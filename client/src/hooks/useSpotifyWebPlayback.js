import { useCallback, useEffect, useRef, useState } from 'react';
import { getSpotifyAccessToken, spotifyApiRequest } from '../services/spotifyAuth';
import { normalizeSpotifyContentUrl } from '../utils/spotifyPlayer';

let spotifySdkPromise = null;

const loadSpotifySdk = () => {
  if (window.Spotify?.Player) return Promise.resolve(window.Spotify);
  if (spotifySdkPromise) return spotifySdkPromise;
  spotifySdkPromise = new Promise((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      spotifySdkPromise = null;
      reject(new Error('spotify_sdk_timeout'));
    }, 20_000);
    const previousReady = window.onSpotifyWebPlaybackSDKReady;
    window.onSpotifyWebPlaybackSDKReady = () => {
      window.clearTimeout(timeout);
      if (typeof previousReady === 'function') previousReady();
      resolve(window.Spotify);
    };
    const existing = document.querySelector('script[data-onion-spotify-sdk]');
    if (existing) return;
    const script = document.createElement('script');
    script.src = 'https://sdk.scdn.co/spotify-player.js';
    script.async = true;
    script.dataset.onionSpotifySdk = 'true';
    script.onerror = () => {
      window.clearTimeout(timeout);
      spotifySdkPromise = null;
      reject(new Error('spotify_sdk_bloqueado'));
    };
    document.head.appendChild(script);
  });
  return spotifySdkPromise;
};

const playbackBodyForUrl = (value) => {
  const normalized = normalizeSpotifyContentUrl(value);
  if (!normalized) return null;
  const parsed = new URL(normalized);
  const [type, id] = parsed.pathname.split('/').filter(Boolean);
  const uri = `spotify:${type}:${id}`;
  if (type === 'track' || type === 'episode') return { uris: [uri] };
  return { context_uri: uri };
};

const desiredUriForUrl = (value) => {
  const body = playbackBodyForUrl(value);
  return body?.context_uri || body?.uris?.[0] || '';
};

const emptyPlayback = { duration: 0, position: 0 };
const emptyMetadata = { title: 'Spotify', artist: '', thumbnailUrl: '', uri: '', contextUri: '' };
const emptyTrackWindow = { previous: [], next: [] };
const DEVICE_READY_TIMEOUT_MS = 18_000;

const summarizeTrack = (track) => ({
  title: String(track?.name || 'Faixa'),
  artist: Array.isArray(track?.artists) ? track.artists.map((artist) => artist?.name).filter(Boolean).join(', ') : '',
  thumbnailUrl: String(track?.album?.images?.[0]?.url || track?.images?.[0]?.url || ''),
  uri: String(track?.uri || ''),
});

export const useSpotifyWebPlayback = ({ connected, contentUrl, initialVolume = 0.55 }) => {
  const playerRef = useRef(null);
  const deviceIdRef = useRef('');
  const activatedRef = useRef(false);
  const playingRef = useRef(false);
  const playbackRef = useRef(emptyPlayback);
  const [ready, setReady] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [phase, setPhase] = useState('idle');
  const [connectionGeneration, setConnectionGeneration] = useState(0);
  const [deviceId, setDeviceId] = useState('');
  const [metadata, setMetadata] = useState(emptyMetadata);
  const [playback, setPlayback] = useState(emptyPlayback);
  const [trackWindow, setTrackWindow] = useState(emptyTrackWindow);
  const [volume, setVolumeState] = useState(() => {
    const parsed = Number(initialVolume);
    return Number.isFinite(parsed) ? Math.min(1, Math.max(0, parsed)) : 0.55;
  });

  const applyState = useCallback((state) => {
    if (!state) return;
    const track = state.track_window?.current_track;
    const nextPlayback = {
      duration: Math.max(0, Number(state.duration) || 0),
      position: Math.max(0, Number(state.position) || 0),
    };
    const nextPlaying = state.paused === false;
    playbackRef.current = nextPlayback;
    playingRef.current = nextPlaying;
    setPlayback(nextPlayback);
    setPlaying(nextPlaying);
    setTrackWindow({
      previous: Array.isArray(state.track_window?.previous_tracks)
        ? state.track_window.previous_tracks.slice(-2).map(summarizeTrack)
        : [],
      next: Array.isArray(state.track_window?.next_tracks)
        ? state.track_window.next_tracks.slice(0, 3).map(summarizeTrack)
        : [],
    });
    if (track) {
      setMetadata({
        title: String(track.name || 'Spotify'),
        artist: Array.isArray(track.artists) ? track.artists.map((artist) => artist?.name).filter(Boolean).join(', ') : '',
        thumbnailUrl: String(track.album?.images?.[0]?.url || track.images?.[0]?.url || ''),
        uri: String(track.uri || ''),
        contextUri: String(state.context?.uri || ''),
      });
    }
  }, []);

  useEffect(() => {
    if (!connected) {
      playerRef.current?.disconnect?.();
      playerRef.current = null;
      deviceIdRef.current = '';
      activatedRef.current = false;
      setReady(false);
      setDeviceId('');
      setPlaying(false);
      setLoading(false);
      setError('');
      setPhase('idle');
      setMetadata(emptyMetadata);
      setPlayback(emptyPlayback);
      setTrackWindow(emptyTrackWindow);
      return undefined;
    }

    let disposed = false;
    let player = null;
    let readyTimeout = null;

    const clearReadyTimeout = () => {
      if (readyTimeout) window.clearTimeout(readyTimeout);
      readyTimeout = null;
    };

    const failConnection = (message, nextPhase = 'error') => {
      if (disposed) return;
      clearReadyTimeout();
      deviceIdRef.current = '';
      activatedRef.current = false;
      setDeviceId('');
      setReady(false);
      setLoading(false);
      setPhase(nextPhase);
      setError(message);
    };

    setLoading(true);
    setError('');
    setPhase('validating-token');

    getSpotifyAccessToken().then(() => {
      if (disposed) return null;
      setPhase('loading-sdk');
      return loadSpotifySdk();
    }).then((Spotify) => {
      if (!Spotify || disposed) return;
      setPhase('connecting');
      player = new Spotify.Player({
        name: 'Onion Flows',
        volume,
        getOAuthToken: (callback) => {
          getSpotifyAccessToken()
            .then(callback)
            .catch(() => {
              callback('');
              failConnection('Sua sessão do Spotify expirou. Desconecte e conecte a conta novamente.', 'authentication-error');
            });
        },
      });
      playerRef.current = player;
      player.addListener('ready', ({ device_id: nextDeviceId }) => {
        if (disposed) return;
        clearReadyTimeout();
        deviceIdRef.current = String(nextDeviceId || '');
        setDeviceId(String(nextDeviceId || ''));
        setReady(Boolean(nextDeviceId));
        setLoading(false);
        setPhase('ready');
        setError('');
        player.getCurrentState().then(applyState).catch(() => {});
      });
      player.addListener('not_ready', ({ device_id: unavailableDeviceId }) => {
        if (disposed || String(unavailableDeviceId || '') !== deviceIdRef.current) return;
        setReady(false);
        setLoading(false);
        setPhase('not-ready');
        setError('O dispositivo Spotify do Onion ficou indisponível.');
      });
      player.addListener('player_state_changed', (state) => {
        if (!disposed) applyState(state);
      });
      player.addListener('initialization_error', ({ message }) => {
        const detail = String(message || '').trim();
        failConnection(`O navegador bloqueou o player protegido do Spotify${detail ? `: ${detail}` : '. Ative conteúdo protegido/Widevine e tente novamente.'}`, 'initialization-error');
      });
      player.addListener('authentication_error', ({ message }) => {
        const detail = String(message || '').trim();
        failConnection(`O Spotify recusou a autenticação${detail ? `: ${detail}` : '. Conecte a conta novamente.'}`, 'authentication-error');
      });
      player.addListener('account_error', () => {
        failConnection('Esta conta precisa ter Spotify Premium ativo.', 'account-error');
      });
      player.addListener('playback_error', ({ message }) => {
        if (disposed) return;
        setLoading(false);
        setError(message || 'Falha ao reproduzir no Spotify.');
      });
      readyTimeout = window.setTimeout(() => {
        failConnection('O Spotify não liberou o dispositivo em 18 segundos. No Brave, permita conteúdo protegido (Widevine) e desative o Shields para 127.0.0.1.', 'ready-timeout');
      }, DEVICE_READY_TIMEOUT_MS);
      player.connect().then((success) => {
        if (!success && !disposed) {
          failConnection('O Spotify não conseguiu criar o dispositivo Onion Flows.', 'connect-rejected');
        } else if (!disposed && !deviceIdRef.current) {
          setPhase('waiting-ready');
        }
      }).catch(() => {
        failConnection('Não foi possível conectar o player completo do Spotify.', 'connect-error');
      });
    }).catch((connectionError) => {
      const message = String(connectionError?.message || '');
      if (/spotify_nao_conectado|invalid_grant|spotify_token_/.test(message)) {
        failConnection('Sua sessão do Spotify não é mais válida. Desconecte e conecte a conta novamente.', 'authentication-error');
      } else if (message === 'spotify_sdk_timeout') {
        failConnection('A SDK do Spotify não carregou em 20 segundos. Verifique o Shields, bloqueadores e a rede.', 'sdk-timeout');
      } else if (message === 'spotify_sdk_bloqueado') {
        failConnection('O navegador ou um bloqueador impediu o carregamento da SDK do Spotify.', 'sdk-blocked');
      } else {
        failConnection('Não foi possível carregar o player completo do Spotify.', 'sdk-error');
      }
    });

    return () => {
      disposed = true;
      clearReadyTimeout();
      player?.disconnect?.();
      if (playerRef.current === player) playerRef.current = null;
    };
  }, [applyState, connected, connectionGeneration]);

  useEffect(() => {
    if (!playing) return undefined;
    const timer = window.setInterval(() => {
      setPlayback((current) => {
        const next = {
          ...current,
          position: Math.min(current.duration || Infinity, current.position + 1000),
        };
        playbackRef.current = next;
        return next;
      });
    }, 1000);
    return () => window.clearInterval(timer);
  }, [playing]);

  const activateDevice = useCallback(async () => {
    const currentDeviceId = deviceIdRef.current;
    if (!currentDeviceId) throw new Error('spotify_dispositivo_indisponivel');
    if (activatedRef.current) return currentDeviceId;
    await spotifyApiRequest('/me/player', {
      method: 'PUT',
      body: JSON.stringify({ device_ids: [currentDeviceId], play: false }),
    });
    activatedRef.current = true;
    return currentDeviceId;
  }, []);

  const play = useCallback(async () => {
    if (!playerRef.current || !ready) throw new Error('spotify_dispositivo_indisponivel');
    setError('');
    const desiredUri = desiredUriForUrl(contentUrl);
    const alreadyLoaded = desiredUri && (metadata.contextUri === desiredUri || metadata.uri === desiredUri);
    if (!desiredUri || alreadyLoaded) {
      await playerRef.current.resume();
    } else {
      const currentDeviceId = await activateDevice();
      const body = playbackBodyForUrl(contentUrl);
      await spotifyApiRequest(`/me/player/play?device_id=${encodeURIComponent(currentDeviceId)}`, {
        method: 'PUT',
        body: JSON.stringify(body),
      });
    }
    playingRef.current = true;
    setPlaying(true);
  }, [activateDevice, contentUrl, metadata.contextUri, metadata.uri, ready]);

  const playTrack = useCallback(async (trackUri) => {
    const normalizedTrackUri = String(trackUri || '');
    if (!playerRef.current || !ready || !normalizedTrackUri.startsWith('spotify:track:')) {
      throw new Error('spotify_faixa_invalida');
    }
    setError('');
    const currentDeviceId = await activateDevice();
    const contentBody = playbackBodyForUrl(contentUrl);
    const body = contentBody?.context_uri
      ? { context_uri: contentBody.context_uri, offset: { uri: normalizedTrackUri } }
      : { uris: [normalizedTrackUri] };
    await spotifyApiRequest(`/me/player/play?device_id=${encodeURIComponent(currentDeviceId)}`, {
      method: 'PUT',
      body: JSON.stringify(body),
    });
    playingRef.current = true;
    setPlaying(true);
  }, [activateDevice, contentUrl, ready]);

  const pause = useCallback(async () => {
    if (!playerRef.current || !ready) return;
    await playerRef.current.pause();
    playingRef.current = false;
    setPlaying(false);
  }, [ready]);

  const restart = useCallback(async () => {
    if (!playerRef.current || !ready) return;
    await playerRef.current.seek(0);
    await playerRef.current.resume();
    setPlayback((current) => ({ ...current, position: 0 }));
    playingRef.current = true;
    setPlaying(true);
  }, [ready]);

  const previousTrack = useCallback(async () => {
    if (!playerRef.current || !ready) return;
    setError('');
    await playerRef.current.previousTrack();
  }, [ready]);

  const nextTrack = useCallback(async () => {
    if (!playerRef.current || !ready) return;
    setError('');
    await playerRef.current.nextTrack();
  }, [ready]);

  const seek = useCallback(async (seconds) => {
    if (!playerRef.current || !ready) return;
    await playerRef.current.seek(Math.max(0, Number(seconds) || 0));
  }, [ready]);

  const setVolume = useCallback(async (nextVolume) => {
    const normalized = Math.min(1, Math.max(0, Number(nextVolume) || 0));
    setVolumeState(normalized);
    if (playerRef.current && ready) await playerRef.current.setVolume(normalized);
  }, [ready]);

  const retry = useCallback(() => {
    playerRef.current?.disconnect?.();
    playerRef.current = null;
    deviceIdRef.current = '';
    activatedRef.current = false;
    setDeviceId('');
    setReady(false);
    setPlaying(false);
    setLoading(true);
    setError('');
    setPhase('retrying');
    setConnectionGeneration((value) => value + 1);
  }, []);

  return {
    ready,
    playing,
    loading,
    error,
    phase,
    deviceId,
    metadata,
    playback,
    trackWindow,
    volume,
    play,
    playTrack,
    pause,
    restart,
    previousTrack,
    nextTrack,
    seek,
    setVolume,
    retry,
  };
};
