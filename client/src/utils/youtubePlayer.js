const VIDEO_ID_PATTERN = /^[a-zA-Z0-9_-]{6,20}$/;
const PLAYLIST_ID_PATTERN = /^[a-zA-Z0-9_-]{6,120}$/;

const cleanVideoId = (value) => {
  const id = String(value || '').trim();
  return VIDEO_ID_PATTERN.test(id) ? id : '';
};

const cleanPlaylistId = (value) => {
  const id = String(value || '').trim();
  return PLAYLIST_ID_PATTERN.test(id) ? id : '';
};

export const normalizeYouTubeContent = (value) => {
  const input = String(value || '').trim();
  if (!input) return null;

  if (VIDEO_ID_PATTERN.test(input)) {
    return {
      kind: 'video',
      videoId: input,
      playlistId: '',
      canonicalUrl: `https://www.youtube.com/watch?v=${input}`,
      embedUrl: `https://www.youtube-nocookie.com/embed/${input}`,
    };
  }

  let parsed;
  try {
    parsed = new URL(/^https?:\/\//i.test(input) ? input : `https://${input}`);
  } catch {
    return null;
  }

  const host = parsed.hostname.toLowerCase().replace(/^www\./, '').replace(/^m\./, '');
  const youtubeHost = host === 'youtube.com' || host === 'music.youtube.com' || host === 'youtube-nocookie.com';
  const shortHost = host === 'youtu.be';
  if (!youtubeHost && !shortHost) return null;

  const segments = parsed.pathname.split('/').filter(Boolean);
  const playlistId = cleanPlaylistId(parsed.searchParams.get('list'));
  let videoId = '';

  if (shortHost) videoId = cleanVideoId(segments[0]);
  else if (segments[0] === 'watch') videoId = cleanVideoId(parsed.searchParams.get('v'));
  else if (['embed', 'shorts', 'live'].includes(segments[0])) videoId = cleanVideoId(segments[1]);

  if (videoId) {
    const listSuffix = playlistId ? `&list=${encodeURIComponent(playlistId)}` : '';
    return {
      kind: 'video',
      videoId,
      playlistId,
      canonicalUrl: `https://www.youtube.com/watch?v=${videoId}${listSuffix}`,
      embedUrl: `https://www.youtube-nocookie.com/embed/${videoId}${playlistId ? `?list=${encodeURIComponent(playlistId)}` : ''}`,
    };
  }

  if (playlistId) {
    return {
      kind: 'playlist',
      videoId: '',
      playlistId,
      canonicalUrl: `https://www.youtube.com/playlist?list=${encodeURIComponent(playlistId)}`,
      embedUrl: `https://www.youtube-nocookie.com/embed/videoseries?list=${encodeURIComponent(playlistId)}`,
    };
  }

  return null;
};
