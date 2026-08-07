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
  assert.match(relay, /commandId:\s*`gcmd_\$\{chat\.id\}_\$\{message\?\.id/);
  assert.match(relay, /genesysCommandOutbox\.set\(commandId/);
  assert.match(relay, /expectedGeneration:\s*pickString\(chat\.genesysSyncGeneration\)/);
  assert.match(relay, /payload\.expiresAt\s*=\s*payload\.createdAt\s*\+\s*30000/);
  assert.match(relay, /reason:\s*'missing_sync_generation'/);
  assert.match(relay, /emitCmdToExtensionWithAck\(\s*targetAgentId,\s*'cmd:enviar_mensagem'/s);
  assert.match(relay, /confirmed,\s*\n\s*relayed:\s*confirmed/);
});

test('relay de mídia Genesys envia somente metadados e mantém o vínculo do card', async () => {
  const relay = await loadRelaySource();
  assert.match(relay, /export const relayAgentMediaToGenesys/);
  assert.match(relay, /commandId:\s*`gmedia_\$\{chat\.id\}_\$\{message\?\.id/);
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

test('fluxo rapido de OS aceita somente Suporte Inicial aberta no Suporte N1', async () => {
  const workspace = await loadAgentWorkspaceSource();
  const routes = await readFile(new URL('../src/routes/chats.js', import.meta.url), 'utf8');
  const extension = await readFile(new URL('../genesys-onion-dev/background.js', import.meta.url), 'utf8');

  assert.match(workspace, /const isValidOpenSupportN1Order/);
  assert.match(workspace, /Finalizar OS/);
  assert.match(workspace, /requestId: operation\.requestId/);
  for (const source of [workspace, routes, extension]) {
    assert.match(source, /startsWith\(['"]SUPORTE INICIAL['"]\)/);
    assert.match(source, /startsWith\(['"]SUPORTE N1['"]\)/);
    assert.match(source, /FINALIZ\|ENCERR\|FECHAD\|CANCEL/);
  }
  assert.match(routes, /requestId: String\(req\.body\?\.requestId/);
  assert.match(extension, /os_selecionada_nao_e_suporte_n1_aberta/);
  assert.match(extension, /IXC_OS_COMMAND_TTL_MS/);
  assert.match(extension, /Comando de OS duplicado ignorado/);
  assert.match(extension, /ixcOsCommandCache\.set\(requestId/);
});

test('conversationId encerrado que volta ativo inicia uma nova sessao local', async () => {
  const extension = await readFile(new URL('../genesys-onion-dev/background.js', import.meta.url), 'utf8');
  assert.match(extension, /function reviveClosedConversationState/);
  assert.match(extension, /state\.syncGeneration = crypto\.randomUUID\(\)/);
  assert.match(extension, /state\.upserted = false/);
  assert.match(extension, /state\.backfilled = false/);
  assert.match(extension, /state\.messageIds = new Set\(\)/);
  assert.match(extension, /reviveClosedConversationState\(conversationId, state, "authoritative-roster"\)/);
  assert.match(extension, /reviveClosedConversationState\(snapshot\.conversationId, state, "notification-snapshot"\)/);
});

test('evento de fechamento antigo nao remove card novo com conversationId reutilizado', async () => {
  const relay = await loadRelaySource();
  const workspace = await loadAgentWorkspaceSource();
  const extension = await readFile(new URL('../genesys-onion-dev/background.js', import.meta.url), 'utf8');
  assert.match(relay, /closeGeneration && closeGeneration !== currentGeneration/);
  assert.match(relay, /staleDuringLock/);
  assert.match(relay, /genesys-conversation:\$\{tenantId\}:\$\{convId\}/);
  assert.match(extension, /syncGeneration,\s*\n\s*closeEventId/);
  assert.match(extension, /response\?\.stale === true/);
  assert.match(extension, /cancelQueuedCloseForConversation\(conversationId, state\.syncGeneration\)/);
  assert.match(workspace, /closedId \? chat\.id === closedId : false/);
  assert.match(workspace, /!closedId\s+&&\s+closedConvId/);
});

test('mídias consecutivas mantêm identidade própria no espelho Genesys', async () => {
  const messages = await loadChatMessagesSource();
  const workspace = await loadAgentWorkspaceSource();
  const extension = await readFile(new URL('../genesys-onion-dev/background.js', import.meta.url), 'utf8');
  assert.match(messages, /const hasMedia = Boolean\(normalized\.media \|\| message\.media \|\| message\.attachment\)/);
  assert.match(messages, /if \(!existingRow && normalized\.text && !hasMedia\)/);
  assert.match(workspace, /if \(aHasMedia \|\| bHasMedia\) return false/);
  assert.match(extension, /function genesysMediaDescriptors/);
  assert.match(extension, /additionalMedia: mediaItems\.slice\(1\)/);
  assert.match(extension, /flatMap\(expandGenesysMessageMedia\)/);
});
