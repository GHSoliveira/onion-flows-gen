import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const loadRelaySource = () => readFile(
  new URL('../src/services/extensionAtendimento.js', import.meta.url),
  'utf8'
);

const loadChatMessagesSource = () => readFile(
  new URL('../src/services/chatMessages.js', import.meta.url),
  'utf8'
);

const loadAgentWorkspaceSource = () => readFile(
  new URL('../client/src/pages/AgentWorkspace.jsx', import.meta.url),
  'utf8'
);

test('relay Onion cria comando Genesys curto, único, vinculado à geração e espera confirmação real', async () => {
  const relay = await loadRelaySource();
  assert.match(relay, /commandId:\s*generateId\('gcmd'\)/);
  assert.match(relay, /expectedGeneration:\s*pickString\(chat\.genesysSyncGeneration\)/);
  assert.match(relay, /payload\.expiresAt\s*=\s*payload\.createdAt\s*\+\s*30000/);
  assert.match(relay, /reason:\s*'missing_sync_generation'/);
  assert.match(relay, /emitCmdToExtensionWithAck\(\s*targetAgentId,\s*'cmd:enviar_mensagem'/s);
  assert.match(relay, /confirmed,\s*\n\s*relayed:\s*confirmed/);
});

test('relay de mídia Genesys envia somente metadados e mantém o vínculo do card', async () => {
  const relay = await loadRelaySource();
  assert.match(relay, /export const relayAgentMediaToGenesys/);
  assert.match(relay, /commandId:\s*generateId\('gmedia'\)/);
  assert.match(relay, /expectedGeneration:\s*pickString\(chat\.genesysSyncGeneration\)/);
  assert.match(relay, /contentLengthBytes/);
  assert.match(relay, /emitCmdToExtensionWithAck\(\s*targetAgentId,\s*'cmd:enviar_midia'/s);
  assert.doesNotMatch(relay, /dataUrl:\s*pickString\(media/);
});

test('upsert persiste a geração informada pela extensão', async () => {
  const relay = await loadRelaySource();
  assert.match(relay, /const syncGeneration = pickString\(payload\.syncGeneration\)/);
  assert.match(relay, /genesysSyncGeneration:\s*syncGeneration\s*\|\|\s*null/);
  assert.match(relay, /chat\.genesysSyncGeneration = syncGeneration/);
});

test('upsert preserva dados primarios recebidos do Genesys sem fingir consulta IXC', async () => {
  const relay = await loadRelaySource();
  assert.match(relay, /vars\.cidade = cidade/);
  assert.match(relay, /vars\.pppoe = pppoe/);
  assert.match(relay, /vars\.contrato_id = contratoId/);
  assert.match(relay, /vars\.olt = olt/);
  assert.match(relay, /vars\.pon_id = ponId/);
  assert.match(relay, /vars\.fonte_dados_primarios = fonteDadosPrimarios/);
  assert.doesNotMatch(relay, /vars\.ixc_dados\s*=\s*\{[^}]*fonteDadosPrimarios/s);
});

test('falha de envio marca delivery e alerta o agente', async () => {
  const relay = await loadRelaySource();
  assert.match(relay, /deliveryStatus:\s*'failed'/);
  assert.match(relay, /emit\('genesys_cmd_failed'/);
  assert.match(relay, /emit\('message_delivery'/);
  assert.match(relay, /'enviar_midia',\s*'enviar_media',\s*'send_media'/);
});

test('confirmação de envio não volta para pending por corrida entre Socket e HTTP', async () => {
  const messages = await loadChatMessagesSource();
  const workspace = await loadAgentWorkspaceSource();
  assert.match(messages, /isGenesysAgentConfirmation/);
  assert.match(messages, /deliveryConfirmed = isGenesysAgentConfirmation/);
  assert.match(workspace, /const strongestDeliveryStatus/);
  assert.match(workspace, /DELIVERY_STATUS_PRIORITY/);
  assert.match(workspace, /const deliveryStatus = strongestDeliveryStatus\(item, message\)/);
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

test('snapshot Genesys preserva bot, agente atual e agente anterior', async () => {
  const relay = await loadRelaySource();
  assert.match(relay, /const extensionSenderMeta/);
  assert.match(relay, /'self_agent', 'other_agent', 'bot', 'system'/);
  assert.match(relay, /'meta\.senderParticipantId'/);
  assert.match(relay, /'meta\.senderName'/);
  assert.match(relay, /Um snapshot autoritativo também corrige a autoria/);
});
