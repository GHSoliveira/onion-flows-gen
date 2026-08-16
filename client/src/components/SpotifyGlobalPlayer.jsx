import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { AudioLines, ChevronDown, ExternalLink, Music2, Pause, Play, RotateCcw, Save, Trash2 } from 'lucide-react';
import {
  getPlaybackSafetySnapshot,
  subscribePlaybackSafety,
} from '../services/playbackSafety';
import { normalizeSpotifyContentUrl } from '../utils/spotifyPlayer';

const SPOTIFY_BRIDGE_PATH = '/spotify-embed-bridge.html';
const SPOTIFY_BRIDGE_COMMAND = 'onion:spotify:bridge:command';
const SPOTIFY_BRIDGE_EVENT = 'onion:spotify:bridge:event';
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
        const playingUrl = normalizeSpotifyContentUrl(data?.playingURI || '');
        if (playingUrl) setCurrentEntityUrl(playingUrl);
        setPlaying(true);
        return;
      }
      if (eventName === 'playback-update') {
        const playingUrl = normalizeSpotifyContentUrl(data?.playingURI || '');
        if (playingUrl) setCurrentEntityUrl((current) => current === playingUrl ? current : playingUrl);
        setPlayback({
          duration: Math.max(0, Number(data?.duration) || 0),
          position: Math.max(0, Number(data?.position) || 0),
        });
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
    setCurrentEntityUrl(normalized);
    setPlayback({ duration: 0, position: 0 });
  };

  const clearContent = () => {
    sendBridgeCommand('destroy');
    try { localStorage.removeItem(spotifyStorageKey(userId)); } catch {}
    setSavedUrl('');
    setDraftUrl('');
    setCurrentEntityUrl('');
    setMetadata({ title: 'Spotify', thumbnailUrl: '' });
    setPlayback({ duration: 0, position: 0 });
    setReady(false);
    setPlaying(false);
    setError('');
    setBridgeLoaded(false);
    setHostKey((value) => value + 1);
    pausedBySafetyRef.current = false;
  };

  const togglePlayback = () => {
    if (!ready || safetyReason) return;
    const nextPlaying = !playingRef.current;
    sendBridgeCommand('toggle');
    pausedBySafetyRef.current = false;
    playingRef.current = nextPlaying;
    setPlaying(nextPlaying);
  };

  const restartPlayback = () => {
    if (!ready || safetyReason) return;
    sendBridgeCommand('restart');
    pausedBySafetyRef.current = false;
    setPlaying(true);
  };

  const seekPlayback = (event) => {
    if (!ready || !playback.duration) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (event.clientX - bounds.left) / Math.max(1, bounds.width)));
    sendBridgeCommand('seek', (playback.duration * ratio) / 1000);
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

export default SpotifyGlobalPlayer;
