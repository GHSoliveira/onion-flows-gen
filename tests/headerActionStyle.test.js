import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const loadWorkspace = () => readFile(
  new URL('../client/src/pages/AgentWorkspace.jsx', import.meta.url),
  'utf8'
);

test('acoes do header usam icones transparentes e circulo suave apenas no hover', async () => {
  const workspace = await loadWorkspace();

  assert.match(workspace, /HEADER_ICON_BUTTON_CLASS = '[^']*rounded-full[^']*bg-transparent[^']*hover:bg-slate-100/);
  assert.match(workspace, /COMPACT_HEADER_ICON_BUTTON_CLASS = '[^']*rounded-full[^']*bg-transparent[^']*hover:bg-slate-100/);
  assert.doesNotMatch(workspace, /HEADER_ICON_BUTTON_CLASS = '[^']*\bborder\b/);
  assert.match(workspace, /title="Abrir assistente IA"/);
  assert.match(workspace, /title="Transferir atendimento"/);
  assert.match(workspace, /title="Encerrar atendimento"/);
  assert.match(workspace, /<ClipboardList size=\{15\} \/>/);
  assert.doesNotMatch(workspace, /<span className="hidden sm:inline">Finalizar OS<\/span>/);
});
