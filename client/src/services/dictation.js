import { apiRequest } from './api';

export const transcribeDictation = async ({ chatId, audioBlob, durationSeconds, signal }) => {
  const safeChatId = String(chatId || '').trim();
  if (!safeChatId || !(audioBlob instanceof Blob) || audioBlob.size <= 0) {
    throw new Error('Gravação inválida');
  }
  const mimeType = String(audioBlob.type || 'audio/webm').trim().toLowerCase();
  const response = await apiRequest(`/chats/${encodeURIComponent(safeChatId)}/dictation`, {
    method: 'POST',
    headers: {
      'Content-Type': mimeType,
      'X-Onion-Duration-Seconds': String(Math.max(1, Math.ceil(Number(durationSeconds) || 0))),
    },
    body: audioBlob,
    signal,
  });
  const payload = response ? await response.json().catch(() => ({})) : {};
  if (!response?.ok) {
    const error = new Error(payload?.error || 'Falha ao transformar a gravação em texto');
    error.code = payload?.code || 'LOCAL_DICTATION_FAILED';
    throw error;
  }
  return payload?.transcription || { text: '' };
};
