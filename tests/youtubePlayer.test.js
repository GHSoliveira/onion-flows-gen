import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizeYouTubeContent } from '../client/src/utils/youtubePlayer.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

test('normaliza somente vídeo e playlist oficiais do YouTube', () => {
  assert.deepEqual(
    normalizeYouTubeContent('https://youtu.be/dQw4w9WgXcQ?t=12'),
    {
      kind: 'video',
      videoId: 'dQw4w9WgXcQ',
      playlistId: '',
      canonicalUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      embedUrl: 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ',
    },
  );
  assert.deepEqual(
    normalizeYouTubeContent('https://www.youtube.com/playlist?list=PL1234567890_test'),
    {
      kind: 'playlist',
      videoId: '',
      playlistId: 'PL1234567890_test',
      canonicalUrl: 'https://www.youtube.com/playlist?list=PL1234567890_test',
      embedUrl: 'https://www.youtube-nocookie.com/embed/videoseries?list=PL1234567890_test',
    },
  );
  assert.equal(normalizeYouTubeContent('javascript:alert(1)'), null);
  assert.equal(normalizeYouTubeContent('https://example.com/watch?v=dQw4w9WgXcQ'), null);
});

test('YouTube ocupa a coluna mais à direita e pausa por segurança', () => {
  const player = read('client/src/components/YouTubeSidePanel.jsx');
  const workspace = read('client/src/pages/AgentWorkspace.jsx');
  const app = read('client/src/App.jsx');
  const server = read('index.js');

  assert.match(workspace, /<\/main>[\s\S]*?<YouTubeSidePanel/);
  assert.match(workspace, /style=\{\{ width: isYoutubePanelOpen \? `\$\{youtubePanelWidth\}px` : '0px' \}\}/);
  assert.match(workspace, /aria-label="Redimensionar painel do YouTube"/);
  assert.match(workspace, /onPointerDown=\{beginYoutubePanelResize\}/);
  assert.match(workspace, /startWidth \+ \(startX - moveEvent\.clientX\)/);
  assert.match(workspace, /onionYoutubePanelWidth:/);
  assert.match(workspace, /YOUTUBE_PANEL_MIN_WIDTH = 300/);
  assert.match(workspace, /YOUTUBE_PANEL_MAX_WIDTH = 720/);
  assert.match(player, /className="aspect-video w-full border-0"/);
  assert.match(app, /aria-label=\{youtubePanelOpen \? 'Fechar player do YouTube' : 'Abrir player do YouTube'\}/);
  assert.match(app, /<AgentWorkspace youtubePanelOpen=\{youtubePanelOpen\} onYoutubePanelOpenChange=\{setYoutubePanelOpen\}/);
  assert.doesNotMatch(workspace, /onClick=\{\(\) => setIsYoutubePanelOpen/);
  assert.match(player, /subscribePlaybackSafety/);
  assert.match(player, /sendPlayerCommand\('pauseVideo'\)/);
  assert.match(player, /document\.addEventListener\('play', markPlaying, true\)/);
  assert.match(player, /https:\/\/www\.youtube-nocookie\.com/);
  assert.match(player, /A retomada é manual/);
  assert.doesNotMatch(player, /setInterval/);
  assert.match(server, /frameSrc: \["'self'", "https:\/\/sdk\.scdn\.co", "https:\/\/www\.youtube-nocookie\.com"\]/);
});
