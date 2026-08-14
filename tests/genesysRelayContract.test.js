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

test('delta resolve o chat do próprio agente antes de cair no gêmeo de outro', async () => {
  const relay = await loadRelaySource();
  const mensagem = relay.slice(
    relay.indexOf('export const handleExtMensagem'),
    relay.indexOf('export const handleExtCliente')
  );
  // Sem agentId, o doc mais recente de outro agente vence a busca e o delta
  // morre em chat_de_outro_agente — erro não-terminal que retenta pra sempre.
  assert.match(mensagem, /findChatByConvId\(\{\s*tenantId,\s*convId,\s*agentId\s*\}\)/);
  assert.doesNotMatch(mensagem, /findChatByConvId\(\{\s*tenantId,\s*convId\s*\}\)/);
  assert.match(mensagem, /chat_de_outro_agente/);
});

test('ligação chega como card de voz sem virar mensagem e com âncora estável', async () => {
  const relay = await loadRelaySource();
  const workspace = await loadAgentWorkspaceSource();
  const extension = await readFile(new URL('../genesys-onion-dev/background.js', import.meta.url), 'utf8');
  const observer = await readFile(new URL('../genesys-onion-dev/genesys-focus.js', import.meta.url), 'utf8');
  const content = await readFile(new URL('../genesys-onion-dev/content.js', import.meta.url), 'utf8');
  const ligacao = relay.slice(
    relay.indexOf('const handleExtLigacaoUnlocked'),
    relay.indexOf('export const handleExtLigacao =')
  );
  // Precisa marcar voz nos dois campos, senão isGenesysCallShell não acende.
  assert.match(ligacao, /live\.genesysMediaType = 'voice'/);
  assert.match(ligacao, /live\.conversationType = 'voice'/);
  // Estado de ligação nunca vira mensagem: messageCount tem que continuar 0.
  assert.doesNotMatch(ligacao, /appendChatMessage/);
  // A âncora do cronômetro se fixa uma vez só — reenvio não reinicia a contagem.
  assert.match(ligacao, /previous\?\.conectadoEm \|\| desde/);
  // Cliente cai já conectado: faltar âncora não pode sumir com o card inteiro,
  // só marcar que o cronômetro começou aproximado.
  assert.match(ligacao, /const ancoraAproximada = estado === 'connected'/);
  assert.match(ligacao, /ancoraAproximada: ancoraAproximada \|\| previous\?\.ancoraAproximada === true/);
  assert.doesNotMatch(ligacao, /missing_conectadoEm/);
  // O decorrido nunca trafega: só a âncora.
  assert.doesNotMatch(ligacao, /duracao|elapsed/i);
  assert.match(relay, /socket\.on\('ext:atendimento:ligacao'/);
  // O mesmo payload que fazia nascer o card temporário é identificado no
  // observador e segue direto ao banner, sem polling nem refresh de lista.
  assert.match(observer, /participant\?\.calls/);
  assert.match(observer, /entry\.genesysMediaType = "voice"/);
  assert.match(content, /genesysMediaType: String\(item\?\.genesysMediaType/);
  assert.match(content, /call: item\?\.call/);
  assert.match(extension, /async function processPassiveCallStates/);
  assert.match(extension, /emit\("ext:atendimento:ligacao"/);
  // O Genesys pode publicar uma perna terminal transitória no meio da chamada.
  // O encerramento espera confirmação curta, e qualquer sinal vivo mais novo cancela.
  assert.match(extension, /const PASSIVE_CALL_DISCONNECT_GRACE_MS = 1800/);
  assert.match(extension, /function schedulePassiveCallDisconnect/);
  assert.match(extension, /Number\(current\.lastCallLiveAt \|\| 0\) > scheduledAt/);
  assert.match(extension, /clearPendingPassiveCallDisconnect\(conversationId\)/);
  // No desligamento, o snapshot pode perder `call` antes do card sair do DOM.
  assert.match(extension, /state\.callUpserted && \(item\?\.agentActive === false \|\| item\?\.active === false\)/);
  assert.match(extension, /snapshot\?\.genesysMediaType === "voice"[\s\S]*?conversations\.get\(conversationId\)\?\.callUpserted/);
  assert.match(extension, /if \(item\?\.genesysMediaType === "voice"\) return/);
  assert.match(relay, /genesys_call_state'[\s\S]*?chat: pub/);
  assert.match(workspace, /const incomingChat = event\?\.chat/);
  assert.match(workspace, /setActiveCalls\(\(list\) => \[/);
  assert.match(workspace, /<span>Confirmar<\/span>/);
});

test('estado de ligação descarta geração antiga e retry fora de ordem', async () => {
  const relay = await loadRelaySource();
  const ligacao = relay.slice(
    relay.indexOf('const handleExtLigacaoUnlocked'),
    relay.indexOf('export const handleExtLigacao =')
  );
  assert.match(ligacao, /GENESYS_CALL_STATES\.has\(estado\)/);
  assert.match(ligacao, /error: 'seq obrigatorio/);
  // seq monotônico: o backoff do outbox pode entregar connected depois de held.
  assert.match(ligacao, /seq <= Number\(previous\.seq\)/);
  assert.match(ligacao, /ignoredReason = 'stale_seq'/);
  // Sequência é por sessão: geração nova reinicia a contagem.
  assert.match(ligacao, /previous\.syncGeneration === syncGeneration/);
  assert.match(ligacao, /reason: 'stale_sync_generation'/);
  // Fechamento não pode ressuscitar card inexistente.
  assert.match(ligacao, /!chat && estado === 'disconnected'/);
  // Silêncio após conectar não é perda de sinal: o Genesys não envia heartbeat.
  assert.match(ligacao, /confirmedConnected: \['connected', 'held'\]\.includes\(estado\)/);
  assert.match(ligacao, /previous\?\.confirmedConnected === true/);
});

test('watcher preserva ligação conectada e expira somente alerting zumbi', async () => {
  const watcher = await readFile(
    new URL('../src/services/chatRuntimeWatcher.js', import.meta.url),
    'utf8'
  );
  assert.match(watcher, /const handleGenesysCallExpiry/);
  assert.match(watcher, /isGenesysCallShell\(chat\) \|\| chat\.status !== 'open'/);
  // Card anterior ao contrato não tem TTL: não pode ser fechado por engano.
  assert.match(watcher, /if \(!call \|\| call\.estado === 'disconnected'\) return/);
  // Connected/held não dependem de heartbeat e um card stale antigo é reparado.
  assert.match(watcher, /const connectedStateIsAuthoritative/);
  assert.match(watcher, /call\.confirmedConnected === true/);
  assert.match(watcher, /\['connected', 'held'\]\.includes\(call\.estado\)/);
  assert.match(watcher, /confirmedConnected: true,[\s\S]*?stale: false,[\s\S]*?staleAt: null/);
  // Para alerting, estágio 1 acusa e estágio 2 fecha — nunca fecha direto.
  assert.match(watcher, /const shouldClose = alreadyStale/);
  assert.match(watcher, /stale: true, staleAt: Date\.now\(\)/);
  assert.match(watcher, /closeReason = 'genesys_ligacao_sem_sinal'/);
  assert.doesNotMatch(watcher, /const everConnected =/);
  // Revalida o TTL sob lock: evento fresco no meio do caminho cancela a expiração.
  assert.match(watcher, /if \(Number\.isFinite\(liveExpiresAt\) && Date\.now\(\) <= liveExpiresAt\) return/);
  assert.match(watcher, /await handleGenesysCallExpiry\(afterInactivityChat\)/);
});

test('watcher reconcilia espelho Genesys calado sem forçar re-seed nem insistir', async () => {
  const watcher = await readFile(
    new URL('../src/services/chatRuntimeWatcher.js', import.meta.url),
    'utf8'
  );
  assert.match(watcher, /const handleGenesysMirrorReconcile/);
  // Só espelho vivo, com dono e já bootstrapado.
  assert.match(watcher, /chat\.status !== 'open' \|\| !chat\.agentId/);
  assert.match(watcher, /if \(!chat\.historySeeded\) return/);
  // Voz/callback nunca tem mensagem: reconciliar seria pedir vazio pra sempre.
  assert.match(watcher, /isGenesysEmptyShell\(chat\)/);
  // Nunca re-seeda histórico: a extensão decide o que falta.
  assert.match(watcher, /force:\s*false/);
  assert.match(watcher, /watch:\s*true/);
  // Cooldown e idle antes de pedir, e limpeza do estado em memória.
  assert.match(watcher, /idleMs < GENESYS_RECONCILE_IDLE_MS/);
  assert.match(watcher, /now - lastAskedAt < GENESYS_RECONCILE_COOLDOWN_MS/);
  assert.match(watcher, /genesysReconcileLastAskedAt\.set\(chat\.id, now\)/);
  assert.match(watcher, /pruneGenesysReconcileState/);
  // Extensão offline é o caso esperado: não polui log.
  assert.match(watcher, /result\?\.reason !== 'extension_offline'/);
  // Ligado no tick, depois de revalidar que o chat não fechou.
  assert.match(watcher, /await handleGenesysMirrorReconcile\(afterInactivityChat\)/);
});
