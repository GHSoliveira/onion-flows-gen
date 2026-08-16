const SPOTIFY_CONTENT_TYPES = new Set(['playlist', 'album', 'track', 'show', 'episode']);

export const normalizeSpotifyContentUrl = (value) => {
  const raw = String(value || '').trim();
  if (!raw) return '';

  const uriMatch = raw.match(/^spotify:(playlist|album|track|show|episode):([A-Za-z0-9]+)$/i);
  if (uriMatch) {
    return `https://open.spotify.com/${uriMatch[1].toLowerCase()}/${uriMatch[2]}`;
  }

  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== 'https:' || parsed.hostname !== 'open.spotify.com') return '';
    const parts = parsed.pathname.split('/').filter(Boolean);
    const contentIndex = parts[0]?.toLowerCase() === 'intl-pt' ? 1 : 0;
    const type = String(parts[contentIndex] || '').toLowerCase();
    const id = String(parts[contentIndex + 1] || '');
    if (!SPOTIFY_CONTENT_TYPES.has(type) || !/^[A-Za-z0-9]+$/.test(id)) return '';
    return `https://open.spotify.com/${type}/${id}`;
  } catch {
    return '';
  }
};

