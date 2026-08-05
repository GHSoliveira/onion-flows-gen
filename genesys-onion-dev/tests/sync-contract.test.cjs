const test = require("node:test");
const assert = require("node:assert/strict");
const { readFile } = require("node:fs/promises");
const { execFileSync } = require("node:child_process");
const path = require("node:path");

const extensionRoot = path.resolve(__dirname, "..");
const backgroundPath = path.join(extensionRoot, "background.js");
const loadBackground = () => readFile(backgroundPath, "utf8");

test("snapshot com mídia não bloqueia recarga ao exceder a cota do Chrome", async () => {
  const background = await loadBackground();
  assert.match(background, /MAX_PERSISTED_SNAPSHOT_BYTES\s*=\s*600000/);
  assert.match(background, /const volatileSyncOutbox = new Map\(\)/);
  assert.match(background, /if \(options\.volatileOnly === true \|\| entryBytes > MAX_PERSISTED_SNAPSHOT_BYTES\)\s*\{\s*volatileSyncOutbox\.set\(eventId, entry\)/);
  assert.match(background, /catch \(error\)\s*\{[\s\S]*?volatileSyncOutbox\.set\(eventId, entry\);[\s\S]*?storage_indisponivel/);
  assert.match(background, /function isStorageQuotaError\(error\)/);
  assert.match(background, /pruneSyncOutboxInPlace\(outbox\)/);
  assert.match(background, /outboxMutation = outboxMutation\.catch\(\(\) => \{\}\)\.then/);
  assert.match(background, /Recarga continuou sem armazenamento local/);
  assert.match(background, /const snapshotDeliveriesInFlight = new Set\(\)/);
  assert.match(background, /const outboxStorage = \(\) => chrome\.storage\.session \|\| chrome\.storage\.local/);
  assert.match(background, /startupStorageRepair = migrateLegacyOutboxesToSession\(\)[\s\S]*?recoverOutboxStorageQuota\(\)/);
});

test("partida reconcilia filas com roster ativo antes de reenviar histórico", async () => {
  const background = await loadBackground();
  assert.match(background, /STARTUP_ROSTER_WAIT_MS\s*=\s*3500/);
  assert.match(background, /passiveRosterCandidate\.confirmations >= 2/);
  assert.match(background, /beginStartupDeliveryReconciliation\(next\)/);
  assert.match(background, /pruneDeliveryQueuesForActiveRoster\(activeIds\)/);
  assert.match(background, /Fila reconciliada com atendimentos ativos/);
  assert.match(background, /filter\(\(conversation\) => hasActiveAgentMessaging\(conversation\)\)/);
  assert.match(background, /if \(!hasActiveAgentMessaging\(detail\)\)/);
  assert.match(background, /Evento histórico ignorado/);
  assert.match(background, /canDeliverActiveConversation\(outboxConversationId\(entry\)\)/);
  assert.match(background, /const quarantinedNotificationIds = new Set\(\)/);
  assert.match(background, /deliveryRosterGuard\.blocking[\s\S]*?!hasGuardedActiveEvidence\(conversationId\)/);
  assert.match(background, /removeSyncOutboxThroughSnapshot\(entry\)/);
  assert.match(background, /const newestByConversation = new Map\(\)/);
});

test("background da extensão continua com sintaxe JavaScript válida", () => {
  assert.doesNotThrow(() => execFileSync(process.execPath, ["--check", backgroundPath], {
    stdio: "pipe"
  }));
});

test("governador preserva teto, reserva e serialização por conversa", async () => {
  const background = await loadBackground();
  assert.match(background, /GENESYS_NORMAL_CALLS_PER_MINUTE\s*=\s*30/);
  assert.match(background, /GENESYS_EMERGENCY_CALLS_PER_MINUTE\s*=\s*40/);
  assert.match(background, /GENESYS_MAX_CONCURRENT_CALLS\s*=\s*2/);
  assert.match(background, /genesysGovernorActiveConversations\.has\(job\.conversationId\)/);
  assert.match(background, /response\.status === 429/);
  assert.match(background, /parseRetryAfterMs\(response\)/);
});

test("envio exige validade, geração e communicationId autoritativo", async () => {
  const background = await loadBackground();
  assert.match(background, /error:\s*"comando_expirado"/);
  assert.match(background, /error:\s*"geracao_da_conversa_divergente"/);
  assert.match(background, /resolveConnectedAgentCommunication\(convId\)/);
  assert.match(background, /state !== "connected"/);
  assert.match(background, /communicationId_nao_disponivel_para_esta_conversa/);
  assert.match(background, /CommunicationId do card estava desatualizado/);
});

test("deltas possuem outbox persistente e remoção no fechamento", async () => {
  const background = await loadBackground();
  assert.match(background, /DELTA_OUTBOX_KEY\s*=\s*"onionDevDeltaOutbox"/);
  assert.match(background, /queueReliableDelta\(/);
  assert.match(background, /flushReliableDeltaOutbox\(/);
  assert.match(background, /removeDeltaOutboxForConversation\(conversationId\)/);
});

test("áudio Genesys é baixado autenticado e só sincroniza depois de hidratado", async () => {
  const background = await loadBackground();
  assert.match(background, /"api-downloads\.sae1\.pure\.cloud"/);
  assert.match(background, /declaredMimeType === "application\/ogg"/);
  assert.match(background, /data:\$\{mimeType\};base64/);
  assert.match(background, /mediaHydrationFailed/);
  assert.match(background, /Mídia Genesys aguardando novo download/);
});

test("IXC entrega ao Onion somente cadastros de login ativos", async () => {
  const background = await loadBackground();
  assert.match(background, /return logins\.filter\(\(login\) => login\.active === true\)/);
});

test("sincroniza clientes em paralelo limitado sem alterar o teto do Genesys", async () => {
  const background = await loadBackground();
  assert.match(background, /MAX_CONVERSATION_SYNC_CONCURRENCY\s*=\s*5/);
  assert.match(background, /MAX_PASSIVE_CONVERSATION_CONCURRENCY\s*=\s*5/);
  assert.match(background, /MAX_ONION_DELIVERY_CONCURRENCY\s*=\s*5/);
  assert.match(background, /MAX_MEDIA_HYDRATION_CONCURRENCY\s*=\s*1/);
  assert.match(background, /mapWithConcurrency\([\s\S]*?MAX_PASSIVE_CONVERSATION_CONCURRENCY/);
  assert.match(background, /const entriesByConversation = new Map\(\)/);
  assert.match(background, /deltaDeliveriesInFlight\.has\(entry\.eventId\)/);
  assert.match(background, /scheduleMediaHydration\(\(\) => hydrateGenesysMedia\(descriptor\)\)/);
  assert.match(background, /processPassiveConversationDiscovery\(message\),\s*processPassiveMessageDeltas\(message\)/);
});
test("roster autoritativo de mensagens repara cards ausentes sem perder o bloqueio", async () => {
  const background = await loadBackground();
  assert.match(background, /AUTHORITATIVE_ROSTER_AUDIT_MS\s*=\s*2\s*\*\s*60\s*\*\s*1000/);
  assert.match(background, /AUTHORITATIVE_ROSTER_CACHE_MS\s*=\s*30000/);
  assert.match(background, /\/api\/v2\/conversations\?communicationType=message&_=/);
  assert.doesNotMatch(background, /conversations\?communicationType=message&pageSize/);
  assert.match(background, /function activeGenesysMessageConversationMap\(entities\)/);
  assert.match(background, /const missingIds = \[\.\.\.activeIds\]\.filter\(\(conversationId\) => !onionIds\.has\(conversationId\)\)/);
  assert.match(background, /state\.forceSnapshot = true;[\s\S]*?scheduleNotificationSync\(conversationId, staggerMs\)/);
  assert.match(background, /function deliverConversationUpsertToOnion\(payload/);
  assert.match(background, /state\.upserted = true;[\s\S]*?resolve\(true\)/);
  assert.match(background, /if \(state\.upserted\) \{\s*emit\("ext:atendimento:upsert"/);
  assert.match(background, /deliveryRosterGuard\.blocking = true/);
  assert.match(background, /schedulePeriodicAuthoritativeRosterAudit\(\)/);
});
test("link textual não vira documento e anexo real continua sendo mídia", async () => {
  const background = await loadBackground();
  const start = background.indexOf("function isExplicitGenesysMediaReference");
  const end = background.indexOf("function arrayBufferToBase64", start);
  assert.ok(start >= 0 && end > start, "extrator de mídia não encontrado");
  const descriptor = new Function(
    `${background.slice(start, end)}; return genesysMediaDescriptor;`
  )();

  assert.equal(descriptor({
    normalizedMessage: {
      text: "Veja https://example.com/cliente",
      content: [{ type: "link", url: "https://example.com/cliente", title: "Portal" }]
    }
  }), null);
  assert.equal(descriptor({
    normalizedMessage: {
      text: "Veja https://example.com/cliente",
      content: [{ contentType: "text/plain", href: "https://example.com/cliente" }]
    }
  }), null);
  assert.equal(descriptor({
    normalizedMessage: {
      text: "Veja https://apps.sae1.pure.cloud/directory/",
      content: [{ type: "link", url: "https://apps.sae1.pure.cloud/directory/", title: "Genesys" }]
    }
  }), null);
  assert.equal(descriptor({
    normalizedMessage: {
      text: "Veja https://example.com/cliente",
      content: [{ type: "link", url: "https://api-downloads.sae1.pure.cloud/media/link-preview", title: "Portal" }]
    }
  }), null);

  const media = descriptor({
    normalizedMessage: {
      attachments: [{
        type: "attachment",
        url: "https://api-downloads.sae1.pure.cloud/media/foto.jpg",
        mimeType: "image/jpeg",
        fileName: "foto.jpg"
      }]
    }
  });
  assert.equal(media?.fileName, "foto.jpg");
  assert.equal(media?.mimeType, "image/jpeg");
});
test("envio normal usa o par salvo e só consulta o roster como recuperação", async () => {
  const background = await loadBackground();
  const start = background.indexOf("async function forwardMessageThroughGenesysWebRequest");
  const end = background.indexOf("async function emit(event, payload)", start);
  assert.ok(start >= 0 && end > start, "fluxo de envio não encontrado");
  const sendFlow = background.slice(start, end);
  assert.match(sendFlow, /let communicationId = locallyKnownCommunicationId \|\| suppliedCommunicationId/);
  assert.match(sendFlow, /if \(!communicationId\) \{[\s\S]*?resolveConnectedAgentCommunication\(convId\)/);
  assert.match(sendFlow, /postGenesysTextMessage\(convId, communicationId, text\)/);
  assert.match(sendFlow, /includes\("Genesys HTTP 404"\)[\s\S]*?resolveConnectedAgentCommunication\(convId\)/);
  assert.match(sendFlow, /refreshedCommunicationId === communicationId/);
  assert.doesNotMatch(sendFlow, /const activeBinding = await resolveConnectedAgentCommunication\(convId\)/);
  assert.match(background, /connectedAgentCommunicationCandidates\(rosterDetail\)\[0\]\?\.communicationId/);
  assert.match(background, /"authoritative-roster"/);
});

test("transferencia Genesys exige fila pesquisada, conversa ativa e tabulacao confirmada", async () => {
  const background = await loadBackground();
  assert.match(background, /cmd:buscar_filas_transferencia/);
  assert.match(background, /cmd:transferir_com_tabulacao/);
  assert.match(background, /GENESYS_TRANSFER_QUEUE_APPROVAL_MS\s*=\s*5 \* 60 \* 1000/);
  assert.match(background, /fila_nao_confirmada_por_pesquisa_recente/);
  assert.match(background, /conversa_nao_encontrada_na_lista_ativa/);
  assert.match(background, /participante_agente_diverge_da_conversa_ativa/);
  assert.match(background, /participante_agente_nao_corresponde_ao_usuario_logado/);
  assert.match(background, /\/replace\/queue/);
  assert.match(background, /wrapup:\s*\{\s*provisional:\s*true,\s*code:\s*selected\.id/);
  assert.match(background, /transferencia_realizada_mas_genesys_nao_confirmou_a_tabulacao/);
  assert.match(background, /motivo:\s*"genesys_transfer_confirmed"/);
});
