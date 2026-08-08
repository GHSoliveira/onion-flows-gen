import os from 'node:os';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import adapter from '../../db/DatabaseAdapter.js';
import { detectMime } from '../utils/fileType.js';
import { generateId } from '../utils/helpers.js';
import { transcribeLocalAudio, warmLocalTranscription } from './localAudioTranscription.js';

const PARTIAL_MODEL = String(process.env.TRANSCRIPTION_PARTIAL_MODEL || 'base').trim() || 'base';
const MAX_PARTIAL_BYTES = 512 * 1024;
const MAX_PARTIAL_SECONDS = 8;
const MIN_PARTIAL_INTERVAL_MS = 700;
const TEMP_ROOT = path.join(os.tmpdir(), 'onion-flows-dictation-live');
const OPERATIONAL_ROLES = new Set(['AGENT', 'ADMIN', 'SUPER_ADMIN']);

const asAudioBuffer = (value) => {
  if (Buffer.isBuffer(value)) return value;
  if (value instanceof ArrayBuffer) return Buffer.from(value);
  if (ArrayBuffer.isView(value)) return Buffer.from(value.buffer, value.byteOffset, value.byteLength);
  return null;
};

const loadAuthorizedChat = async (socket, rawChatId) => {
  const chatId = String(rawChatId || '').trim().slice(0, 200);
  if (!chatId || !socket.userId || !OPERATIONAL_ROLES.has(String(socket.userRole || ''))) {
    return { ok: false, error: 'Ditado não autorizado.', code: 'FORBIDDEN' };
  }
  const chat = await adapter.getDocument('activeChats', { id: chatId });
  if (!chat) return { ok: false, error: 'Atendimento não encontrado.', code: 'CHAT_NOT_FOUND' };
  if (socket.userRole !== 'SUPER_ADMIN' && String(chat.tenantId || '') !== String(socket.tenantId || '')) {
    return { ok: false, error: 'Atendimento fora do tenant atual.', code: 'FORBIDDEN' };
  }
  if (!chat.agentId || String(chat.agentId) !== String(socket.userId)) {
    return { ok: false, error: 'Atendimento atribuído a outro agente.', code: 'CHAT_NOT_ASSIGNED' };
  }
  if (chat.status === 'waiting' || chat.outreachPendingReply === true) {
    return { ok: false, error: 'O envio está bloqueado neste atendimento.', code: 'CHAT_LOCKED' };
  }
  return { ok: true, chat };
};

const acknowledge = (ack, payload) => {
  if (typeof ack === 'function') ack(payload);
};

export const registerLocalDictationHandlers = (socket) => {
  let partialInFlight = false;
  let lastPartialAt = 0;

  socket.on('dictation:warmup', async (payload = {}, ack) => {
    try {
      if (socket.isGenesysExtension) {
        acknowledge(ack, { ok: false, code: 'FORBIDDEN', error: 'Cliente de socket inválido.' });
        return;
      }
      const access = await loadAuthorizedChat(socket, payload.chatId);
      if (!access.ok) {
        acknowledge(ack, access);
        return;
      }
      const result = await warmLocalTranscription({ modelName: PARTIAL_MODEL });
      acknowledge(ack, { ok: true, model: result.model, cached: result.cached === true });
    } catch (error) {
      acknowledge(ack, {
        ok: false,
        code: String(error?.code || 'DICTATION_WARMUP_FAILED'),
        error: String(error?.message || 'Falha ao preparar o ditado local').slice(0, 300),
      });
    }
  });

  socket.on('dictation:partial', async (payload = {}, ack) => {
    let filePath = '';
    try {
      if (socket.isGenesysExtension) {
        acknowledge(ack, { ok: false, code: 'FORBIDDEN', error: 'Cliente de socket inválido.' });
        return;
      }
      if (partialInFlight) {
        acknowledge(ack, { ok: false, code: 'DICTATION_BUSY', error: 'Prévia anterior ainda em processamento.' });
        return;
      }
      const now = Date.now();
      if (now - lastPartialAt < MIN_PARTIAL_INTERVAL_MS) {
        acknowledge(ack, { ok: false, code: 'DICTATION_THROTTLED', error: 'Prévia enviada cedo demais.' });
        return;
      }
      const access = await loadAuthorizedChat(socket, payload.chatId);
      if (!access.ok) {
        acknowledge(ack, access);
        return;
      }

      const audio = asAudioBuffer(payload.audio);
      const durationSeconds = Number(payload.durationSeconds || 0);
      const sequence = Math.max(0, Number.parseInt(payload.sequence, 10) || 0);
      if (!audio || audio.length < 256 || audio.length > MAX_PARTIAL_BYTES) {
        acknowledge(ack, { ok: false, code: 'INVALID_AUDIO', error: 'Bloco de áudio inválido.' });
        return;
      }
      if (!Number.isFinite(durationSeconds) || durationSeconds < 0.5 || durationSeconds > MAX_PARTIAL_SECONDS) {
        acknowledge(ack, { ok: false, code: 'INVALID_DURATION', error: 'Duração do bloco inválida.' });
        return;
      }
      if (detectMime(audio.subarray(0, 64)) !== 'audio/wav') {
        acknowledge(ack, { ok: false, code: 'INVALID_AUDIO', error: 'O bloco não contém PCM WAV válido.' });
        return;
      }

      partialInFlight = true;
      lastPartialAt = now;
      await fs.mkdir(TEMP_ROOT, { recursive: true });
      filePath = path.join(TEMP_ROOT, `${generateId('partial')}.wav`);
      await fs.writeFile(filePath, audio, { flag: 'wx' });
      const result = await transcribeLocalAudio({
        filePath,
        cacheKey: `dictation-partial:${socket.id}:${sequence}:${generateId('job')}`,
        modelName: PARTIAL_MODEL,
        beamSize: 1,
        vadFilter: false,
      });
      acknowledge(ack, {
        ok: true,
        sequence,
        text: String(result.text || '').trim().slice(0, 4_000),
        model: result.model,
        duration: result.duration,
      });
    } catch (error) {
      acknowledge(ack, {
        ok: false,
        code: String(error?.code || 'DICTATION_PARTIAL_FAILED'),
        error: String(error?.message || 'Falha na prévia local').slice(0, 300),
      });
    } finally {
      partialInFlight = false;
      if (filePath) await fs.unlink(filePath).catch(() => {});
    }
  });
};
