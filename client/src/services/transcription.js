import { apiRequest } from './api';

export const transcribeChatAudio = async ({ chatId, messageId }) => {
  const safeChatId = String(chatId || '').trim();
  const safeMessageId = String(messageId || '').trim();
  if (!safeChatId || !safeMessageId) throw new Error('Chat ou mensagem inválida');
  const response = await apiRequest(
    `/chats/${encodeURIComponent(safeChatId)}/messages/${encodeURIComponent(safeMessageId)}/transcribe`,
    { method: 'POST' }
  );
  const payload = response ? await response.json().catch(() => ({})) : {};
  if (!response?.ok) {
    const error = new Error(payload?.error || 'Falha ao transcrever o áudio');
    error.code = payload?.code || 'LOCAL_TRANSCRIPTION_FAILED';
    throw error;
  }
  return payload;
};
