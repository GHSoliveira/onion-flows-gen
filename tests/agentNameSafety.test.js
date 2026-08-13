import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { normalizeAgentDisplayName } from '../src/utils/agentName.js';

test('nome do agente fica nulo sem configuração e remove placeholder legado', () => {
  assert.equal(normalizeAgentDisplayName(undefined), null);
  assert.equal(normalizeAgentDisplayName(null), null);
  assert.equal(normalizeAgentDisplayName('   '), null);
  assert.equal(normalizeAgentDisplayName(['Sandbox', 'Agent'].join(' ')), null);
  assert.equal(normalizeAgentDisplayName('  Gustavo  Helio '), 'Gustavo Helio');
});

test('mensagem rápida bloqueia variável sem valor antes do envio', async () => {
  const workspace = await readFile(
    new URL('../client/src/pages/AgentWorkspace.jsx', import.meta.url),
    'utf8'
  );
  assert.match(workspace, /'agente\.nome': user\?\.name \?\? null/);
  assert.match(workspace, /A variável \{\$\{key\}\} está sem valor/);
  assert.match(workspace, /Configure o nome do agente na engrenagem/);
  assert.match(workspace, /textToSend = renderTemplateText\(quickDraft\)/);
  assert.match(workspace, /const message = bulkPickupModal\.message[\s\S]*?renderTemplateText\(bulkPickupModal\.message\)/);
  const routes = await readFile(new URL('../src/routes/chats.js', import.meta.url), 'utf8');
  assert.match(routes, /UNRESOLVED_AGENT_NAME_VARIABLE_RE/);
  assert.match(routes, /LEGACY_AGENT_PLACEHOLDER_RE/);
  assert.match(routes, /status\(422\)/);
  assert.match(routes, /rejectUnresolvedAgentNameVariable\(text, res\)/);
  assert.match(routes, /rejectUnresolvedAgentNameVariable\(openingMessage, res\)/);
});

test('seed local não inventa nome de agente', async () => {
  const seed = await readFile(new URL('../scripts/seed-sandbox-json.js', import.meta.url), 'utf8');
  const loadTest = await readFile(new URL('../src/routes/loadTest.js', import.meta.url), 'utf8');
  assert.match(seed, /name: configuredAgentName/);
  assert.match(seed, /getLocalPreferences/);
  assert.doesNotMatch(seed, /name:\s*['"]Sandbox Agent['"]/i);
  assert.doesNotMatch(loadTest, /SANDBOX_AGENT_NAME/);
});
