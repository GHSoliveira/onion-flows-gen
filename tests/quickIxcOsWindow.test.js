import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const load = (relativePath) => readFile(new URL(relativePath, import.meta.url), 'utf8');

test('janela de OS rapido nao bloqueia a pagina e confirmacao fica acima', async () => {
  const workspace = await load('../client/src/pages/AgentWorkspace.jsx');
  const dialogs = await load('../client/src/context/DialogContext.jsx');

  assert.match(workspace, /pointer-events-none fixed inset-x-3 bottom-3 top-16 z-\[120\]/);
  assert.match(workspace, /ui-modal-surface pointer-events-auto/);
  assert.doesNotMatch(workspace, /fixed inset-0 z-\[120\][^\n]*bg-slate-950\/60/);
  assert.match(dialogs, /fixed inset-0 z-\[300\]/);
});

test('anexos da OS rapida exibem miniatura e abrem o visualizador completo', async () => {
  const workspace = await load('../client/src/pages/AgentWorkspace.jsx');

  assert.match(workspace, /const previewUrl = media\.resolvedUrl \|\| resolveMediaUrl\(media\.url\)/);
  assert.match(workspace, /const openPreview = \(\) => openChatMedia/);
  assert.match(workspace, /media\.type === 'image' \? <img src=\{previewUrl\}/);
  assert.match(workspace, /media\.type === 'video' \? <video src=\{previewUrl\}/);
  assert.match(workspace, /abrir preview/);
});
