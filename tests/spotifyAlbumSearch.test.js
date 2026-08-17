import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

test('pesquisa de álbuns usa API autenticada com debounce, limite e cache', () => {
  const player = read('client/src/components/SpotifyGlobalPlayer.jsx');

  assert.match(player, /spotifyApiRequest\(`\/search\?type=album&limit=\$\{ALBUM_SEARCH_LIMIT\}&q=\$\{encodeURIComponent\(normalizedQuery\)\}`\)/);
  assert.match(player, /const ALBUM_SEARCH_LIMIT = 8/);
  assert.match(player, /spotifyAlbumSearchCache\.has\(cacheKey\)/);
  assert.match(player, /spotifyAlbumSearchCache\.set\(cacheKey, request\)/);
  assert.match(player, /normalizedQuery\.length < 2/);
  assert.match(player, /}, 350\)/);
});

test('resultado da pesquisa reutiliza o seletor seguro do player', () => {
  const player = read('client/src/components/SpotifyGlobalPlayer.jsx');

  assert.match(player, /data-spotify-album-search/);
  assert.match(player, /aria-label="Pesquisar álbuns no Spotify"/);
  assert.match(player, /selectLibraryAlbum\(album\); setAlbumSearchQuery\(''\)/);
  assert.match(player, /disabled=\{!spotify\.ready \|\| Boolean\(safetyReason\)\}/);
});
