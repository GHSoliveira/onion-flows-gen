import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const load = (relativePath) => readFile(new URL(relativePath, import.meta.url), 'utf8');

test('Onion solicita problemas externos pela extensão sem receber credenciais', async () => {
  const relay = await load('../src/services/extensionAtendimento.js');
  const routes = await load('../src/routes/chats.js');
  assert.match(relay, /export const relayRefreshExternalStatus/);
  assert.match(relay, /'cmd:refresh_external_status'/);
  assert.match(relay, /chat\.ixcData\.logins/);
  assert.match(relay, /external_network/);
  assert.match(relay, /missing_network_identity/);
  assert.match(relay, /networkSource/);
  assert.doesNotMatch(relay, /nocview_token|grafana_session/i);
  assert.match(routes, /\/refresh-external-status/);
  assert.match(routes, /externalStatusRefreshLimiter/);
  assert.match(routes, /limit:\s*4/);
});

test('interface mostra fontes e resultado por login IXC', async () => {
  const workspace = await load('../client/src/pages/AgentWorkspace.jsx');
  assert.match(workspace, /Problemas externos/);
  assert.match(workspace, /NocView/);
  assert.match(workspace, /Grafana \/ Zabbix/);
  assert.match(workspace, /login\.massiva/);
  assert.match(workspace, /login\.grafana/);
  assert.match(workspace, /cache global, nunca por cliente/);
  assert.match(workspace, /Problema externo/);
  assert.match(workspace, /Possível massiva/);
  assert.match(workspace, /Sem problema externo/);
  assert.match(workspace, /Rede não verificada/);
  assert.match(workspace, /data-external-network-state/);
  assert.match(workspace, /selectedHeaderExternalComparable/);
  assert.match(workspace, /source\?\.available === true/);
  assert.doesNotMatch(workspace, /selectedHeaderExternalFresh/);
});
