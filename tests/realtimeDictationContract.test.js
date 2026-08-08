import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const load = (relativePath) => readFile(new URL(relativePath, import.meta.url), 'utf8');

test('previa do ditado usa socket local autenticado, base beam 1 e fila unica', async () => {
  const index = await load('../index.js');
  const socketHandler = await load('../src/services/localDictationSocket.js');
  const transcription = await load('../src/services/localAudioTranscription.js');
  const worker = await load('../scripts/transcribe_audio_worker.py');
  const socketClient = await load('../client/src/services/socket.js');

  assert.match(index, /registerLocalDictationHandlers\(socket\)/);
  assert.match(index, /warmLocalTranscription\(\)/);
  assert.match(socketHandler, /socket\.on\('dictation:partial'/);
  assert.match(socketHandler, /partialInFlight/);
  assert.match(socketHandler, /detectMime\(audio\.subarray\(0, 64\)\) !== 'audio\/wav'/);
  assert.match(socketHandler, /modelName: PARTIAL_MODEL/);
  assert.match(socketHandler, /beamSize: 1/);
  assert.match(socketHandler, /vadFilter: false/);
  assert.match(socketHandler, /fs\.unlink\(filePath\)/);
  assert.match(transcription, /warmLocalTranscription/);
  assert.match(worker, /models = \{\}/);
  assert.match(worker, /beam_size = max\(1, min\(5/);
  assert.match(socketClient, /dictation:warmup/);
  assert.match(socketClient, /dictation:partial/);
});

test('captura mostra previa na caixa mas bloqueia envio ate a revisao final', async () => {
  const component = await load('../client/src/components/DictationRecorder.jsx');
  const workspace = await load('../client/src/pages/AgentWorkspace.jsx');

  assert.match(component, /createMediaStreamSource/);
  assert.match(component, /createScriptProcessor/);
  assert.match(component, /encodePcm16Wav/);
  assert.match(component, /calculateRms/);
  assert.match(component, /fullPcmChunksRef/);
  assert.match(component, /Nível do microfone/);
  assert.match(component, /sem sinal/);
  assert.match(component, /não entrou som/);
  assert.match(component, /mergeTranscript/);
  assert.match(component, /transcribeDictationPartial/);
  assert.match(component, /onPartial\?\.\(liveTextRef\.current\)/);
  assert.match(component, /transcribeDictation\(/);
  assert.match(workspace, /displayedAgentInput/);
  assert.match(workspace, /composerLocked/);
  assert.match(workspace, /value=\{displayedAgentInput\}/);
  assert.match(workspace, /disabled=\{composerLocked\}/);
});
