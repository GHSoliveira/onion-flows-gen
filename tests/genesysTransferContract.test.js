import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const load = (relativePath) => readFile(new URL(relativePath, import.meta.url), 'utf8');

test('transferencia Genesys pesquisa fila e so conclui com tabulacao confirmada', async () => {
  const relay = await load('../src/services/extensionAtendimento.js');
  const routes = await load('../src/routes/chats.js');
  const workspace = await load('../client/src/pages/AgentWorkspace.jsx');

  assert.match(relay, /export const relaySearchGenesysTransferQueues/);
  assert.match(relay, /'cmd:buscar_filas_transferencia'/);
  assert.match(relay, /export const relayTransferGenesysWithWrapup/);
  assert.match(relay, /'cmd:transferir_com_tabulacao'/);
  assert.match(relay, /queue_id_invalid/);
  assert.match(relay, /wrapup_code_invalid/);
  assert.match(relay, /participantId:\s*GENESYS_UUID_RE\.test/);

  assert.match(routes, /\/genesys-transfer-queues/);
  assert.match(routes, /\/transfer-genesys/);
  assert.match(routes, /GENESYS_TRANSFER_CONFIRMED/);
  assert.match(routes, /participantId:\s*asIdentifier\(req\.body\?\.participantId\)/);

  assert.match(workspace, /genesys-transfer-queues\?q=/);
  assert.match(workspace, /\/transfer-genesys/);
  assert.match(workspace, /data\?\.transferred !== true \|\| data\?\.confirmed !== true/);
  assert.match(workspace, /Transferir e tabular/);
  assert.match(workspace, /participantId:\s*transferModal\.participantId/);
});
