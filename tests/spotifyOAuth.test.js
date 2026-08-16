import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

test('Spotify usa OAuth PKCE local sem Client Secret', () => {
  const auth = read('client/src/services/spotifyAuth.js');
  assert.match(auth, /c9f47761773a46948558e534739cceab/);
  assert.match(auth, /http:\/\/127\.0\.0\.1:3101\/spotify\/callback/);
  assert.match(auth, /code_challenge_method: 'S256'/);
  assert.match(auth, /crypto\.subtle\.digest\('SHA-256'/);
  assert.match(auth, /transaction\.state !== returnedState/);
  assert.match(auth, /grant_type: 'refresh_token'/);
  assert.match(auth, /spotify_rate_limit_/);
  assert.doesNotMatch(auth, /client[_ ]?secret/i);
});

test('player Premium tem pausa, volume real e segurança por ligação', () => {
  const player = read('client/src/components/SpotifyGlobalPlayer.jsx');
  const playback = read('client/src/hooks/useSpotifyWebPlayback.js');
  const settings = read('client/src/components/SpotifyAccountSettings.jsx');
  assert.match(playback, /new Spotify\.Player/);
  assert.match(playback, /playerRef\.current\.setVolume/);
  assert.match(playback, /playerRef\.current\.pause/);
  assert.match(playback, /playerRef\.current\.previousTrack/);
  assert.match(playback, /playerRef\.current\.nextTrack/);
  assert.match(playback, /const playTrack = useCallback/);
  assert.match(playback, /DEVICE_READY_TIMEOUT_MS = 18_000/);
  assert.match(playback, /setLoading\(false\)/);
  assert.match(playback, /const retry = useCallback/);
  assert.match(playback, /spotifyApiRequest\(`\/me\/player\/play\?device_id=/);
  assert.match(player, /data-spotify-premium-player/);
  assert.match(player, /aria-label="Volume do Spotify"/);
  assert.match(player, /data-spotify-mini-browser/);
  assert.match(player, /Faixas do álbum/);
  assert.match(player, /spotify\.playTrack\(track\.uri\)/);
  assert.match(player, /spotify\.playing \? spotify\.pause : spotify\.play/);
  assert.match(player, /Spotify precisa de atenção/);
  assert.match(player, /Tentar novamente/);
  assert.match(player, /spotify\.pause\(\)\.catch/);
  assert.match(settings, /startSpotifyAuthorization\('\/agent'\)/);
});

test('CSP libera apenas superfícies oficiais necessárias ao player Premium', () => {
  const server = read('index.js');
  assert.match(server, /https:\/\/sdk\.scdn\.co/);
  assert.match(server, /https:\/\/accounts\.spotify\.com/);
  assert.match(server, /https:\/\/api\.spotify\.com/);
  assert.match(server, /frameSrc: \["'self'", "https:\/\/sdk\.scdn\.co"\]/);
  assert.match(server, /wss:\/\/\*\.spotify\.com/);
  assert.match(server, /mediaSrc: \["'self'", "blob:"/);
});
