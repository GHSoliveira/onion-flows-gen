import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const load = (relativePath) => readFile(new URL(relativePath, import.meta.url), 'utf8');

test('ditado local recebe audio bruto, limita uso e sempre remove o temporario', async () => {
  const routes = await load('../src/routes/chats.js');
  const start = routes.indexOf("router.post('/:id/dictation'");
  const end = routes.indexOf('// Transcrição local sob demanda', start);
  const route = routes.slice(start, end);

  assert.ok(start >= 0 && end > start);
  assert.match(route, /String\(chat\.agentId\) !== String\(req\.user\?\.id/);
  assert.match(route, /DICTATION_MAX_DURATION_SECONDS/);
  assert.match(route, /DICTATION_MAX_BYTES/);
  assert.match(route, /for await \(const rawChunk of req\)/);
  assert.match(route, /detectMime\(signature\)/);
  assert.match(route, /transcribeLocalAudio\(/);
  assert.match(route, /finally \{/);
  assert.match(route, /fs\.unlink\(filePath\)/);
  assert.doesNotMatch(route, /appendChatMessage|relayAgentMessageToGenesys|relayAgentMediaToGenesys/);
});

test('gravador insere o resultado somente no rascunho e para ao trocar de card', async () => {
  const component = await load('../client/src/components/DictationRecorder.jsx');
  const workspace = await load('../client/src/pages/AgentWorkspace.jsx');
  const service = await load('../client/src/services/dictation.js');

  assert.match(component, /navigator\.mediaDevices\.getUserMedia/);
  assert.match(component, /new MediaRecorder/);
  assert.match(component, /MAX_RECORDING_SECONDS = 120/);
  assert.match(component, /onTranscribed\?\.\(text\)/);
  assert.match(component, /requestControllerRef\.current\?\.abort\(\)/);
  assert.doesNotMatch(component, /\/messages|handleSend|relay/);
  assert.match(workspace, /key={`dictation-\$\{selectedChat\.id\}`}/);
  assert.match(workspace, /setAgentInput\(\(previous\)/);
  assert.match(service, /body: audioBlob/);
  assert.match(service, /X-Onion-Duration-Seconds/);
  assert.match(service, /signal/);
});
