import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const folder = new URL('../genesys-call-diagnostic/', import.meta.url);

async function source(name) {
  return readFile(new URL(name, folder), 'utf8');
}

test('extensao de diagnostico e independente e nao ganha acesso a segredos', async () => {
  const manifest = JSON.parse(await source('manifest.json'));
  assert.equal(manifest.name, 'Onion Sync Diagnostic');
  assert.equal(manifest.version, '0.3.0');
  assert.deepEqual(manifest.permissions.sort(), ['storage', 'tabs']);
  assert.deepEqual(manifest.host_permissions, ['https://apps.sae1.pure.cloud/*']);
  for (const forbidden of ['cookies', 'debugger', 'downloads', 'webRequest', 'webRequestBlocking']) {
    assert.ok(!manifest.permissions.includes(forbidden));
  }
  assert.ok(manifest.content_scripts.some((entry) => entry.world === 'MAIN' && entry.run_at === 'document_start'));
  assert.ok(manifest.content_scripts.every((entry) => entry.all_frames === true));
});

test('probe observa transporte existente sem criar chamada adicional ao Genesys', async () => {
  const probe = await source('page-probe.js');
  assert.match(probe, /function DiagnosticWebSocket/);
  assert.match(probe, /socket\.addEventListener\("message"/);
  assert.match(probe, /response\.clone\(\)\.text\(\)/);
  assert.match(probe, /this\.addEventListener\("loadend"/);
  assert.match(probe, /const response = await nativeFetch\.apply\(this, arguments\)/);
  assert.match(probe, /kind: "network_messages"/);
  assert.match(probe, /kind: "transport_state"/);
  assert.match(probe, /requestedIds: parseRequestedMessageIds/);
  assert.match(probe, /hasText: Boolean/);
  assert.match(probe, /return "ignored"/);
  assert.match(probe, /!observableConversationPath\(route\)/);
  assert.match(probe, /Array\.isArray\(item\.participants\)/);
  assert.doesNotMatch(probe, /authorization|cookie|headers\s*:/i);
  assert.doesNotMatch(probe, /text:\s*cleanText|textBody:\s*|messageText:\s*/);
});

test('relatorio e limitado, sanitizado e sobrevive a suspensao do service worker', async () => {
  const background = await source('background.js');
  assert.match(background, /const MAX_EVENTS = 4000/);
  assert.match(background, /const MAX_CAPTURE_BYTES = 4 \* 1024 \* 1024/);
  assert.match(background, /const MAX_CAPTURE_MS = 20 \* 60 \* 1000/);
  assert.match(background, /chrome\.storage\.session\.set/);
  assert.match(background, /function sanitizeCall/);
  assert.match(background, /function sanitizeParticipant/);
  assert.match(background, /function sanitizeMessageCommunication/);
  assert.match(background, /function sanitizeMessageEntity/);
  assert.match(background, /function sanitizeObserverConversation/);
  assert.match(background, /function sanitizeDomSnapshot/);
  assert.match(background, /replace\(UUID_GLOBAL_RE, "\{uuid\}"\)/);
  assert.match(background, /callTransitions/);
  assert.match(background, /messageTransitions/);
  assert.match(background, /messageBatchTimeline/);
  assert.match(background, /pipelineTimeline/);
  assert.match(background, /kind === "onion_pipeline"/);
  assert.match(background, /conversationDiagnostics/);
  assert.match(background, /rawToObserverMs/);
  assert.match(background, /EVENT_HEARTBEAT_MS = 5000/);
  assert.match(background, /addedConversationIds/);
  assert.match(background, /removedConversationIds/);
  assert.match(background, /Recarregue a página do Genesys e tente novamente/);
  assert.match(background, /Sem tokens, cookies, mensagens, CPF, nomes, telefones ou enderecos/);
});

test('captura usa dois cliques e baixa JSON local', async () => {
  const popup = await source('popup.js');
  const content = await source('content.js');
  assert.match(popup, /CALL_DIAG_START/);
  assert.match(popup, /CALL_DIAG_STOP/);
  assert.match(popup, /new Blob\(\[reportJson\]/);
  assert.match(content, /phase: "initial"|sendDomSnapshot\(phase, true\)/);
  assert.match(content, /MutationObserver/);
  assert.match(content, /onion-dev-network-observation/);
  assert.match(content, /observerEvent: "communication_candidate"/);
  assert.match(content, /source === "onion-dev-sync-stage"/);
  assert.match(content, /kind: "onion_pipeline"/);
  assert.match(content, /mediaHint/);
  assert.doesNotMatch(content, /innerText|textContent/);
});

test('todos os scripts da extensao de diagnostico possuem sintaxe valida', async () => {
  for (const name of ['background.js', 'page-probe.js', 'content.js', 'popup.js']) {
    execFileSync(process.execPath, ['--check', fileURLToPath(new URL(name, folder))], { stdio: 'pipe' });
  }
});
