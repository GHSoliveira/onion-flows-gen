import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { AudioLines, ChevronDown, ExternalLink, Music2, Pause, Play, RotateCcw, Save, Trash2, Volume2, VolumeX } from 'lucide-react';
import {
  getPlaybackSafetySnapshot,
  subscribePlaybackSafety,
} from '../services/playbackSafety';
import { normalizeSpotifyContentUrl } from '../utils/spotifyPlayer';
import SpotifyAccountSettings from './SpotifyAccountSettings';
import { getSpotifyAuthSnapshot, subscribeSpotifyAuth } from '../services/spotifyAuth';
import { useSpotifyWebPlayback } from '../hooks/useSpotifyWebPlayback';

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

  const playPlayback = () => {
    if (!ready || safetyReason) return;
    sendBridgeCommand('resume');
    pausedBySafetyRef.current = false;
    playingRef.current = true;
    setPlaying(true);
  };

  const pausePlayback = () => {
    if (!ready) return;
    sendBridgeCommand('pause');
    pausedBySafetyRef.current = false;
    playingRef.current = false;
    setPlaying(false);
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
        {savedUrl ? (
          <>
            <button
              type="button"
              onClick={playPlayback}
              disabled={!ready || Boolean(safetyReason)}
              className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full shadow-sm transition ${playing && !safetyReason ? 'bg-[#1DB954] text-white' : 'bg-white text-black hover:scale-105'} disabled:cursor-default disabled:opacity-50`}
              title={safetyReason ? `Spotify pausado por ${safetyReason}` : 'Reproduzir Spotify'}
              aria-label="Reproduzir Spotify"
            >
              {safetyReason ? <AudioLines size={13} /> : <Play size={13} fill="currentColor" className="translate-x-px" />}
            </button>
            <button
              type="button"
              onClick={pausePlayback}
              disabled={!ready}
              className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full transition ${!playing || safetyReason ? 'bg-white/5 text-white/45 hover:bg-white/10 hover:text-white' : 'bg-white text-black hover:scale-105'} disabled:cursor-default disabled:opacity-35`}
              title="Pausar Spotify"
              aria-label="Pausar Spotify"
            >
              <Pause size={12} fill="currentColor" />
            </button>
          </>
        ) : (
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-white text-black shadow-sm transition hover:scale-105"
            title="Configurar Spotify"
            aria-label="Configurar Spotify"
          >
            <Play size={13} fill="currentColor" className="translate-x-px" />
          </button>
        )}
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

const spotifyVolumeStorageKey = (userId) => `onionSpotifyVolume:${userId || 'anon'}`;

const readSpotifyVolume = (userId) => {
  try {
    const value = Number(localStorage.getItem(spotifyVolumeStorageKey(userId)));
    return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0.55;
  } catch {
    return 0.55;
  }
};

const SpotifyPremiumPlayer = ({ userId, profile }) => {
  const safety = useSyncExternalStore(subscribePlaybackSafety, getPlaybackSafetySnapshot, getPlaybackSafetySnapshot);
  const localAudioCount = useLocalAudioActivity();
  const rootRef = useRef(null);
  const pausedBySafetyRef = useRef(false);
  const [open, setOpen] = useState(false);
  const [savedUrl, setSavedUrl] = useState(() => readSavedUrl(userId));
  const [draftUrl, setDraftUrl] = useState(() => readSavedUrl(userId));
  const [actionError, setActionError] = useState('');
  const [fallbackMetadata, setFallbackMetadata] = useState({ title: 'Spotify Premium', thumbnailUrl: '' });
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
        <button type="button" onClick={() => runAction(spotify.restart)} disabled={!spotify.ready || Boolean(safetyReason)} className="hidden h-6 w-6 shrink-0 items-center justify-center rounded-full text-white/55 transition hover:bg-white/10 hover:text-white disabled:opacity-30 lg:flex" title="Reiniciar música" aria-label="Reiniciar música"><RotateCcw size={11} /></button>
        <button type="button" onClick={() => runAction(spotify.play)} disabled={!spotify.ready || Boolean(safetyReason) || !savedUrl} className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full shadow-sm transition ${spotify.playing && !safetyReason ? 'bg-[#1DB954] text-white' : 'bg-white text-black hover:scale-105'} disabled:cursor-default disabled:opacity-45`} title="Reproduzir Spotify" aria-label="Reproduzir Spotify"><Play size={13} fill="currentColor" className="translate-x-px" /></button>
        <button type="button" onClick={() => runAction(spotify.pause)} disabled={!spotify.ready} className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full transition ${!spotify.playing || safetyReason ? 'bg-white/5 text-white/45 hover:bg-white/10 hover:text-white' : 'bg-white text-black hover:scale-105'} disabled:opacity-35`} title="Pausar Spotify" aria-label="Pausar Spotify"><Pause size={12} fill="currentColor" /></button>
        <button type="button" onClick={() => setOpen((value) => !value)} className="flex h-6 w-4 shrink-0 items-center justify-center text-white/35 transition hover:text-white" title="Abrir controles do Spotify" aria-label="Abrir controles do Spotify"><ChevronDown size={11} className={`transition-transform ${open ? 'rotate-180' : ''}`} /></button>
      </div>

      <div className={`absolute right-0 top-11 z-[80] w-[min(360px,calc(100vw-24px))] origin-top-right rounded-2xl border border-slate-200 bg-white p-3 shadow-[0_24px_70px_rgba(15,23,42,0.28)] transition duration-150 dark:border-slate-700 dark:bg-slate-900 ${open ? 'scale-100 opacity-100' : 'pointer-events-none scale-95 opacity-0'}`}>
        <div className="mb-2 flex items-start justify-between gap-3">
          <div><div className="flex items-center gap-1.5 text-xs font-bold text-slate-900 dark:text-white"><Music2 size={14} className="text-[#1DB954]" /> Spotify Premium</div><div className={`mt-0.5 text-[9px] ${safetyReason ? 'font-semibold text-amber-600 dark:text-amber-300' : 'text-slate-400'}`}>{status}</div></div>
          {savedUrl ? <a href={savedUrl} target="_blank" rel="noreferrer" className="flex h-7 w-7 items-center justify-center rounded-full text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-white" title="Abrir no Spotify"><ExternalLink size={13} /></a> : null}
        </div>

        <SpotifyAccountSettings compact />

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
  return auth.connected ? <SpotifyPremiumPlayer userId={userId} profile={auth.profile} /> : <SpotifyPreviewPlayer userId={userId} />;
};

export default SpotifyGlobalPlayer;
