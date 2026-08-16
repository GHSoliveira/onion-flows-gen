const SPOTIFY_CLIENT_ID = 'c9f47761773a46948558e534739cceab';
const SPOTIFY_REDIRECT_URI = 'http://127.0.0.1:3101/spotify/callback';
const SPOTIFY_SCOPES = [
  'streaming',
  'user-read-email',
  'user-read-private',
  'user-read-playback-state',
  'user-read-currently-playing',
  'user-modify-playback-state',
].join(' ');

const TOKEN_KEY = 'onionSpotifyOAuth';
const TRANSACTION_KEY = 'onionSpotifyOAuthTransaction';
const listeners = new Set();
let refreshPromise = null;
let completionPromise = null;

const readJson = (key) => {
  try {
    return JSON.parse(localStorage.getItem(key) || 'null');
  } catch {
    return null;
  }
};

const writeJson = (key, value) => {
  localStorage.setItem(key, JSON.stringify(value));
};

const readTokenState = () => {
  const value = readJson(TOKEN_KEY);
  if (!value?.accessToken || !value?.refreshToken) return null;
  return value;
};

let snapshot = (() => {
  const token = readTokenState();
  return {
    connected: Boolean(token),
    profile: token?.profile || null,
    expiresAt: Number(token?.expiresAt || 0),
  };
})();

const publish = () => {
  const token = readTokenState();
  snapshot = {
    connected: Boolean(token),
    profile: token?.profile || null,
    expiresAt: Number(token?.expiresAt || 0),
  };
  listeners.forEach((listener) => listener());
};

const randomUrlSafe = (size = 48) => {
  const bytes = crypto.getRandomValues(new Uint8Array(size));
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
};

const sha256Challenge = async (verifier) => {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return btoa(String.fromCharCode(...new Uint8Array(digest)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
};

const exchangeToken = async (body) => {
  const response = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(body),
    credentials: 'omit',
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload?.access_token) {
    throw new Error(payload?.error_description || payload?.error || `spotify_token_${response.status}`);
  }
  return payload;
};

const fetchProfile = async (accessToken) => {
  const response = await fetch('https://api.spotify.com/v1/me', {
    headers: { Authorization: `Bearer ${accessToken}` },
    credentials: 'omit',
  });
  const profile = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail = String(profile?.error?.message || profile?.message || '').trim();
    if (response.status === 403) {
      throw new Error(`spotify_profile_403_allowlist${detail ? `:${detail}` : ''}`);
    }
    throw new Error(`spotify_profile_${response.status}${detail ? `:${detail}` : ''}`);
  }
  return {
    id: String(profile?.id || ''),
    name: String(profile?.display_name || profile?.id || 'Spotify'),
    email: String(profile?.email || ''),
    product: String(profile?.product || ''),
    image: String(profile?.images?.[0]?.url || ''),
  };
};

export const getSpotifyAuthSnapshot = () => snapshot;

export const subscribeSpotifyAuth = (listener) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export const startSpotifyAuthorization = async (returnTo = '/agent') => {
  if (window.location.origin !== 'http://127.0.0.1:3101') {
    throw new Error('spotify_exige_127_0_0_1_3101');
  }
  const verifier = randomUrlSafe(64);
  const state = randomUrlSafe(32);
  const challenge = await sha256Challenge(verifier);
  writeJson(TRANSACTION_KEY, {
    verifier,
    state,
    returnTo: String(returnTo || '/agent'),
    createdAt: Date.now(),
  });
  const authorizeUrl = new URL('https://accounts.spotify.com/authorize');
  authorizeUrl.search = new URLSearchParams({
    client_id: SPOTIFY_CLIENT_ID,
    response_type: 'code',
    redirect_uri: SPOTIFY_REDIRECT_URI,
    code_challenge_method: 'S256',
    code_challenge: challenge,
    state,
    scope: SPOTIFY_SCOPES,
  }).toString();
  window.location.assign(authorizeUrl.toString());
};

const completeSpotifyAuthorizationOnce = async (search) => {
  const params = new URLSearchParams(search);
  const error = params.get('error');
  if (error) throw new Error(`spotify_autorizacao_${error}`);
  const code = params.get('code');
  const returnedState = params.get('state');
  const transaction = readJson(TRANSACTION_KEY);
  if (!code || !returnedState || !transaction?.verifier || transaction.state !== returnedState) {
    throw new Error('spotify_callback_invalido');
  }
  if (Date.now() - Number(transaction.createdAt || 0) > 10 * 60 * 1000) {
    throw new Error('spotify_callback_expirado');
  }
  const token = await exchangeToken({
    client_id: SPOTIFY_CLIENT_ID,
    grant_type: 'authorization_code',
    code,
    redirect_uri: SPOTIFY_REDIRECT_URI,
    code_verifier: transaction.verifier,
  });
  const profile = await fetchProfile(token.access_token);
  writeJson(TOKEN_KEY, {
    accessToken: token.access_token,
    refreshToken: token.refresh_token,
    expiresAt: Date.now() + (Math.max(60, Number(token.expires_in) || 3600) * 1000),
    profile,
  });
  localStorage.removeItem(TRANSACTION_KEY);
  publish();
  return transaction.returnTo || '/agent';
};

export const completeSpotifyAuthorization = (search = window.location.search) => {
  if (!completionPromise) {
    completionPromise = completeSpotifyAuthorizationOnce(search).catch((error) => {
      completionPromise = null;
      throw error;
    });
  }
  return completionPromise;
};

const refreshSpotifyAccessToken = async () => {
  if (refreshPromise) return refreshPromise;
  refreshPromise = (async () => {
    const current = readTokenState();
    if (!current?.refreshToken) throw new Error('spotify_nao_conectado');
    const token = await exchangeToken({
      client_id: SPOTIFY_CLIENT_ID,
      grant_type: 'refresh_token',
      refresh_token: current.refreshToken,
    });
    const next = {
      ...current,
      accessToken: token.access_token,
      refreshToken: token.refresh_token || current.refreshToken,
      expiresAt: Date.now() + (Math.max(60, Number(token.expires_in) || 3600) * 1000),
    };
    writeJson(TOKEN_KEY, next);
    publish();
    return next.accessToken;
  })().catch((error) => {
    if (/invalid_grant|spotify_token_400/.test(String(error?.message || ''))) {
      localStorage.removeItem(TOKEN_KEY);
      publish();
    }
    throw error;
  }).finally(() => {
    refreshPromise = null;
  });
  return refreshPromise;
};

export const getSpotifyAccessToken = async ({ forceRefresh = false } = {}) => {
  const current = readTokenState();
  if (!current) throw new Error('spotify_nao_conectado');
  if (!forceRefresh && Number(current.expiresAt || 0) - Date.now() > 60_000) {
    return current.accessToken;
  }
  return refreshSpotifyAccessToken();
};

export const spotifyApiRequest = async (path, options = {}, retry = true) => {
  const accessToken = await getSpotifyAccessToken();
  const response = await fetch(`https://api.spotify.com/v1${path}`, {
    ...options,
    headers: {
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(options.headers || {}),
      Authorization: `Bearer ${accessToken}`,
    },
    credentials: 'omit',
  });
  if (response.status === 401 && retry) {
    await getSpotifyAccessToken({ forceRefresh: true });
    return spotifyApiRequest(path, options, false);
  }
  if (response.status === 429) {
    const retryAfter = Math.max(1, Number(response.headers.get('Retry-After')) || 1);
    throw new Error(`spotify_rate_limit_${retryAfter}`);
  }
  if (!response.ok && response.status !== 204) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload?.error?.message || `spotify_http_${response.status}`);
  }
  return response;
};

export const disconnectSpotify = () => {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(TRANSACTION_KEY);
  publish();
};

window.addEventListener('storage', (event) => {
  if (event.key === TOKEN_KEY) publish();
});

export const spotifyAuthConfig = {
  clientId: SPOTIFY_CLIENT_ID,
  redirectUri: SPOTIFY_REDIRECT_URI,
};
