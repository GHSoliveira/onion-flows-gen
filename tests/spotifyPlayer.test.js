import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizeSpotifyContentUrl } from '../client/src/utils/spotifyPlayer.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

test('normaliza somente conteúdo oficial do Spotify', () => {
  assert.equal(
    normalizeSpotifyContentUrl('https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M?si=abc'),
    'https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M',
  );
  assert.equal(
    normalizeSpotifyContentUrl('spotify:track:4cOdK2wGLETKBW3PvgPWqT'),
    'https://open.spotify.com/track/4cOdK2wGLETKBW3PvgPWqT',
  );
  assert.equal(normalizeSpotifyContentUrl('javascript:alert(1)'), '');
  assert.equal(normalizeSpotifyContentUrl('https://example.com/playlist/abc'), '');
});

test('player global pausa por chamada e áudio sem polling nem API Genesys extra', () => {
  const player = read('client/src/components/SpotifyGlobalPlayer.jsx');
  const workspace = read('client/src/pages/AgentWorkspace.jsx');
  const app = read('client/src/App.jsx');
  const server = read('index.js');
  const bridge = read('client/public/spotify-embed-bridge.js');
  const bridgeHtml = read('client/public/spotify-embed-bridge.html');

  assert.match(app, /<SpotifyGlobalPlayer userId=\{user\?\.id\}/);
  assert.match(workspace, /setGenesysActiveCallCount\(spotifyActiveCallCount\)/);
  assert.match(workspace, /callStateOf\(call\)\?\.stale === true \? 0 : 1/);
  assert.match(player, /document\.addEventListener\('play', markPlaying, true\)/);
  assert.match(player, /sendBridgeCommand\('pause'\)/);
  assert.match(player, /aria-label="Pausar Spotify"/);
  assert.match(player, /aria-label="Reproduzir Spotify"/);
  assert.match(player, /https:\/\/open\.spotify\.com\/oembed\?url=/);
  assert.match(player, /sendBridgeCommand\('restart'\)/);
  assert.match(player, /sendBridgeCommand\('seek'/);
  assert.match(player, /sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox"/);
  assert.doesNotMatch(player, /allow-same-origin/);
  assert.match(player, /role="progressbar"/);
  assert.match(player, /metadata\.thumbnailUrl/);
  assert.match(player, /A retomada é sempre manual/);
  assert.doesNotMatch(player, /setInterval/);
  assert.match(bridgeHtml, /https:\/\/open\.spotify\.com\/embed\/iframe-api\/v1/);
  assert.match(bridge, /iframeApi\.createController/);
  assert.match(bridge, /controller\.pause\(\)/);
  assert.match(bridge, /controller\.togglePlay\(\)/);
  assert.match(bridge, /controller\.restart\(\)/);
  assert.match(bridge, /controller\.seek\(/);
  assert.match(server, /scriptSrc: \["'self'"\]/);
  assert.match(server, /app\.get\('\/spotify-embed-bridge\.html'/);
  assert.match(server, /script-src 'nonce-\$\{nonce\}' 'unsafe-eval' https:\/\/open\.spotify\.com https:\/\/embed-cdn\.spotifycdn\.com/);
  assert.match(server, /randomBytes\(18\)/);
  assert.match(server, /replace\('__SPOTIFY_BRIDGE_SOURCE__'/);
  assert.match(bridgeHtml, /nonce="__SPOTIFY_CSP_NONCE__"/);
  assert.match(server, /connectSrc:\s*\[\s*"'self'",\s*"https:\/\/open\.spotify\.com"/);
});
