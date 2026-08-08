import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '../..');
const workerScript = path.join(projectRoot, 'scripts', 'transcribe_audio_worker.py');
const localAppData = String(process.env.LOCALAPPDATA || '').trim();
const defaultRuntimeRoot = localAppData
  ? path.join(localAppData, 'Onion', 'runtime')
  : path.join(projectRoot, '.onion-runtime');
const defaultPython = process.platform === 'win32'
  ? path.join(defaultRuntimeRoot, 'transcription-venv', 'Scripts', 'python.exe')
  : path.join(defaultRuntimeRoot, 'transcription-venv', 'bin', 'python');

const MAX_QUEUE_LENGTH = Math.max(1, Number.parseInt(process.env.TRANSCRIPTION_MAX_QUEUE || '8', 10));
const JOB_TIMEOUT_MS = Math.max(
  60_000,
  Number.parseInt(process.env.TRANSCRIPTION_TIMEOUT_MS || `${20 * 60 * 1000}`, 10)
);
const MODEL_NAME = String(process.env.TRANSCRIPTION_MODEL || 'small').trim() || 'small';
const PARTIAL_MODEL_NAME = String(process.env.TRANSCRIPTION_PARTIAL_MODEL || 'base').trim() || 'base';
const ALLOWED_MODELS = new Set([MODEL_NAME, PARTIAL_MODEL_NAME]);
const PYTHON_EXECUTABLE = String(process.env.TRANSCRIPTION_PYTHON || defaultPython).trim();

let worker = null;
let stderrTail = '';
let stdoutBuffer = '';
let activeJob = null;
const queue = [];
const inFlightByKey = new Map();
const warmedModels = new Set();

const resolveModelName = (value) => {
  const requested = String(value || '').trim();
  return ALLOWED_MODELS.has(requested) ? requested : MODEL_NAME;
};

const transcriptionError = (message, code = 'LOCAL_TRANSCRIPTION_FAILED') => {
  const error = new Error(message);
  error.code = code;
  return error;
};

const engineAvailability = () => {
  if (!fs.existsSync(workerScript)) {
    return { ok: false, reason: 'Worker local de transcrição não encontrado.' };
  }
  if (!fs.existsSync(PYTHON_EXECUTABLE)) {
    return {
      ok: false,
      reason: 'Transcrição local ainda não instalada. Execute START.bat novamente.',
    };
  }
  return { ok: true };
};

const finishJob = (job, error, value) => {
  if (!job) return;
  clearTimeout(job.timer);
  activeJob = null;
  inFlightByKey.delete(job.cacheKey);
  if (error) job.reject(error);
  else job.resolve(value);
  queueMicrotask(pumpQueue);
};

const failAllJobs = (error) => {
  const failure = error instanceof Error ? error : transcriptionError(String(error || 'Worker encerrado'));
  if (activeJob) {
    const current = activeJob;
    activeJob = null;
    clearTimeout(current.timer);
    inFlightByKey.delete(current.cacheKey);
    current.reject(failure);
  }
  while (queue.length) {
    const queued = queue.shift();
    inFlightByKey.delete(queued.cacheKey);
    queued.reject(failure);
  }
};

const handleWorkerLine = (line) => {
  let payload;
  try {
    payload = JSON.parse(line);
  } catch {
    return;
  }
  if (!activeJob || String(payload?.id || '') !== activeJob.id) return;
  const job = activeJob;
  if (!payload.ok) {
    finishJob(job, transcriptionError(
      String(payload.error || 'Falha no mecanismo local de transcrição').slice(0, 500),
      'LOCAL_TRANSCRIPTION_WORKER_ERROR'
    ));
    return;
  }
  const responseModel = resolveModelName(payload.model || job.modelName);
  warmedModels.add(responseModel);
  if (payload.warmed === true) {
    finishJob(job, null, { warmed: true, model: responseModel });
    return;
  }
  finishJob(job, null, {
    text: String(payload.text || '').trim().slice(0, 20_000),
    language: String(payload.language || 'pt').slice(0, 16),
    duration: Number(payload.duration || 0) || null,
    model: responseModel,
  });
};

const ensureWorker = () => {
  if (worker && !worker.killed && worker.exitCode === null) return worker;
  const availability = engineAvailability();
  if (!availability.ok) {
    throw transcriptionError(availability.reason, 'LOCAL_TRANSCRIPTION_UNAVAILABLE');
  }

  stderrTail = '';
  stdoutBuffer = '';
  const child = spawn(PYTHON_EXECUTABLE, ['-u', workerScript], {
    cwd: projectRoot,
    windowsHide: true,
    stdio: ['pipe', 'pipe', 'pipe'],
    env: {
      ...process.env,
      PYTHONUTF8: '1',
      PYTHONUNBUFFERED: '1',
      HF_HUB_DISABLE_SYMLINKS_WARNING: '1',
      HF_HOME: String(process.env.HF_HOME || path.join(defaultRuntimeRoot, 'transcription-models')),
      ONION_TRANSCRIPTION_MODEL: MODEL_NAME,
      ONION_TRANSCRIPTION_PARTIAL_MODEL: PARTIAL_MODEL_NAME,
      ONION_TRANSCRIPTION_DEVICE: String(process.env.TRANSCRIPTION_DEVICE || 'cpu'),
      ONION_TRANSCRIPTION_COMPUTE_TYPE: String(process.env.TRANSCRIPTION_COMPUTE_TYPE || 'int8'),
    },
  });
  worker = child;

  child.stdout.on('data', (chunk) => {
    stdoutBuffer += chunk.toString('utf8');
    let newline = stdoutBuffer.indexOf('\n');
    while (newline >= 0) {
      const line = stdoutBuffer.slice(0, newline).trim();
      stdoutBuffer = stdoutBuffer.slice(newline + 1);
      if (line) handleWorkerLine(line);
      newline = stdoutBuffer.indexOf('\n');
    }
  });
  child.stderr.on('data', (chunk) => {
    stderrTail = `${stderrTail}${chunk.toString('utf8')}`.slice(-4_000);
  });
  child.once('error', (error) => {
    if (worker !== child) return;
    worker = null;
    warmedModels.clear();
    failAllJobs(transcriptionError(error?.message || 'Falha ao iniciar o worker local'));
  });
  child.once('exit', (code) => {
    if (worker !== child) return;
    worker = null;
    warmedModels.clear();
    if (activeJob || queue.length) {
      const detail = stderrTail.trim().split(/\r?\n/).slice(-2).join(' ');
      failAllJobs(transcriptionError(
        `Worker local encerrou (código ${code ?? 'desconhecido'})${detail ? `: ${detail}` : ''}`.slice(0, 700)
      ));
    }
  });
  return child;
};

function pumpQueue() {
  if (activeJob || !queue.length) return;
  let child;
  try {
    child = ensureWorker();
  } catch (error) {
    failAllJobs(error);
    return;
  }
  const job = queue.shift();
  activeJob = job;
  job.timer = setTimeout(() => {
    const timeoutError = transcriptionError(
      'A transcrição local excedeu o tempo limite. Tente novamente.',
      'LOCAL_TRANSCRIPTION_TIMEOUT'
    );
    worker?.kill();
    worker = null;
    warmedModels.clear();
    finishJob(job, timeoutError);
  }, JOB_TIMEOUT_MS);
  job.timer.unref?.();
  child.stdin.write(`${JSON.stringify({
    id: job.id,
    action: job.action,
    filePath: job.filePath,
    model: job.modelName,
    beamSize: job.beamSize,
    vadFilter: job.vadFilter,
  })}\n`, (error) => {
    if (error && activeJob?.id === job.id) finishJob(job, error);
  });
}

const enqueueLocalTranscription = ({
  filePath = '',
  cacheKey,
  action = 'transcribe',
  modelName = MODEL_NAME,
  beamSize = 5,
  vadFilter = true,
}) => {
  const safeCacheKey = String(cacheKey || filePath || '').trim();
  if ((action !== 'warmup' && !filePath) || !safeCacheKey) {
    return Promise.reject(transcriptionError('Arquivo de áudio inválido'));
  }
  const existing = inFlightByKey.get(safeCacheKey);
  if (existing) return existing;
  if (queue.length + (activeJob ? 1 : 0) >= MAX_QUEUE_LENGTH + 1) {
    return Promise.reject(transcriptionError(
      'A fila local de transcrição está cheia. Aguarde um áudio terminar.',
      'LOCAL_TRANSCRIPTION_QUEUE_FULL'
    ));
  }

  const promise = new Promise((resolve, reject) => {
    queue.push({
      id: crypto.randomUUID(),
      cacheKey: safeCacheKey,
      filePath,
      action,
      modelName: resolveModelName(modelName),
      beamSize: Math.max(1, Math.min(5, Number.parseInt(beamSize, 10) || 5)),
      vadFilter: vadFilter !== false,
      resolve,
      reject,
      timer: null,
    });
    pumpQueue();
  });
  inFlightByKey.set(safeCacheKey, promise);
  return promise;
};

export const transcribeLocalAudio = ({
  filePath,
  cacheKey,
  modelName = MODEL_NAME,
  beamSize = 5,
  vadFilter = true,
}) => enqueueLocalTranscription({ filePath, cacheKey, modelName, beamSize, vadFilter });

export const warmLocalTranscription = ({ modelName = PARTIAL_MODEL_NAME } = {}) => {
  const safeModelName = resolveModelName(modelName);
  if (warmedModels.has(safeModelName) && worker && !worker.killed && worker.exitCode === null) {
    return Promise.resolve({ warmed: true, model: safeModelName, cached: true });
  }
  return enqueueLocalTranscription({
    action: 'warmup',
    cacheKey: `warmup:${safeModelName}`,
    modelName: safeModelName,
    beamSize: 1,
    vadFilter: false,
  });
};

export const getLocalTranscriptionStatus = () => ({
  ...engineAvailability(),
  model: MODEL_NAME,
  partialModel: PARTIAL_MODEL_NAME,
  active: Boolean(activeJob),
  queued: queue.length,
  concurrency: 1,
});

const stopWorker = () => {
  try { worker?.stdin?.end(); } catch {}
  try { worker?.kill(); } catch {}
  worker = null;
  warmedModels.clear();
};

process.once('exit', stopWorker);
process.once('SIGINT', stopWorker);
process.once('SIGTERM', stopWorker);
