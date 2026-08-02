import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const loadRelaySource = () => readFile(
  new URL('../src/services/extensionAtendimento.js', import.meta.url),
  'utf8'
);

test('relay Onion cria comando Genesys curto, único e vinculado à geração', async () => {
  const relay = await loadRelaySource();
  assert.match(relay, /commandId:\s*generateId\('gcmd'\)/);
  assert.match(relay, /expectedGeneration:\s*pickString\(chat\.genesysSyncGeneration\)/);
  assert.match(relay, /payload\.expiresAt\s*=\s*payload\.createdAt\s*\+\s*30000/);
  assert.match(relay, /reason:\s*'missing_sync_generation'/);
});

test('relay de mídia Genesys envia somente metadados e mantém o vínculo do card', async () => {
  const relay = await loadRelaySource();
  assert.match(relay, /export const relayAgentMediaToGenesys/);
  assert.match(relay, /commandId:\s*generateId\('gmedia'\)/);
  assert.match(relay, /expectedGeneration:\s*pickString\(chat\.genesysSyncGeneration\)/);
  assert.match(relay, /contentLengthBytes/);
  assert.match(relay, /emitCmdToExtension\(targetAgentId, 'cmd:enviar_midia'/);
  assert.doesNotMatch(relay, /dataUrl:\s*pickString\(media/);
});

test('upsert persiste a geração informada pela extensão', async () => {
  const relay = await loadRelaySource();
  assert.match(relay, /const syncGeneration = pickString\(payload\.syncGeneration\)/);
  assert.match(relay, /genesysSyncGeneration:\s*syncGeneration\s*\|\|\s*null/);
  assert.match(relay, /chat\.genesysSyncGeneration = syncGeneration/);
});

test('falha de envio marca delivery e alerta o agente', async () => {
  const relay = await loadRelaySource();
  assert.match(relay, /deliveryStatus:\s*'failed'/);
  assert.match(relay, /emit\('genesys_cmd_failed'/);
  assert.match(relay, /emit\('message_delivery'/);
  assert.match(relay, /'enviar_midia',\s*'enviar_media',\s*'send_media'/);
});

test('mídia Genesys aceita data URL com parâmetros e normaliza OGG', async () => {
  const relay = await loadRelaySource();
  assert.match(relay, /normalizedReceivedMime === 'application\/ogg'/);
  assert.match(relay, /const commaIndex = dataUrl\.indexOf\(','\)/);
  assert.match(relay, /part\.toLowerCase\(\) === 'base64'/);
  assert.match(relay, /storeTenantMediaBuffer/);
  assert.match(relay, /hasTemporaryGenesysUrl/);
  assert.match(relay, /media,\s*\n\s*updatedAt/);
});
