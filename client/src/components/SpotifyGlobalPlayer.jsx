import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { AudioLines, ChevronDown, ChevronLeft, ChevronRight, Disc3, ExternalLink, Library, Loader2, Music2, Pause, Play, Save, Search, SkipBack, SkipForward, Trash2, Volume2, VolumeX, X } from 'lucide-react';
import {
  getPlaybackSafetySnapshot,
  subscribePlaybackSafety,
} from '../services/playbackSafety';
import { normalizeSpotifyContentUrl } from '../utils/spotifyPlayer';
import SpotifyAccountSettings from './SpotifyAccountSettings';
import { getSpotifyAuthSnapshot, spotifyApiRequest, startSpotifyAuthorization, subscribeSpotifyAuth } from '../services/spotifyAuth';
import { useSpotifyWebPlayback } from '../hooks/useSpotifyWebPlayback';

const SPOTIFY_BRIDGE_PATH = '/spotify-embed-bridge.html';
const SPOTIFY_BRIDGE_COMMAND = 'onion:spotify:bridge:command';
const SPOTIFY_BRIDGE_EVENT = 'onion:spotify:bridge:event';
const spotifyMetadataCache = new Map();
const spotifyAlbumTracksCache = new Map();
const spotifyAlbumSearchCache = new Map();
const SAVED_ALBUMS_PAGE_SIZE = 12;
const ALBUM_SEARCH_LIMIT = 8;

const SpotifyGlyph = ({ size = 17, className = '' }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true" className={className}>
    <circle cx="12" cy="12" r="9.25" stroke="currentColor" strokeWidth="1.5" />
    <path d="M6.6 9.2c3.9-1.15 7.85-.8 11.25 1.05M7.35 12.25c3.25-.85 6.65-.5 9.45 1M8.05 15.1c2.55-.6 5.15-.3 7.35.85" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" />
  </svg>
);

const formatPlaybackTime = (milliseconds) => {
  const seconds = Math.max(0, Math.floor((Number(milliseconds) || 0) / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
};

const loadSpotifyMetadata = async (url, signal) => {
  const normalized = normalizeSpotifyContentUrl(url);
  if (!normalized) return null;
  if (spotifyMetadataCache.has(normalized)) return spotifyMetadataCache.get(normalized);
  const response = await fetch(`https://open.spotify.com/oembed?url=${encodeURIComponent(normalized)}`, {
    method: 'GET',
    signal,
    credentials: 'omit',
  });
  if (!response.ok) throw new Error(`spotify_oembed_${response.status}`);
  const payload = await response.json();
  const metadata = {
    title: String(payload?.title || 'Spotify').trim(),
    thumbnailUrl: String(payload?.thumbnail_url || '').trim(),
  };
  spotifyMetadataCache.set(normalized, metadata);
  return metadata;
};

const loadSpotifyAlbumTracks = async (url) => {
  const normalized = normalizeSpotifyContentUrl(url);
  if (!normalized) return [];
  const parsed = new URL(normalized);
  const [type, id] = parsed.pathname.split('/').filter(Boolean);
  if (type !== 'album' || !id) return [];
  if (spotifyAlbumTracksCache.has(normalized)) return spotifyAlbumTracksCache.get(normalized);
  const request = spotifyApiRequest(`/albums/${encodeURIComponent(id)}`)
    .then((response) => response.json())
    .then((album) => {
      const thumbnailUrl = String(album?.images?.[0]?.url || '');
      return (Array.isArray(album?.tracks?.items) ? album.tracks.items : [])
        .filter((track) => String(track?.uri || '').startsWith('spotify:track:'))
        .map((track) => ({
          uri: String(track.uri),
          title: String(track.name || 'Faixa'),
          artist: Array.isArray(track.artists) ? track.artists.map((artist) => artist?.name).filter(Boolean).join(', ') : '',
          thumbnailUrl,
          trackNumber: Number(track.track_number) || 0,
        }));
    })
    .catch((error) => {
      spotifyAlbumTracksCache.delete(normalized);
      throw error;
    });
  spotifyAlbumTracksCache.set(normalized, request);
  return request;
};

const loadSpotifySavedAlbums = async (cache, offset = 0) => {
  const safeOffset = Math.max(0, Number(offset) || 0);
  const cacheKey = `${safeOffset}:${SAVED_ALBUMS_PAGE_SIZE}`;
  if (cache.has(cacheKey)) return cache.get(cacheKey);
  const request = spotifyApiRequest(`/me/albums?limit=${SAVED_ALBUMS_PAGE_SIZE}&offset=${safeOffset}`)
    .then((response) => response.json())
    .then((payload) => ({
      total: Math.max(0, Number(payload?.total) || 0),
      offset: Math.max(0, Number(payload?.offset) || safeOffset),
      albums: (Array.isArray(payload?.items) ? payload.items : [])
        .map((item) => item?.album)
        .filter((album) => album?.id)
        .map((album) => ({
          id: String(album.id),
          uri: String(album.uri || `spotify:album:${album.id}`),
          url: String(album?.external_urls?.spotify || `https://open.spotify.com/album/${album.id}`),
          name: String(album.name || 'Álbum'),
          artist: Array.isArray(album.artists) ? album.artists.map((artist) => artist?.name).filter(Boolean).join(', ') : '',
          image: String(album?.images?.[1]?.url || album?.images?.[0]?.url || ''),
          year: String(album?.release_date || '').slice(0, 4),
        })),
    }))
    .catch((error) => {
      cache.delete(cacheKey);
      throw error;
    });
  cache.set(cacheKey, request);
  return request;
};

const mapSpotifyAlbum = (album) => ({
  id: String(album.id),
  uri: String(album.uri || `spotify:album:${album.id}`),
  url: String(album?.external_urls?.spotify || `https://open.spotify.com/album/${album.id}`),
  name: String(album.name || 'Álbum'),
  artist: Array.isArray(album.artists) ? album.artists.map((artist) => artist?.name).filter(Boolean).join(', ') : '',
  image: String(album?.images?.[1]?.url || album?.images?.[0]?.url || ''),
  year: String(album?.release_date || '').slice(0, 4),
});

const searchSpotifyAlbums = async (query) => {
  const normalizedQuery = String(query || '').trim().replace(/\s+/g, ' ');
  if (normalizedQuery.length < 2) return [];
  const cacheKey = normalizedQuery.toLocaleLowerCase('pt-BR');
  if (spotifyAlbumSearchCache.has(cacheKey)) return spotifyAlbumSearchCache.get(cacheKey);
  const request = spotifyApiRequest(`/search?type=album&limit=${ALBUM_SEARCH_LIMIT}&q=${encodeURIComponent(normalizedQuery)}`)
    .then((response) => response.json())
    .then((payload) => (Array.isArray(payload?.albums?.items) ? payload.albums.items : [])
      .filter((album) => album?.id)
      .map(mapSpotifyAlbum))
    .catch((error) => {
      spotifyAlbumSearchCache.delete(cacheKey);
      throw error;
    });
  spotifyAlbumSearchCache.set(cacheKey, request);
  return request;
};

const spotifyStorageKey = (userId) => `onionSpotifyContent:${userId || 'anon'}`;

const readSavedUrl = (userId) => {
  try {
    return normalizeSpotifyContentUrl(localStorage.getItem(spotifyStorageKey(userId)) || '');
  } catch {
    return '';
  }
};

const useLocalAudioActivity = () => {
  const [activeAudioCount, setActiveAudioCount] = useState(0);

  useEffect(() => {
    const playing = new Set();
    const sync = () => setActiveAudioCount(playing.size);
    const isAudio = (target) => target instanceof HTMLAudioElement;
    const markPlaying = (event) => {
      if (!isAudio(event.target)) return;
      playing.add(event.target);
      sync();
    };
    const markStopped = (event) => {
      if (!isAudio(event.target)) return;
      playing.delete(event.target);
      sync();
    };

    document.addEventListener('play', markPlaying, true);
    ['pause', 'ended', 'emptied', 'abort', 'error'].forEach((name) => {
      document.addEventListener(name, markStopped, true);
    });

    return () => {
      document.removeEventListener('play', markPlaying, true);
      ['pause', 'ended', 'emptied', 'abort', 'error'].forEach((name) => {
        document.removeEventListener(name, markStopped, true);
      });
      playing.clear();
    };
  }, []);

  return activeAudioCount;
};

const SpotifyPreviewPlayer = ({ userId }) => {
  const safety = useSyncExternalStore(
    subscribePlaybackSafety,
    getPlaybackSafetySnapshot,
    getPlaybackSafetySnapshot,
  );
  const localAudioCount = useLocalAudioActivity();
  const rootRef = useRef(null);
  const bridgeRef = useRef(null);
  const bridgeTimeoutRef = useRef(null);
  const pausedBySafetyRef = useRef(false);
  const playingRef = useRef(false);
  const [bridgeLoaded, setBridgeLoaded] = useState(false);
  const [open, setOpen] = useState(false);
  const [savedUrl, setSavedUrl] = useState(() => readSavedUrl(userId));
  const [draftUrl, setDraftUrl] = useState(() => readSavedUrl(userId));
  const [ready, setReady] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [hostKey, setHostKey] = useState(0);

  const safetyReason = useMemo(() => {
    if (safety.activeCallCount > 0) return 'ligação em andamento';
    if (localAudioCount > 0) return 'áudio em reprodução';
    return '';
  }, [localAudioCount, safety.activeCallCount]);

  useEffect(() => {
    playingRef.current = playing;
  }, [playing]);

  useEffect(() => {
    const closeOnOutsideClick = (event) => {
      if (rootRef.current && !rootRef.current.contains(event.target)) setOpen(false);
    };
    document.addEventListener('pointerdown', closeOnOutsideClick);
    return () => document.removeEventListener('pointerdown', closeOnOutsideClick);
  }, []);

  useEffect(() => {
    const handleBridgeEvent = (event) => {
      if (event.source !== bridgeRef.current?.contentWindow) return;
      if (event.data?.type !== SPOTIFY_BRIDGE_EVENT) return;
      const { event: eventName, data } = event.data;
      if (eventName === 'controller-created' || eventName === 'ready') {
        window.clearTimeout(bridgeTimeoutRef.current);
        bridgeTimeoutRef.current = null;
        setReady(true);
        setLoading(false);
        setError('');
        return;
      }
      if (eventName === 'playback-started') {
        setPlaying(true);
        return;
      }
      if (eventName === 'playback-update') {
        setPlaying(data?.isPaused === false);
        return;
      }
      if (eventName === 'error') {
        window.clearTimeout(bridgeTimeoutRef.current);
        bridgeTimeoutRef.current = null;
        setLoading(false);
        setReady(false);
        setError('O Spotify bloqueou a inicialização do player.');
      }
    };
    window.addEventListener('message', handleBridgeEvent);
    return () => window.removeEventListener('message', handleBridgeEvent);
  }, []);

  const sendBridgeCommand = (action, value) => {
    bridgeRef.current?.contentWindow?.postMessage({
      type: SPOTIFY_BRIDGE_COMMAND,
      action,
      value,
    }, '*');
  };

  useEffect(() => {
    if (!savedUrl || !bridgeLoaded) return undefined;
    setLoading(true);
    setReady(false);
    setError('');
    sendBridgeCommand('load', savedUrl);
    window.clearTimeout(bridgeTimeoutRef.current);
    bridgeTimeoutRef.current = window.setTimeout(() => {
      setLoading(false);
      setReady(false);
      setError('O Spotify não respondeu. Abra o painel e tente novamente.');
    }, 15000);

    return () => {
      window.clearTimeout(bridgeTimeoutRef.current);
      bridgeTimeoutRef.current = null;
    };
  }, [bridgeLoaded, hostKey, savedUrl]);

  useEffect(() => () => {
    window.clearTimeout(bridgeTimeoutRef.current);
    sendBridgeCommand('destroy');
  }, []);

  useEffect(() => {
    if (!safetyReason || !ready) return;
    if (playingRef.current) pausedBySafetyRef.current = true;
    sendBridgeCommand('pause');
    setPlaying(false);
  }, [playing, ready, safetyReason]);

  const saveContent = () => {
    const normalized = normalizeSpotifyContentUrl(draftUrl);
    if (!normalized) {
      setError('Cole um link válido de música, álbum ou playlist do Spotify.');
      return;
    }
    try {
      localStorage.setItem(spotifyStorageKey(userId), normalized);
    } catch {}
    setError('');
    setDraftUrl(normalized);
    setSavedUrl(normalized);
  };

  const clearContent = () => {
    sendBridgeCommand('destroy');
    try { localStorage.removeItem(spotifyStorageKey(userId)); } catch {}
    setSavedUrl('');
    setDraftUrl('');
    setReady(false);
    setPlaying(false);
    setError('');
    setBridgeLoaded(false);
    setHostKey((value) => value + 1);
    pausedBySafetyRef.current = false;
  };

  const status = safetyReason
    ? `Pausado: ${safetyReason}`
    : pausedBySafetyRef.current
      ? 'Pronto para retomar'
      : loading
        ? 'Carregando…'
        : playing
          ? 'Tocando agora'
          : savedUrl
            ? 'Música de fundo'
            : 'Configurar música';
  return (
    <div ref={rootRef} className="relative" data-spotify-global-player>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className={`relative flex h-8 w-8 items-center justify-center rounded-full transition-colors ${open ? 'bg-[#1DB954]/12 text-[#159447] dark:bg-[#1DB954]/15 dark:text-[#1DB954]' : 'text-slate-500 hover:bg-gray-100 hover:text-[#159447] dark:text-slate-400 dark:hover:bg-slate-700 dark:hover:text-[#1DB954]'}`}
        title="Abrir Spotify"
        aria-label="Abrir Spotify"
        aria-expanded={open}
      >
        <SpotifyGlyph />
        {playing ? <span className="absolute bottom-0.5 right-0.5 h-1.5 w-1.5 rounded-full bg-[#1DB954] ring-2 ring-white dark:ring-slate-800" /> : null}
      </button>

      <div className={`absolute right-0 top-10 z-[80] w-[min(360px,calc(100vw-24px))] origin-top-right rounded-2xl border border-slate-200 bg-white p-3 shadow-[0_24px_70px_rgba(15,23,42,0.28)] transition duration-150 dark:border-slate-700 dark:bg-slate-900 ${open ? 'scale-100 opacity-100' : 'pointer-events-none scale-95 opacity-0'}`}>
        <div className="mb-2 flex items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-1.5 text-xs font-bold text-slate-900 dark:text-white"><Music2 size={14} className="text-[#1DB954]" /> Música de fundo</div>
            <div className={`mt-0.5 text-[9px] ${safetyReason ? 'font-semibold text-amber-600 dark:text-amber-300' : 'text-slate-400'}`}>{status}</div>
          </div>
          {savedUrl ? (
            <a href={savedUrl} target="_blank" rel="noreferrer" className="flex h-7 w-7 items-center justify-center rounded-full text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-white" title="Abrir no Spotify"><ExternalLink size={13} /></a>
          ) : null}
        </div>

        <div className={savedUrl ? 'mb-2 overflow-hidden rounded-xl bg-black' : 'hidden'}>
          <iframe
            key={hostKey}
            ref={bridgeRef}
            src={SPOTIFY_BRIDGE_PATH}
            title="Player do Spotify"
            sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox"
            allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture"
            onLoad={() => setBridgeLoaded(true)}
            className="h-[152px] w-full border-0"
          />
        </div>

        <div className="flex gap-1.5">
          <input
            value={draftUrl}
            onChange={(event) => setDraftUrl(event.target.value)}
            onKeyDown={(event) => { if (event.key === 'Enter') saveContent(); }}
            placeholder="Cole uma playlist, álbum ou música"
            className="h-8 min-w-0 flex-1 rounded-lg border border-slate-200 bg-slate-50 px-2.5 text-[10px] text-slate-700 outline-none transition focus:border-[#1DB954] dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
          />
          <button type="button" onClick={saveContent} className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#1DB954] text-white transition hover:bg-[#18a64a]" title="Salvar conteúdo do Spotify" aria-label="Salvar conteúdo do Spotify"><Save size={13} /></button>
          {savedUrl ? <button type="button" onClick={clearContent} className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 transition hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-950/30" title="Remover player" aria-label="Remover player"><Trash2 size={13} /></button> : null}
        </div>
        {error ? <div className="mt-1.5 text-[9px] font-medium text-red-500">{error}</div> : null}
        <div className="mt-2 text-[8px] leading-3 text-slate-400">A música pausa ao detectar ligação ou áudio. A retomada é sempre manual.</div>
      </div>
    </div>
  );
};

const spotifyVolumeStorageKey = (userId) => `onionSpotifyVolume:${userId || 'anon'}`;

const readSpotifyVolume = (userId) => {
  try {
    const value = Number(localStorage.getItem(spotifyVolumeStorageKey(userId)));
    return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0.55;
  } catch {
    return 0.55;
  }
};

const SpotifyPremiumPlayer = ({ userId, profile, authorizedScopes = '' }) => {
  const safety = useSyncExternalStore(subscribePlaybackSafety, getPlaybackSafetySnapshot, getPlaybackSafetySnapshot);
  const localAudioCount = useLocalAudioActivity();
  const rootRef = useRef(null);
  const pausedBySafetyRef = useRef(false);
  const pendingAlbumPlaybackRef = useRef(false);
  const libraryPageCacheRef = useRef(new Map());
  const albumSearchRequestRef = useRef(0);
  const [open, setOpen] = useState(false);
  const [savedUrl, setSavedUrl] = useState(() => readSavedUrl(userId));
  const [draftUrl, setDraftUrl] = useState(() => readSavedUrl(userId));
  const [actionError, setActionError] = useState('');
  const [fallbackMetadata, setFallbackMetadata] = useState({ title: 'Spotify Premium', thumbnailUrl: '' });
  const [albumTracks, setAlbumTracks] = useState([]);
  const [albumTracksLoading, setAlbumTracksLoading] = useState(false);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [libraryOffset, setLibraryOffset] = useState(0);
  const [libraryAlbums, setLibraryAlbums] = useState([]);
  const [libraryTotal, setLibraryTotal] = useState(0);
  const [libraryLoading, setLibraryLoading] = useState(false);
  const [libraryError, setLibraryError] = useState('');
  const [libraryAuthBusy, setLibraryAuthBusy] = useState(false);
  const [albumSearchQuery, setAlbumSearchQuery] = useState('');
  const [albumSearchResults, setAlbumSearchResults] = useState([]);
  const [albumSearchLoading, setAlbumSearchLoading] = useState(false);
  const [albumSearchError, setAlbumSearchError] = useState('');
  const libraryScopeGranted = String(authorizedScopes).split(/\s+/).includes('user-library-read');
  const accountProduct = String(profile?.product || '').toLowerCase();
  const accountNeedsPremium = Boolean(accountProduct && accountProduct !== 'premium');
  const spotify = useSpotifyWebPlayback({
    connected: !accountNeedsPremium,
    contentUrl: savedUrl,
    initialVolume: readSpotifyVolume(userId),
  });

  const safetyReason = useMemo(() => {
    if (safety.activeCallCount > 0) return 'ligação em andamento';
    if (localAudioCount > 0) return 'áudio em reprodução';
    return '';
  }, [localAudioCount, safety.activeCallCount]);

  const metadata = spotify.metadata?.uri ? spotify.metadata : fallbackMetadata;
  const playback = spotify.playback;
  const playbackPercent = playback.duration > 0
    ? Math.min(100, Math.max(0, (playback.position / playback.duration) * 100))
    : 0;

  useEffect(() => {
    const closeOnOutsideClick = (event) => {
      if (rootRef.current && !rootRef.current.contains(event.target)) setOpen(false);
    };
    document.addEventListener('pointerdown', closeOnOutsideClick);
    return () => document.removeEventListener('pointerdown', closeOnOutsideClick);
  }, []);

  useEffect(() => {
    if (!savedUrl) {
      setFallbackMetadata({ title: 'Spotify Premium', thumbnailUrl: '' });
      return undefined;
    }
    const controller = new AbortController();
    loadSpotifyMetadata(savedUrl, controller.signal)
      .then((nextMetadata) => nextMetadata && setFallbackMetadata(nextMetadata))
      .catch(() => {});
    return () => controller.abort();
  }, [savedUrl]);

  useEffect(() => {
    if (!libraryOpen || !libraryScopeGranted) return undefined;
    let disposed = false;
    setLibraryLoading(true);
    setLibraryError('');
    loadSpotifySavedAlbums(libraryPageCacheRef.current, libraryOffset)
      .then((result) => {
        if (disposed) return;
        setLibraryAlbums(result.albums);
        setLibraryTotal(result.total);
      })
      .catch((error) => {
        if (disposed) return;
        const message = String(error?.message || '');
        setLibraryError(/scope|permission|403/i.test(message)
          ? 'Permissão da biblioteca ausente. Reconecte o Spotify uma vez.'
          : 'Não foi possível carregar seus álbuns agora.');
      })
      .finally(() => {
        if (!disposed) setLibraryLoading(false);
      });
    return () => { disposed = true; };
  }, [libraryOffset, libraryOpen, libraryScopeGranted]);

  useEffect(() => {
    const query = albumSearchQuery.trim().replace(/\s+/g, ' ');
    const requestId = albumSearchRequestRef.current + 1;
    albumSearchRequestRef.current = requestId;
    if (query.length < 2) {
      setAlbumSearchResults([]);
      setAlbumSearchLoading(false);
      setAlbumSearchError('');
      return undefined;
    }
    setAlbumSearchLoading(true);
    setAlbumSearchError('');
    const timer = window.setTimeout(() => {
      searchSpotifyAlbums(query)
        .then((albums) => {
          if (albumSearchRequestRef.current !== requestId) return;
          setAlbumSearchResults(albums);
          setAlbumSearchError(albums.length ? '' : 'Nenhum álbum encontrado.');
        })
        .catch((error) => {
          if (albumSearchRequestRef.current !== requestId) return;
          const message = String(error?.message || '');
          setAlbumSearchResults([]);
          setAlbumSearchError(message.includes('spotify_rate_limit')
            ? 'O Spotify pediu uma pausa. Tente novamente em instantes.'
            : 'Não foi possível pesquisar álbuns agora.');
        })
        .finally(() => {
          if (albumSearchRequestRef.current === requestId) setAlbumSearchLoading(false);
        });
    }, 350);
    return () => window.clearTimeout(timer);
  }, [albumSearchQuery]);

  useEffect(() => {
    if (!pendingAlbumPlaybackRef.current || !spotify.ready) return;
    pendingAlbumPlaybackRef.current = false;
    spotify.play().catch((error) => setActionError(String(error?.message || 'O Spotify não confirmou o álbum.')));
  }, [savedUrl, spotify.play, spotify.ready]);

  useEffect(() => {
    const normalized = normalizeSpotifyContentUrl(savedUrl);
    const type = normalized ? new URL(normalized).pathname.split('/').filter(Boolean)[0] : '';
    if (type !== 'album') {
      setAlbumTracks([]);
      setAlbumTracksLoading(false);
      return undefined;
    }
    let disposed = false;
    setAlbumTracksLoading(true);
    loadSpotifyAlbumTracks(normalized)
      .then((tracks) => {
        if (!disposed) setAlbumTracks(tracks);
      })
      .catch((error) => {
        if (!disposed && error?.name !== 'AbortError') setAlbumTracks([]);
      })
      .finally(() => {
        if (!disposed) setAlbumTracksLoading(false);
      });
    return () => {
      disposed = true;
    };
  }, [savedUrl]);

  useEffect(() => {
    if (!safetyReason || !spotify.ready) return;
    if (spotify.playing) pausedBySafetyRef.current = true;
    spotify.pause().catch(() => {});
  }, [safetyReason, spotify.playing, spotify.ready]);

  const runAction = async (action) => {
    setActionError('');
    try {
      await action();
    } catch (error) {
      const message = String(error?.message || '');
      if (message.includes('Premium')) setActionError('Esta conta precisa ser Spotify Premium.');
      else if (message.includes('NO_ACTIVE_DEVICE') || message.includes('dispositivo')) setActionError('Nenhum dispositivo Spotify disponível. Abra o Spotify e tente novamente.');
      else setActionError(message || 'O Spotify não confirmou o comando.');
    }
  };

  const saveContent = () => {
    const normalized = normalizeSpotifyContentUrl(draftUrl);
    if (!normalized) {
      setActionError('Cole um link válido de música, álbum ou playlist do Spotify.');
      return;
    }
    try { localStorage.setItem(spotifyStorageKey(userId), normalized); } catch {}
    setDraftUrl(normalized);
    setSavedUrl(normalized);
    setActionError('');
  };

  const selectLibraryAlbum = (album) => {
    const normalized = normalizeSpotifyContentUrl(album?.url);
    if (!normalized) return;
    if (normalized === savedUrl) {
      runAction(spotify.play);
      return;
    }
    try { localStorage.setItem(spotifyStorageKey(userId), normalized); } catch {}
    pendingAlbumPlaybackRef.current = true;
    setDraftUrl(normalized);
    setSavedUrl(normalized);
    setActionError('');
  };

  const authorizeLibrary = async () => {
    setLibraryAuthBusy(true);
    setLibraryError('');
    try {
      await startSpotifyAuthorization('/agent');
    } catch {
      setLibraryAuthBusy(false);
      setLibraryError('Não foi possível abrir a autorização do Spotify.');
    }
  };

  const clearContent = () => {
    spotify.pause().catch(() => {});
    try { localStorage.removeItem(spotifyStorageKey(userId)); } catch {}
    setSavedUrl('');
    setDraftUrl('');
    setActionError('');
  };

  const changeVolume = (event) => {
    const nextVolume = Math.min(1, Math.max(0, Number(event.target.value) / 100));
    try { localStorage.setItem(spotifyVolumeStorageKey(userId), String(nextVolume)); } catch {}
    spotify.setVolume(nextVolume).catch(() => setActionError('O Spotify não confirmou o volume.'));
  };

  const seekPlayback = (event) => {
    if (!spotify.ready || !playback.duration) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (event.clientX - bounds.left) / Math.max(1, bounds.width)));
    runAction(() => spotify.seek((playback.duration * ratio) / 1000));
  };

  const togglePlayback = () => {
    runAction(spotify.playing ? spotify.pause : spotify.play);
  };

  const connectionStage = {
    'validating-token': 'validando sessão',
    'loading-sdk': 'carregando SDK',
    connecting: 'abrindo conexão',
    'waiting-ready': 'aguardando dispositivo',
    retrying: 'reiniciando conexão',
  }[spotify.phase] || '';
  const visibleError = accountNeedsPremium
    ? 'A conta conectada não possui Spotify Premium.'
    : actionError || spotify.error;
  const status = safetyReason
    ? `Pausado: ${safetyReason}`
    : visibleError
      ? 'Spotify precisa de atenção'
    : spotify.loading
      ? `Conectando ao Spotify${connectionStage ? ` · ${connectionStage}` : ''}…`
      : spotify.playing
        ? 'Tocando completo'
        : spotify.ready
          ? 'Spotify Premium pronto'
          : 'Preparando dispositivo…';

  return (
    <div ref={rootRef} className="relative" data-spotify-global-player data-spotify-premium-player>
      <div className={`flex h-10 max-w-[calc(100vw-112px)] items-center gap-1.5 rounded-xl border px-1.5 text-white shadow-sm transition-colors sm:w-64 xl:w-96 ${safetyReason ? 'border-amber-400/50 bg-[#241f15]' : 'border-white/10 bg-[#171717]'}`}>
        <button type="button" onClick={() => setOpen((value) => !value)} className="relative flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-[#282828]" title="Abrir player Spotify Premium" aria-expanded={open}>
          {metadata.thumbnailUrl ? <img src={metadata.thumbnailUrl} alt="" className="h-full w-full object-cover" /> : <Music2 size={16} className="text-[#1DB954]" />}
        </button>
        <button type="button" onClick={() => setOpen((value) => !value)} className="hidden min-w-0 flex-1 text-left sm:block" title={`${metadata.title} · ${status}`} aria-expanded={open}>
          <span className="block truncate text-[9px] font-bold leading-tight text-white">{metadata.title || 'Spotify Premium'}</span>
          <span className={`mt-0.5 block truncate text-[8px] leading-tight ${safetyReason ? 'text-amber-300' : 'text-white/45'}`}>{metadata.artist || status}</span>
          <span className="mt-1 block h-0.5 overflow-hidden rounded-full bg-white/15 xl:hidden"><span className="block h-full rounded-full bg-[#1DB954] transition-[width] duration-300" style={{ width: `${playbackPercent}%` }} /></span>
        </button>
        {playback.duration > 0 ? (
          <button type="button" onClick={seekPlayback} className="hidden w-16 shrink-0 text-left xl:block" title="Clique para avançar ou voltar">
            <span className="flex justify-between text-[7px] tabular-nums text-white/40"><span>{formatPlaybackTime(playback.position)}</span><span>-{formatPlaybackTime(Math.max(0, playback.duration - playback.position))}</span></span>
            <span className="mt-1 block h-0.5 overflow-hidden rounded-full bg-white/15"><span className="block h-full rounded-full bg-white/80" style={{ width: `${playbackPercent}%` }} /></span>
          </button>
        ) : null}
        <button type="button" onClick={() => runAction(spotify.previousTrack)} disabled={!spotify.ready || Boolean(safetyReason)} className="hidden h-5 w-5 shrink-0 items-center justify-center rounded-full text-white/55 transition hover:bg-white/10 hover:text-white disabled:opacity-25 sm:flex" title="Faixa anterior" aria-label="Faixa anterior"><SkipBack size={10} fill="currentColor" /></button>
        <button type="button" onClick={togglePlayback} disabled={!spotify.ready || Boolean(safetyReason) || (!spotify.playing && !savedUrl)} className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full shadow-sm transition ${spotify.playing && !safetyReason ? 'bg-[#1DB954] text-white' : 'bg-white text-black hover:scale-105'} disabled:cursor-default disabled:opacity-45`} title={spotify.playing ? 'Pausar Spotify' : 'Reproduzir Spotify'} aria-label={spotify.playing ? 'Pausar Spotify' : 'Reproduzir Spotify'}>{spotify.playing ? <Pause size={10} fill="currentColor" /> : <Play size={10} fill="currentColor" className="translate-x-px" />}</button>
        <button type="button" onClick={() => runAction(spotify.nextTrack)} disabled={!spotify.ready || Boolean(safetyReason)} className="hidden h-5 w-5 shrink-0 items-center justify-center rounded-full text-white/55 transition hover:bg-white/10 hover:text-white disabled:opacity-25 sm:flex" title="Próxima faixa" aria-label="Próxima faixa"><SkipForward size={10} fill="currentColor" /></button>
        <button type="button" onClick={() => setOpen((value) => !value)} className="flex h-6 w-4 shrink-0 items-center justify-center text-white/35 transition hover:text-white" title="Abrir controles do Spotify" aria-label="Abrir controles do Spotify"><ChevronDown size={11} className={`transition-transform ${open ? 'rotate-180' : ''}`} /></button>
      </div>

      <div className={`absolute right-0 top-11 z-[80] w-[min(360px,calc(100vw-24px))] origin-top-right rounded-2xl border border-slate-200 bg-white p-3 shadow-[0_24px_70px_rgba(15,23,42,0.28)] transition duration-150 dark:border-slate-700 dark:bg-slate-900 ${open ? 'scale-100 opacity-100' : 'pointer-events-none scale-95 opacity-0'}`}>
        <div className="mb-2 flex items-start justify-between gap-3">
          <div><div className="flex items-center gap-1.5 text-xs font-bold text-slate-900 dark:text-white"><Music2 size={14} className="text-[#1DB954]" /> Spotify Premium</div><div className={`mt-0.5 text-[9px] ${safetyReason ? 'font-semibold text-amber-600 dark:text-amber-300' : 'text-slate-400'}`}>{status}</div></div>
          {savedUrl ? <a href={savedUrl} target="_blank" rel="noreferrer" className="flex h-7 w-7 items-center justify-center rounded-full text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-white" title="Abrir no Spotify"><ExternalLink size={13} /></a> : null}
        </div>

        <SpotifyAccountSettings compact />

        <div className="relative mt-2" data-spotify-album-search>
          <Search size={12} className="pointer-events-none absolute left-2.5 top-2.5 text-slate-400" />
          <input
            type="search"
            value={albumSearchQuery}
            onChange={(event) => setAlbumSearchQuery(event.target.value)}
            placeholder="Pesquisar álbuns no Spotify"
            aria-label="Pesquisar álbuns no Spotify"
            autoComplete="off"
            className="h-8 w-full rounded-xl border border-slate-200 bg-slate-50 pl-8 pr-8 text-[9px] text-slate-700 outline-none transition placeholder:text-slate-400 focus:border-[#1DB954] focus:ring-2 focus:ring-[#1DB954]/10 dark:border-slate-700 dark:bg-slate-800/70 dark:text-slate-100"
          />
          {albumSearchLoading ? <Loader2 size={12} className="absolute right-2.5 top-2.5 animate-spin text-[#1DB954]" /> : null}
          {!albumSearchLoading && albumSearchQuery ? (
            <button type="button" onClick={() => setAlbumSearchQuery('')} className="absolute right-1.5 top-1.5 flex h-5 w-5 items-center justify-center rounded-full text-slate-400 transition hover:bg-slate-200 hover:text-slate-700 dark:hover:bg-slate-700 dark:hover:text-white" title="Limpar pesquisa" aria-label="Limpar pesquisa de álbuns"><X size={10} /></button>
          ) : null}
          {albumSearchQuery.trim().length >= 2 ? (
            <div className="absolute left-0 right-0 top-9 z-20 max-h-52 overflow-y-auto rounded-xl border border-slate-200 bg-white p-1.5 shadow-[0_16px_40px_rgba(15,23,42,0.24)] [scrollbar-width:thin] dark:border-slate-700 dark:bg-slate-900">
              {albumSearchResults.map((album) => {
                const active = savedUrl === normalizeSpotifyContentUrl(album.url);
                return (
                  <button key={album.id} type="button" onClick={() => { selectLibraryAlbum(album); setAlbumSearchQuery(''); }} disabled={!spotify.ready || Boolean(safetyReason)} className={`group flex w-full min-w-0 items-center gap-2 rounded-lg p-1.5 text-left transition disabled:opacity-40 ${active ? 'bg-[#1DB954]/12' : 'hover:bg-slate-100 dark:hover:bg-slate-800'}`} title={`Tocar ${album.name}`}>
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-md bg-slate-200 dark:bg-slate-700">{album.image ? <img src={album.image} alt="" className="h-full w-full object-cover" loading="lazy" /> : <Disc3 size={15} className="text-slate-400" />}</span>
                    <span className="min-w-0 flex-1"><span className={`block truncate text-[9px] font-bold ${active ? 'text-[#159447]' : 'text-slate-700 dark:text-slate-100'}`}>{album.name}</span><span className="block truncate text-[8px] text-slate-400">{album.artist}{album.year ? ` · ${album.year}` : ''}</span></span>
                    {active ? <AudioLines size={10} className="shrink-0 text-[#1DB954]" /> : <Play size={9} className="shrink-0 text-slate-300 opacity-0 transition group-hover:opacity-100" />}
                  </button>
                );
              })}
              {!albumSearchLoading && albumSearchError ? <div className="px-2 py-4 text-center text-[8px] text-slate-400">{albumSearchError}</div> : null}
              {albumSearchLoading && albumSearchResults.length === 0 ? <div className="flex items-center justify-center gap-2 px-2 py-4 text-[8px] text-slate-400"><Loader2 size={11} className="animate-spin text-[#1DB954]" />Pesquisando…</div> : null}
            </div>
          ) : null}
        </div>

        <div className="mt-2 overflow-hidden rounded-xl border border-slate-200 bg-slate-50/80 dark:border-slate-700 dark:bg-slate-800/55" data-spotify-library>
          <button type="button" onClick={() => setLibraryOpen((value) => !value)} className="flex w-full items-center gap-2 px-2.5 py-2 text-left transition hover:bg-slate-100 dark:hover:bg-slate-800" aria-expanded={libraryOpen}>
            <Library size={13} className="text-[#1DB954]" />
            <span className="min-w-0 flex-1">
              <span className="block text-[9px] font-bold text-slate-800 dark:text-slate-100">Meus álbuns</span>
              <span className="block text-[8px] text-slate-400">Navegar pela biblioteca salva</span>
            </span>
            <ChevronDown size={12} className={`text-slate-400 transition-transform ${libraryOpen ? 'rotate-180' : ''}`} />
          </button>
          {libraryOpen ? (
            <div className="border-t border-slate-200 p-2 dark:border-slate-700">
              {!libraryScopeGranted ? (
                <div className="rounded-lg bg-white p-2 text-center dark:bg-slate-900/60">
                  <p className="text-[8px] leading-3 text-slate-500 dark:text-slate-300">Autorize somente a leitura dos seus álbuns salvos. Sua sessão e o player continuam locais.</p>
                  <button type="button" onClick={authorizeLibrary} disabled={libraryAuthBusy} className="mt-2 inline-flex h-7 items-center gap-1.5 rounded-lg bg-[#1DB954] px-2.5 text-[8px] font-bold text-white transition hover:bg-[#18a64a] disabled:opacity-50">
                    {libraryAuthBusy ? <Loader2 size={10} className="animate-spin" /> : <Library size={10} />}
                    {libraryAuthBusy ? 'Abrindo...' : 'Liberar meus álbuns'}
                  </button>
                </div>
              ) : libraryLoading ? (
                <div className="flex h-20 items-center justify-center gap-2 text-[8px] text-slate-400"><Loader2 size={12} className="animate-spin text-[#1DB954]" />Carregando álbuns…</div>
              ) : libraryAlbums.length > 0 ? (
                <>
                  <div className="grid max-h-48 grid-cols-2 gap-1.5 overflow-y-auto pr-0.5 [scrollbar-width:thin]">
                    {libraryAlbums.map((album) => {
                      const active = savedUrl === normalizeSpotifyContentUrl(album.url);
                      return (
                        <button key={album.id} type="button" onClick={() => selectLibraryAlbum(album)} disabled={!spotify.ready || Boolean(safetyReason)} className={`group flex min-w-0 items-center gap-2 rounded-lg p-1.5 text-left transition disabled:opacity-40 ${active ? 'bg-[#1DB954]/12 ring-1 ring-[#1DB954]/30' : 'bg-white hover:bg-slate-100 dark:bg-slate-900/55 dark:hover:bg-slate-800'}`} title={`Tocar ${album.name}`}>
                          <span className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-md bg-slate-200 dark:bg-slate-700">{album.image ? <img src={album.image} alt="" className="h-full w-full object-cover" loading="lazy" /> : <Disc3 size={15} className="text-slate-400" />}</span>
                          <span className="min-w-0 flex-1">
                            <span className={`block truncate text-[8px] font-bold ${active ? 'text-[#159447]' : 'text-slate-700 dark:text-slate-100'}`}>{album.name}</span>
                            <span className="block truncate text-[7px] text-slate-400">{album.artist}{album.year ? ` · ${album.year}` : ''}</span>
                          </span>
                          {active ? <AudioLines size={10} className="shrink-0 text-[#1DB954]" /> : <Play size={9} className="shrink-0 text-slate-300 opacity-0 transition group-hover:opacity-100" />}
                        </button>
                      );
                    })}
                  </div>
                  <div className="mt-2 flex items-center justify-between">
                    <button type="button" onClick={() => setLibraryOffset((value) => Math.max(0, value - SAVED_ALBUMS_PAGE_SIZE))} disabled={libraryOffset <= 0 || libraryLoading} className="flex h-6 items-center gap-1 rounded-md px-1.5 text-[7px] font-bold text-slate-400 hover:bg-slate-200 hover:text-slate-700 disabled:opacity-25 dark:hover:bg-slate-700 dark:hover:text-white"><ChevronLeft size={10} />Anterior</button>
                    <span className="text-[7px] tabular-nums text-slate-400">{libraryOffset + 1}–{Math.min(libraryOffset + libraryAlbums.length, libraryTotal)} de {libraryTotal}</span>
                    <button type="button" onClick={() => setLibraryOffset((value) => value + SAVED_ALBUMS_PAGE_SIZE)} disabled={libraryOffset + libraryAlbums.length >= libraryTotal || libraryLoading} className="flex h-6 items-center gap-1 rounded-md px-1.5 text-[7px] font-bold text-slate-400 hover:bg-slate-200 hover:text-slate-700 disabled:opacity-25 dark:hover:bg-slate-700 dark:hover:text-white">Próxima<ChevronRight size={10} /></button>
                  </div>
                </>
              ) : (
                <div className="py-5 text-center text-[8px] text-slate-400">Nenhum álbum salvo encontrado.</div>
              )}
              {libraryError ? <p className="mt-1.5 text-center text-[8px] font-medium text-red-500">{libraryError}</p> : null}
            </div>
          ) : null}
        </div>

        <div className="mt-2 overflow-hidden rounded-xl bg-[#171717] p-2.5 text-white shadow-inner" data-spotify-mini-browser>
          <div className="flex gap-2.5">
            <div className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-[#282828]">
              {metadata.thumbnailUrl ? <img src={metadata.thumbnailUrl} alt="" className="h-full w-full object-cover" /> : <Music2 size={22} className="text-[#1DB954]" />}
            </div>
            <div className="min-w-0 flex-1 self-center">
              <div className="truncate text-[11px] font-bold">{metadata.title || 'Spotify Premium'}</div>
              <div className="mt-0.5 truncate text-[9px] text-white/50">{metadata.artist || status}</div>
              <button type="button" onClick={seekPlayback} disabled={!spotify.ready || !playback.duration} className="mt-2 block w-full text-left disabled:cursor-default" title="Navegar pela faixa">
                <span className="block h-1 overflow-hidden rounded-full bg-white/15"><span className="block h-full rounded-full bg-[#1DB954] transition-[width] duration-300" style={{ width: `${playbackPercent}%` }} /></span>
                <span className="mt-1 flex justify-between text-[8px] tabular-nums text-white/40"><span>{formatPlaybackTime(playback.position)}</span><span>{formatPlaybackTime(playback.duration)}</span></span>
              </button>
            </div>
          </div>
          <div className="mt-1 flex items-center justify-center gap-4">
            <button type="button" onClick={() => runAction(spotify.previousTrack)} disabled={!spotify.ready || Boolean(safetyReason)} className="flex h-7 w-7 items-center justify-center rounded-full text-white/65 transition hover:bg-white/10 hover:text-white disabled:opacity-25" title="Faixa anterior" aria-label="Faixa anterior"><SkipBack size={14} fill="currentColor" /></button>
            <button type="button" onClick={togglePlayback} disabled={!spotify.ready || Boolean(safetyReason) || (!spotify.playing && !savedUrl)} className="flex h-9 w-9 items-center justify-center rounded-full bg-white text-black transition hover:scale-105 disabled:opacity-40" title={spotify.playing ? 'Pausar' : 'Reproduzir'} aria-label={spotify.playing ? 'Pausar Spotify' : 'Reproduzir Spotify'}>{spotify.playing ? <Pause size={15} fill="currentColor" /> : <Play size={15} fill="currentColor" className="translate-x-px" />}</button>
            <button type="button" onClick={() => runAction(spotify.nextTrack)} disabled={!spotify.ready || Boolean(safetyReason)} className="flex h-7 w-7 items-center justify-center rounded-full text-white/65 transition hover:bg-white/10 hover:text-white disabled:opacity-25" title="Próxima faixa" aria-label="Próxima faixa"><SkipForward size={14} fill="currentColor" /></button>
          </div>
          {spotify.trackWindow.next.length > 0 ? (
            <div className="mt-1.5 border-t border-white/10 pt-1.5">
              <div className="mb-1 text-[7px] font-bold uppercase tracking-[0.12em] text-white/30">A seguir</div>
              {spotify.trackWindow.next.slice(0, 2).map((track) => (
                <div key={track.uri || `${track.title}-${track.artist}`} className="flex items-center gap-1.5 py-0.5 text-[8px] text-white/45">
                  <SkipForward size={8} className="shrink-0" />
                  <span className="min-w-0 flex-1 truncate"><span className="font-semibold text-white/65">{track.title}</span>{track.artist ? ` · ${track.artist}` : ''}</span>
                </div>
              ))}
            </div>
          ) : null}
          {albumTracksLoading ? <div className="mt-1.5 border-t border-white/10 pt-1.5 text-[8px] text-white/35">Carregando faixas do álbum…</div> : null}
          {albumTracks.length > 0 ? (
            <div className="mt-1.5 max-h-24 overflow-y-auto border-t border-white/10 pt-1.5 [scrollbar-width:thin]">
              <div className="sticky top-0 mb-1 bg-[#171717] pb-0.5 text-[7px] font-bold uppercase tracking-[0.12em] text-white/30">Faixas do álbum</div>
              {albumTracks.map((track) => {
                const active = track.uri === spotify.metadata.uri;
                return (
                  <button key={track.uri} type="button" onClick={() => runAction(() => spotify.playTrack(track.uri))} disabled={!spotify.ready || Boolean(safetyReason)} className={`flex w-full items-center gap-1.5 rounded-md px-1 py-1 text-left text-[8px] transition hover:bg-white/10 disabled:opacity-35 ${active ? 'bg-white/10 text-[#1DB954]' : 'text-white/50'}`} title={`Tocar ${track.title}`}>
                    <span className="w-3 shrink-0 text-right tabular-nums text-white/25">{track.trackNumber || '•'}</span>
                    <span className="min-w-0 flex-1 truncate"><span className={`font-semibold ${active ? 'text-[#1DB954]' : 'text-white/70'}`}>{track.title}</span>{track.artist ? ` · ${track.artist}` : ''}</span>
                    {active ? <AudioLines size={9} className="shrink-0" /> : <Play size={8} className="shrink-0 opacity-0 transition group-hover:opacity-100" />}
                  </button>
                );
              })}
            </div>
          ) : null}
        </div>

        <div className="mt-2 rounded-xl border border-slate-200 bg-slate-50 p-2.5 dark:border-slate-700 dark:bg-slate-800/60">
          <label className="flex items-center gap-2" aria-label="Volume do Spotify">
            {spotify.volume <= 0.01 ? <VolumeX size={14} className="shrink-0 text-slate-400" /> : <Volume2 size={14} className="shrink-0 text-[#1DB954]" />}
            <input type="range" min="0" max="100" step="1" value={Math.round(spotify.volume * 100)} onChange={changeVolume} disabled={!spotify.ready} className="min-w-0 flex-1 accent-[#1DB954] disabled:opacity-40" />
            <span className="w-8 text-right text-[9px] font-bold tabular-nums text-slate-500 dark:text-slate-300">{Math.round(spotify.volume * 100)}%</span>
          </label>
        </div>

        <div className="mt-2 flex gap-1.5">
          <input value={draftUrl} onChange={(event) => setDraftUrl(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') saveContent(); }} placeholder="Cole uma playlist, álbum ou música" className="h-8 min-w-0 flex-1 rounded-lg border border-slate-200 bg-slate-50 px-2.5 text-[10px] text-slate-700 outline-none transition focus:border-[#1DB954] dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100" />
          <button type="button" onClick={saveContent} className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#1DB954] text-white transition hover:bg-[#18a64a]" title="Salvar conteúdo" aria-label="Salvar conteúdo do Spotify"><Save size={13} /></button>
          {savedUrl ? <button type="button" onClick={clearContent} className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 transition hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-950/30" title="Remover música" aria-label="Remover música do Spotify"><Trash2 size={13} /></button> : null}
        </div>
        {visibleError ? (
          <div className="mt-2 flex items-center justify-between gap-2 rounded-lg border border-red-200 bg-red-50 px-2.5 py-2 dark:border-red-900/60 dark:bg-red-950/25">
            <div className="min-w-0 text-[9px] font-medium leading-3 text-red-600 dark:text-red-300">{visibleError}</div>
            {!accountNeedsPremium ? (
              <button type="button" onClick={spotify.retry} className="shrink-0 rounded-md bg-white px-2 py-1 text-[9px] font-bold text-red-600 shadow-sm transition hover:bg-red-100 dark:bg-red-950/70 dark:text-red-200 dark:hover:bg-red-900/70">Tentar novamente</button>
            ) : null}
          </div>
        ) : null}
        <div className="mt-2 text-[8px] leading-3 text-slate-400">Reprodução completa pelo dispositivo Onion Flows. Ligações e áudios pausam a música; a retomada é manual.</div>
      </div>
    </div>
  );
};

const SpotifyGlobalPlayer = ({ userId }) => {
  const auth = useSyncExternalStore(subscribeSpotifyAuth, getSpotifyAuthSnapshot, getSpotifyAuthSnapshot);
  return auth.connected ? <SpotifyPremiumPlayer userId={userId} profile={auth.profile} authorizedScopes={auth.scopes} /> : <SpotifyPreviewPlayer userId={userId} />;
};

export default SpotifyGlobalPlayer;
