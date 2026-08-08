import { useEffect, useRef, useState } from 'react';
import { Loader2, Mic, Square, X } from 'lucide-react';
import toast from 'react-hot-toast';
import { transcribeDictation } from '../services/dictation';
import { socketService } from '../services/socket';

const MAX_RECORDING_SECONDS = 120;
const PARTIAL_MIN_SECONDS = 0.9;
const PARTIAL_MAX_SECONDS = 7;
const PARTIAL_OVERLAP_SECONDS = 0.3;
const TARGET_SAMPLE_RATE = 16_000;
const MIN_SIGNAL_RMS = 0.0015;
const MIN_SIGNAL_PEAK = 0.006;
const MIME_CANDIDATES = [
  'audio/webm;codecs=opus',
  'audio/ogg;codecs=opus',
  'audio/webm',
  'audio/mp4',
];

const formatSeconds = (value) => {
  const seconds = Math.max(0, Math.floor(Number(value) || 0));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
};

const stopStream = (stream) => {
  stream?.getTracks?.().forEach((track) => track.stop());
};

const normalizeMergeWord = (value) => String(value || '')
  .normalize('NFKD')
  .replace(/[\u0300-\u036f]/g, '')
  .toLowerCase()
  .replace(/[^a-z0-9]/g, '');

const mergeTranscript = (current, incoming) => {
  const before = String(current || '').trim();
  const next = String(incoming || '').trim();
  if (!before) return next;
  if (!next) return before;
  const beforeWords = before.split(/\s+/);
  const nextWords = next.split(/\s+/);
  const maximumOverlap = Math.min(8, beforeWords.length, nextWords.length);
  for (let size = maximumOverlap; size > 0; size -= 1) {
    const left = beforeWords.slice(-size).map(normalizeMergeWord).join('|');
    const right = nextWords.slice(0, size).map(normalizeMergeWord).join('|');
    if (left && left === right) return [...beforeWords, ...nextWords.slice(size)].join(' ');
  }
  return `${before} ${next}`;
};

const flattenSamples = (chunks, totalLength) => {
  const output = new Float32Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.length;
  }
  return output;
};

const calculateRms = (samples) => {
  if (!samples?.length) return 0;
  let sumSquares = 0;
  for (let index = 0; index < samples.length; index += 1) {
    sumSquares += samples[index] * samples[index];
  }
  return Math.sqrt(sumSquares / samples.length);
};

const downsampleTo16Khz = (input, inputRate) => {
  if (inputRate === TARGET_SAMPLE_RATE) return input;
  const ratio = inputRate / TARGET_SAMPLE_RATE;
  const outputLength = Math.max(1, Math.floor(input.length / ratio));
  const output = new Float32Array(outputLength);
  for (let index = 0; index < outputLength; index += 1) {
    const start = Math.floor(index * ratio);
    const end = Math.min(input.length, Math.max(start + 1, Math.floor((index + 1) * ratio)));
    let sum = 0;
    for (let cursor = start; cursor < end; cursor += 1) sum += input[cursor];
    output[index] = sum / Math.max(1, end - start);
  }
  return output;
};

const encodePcm16Wav = (samples) => {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  const writeText = (offset, text) => {
    for (let index = 0; index < text.length; index += 1) view.setUint8(offset + index, text.charCodeAt(index));
  };
  writeText(0, 'RIFF');
  view.setUint32(4, 36 + samples.length * 2, true);
  writeText(8, 'WAVE');
  writeText(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, TARGET_SAMPLE_RATE, true);
  view.setUint32(28, TARGET_SAMPLE_RATE * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeText(36, 'data');
  view.setUint32(40, samples.length * 2, true);
  for (let index = 0; index < samples.length; index += 1) {
    const sample = Math.max(-1, Math.min(1, samples[index]));
    view.setInt16(44 + index * 2, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
  }
  return buffer;
};

const DictationRecorder = ({
  chatId,
  disabled = false,
  onPartial,
  onStatusChange,
  onTranscribed,
}) => {
  const [status, setStatus] = useState('idle');
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [inputLevel, setInputLevel] = useState(0);
  const [signalDetected, setSignalDetected] = useState(false);
  const [captureNotice, setCaptureNotice] = useState('');
  const recorderRef = useRef(null);
  const streamRef = useRef(null);
  const chunksRef = useRef([]);
  const startedAtRef = useRef(0);
  const canceledRef = useRef(false);
  const intervalRef = useRef(null);
  const partialTimerRef = useRef(null);
  const stopTimerRef = useRef(null);
  const requestControllerRef = useRef(null);
  const mountedRef = useRef(true);
  const disabledRef = useRef(disabled);
  const statusRef = useRef('idle');
  const audioContextRef = useRef(null);
  const audioSourceRef = useRef(null);
  const audioProcessorRef = useRef(null);
  const silentGainRef = useRef(null);
  const pcmChunksRef = useRef([]);
  const pcmLengthRef = useRef(0);
  const fullPcmChunksRef = useRef([]);
  const fullPcmLengthRef = useRef(0);
  const sampleRateRef = useRef(48_000);
  const signalSumSquaresRef = useRef(0);
  const signalSampleCountRef = useRef(0);
  const signalPeakRef = useRef(0);
  const lastLevelUpdateRef = useRef(0);
  const partialInFlightRef = useRef(false);
  const partialSequenceRef = useRef(0);
  const partialSessionRef = useRef(0);
  const liveTextRef = useRef('');

  const updateStatus = (nextStatus) => {
    statusRef.current = nextStatus;
    if (mountedRef.current) setStatus(nextStatus);
    onStatusChange?.(nextStatus);
  };

  const clearTimers = () => {
    if (intervalRef.current) window.clearInterval(intervalRef.current);
    if (partialTimerRef.current) window.clearInterval(partialTimerRef.current);
    if (stopTimerRef.current) window.clearTimeout(stopTimerRef.current);
    intervalRef.current = null;
    partialTimerRef.current = null;
    stopTimerRef.current = null;
  };

  const releaseRealtimeCapture = () => {
    if (audioProcessorRef.current) audioProcessorRef.current.onaudioprocess = null;
    try { audioSourceRef.current?.disconnect(); } catch {}
    try { audioProcessorRef.current?.disconnect(); } catch {}
    try { silentGainRef.current?.disconnect(); } catch {}
    audioSourceRef.current = null;
    audioProcessorRef.current = null;
    silentGainRef.current = null;
    const context = audioContextRef.current;
    audioContextRef.current = null;
    if (context && context.state !== 'closed') void context.close().catch(() => {});
    pcmChunksRef.current = [];
    pcmLengthRef.current = 0;
    fullPcmChunksRef.current = [];
    fullPcmLengthRef.current = 0;
  };

  const releaseRecorder = () => {
    clearTimers();
    releaseRealtimeCapture();
    stopStream(streamRef.current);
    streamRef.current = null;
    recorderRef.current = null;
  };

  const consumePartialSamples = () => {
    const inputRate = sampleRateRef.current;
    const minimumSamples = Math.floor(inputRate * PARTIAL_MIN_SECONDS);
    if (pcmLengthRef.current < minimumSamples) return null;
    const allSamples = flattenSamples(pcmChunksRef.current, pcmLengthRef.current);
    const maximumSamples = Math.floor(inputRate * PARTIAL_MAX_SECONDS);
    const selected = allSamples.length > maximumSamples ? allSamples.slice(-maximumSamples) : allSamples;
    const overlapSamples = Math.min(selected.length, Math.floor(inputRate * PARTIAL_OVERLAP_SECONDS));
    const overlap = selected.slice(-overlapSamples);
    pcmChunksRef.current = overlap.length ? [overlap] : [];
    pcmLengthRef.current = overlap.length;
    return selected;
  };

  const sendPartial = async (sessionId) => {
    if (
      statusRef.current !== 'recording'
      || partialInFlightRef.current
      || sessionId !== partialSessionRef.current
      || !socketService.isConnected()
    ) return;
    const samples = consumePartialSamples();
    if (!samples) return;
    if (calculateRms(samples) < MIN_SIGNAL_RMS) return;
    const downsampled = downsampleTo16Khz(samples, sampleRateRef.current);
    const durationSeconds = downsampled.length / TARGET_SAMPLE_RATE;
    const audio = encodePcm16Wav(downsampled);
    const sequence = partialSequenceRef.current + 1;
    partialSequenceRef.current = sequence;
    partialInFlightRef.current = true;
    try {
      const result = await socketService.transcribeDictationPartial({
        chatId,
        sequence,
        audio,
        durationSeconds,
      });
      if (!result?.ok) {
        const ignored = result?.code === 'DICTATION_BUSY' || result?.code === 'DICTATION_THROTTLED';
        if (!ignored && mountedRef.current) {
          setCaptureNotice('Prévia indisponível; a revisão final continua.');
        }
        return;
      }
      if (
        statusRef.current !== 'recording'
        || sessionId !== partialSessionRef.current
        || Number(result.sequence) !== sequence
      ) return;
      if (mountedRef.current) setCaptureNotice('Ouvindo…');
      liveTextRef.current = mergeTranscript(liveTextRef.current, result.text);
      onPartial?.(liveTextRef.current);
    } catch {
      if (mountedRef.current) setCaptureNotice('Prévia indisponível; a revisão final continua.');
    } finally {
      partialInFlightRef.current = false;
    }
  };

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      canceledRef.current = true;
      partialSessionRef.current += 1;
      requestControllerRef.current?.abort();
      const recorder = recorderRef.current;
      recorderRef.current = null;
      if (recorder?.state === 'recording') {
        try { recorder.stop(); } catch {}
      }
      releaseRecorder();
    };
  }, []);

  useEffect(() => {
    disabledRef.current = disabled;
    if (!disabled) return;
    requestControllerRef.current?.abort();
    if (recorderRef.current?.state === 'recording') {
      canceledRef.current = true;
      partialSessionRef.current += 1;
      chunksRef.current = [];
      onPartial?.('');
      try { recorderRef.current.stop(); } catch {}
      updateStatus('idle');
      setElapsedSeconds(0);
    }
  }, [disabled]);

  const finishRecording = () => {
    const recorder = recorderRef.current;
    if (recorder?.state === 'recording') recorder.stop();
  };

  const cancelRecording = () => {
    if (statusRef.current !== 'recording') return;
    canceledRef.current = true;
    partialSessionRef.current += 1;
    chunksRef.current = [];
    liveTextRef.current = '';
    onPartial?.('');
    setInputLevel(0);
    setSignalDetected(false);
    setCaptureNotice('');
    finishRecording();
    updateStatus('idle');
    setElapsedSeconds(0);
  };

  const transcribeRecording = async (blob, durationSeconds) => {
    if (!mountedRef.current || canceledRef.current) return;
    updateStatus('transcribing');
    const controller = new AbortController();
    requestControllerRef.current = controller;
    try {
      const result = await transcribeDictation({
        chatId,
        audioBlob: blob,
        durationSeconds,
        signal: controller.signal,
      });
      if (!mountedRef.current || controller.signal.aborted) return;
      const text = String(result?.text || liveTextRef.current || '').trim();
      onPartial?.('');
      if (!text) {
        toast.error('Não identifiquei fala nessa gravação.');
      } else {
        onTranscribed?.(text);
        toast.success('Ditado revisado e inserido no rascunho.');
      }
    } catch (error) {
      if (error?.name !== 'AbortError' && mountedRef.current) {
        const fallback = String(liveTextRef.current || '').trim();
        onPartial?.('');
        if (fallback) {
          onTranscribed?.(fallback);
          toast.error('A revisão final falhou; mantive a prévia local no rascunho.');
        } else {
          toast.error(error?.message || 'Falha ao transcrever a gravação.');
        }
      }
    } finally {
      liveTextRef.current = '';
      if (mountedRef.current) {
        updateStatus('idle');
        setElapsedSeconds(0);
      }
      requestControllerRef.current = null;
    }
  };

  const startRealtimeCapture = async (stream, sessionId) => {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return false;
    const context = new AudioContextClass({ latencyHint: 'interactive' });
    await context.resume();
    const source = context.createMediaStreamSource(stream);
    const processor = context.createScriptProcessor(4096, 1, 1);
    const silentGain = context.createGain();
    silentGain.gain.value = 0;
    sampleRateRef.current = context.sampleRate;
    processor.onaudioprocess = (event) => {
      if (statusRef.current !== 'recording' || sessionId !== partialSessionRef.current) return;
      const input = event.inputBuffer.getChannelData(0);
      const copy = new Float32Array(input.length);
      copy.set(input);
      pcmChunksRef.current.push(copy);
      pcmLengthRef.current += copy.length;
      fullPcmChunksRef.current.push(copy);
      fullPcmLengthRef.current += copy.length;
      let chunkSumSquares = 0;
      let chunkPeak = 0;
      for (let index = 0; index < copy.length; index += 1) {
        const sample = copy[index];
        const absolute = Math.abs(sample);
        chunkSumSquares += sample * sample;
        if (absolute > chunkPeak) chunkPeak = absolute;
      }
      signalSumSquaresRef.current += chunkSumSquares;
      signalSampleCountRef.current += copy.length;
      signalPeakRef.current = Math.max(signalPeakRef.current, chunkPeak);
      const now = performance.now();
      if (now - lastLevelUpdateRef.current >= 80 && mountedRef.current) {
        const rms = Math.sqrt(chunkSumSquares / Math.max(1, copy.length));
        setInputLevel(Math.min(1, rms * 22));
        if (rms >= MIN_SIGNAL_RMS || chunkPeak >= MIN_SIGNAL_PEAK) setSignalDetected(true);
        lastLevelUpdateRef.current = now;
      }
      const maximumBufferedSamples = Math.floor(context.sampleRate * PARTIAL_MAX_SECONDS);
      while (pcmLengthRef.current > maximumBufferedSamples && pcmChunksRef.current.length > 1) {
        const removed = pcmChunksRef.current.shift();
        pcmLengthRef.current -= removed.length;
      }
    };
    source.connect(processor);
    processor.connect(silentGain);
    silentGain.connect(context.destination);
    audioContextRef.current = context;
    audioSourceRef.current = source;
    audioProcessorRef.current = processor;
    silentGainRef.current = silentGain;
    partialTimerRef.current = window.setInterval(() => void sendPartial(sessionId), 400);
    return true;
  };

  const startRecording = async () => {
    if (disabled || statusRef.current !== 'idle') return;
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      toast.error('Este navegador não oferece gravação local de áudio.');
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      if (!mountedRef.current || disabledRef.current) {
        stopStream(stream);
        return;
      }
      const mimeType = MIME_CANDIDATES.find((candidate) => MediaRecorder.isTypeSupported?.(candidate)) || '';
      const recorder = new MediaRecorder(stream, {
        ...(mimeType ? { mimeType } : {}),
        audioBitsPerSecond: 32_000,
      });
      const sessionId = partialSessionRef.current + 1;
      partialSessionRef.current = sessionId;
      streamRef.current = stream;
      recorderRef.current = recorder;
      chunksRef.current = [];
      pcmChunksRef.current = [];
      pcmLengthRef.current = 0;
      fullPcmChunksRef.current = [];
      fullPcmLengthRef.current = 0;
      signalSumSquaresRef.current = 0;
      signalSampleCountRef.current = 0;
      signalPeakRef.current = 0;
      lastLevelUpdateRef.current = 0;
      partialSequenceRef.current = 0;
      liveTextRef.current = '';
      canceledRef.current = false;
      startedAtRef.current = Date.now();
      onPartial?.('');
      setInputLevel(0);
      setSignalDetected(false);
      setCaptureNotice('Ouvindo…');

      recorder.ondataavailable = (event) => {
        if (!canceledRef.current && event.data?.size > 0) chunksRef.current.push(event.data);
      };
      recorder.onerror = () => {
        canceledRef.current = true;
        partialSessionRef.current += 1;
        chunksRef.current = [];
        onPartial?.('');
        releaseRecorder();
        if (mountedRef.current) {
          updateStatus('idle');
          toast.error('A gravação foi interrompida pelo navegador.');
        }
      };
      recorder.onstop = () => {
        const durationSeconds = Math.max(1, (Date.now() - startedAtRef.current) / 1000);
        const parts = canceledRef.current ? [] : chunksRef.current;
        const recordedMime = recorder.mimeType || mimeType || 'audio/webm';
        const fullPcm = fullPcmLengthRef.current > 0
          ? flattenSamples(fullPcmChunksRef.current, fullPcmLengthRef.current)
          : null;
        const averageRms = signalSampleCountRef.current > 0
          ? Math.sqrt(signalSumSquaresRef.current / signalSampleCountRef.current)
          : 0;
        const peak = signalPeakRef.current;
        chunksRef.current = [];
        releaseRecorder();
        if (canceledRef.current || (!fullPcm?.length && !parts.length) || !mountedRef.current) return;
        setInputLevel(0);
        setSignalDetected(false);
        setCaptureNotice('');
        const hasMeasuredSignal = Boolean(fullPcm?.length)
          && (averageRms >= MIN_SIGNAL_RMS || peak >= MIN_SIGNAL_PEAK);
        if (fullPcm?.length && !hasMeasuredSignal && !liveTextRef.current) {
          onPartial?.('');
          updateStatus('idle');
          setElapsedSeconds(0);
          toast.error('O microfone foi aberto, mas não entrou som. Confira o dispositivo de entrada do Windows/Chrome.');
          return;
        }
        const blob = fullPcm?.length
          ? new Blob([
            encodePcm16Wav(downsampleTo16Khz(fullPcm, sampleRateRef.current)),
          ], { type: 'audio/wav' })
          : new Blob(parts, { type: recordedMime });
        if (blob.size < 256) {
          onPartial?.('');
          updateStatus('idle');
          toast.error('A gravação ficou curta demais.');
          return;
        }
        void transcribeRecording(blob, durationSeconds);
      };

      updateStatus('recording');
      recorder.start(250);
      const realtimeReady = await startRealtimeCapture(stream, sessionId);
      if (!realtimeReady && mountedRef.current) {
        setCaptureNotice('Sem prévia ao vivo; gravando para revisão final.');
      }
      if (realtimeReady && socketService.isConnected()) {
        void socketService.warmDictation(chatId).catch(() => {});
      }
      setElapsedSeconds(0);
      intervalRef.current = window.setInterval(() => {
        const elapsed = Math.min(MAX_RECORDING_SECONDS, (Date.now() - startedAtRef.current) / 1000);
        if (mountedRef.current) setElapsedSeconds(elapsed);
      }, 250);
      stopTimerRef.current = window.setTimeout(finishRecording, MAX_RECORDING_SECONDS * 1000);
    } catch (error) {
      canceledRef.current = true;
      partialSessionRef.current += 1;
      onPartial?.('');
      releaseRecorder();
      updateStatus('idle');
      setInputLevel(0);
      setSignalDetected(false);
      setCaptureNotice('');
      const denied = error?.name === 'NotAllowedError' || error?.name === 'SecurityError';
      toast.error(denied
        ? 'Permita o acesso ao microfone para usar o ditado.'
        : 'Não foi possível iniciar o microfone.');
    }
  };

  if (status === 'recording') {
    const meterWidth = `${Math.max(4, Math.round(inputLevel * 100))}%`;
    return (
      <div title={captureNotice} className="flex h-9 shrink-0 items-center gap-1 rounded-xl border border-red-200 bg-red-50 px-1.5 text-red-600 shadow-sm dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-300">
        <button type="button" onClick={finishRecording} title="Parar e revisar" aria-label="Parar e revisar" className="flex h-7 items-center gap-1.5 rounded-lg px-1.5 text-[11px] font-bold hover:bg-red-100 dark:hover:bg-red-900/30">
          <span className="h-2 w-2 animate-pulse rounded-full bg-red-500" />
          {formatSeconds(elapsedSeconds)}
          <span className="h-1.5 w-7 overflow-hidden rounded-full bg-red-200 dark:bg-red-900/60" aria-label="Nível do microfone">
            <span className="block h-full rounded-full bg-red-500 transition-[width] duration-75" style={{ width: meterWidth }} />
          </span>
          {elapsedSeconds >= 1.5 && !signalDetected ? <span className="text-[9px] font-semibold">sem sinal</span> : null}
          <Square size={10} fill="currentColor" />
        </button>
        <button type="button" onClick={cancelRecording} title="Cancelar gravação" aria-label="Cancelar gravação" className="flex h-7 w-7 items-center justify-center rounded-lg hover:bg-red-100 dark:hover:bg-red-900/30"><X size={13} /></button>
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={startRecording}
      disabled={disabled || status === 'transcribing'}
      title={status === 'transcribing' ? 'Revisando o ditado local…' : 'Ditar mensagem em tempo real'}
      aria-label={status === 'transcribing' ? 'Revisando ditado' : 'Ditar mensagem em tempo real'}
      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-slate-200 bg-slate-50 text-slate-600 transition-colors hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
    >
      {status === 'transcribing' ? <Loader2 size={15} className="animate-spin" /> : <Mic size={15} />}
    </button>
  );
};

export default DictationRecorder;
