import { apiRequest } from './api';

export const listMediaAssets = async () => {
  const res = await apiRequest('/media/assets?limit=500');
  if (!res || !res.ok) return [];
  const data = await res.json();
  return Array.isArray(data?.items) ? data.items : [];
};

export const uploadMediaAsset = async (file) => {
  const mimeType = String(file?.type || '').trim().toLowerCase();
  if (!file || !mimeType) throw new Error('Tipo do arquivo não identificado');
  const res = await apiRequest('/media/assets/stream', {
    method: 'POST',
    headers: {
      'Content-Type': mimeType,
      'X-Onion-Filename': encodeURIComponent(file.name || 'arquivo')
    },
    body: file
  });
  if (!res || !res.ok) {
    const error = res ? await res.json().catch(() => ({})) : {};
    throw new Error(error?.error || 'Falha no upload');
  }
  return res.json();
};
