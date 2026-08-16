import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { AudioLines, ChevronDown, ExternalLink, Music2, Pause, Play, RotateCcw, Save, Trash2 } from 'lucide-react';
import {
  getPlaybackSafetySnapshot,
  subscribePlaybackSafety,
} from '../services/playbackSafety';
import { normalizeSpotifyContentUrl } from '../utils/spotifyPlayer';

const SPOTIFY_SCRIPT_ID = 'onion-spotify-iframe-api';
const SPOTIFY_SCRIPT_URL = 'https://open.spotify.com/embed/iframe-api/v1';
let spotifyApiPromise;
const spotifyMetadataCache = new Map();

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

const loadSpotifyApi = () => {
  if (window.__onionSpotifyIframeApi) return Promise.resolve(window.__onionSpotifyIframeApi);
  if (spotifyApiPromise) return spotifyApiPromise;

  spotifyApiPromise = new Promise((resolve, reject) => {
    let settled = false;
    const timeoutId = window.setTimeout(() => {
      if (settled) return;
      settled = true;
      spotifyApiPromise = undefined;
      reject(new Error('spotify_api_timeout'));
    }, 12000);
    const previousReady = window.onSpotifyIframeApiReady;
    window.onSpotifyIframeApiReady = (api) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeoutId);
      window.__onionSpotifyIframeApi = api;
      if (typeof previousReady === 'function') previousReady(api);
      resolve(api);
    };

    const existing = document.getElementById(SPOTIFY_SCRIPT_ID);
    if (existing) {
      existing.addEventListener('error', () => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timeoutId);
        spotifyApiPromise = undefined;
        reject(new Error('spotify_api_indisponivel'));
      }, { once: true });
      return;
    }

    const script = document.createElement('script');
    script.id = SPOTIFY_SCRIPT_ID;
    script.src = SPOTIFY_SCRIPT_URL;
    script.async = true;
    script.addEventListener('error', () => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeoutId);
      spotifyApiPromise = undefined;
      reject(new Error('spotify_api_indisponivel'));
    }, { once: true });
    document.head.appendChild(script);
  });

  return spotifyApiPromise;
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

const SpotifyGlobalPlayer = ({ userId }) => {
  const safety = useSyncExternalStore(
    subscribePlaybackSafety,
    getPlaybackSafetySnapshot,
    getPlaybackSafetySnapshot,
  );
  const localAudioCount = useLocalAudioActivity();
  const rootRef = useRef(null);
  const embedRef = useRef(null);
  const controllerRef = useRef(null);
  const pausedBySafetyRef = useRef(false);
  const playingRef = useRef(false);
  const [open, setOpen] = useState(false);
  const [savedUrl, setSavedUrl] = useState(() => readSavedUrl(userId));
  const [draftUrl, setDraftUrl] = useState(() => readSavedUrl(userId));
  const [ready, setReady] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [hostKey, setHostKey] = useState(0);
  const [currentEntityUrl, setCurrentEntityUrl] = useState(() => readSavedUrl(userId));
  const [metadata, setMetadata] = useState({ title: 'Spotify', thumbnailUrl: '' });
  const [playback, setPlayback] = useState({ duration: 0, position: 0 });

  const safetyReason = useMemo(() => {
    if (safety.activeCallCount > 0) return 'ligação em andamento';
    if (localAudioCount > 0) return 'áudio em reprodução';
    return '';
  }, [localAudioCount, safety.activeCallCount]);

  useEffect(() => {
    playingRef.current = playing;
  }, [playing]);

  useEffect(() => {
    const targetUrl = normalizeSpotifyContentUrl(currentEntityUrl || savedUrl);
    if (!targetUrl) {
      setMetadata({ title: 'Spotify', thumbnailUrl: '' });
      return undefined;
    }
    const controller = new AbortController();
    loadSpotifyMetadata(targetUrl, controller.signal)
      .then((nextMetadata) => {
        if (nextMetadata) setMetadata(nextMetadata);
      })
      .catch((fetchError) => {
        if (fetchError?.name !== 'AbortError') {
          setMetadata((current) => ({ ...current, title: current.title || 'Spotify' }));
        }
      });
    return () => controller.abort();
  }, [currentEntityUrl, savedUrl]);

  useEffect(() => {
    const closeOnOutsideClick = (event) => {
      if (rootRef.current && !rootRef.current.contains(event.target)) setOpen(false);
    };
    document.addEventListener('pointerdown', closeOnOutsideClick);
    return () => document.removeEventListener('pointerdown', closeOnOutsideClick);
  }, []);

  useEffect(() => {
    if (!savedUrl || !embedRef.current) return undefined;
    let disposed = false;
    setLoading(true);
    setError('');

    loadSpotifyApi()
      .then((api) => {
        if (disposed || !embedRef.current) return;
        if (controllerRef.current) {
          controllerRef.current.loadEntity(savedUrl);
          setLoading(false);
          return;
        }
        api.createController(embedRef.current, {
          url: savedUrl,
          width: '100%',
          height: 152,
        }, (controller) => {
          if (disposed) {
            controller.destroy();
            return;
          }
          controllerRef.current = controller;
          // O callback confirma que já existe um controller utilizável. Alguns
          // navegadores perdem o evento `ready` quando o iframe conclui muito
          // rápido; ele não pode manter o card preso em "Carregando".
          setReady(true);
          setLoading(false);
          controller.addListener('ready', () => {
            setReady(true);
            setLoading(false);
          });
          controller.addListener('playback_started', (event) => {
            const playingUrl = normalizeSpotifyContentUrl(event?.data?.playingURI || '');
            if (playingUrl) setCurrentEntityUrl(playingUrl);
            setPlaying(true);
          });
          controller.addListener('playback_update', (event) => {
            const playingUrl = normalizeSpotifyContentUrl(event?.data?.playingURI || '');
            if (playingUrl) setCurrentEntityUrl((current) => current === playingUrl ? current : playingUrl);
            setPlayback({
              duration: Math.max(0, Number(event?.data?.duration) || 0),
              position: Math.max(0, Number(event?.data?.position) || 0),
            });
            setPlaying(event?.data?.isPaused === false);
          });
        });
      })
      .catch(() => {
        if (!disposed) {
          setLoading(false);
          setError('Não foi possível carregar o player.');
        }
      });

    return () => {
      disposed = true;
    };
  }, [savedUrl]);

  useEffect(() => () => {
    controllerRef.current?.destroy?.();
    controllerRef.current = null;
  }, []);

  useEffect(() => {
    if (!safetyReason || !controllerRef.current) return;
    if (playingRef.current) pausedBySafetyRef.current = true;
    controllerRef.current.pause();
    setPlaying(false);
  }, [playing, safetyReason]);

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
    setCurrentEntityUrl(normalized);
    setPlayback({ duration: 0, position: 0 });
  };

  const clearContent = () => {
    controllerRef.current?.destroy?.();
    controllerRef.current = null;
    try { localStorage.removeItem(spotifyStorageKey(userId)); } catch {}
    setSavedUrl('');
    setDraftUrl('');
    setCurrentEntityUrl('');
    setMetadata({ title: 'Spotify', thumbnailUrl: '' });
    setPlayback({ duration: 0, position: 0 });
    setReady(false);
    setPlaying(false);
    setError('');
    setHostKey((value) => value + 1);
    pausedBySafetyRef.current = false;
  };

  const togglePlayback = () => {
    if (!controllerRef.current || !ready || safetyReason) return;
    if (playingRef.current) {
      controllerRef.current.pause();
      setPlaying(false);
      pausedBySafetyRef.current = false;
      return;
    }
    controllerRef.current.resume();
    pausedBySafetyRef.current = false;
    setPlaying(true);
  };

  const restartPlayback = () => {
    if (!controllerRef.current || !ready || safetyReason) return;
    controllerRef.current.restart();
    pausedBySafetyRef.current = false;
    setPlaying(true);
  };

  const seekPlayback = (event) => {
    if (!controllerRef.current || !playback.duration) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (event.clientX - bounds.left) / Math.max(1, bounds.width)));
    controllerRef.current.seek((playback.duration * ratio) / 1000);
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
  const playbackPercent = playback.duration > 0
    ? Math.min(100, Math.max(0, (playback.position / playback.duration) * 100))
    : 0;

  return (
    <div ref={rootRef} className="relative" data-spotify-global-player>
      <div className={`flex h-10 max-w-[calc(100vw-112px)] items-center gap-1.5 rounded-xl border px-1.5 text-white shadow-sm transition-colors sm:w-60 xl:w-80 ${
        safetyReason ? 'border-amber-400/50 bg-[#241f15]' : 'border-white/10 bg-[#171717]'
      }`}>
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          className="relative flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-[#282828]"
          title="Abrir o player do Spotify"
          aria-expanded={open}
        >
          {metadata.thumbnailUrl ? (
            <img src={metadata.thumbnailUrl} alt="" className="h-full w-full object-cover" />
          ) : (
            <Music2 size={16} className="text-[#1DB954]" />
          )}
        </button>

        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          className="hidden min-w-0 flex-1 text-left sm:block"
          title={`${metadata.title} · ${status}`}
          aria-expanded={open}
        >
          <span className="block truncate text-[9px] font-bold leading-tight text-white">{savedUrl ? metadata.title : 'Conectar Spotify'}</span>
          <span className={`mt-0.5 block truncate text-[8px] leading-tight ${safetyReason ? 'text-amber-300' : 'text-white/45'}`}>{status}</span>
          <span
            role="progressbar"
            aria-label="Progresso da música"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(playbackPercent)}
            className="mt-1 block h-0.5 overflow-hidden rounded-full bg-white/15 xl:hidden"
          >
            <span className="block h-full rounded-full bg-[#1DB954] transition-[width] duration-300" style={{ width: `${playbackPercent}%` }} />
          </span>
        </button>

        {savedUrl && playback.duration > 0 ? (
          <button
            type="button"
            onClick={seekPlayback}
            className="hidden w-16 shrink-0 text-left xl:block"
            title="Clique para avançar ou voltar na música"
          >
            <span className="flex justify-between text-[7px] tabular-nums text-white/40">
              <span>{formatPlaybackTime(playback.position)}</span>
              <span>-{formatPlaybackTime(Math.max(0, playback.duration - playback.position))}</span>
            </span>
            <span className="mt-1 block h-0.5 overflow-hidden rounded-full bg-white/15">
              <span className="block h-full rounded-full bg-white/80" style={{ width: `${playbackPercent}%` }} />
            </span>
          </button>
        ) : null}

        {savedUrl ? (
          <button
            type="button"
            onClick={restartPlayback}
            disabled={!ready || Boolean(safetyReason)}
            className="hidden h-6 w-6 shrink-0 items-center justify-center rounded-full text-white/55 transition hover:bg-white/10 hover:text-white disabled:opacity-30 lg:flex"
            title="Reiniciar música"
            aria-label="Reiniciar música"
          >
            <RotateCcw size={11} />
          </button>
        ) : null}
        <button
          type="button"
          onClick={savedUrl ? togglePlayback : () => setOpen(true)}
          disabled={Boolean(safetyReason) || (Boolean(savedUrl) && !ready)}
          className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-white shadow-sm transition ${safetyReason ? 'bg-amber-500' : 'bg-white text-black hover:scale-105'} disabled:cursor-default disabled:opacity-70`}
          title={safetyReason ? `Spotify pausado por ${safetyReason}` : !savedUrl ? 'Configurar Spotify' : playing ? 'Pausar Spotify' : 'Reproduzir Spotify'}
          aria-label={!savedUrl ? 'Configurar Spotify' : playing ? 'Pausar Spotify' : 'Reproduzir Spotify'}
        >
          {safetyReason ? <AudioLines size={13} /> : playing ? <Pause size={13} fill="currentColor" /> : <Play size={13} fill="currentColor" className="translate-x-px" />}
        </button>
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          className="flex h-6 w-4 shrink-0 items-center justify-center text-white/35 transition hover:text-white"
          title="Abrir player global do Spotify"
          aria-label="Abrir player global do Spotify"
        >
          <ChevronDown size={11} className={`transition-transform ${open ? 'rotate-180' : ''}`} />
        </button>
      </div>

      <div className={`absolute right-0 top-11 z-[80] w-[min(360px,calc(100vw-24px))] origin-top-right rounded-2xl border border-slate-200 bg-white p-3 shadow-[0_24px_70px_rgba(15,23,42,0.28)] transition duration-150 dark:border-slate-700 dark:bg-slate-900 ${open ? 'scale-100 opacity-100' : 'pointer-events-none scale-95 opacity-0'}`}>
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
          <div key={hostKey} ref={embedRef} className="min-h-[152px] w-full" />
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

export default SpotifyGlobalPlayer;
