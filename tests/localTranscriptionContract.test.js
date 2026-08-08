import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const load = (relativePath) => readFile(new URL(relativePath, import.meta.url), 'utf8');

test('transcricao local resolve o audio pela conversa e nunca por caminho enviado pelo navegador', async () => {
  const routes = await load('../src/routes/chats.js');
  const routeStart = routes.indexOf("router.post('/:id/messages/:messageId/transcribe'");
  const routeEnd = routes.indexOf('// Hydrate Genesys sob demanda', routeStart);
  const transcribeRoute = routes.slice(routeStart, routeEnd);

  assert.ok(routeStart >= 0 && routeEnd > routeStart);
  assert.match(transcribeRoute, /String\(chat\.agentId\) !== String\(req\.user\?\.id/);
  assert.match(transcribeRoute, /getChatMessageById\(\{/);
  assert.match(routes, /pathname\.startsWith\(uploadPrefix\)/);
  assert.match(routes, /filePath\.startsWith\(`\$\{tenantRoot\}\$\{path\.sep\}`\)/);
  assert.doesNotMatch(transcribeRoute, /req\.body\?\.(filePath|mediaUrl|url)/);
});

test('transcricao usa fila de concorrencia um, deduplica e persiste cache efemero na mensagem', async () => {
  const routes = await load('../src/routes/chats.js');
  const service = await load('../src/services/localAudioTranscription.js');
  const worker = await load('../scripts/transcribe_audio_worker.py');
  const requirements = await load('../requirements-transcription.txt');
  const setup = await load('../scripts/setup-local-transcription.ps1');

  assert.match(service, /if \(activeJob \|\| !queue\.length\) return/);
  assert.match(service, /inFlightByKey\.get\(safeCacheKey\)/);
  assert.match(service, /concurrency: 1/);
  assert.match(routes, /message\?\.meta\?\.audioTranscription/);
  assert.match(routes, /'meta\.audioTranscription': transcription/);
  assert.match(worker, /"vad_filter": use_vad/);
  assert.match(worker, /"language": "pt"/);
  assert.match(requirements, /ctranslate2==4\.6\.0/);
  assert.match(setup, /ctranslate2\.__version__ == '4\.6\.0'/);
  assert.match(service, /PARTIAL_MODEL_NAME/);
  assert.match(worker, /PARTIAL_MODEL_NAME/);
});

test('player oferece transcricao somente sob demanda', async () => {
  const component = await load('../client/src/components/ChatMessageContent.jsx');
  const service = await load('../client/src/services/transcription.js');

  assert.match(component, /'Transcrever'/);
  assert.match(component, /requestTranscription/);
  assert.match(component, /audioTranscriptionCache/);
  assert.match(component, /Nenhuma fala identificada neste áudio/);
  assert.match(service, /method: 'POST'/);
});
