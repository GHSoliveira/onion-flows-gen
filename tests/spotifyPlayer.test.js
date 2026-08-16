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

  assert.match(app, /<SpotifyGlobalPlayer userId=\{user\?\.id\}/);
  assert.match(workspace, /setGenesysActiveCallCount\(spotifyActiveCallCount\)/);
  assert.match(workspace, /callStateOf\(call\)\?\.stale === true \? 0 : 1/);
  assert.match(player, /document\.addEventListener\('play', markPlaying, true\)/);
  assert.match(player, /controllerRef\.current\.pause\(\)/);
  assert.match(player, /https:\/\/open\.spotify\.com\/oembed\?url=/);
  assert.match(player, /controllerRef\.current\.restart\(\)/);
  assert.match(player, /controllerRef\.current\.seek\(/);
  assert.match(player, /controllerRef\.current = controller;\s*\/\/[^]*setReady\(true\);\s*setLoading\(false\);/);
  assert.match(player, /spotify_api_timeout/);
  assert.match(player, /role="progressbar"/);
  assert.match(player, /metadata\.thumbnailUrl/);
  assert.match(player, /A retomada é sempre manual/);
  assert.doesNotMatch(player, /setInterval/);
  assert.match(server, /frameSrc: \["'self'", "https:\/\/open\.spotify\.com"\]/);
  assert.match(server, /connectSrc:\s*\[\s*"'self'",\s*"https:\/\/open\.spotify\.com"/);
});
