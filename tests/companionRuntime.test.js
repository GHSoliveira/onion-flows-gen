import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

test('JSON companion não persiste conversas nem mensagens', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'onion-companion-'));
  const dbPath = path.join(tempDir, 'db.json');
  process.env.DB_ADAPTER = 'json';
  process.env.USE_JSON_DB = 'true';
  process.env.JSON_DB_PATH = dbPath;
  process.env.JSON_EPHEMERAL_COLLECTIONS = 'activeChats,chatMessages,chatEvents';

  try {
    const { default: adapter } = await import(`../db/DatabaseAdapter.js?companion=${Date.now()}`);
    await adapter.init();
    await adapter.insertOne('users', { id: 'agent_local', name: 'Agente local' });
    await adapter.insertOne('activeChats', { id: 'chat_ephemeral', customerName: 'Cliente de teste' });
    await adapter.insertOne('chatMessages', { id: 'msg_ephemeral', text: 'mensagem sintética' });
    await adapter.insertOne('chatEvents', { id: 'event_ephemeral', type: 'MESSAGE' });

    const persisted = JSON.parse(await fs.readFile(dbPath, 'utf8'));
    assert.equal(persisted.users?.[0]?.id, 'agent_local');
    assert.equal('activeChats' in persisted, false);
    assert.equal('chatMessages' in persisted, false);
    assert.equal('chatEvents' in persisted, false);
    await adapter.close();
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

test('ponte realtime encaminha ACKs do Genesys e usa união de salas', async () => {
  const root = path.resolve(import.meta.dirname, '..');
  const socketSource = await fs.readFile(path.join(root, 'client', 'src', 'services', 'socket.js'), 'utf8');
  const extensionSource = await fs.readFile(path.join(root, 'src', 'services', 'extensionAtendimento.js'), 'utf8');
  const serverSource = await fs.readFile(path.join(root, 'index.js'), 'utf8');

  for (const eventName of ['chat_updated', 'message_delivery', 'genesys_cmd_result', 'genesys_cmd_failed']) {
    assert.match(socketSource, new RegExp(`this\\.socket\\.on\\('${eventName}'`));
    assert.match(socketSource, new RegExp(`this\\.emit\\('${eventName}'`));
  }
  assert.match(extensionSource, /io\.to\(roomTenant\)\.to\(`agent:\$\{chat\.agentId\}`\)/);
  assert.match(serverSource, /path\.join\(__dirname, 'client', 'dist'\)/);
  assert.match(serverSource, /httpServer\.listen\(PORT, '127\.0\.0\.1'/);
});

test('frontend local usa a origem atual e nao volta para a porta legada 3001', async () => {
  const root = path.resolve(import.meta.dirname, '..');
  const apiSource = await fs.readFile(path.join(root, 'client', 'src', 'services', 'api.js'), 'utf8');
  const mainSource = await fs.readFile(path.join(root, 'client', 'src', 'main.jsx'), 'utf8');
  const viteSource = await fs.readFile(path.join(root, 'client', 'vite.config.js'), 'utf8');

  assert.match(apiSource, /API_BASE = isLocalHost\s*\? window\.location\.origin/);
  assert.match(mainSource, /API_BASE = isLocalHost\s*\? window\.location\.origin/);
  assert.doesNotMatch(apiSource, /VITE_API_URL \|\| DEFAULT_API_BASE/);
  assert.doesNotMatch(mainSource, /VITE_API_URL \|\| DEFAULT_API_BASE/);
  assert.doesNotMatch(`${apiSource}\n${mainSource}\n${viteSource}`, /localhost:3001/);
  assert.match(viteSource, /target: 'http:\/\/localhost:3101'/);
});

test('JSON local rejeita duplicatas concorrentes e mantém lookup indexado', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'onion-index-'));
  process.env.DB_ADAPTER = 'json';
  process.env.USE_JSON_DB = 'true';
  process.env.JSON_DB_PATH = path.join(tempDir, 'db.json');
  process.env.JSON_EPHEMERAL_COLLECTIONS = 'activeChats,chatMessages,chatEvents';

  try {
    const { default: adapter } = await import(`../db/DatabaseAdapter.js?index=${Date.now()}`);
    await adapter.init();
    const attempts = await Promise.allSettled([
      adapter.insertOne('activeChats', { id: 'chat_a', tenantId: 'tenant_a', genesysConvId: 'conv_a' }),
      adapter.insertOne('activeChats', { id: 'chat_b', tenantId: 'tenant_a', genesysConvId: 'conv_a' })
    ]);
    assert.equal(attempts.filter((item) => item.status === 'fulfilled').length, 1);
    const rejected = attempts.find((item) => item.status === 'rejected');
    assert.equal(rejected?.reason?.code, 11000);
    const found = await adapter.findOne('activeChats', { tenantId: 'tenant_a', genesysConvId: 'conv_a' });
    assert.equal(found?.id, 'chat_a');
    await adapter.close();
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

test('companion bloqueia banco remoto e anexo usa streaming temporário local', async () => {
  const root = path.resolve(import.meta.dirname, '..');
  const serverSource = await fs.readFile(path.join(root, 'index.js'), 'utf8');
  const mediaRouteSource = await fs.readFile(path.join(root, 'src', 'routes', 'media.js'), 'utf8');
  const mediaClientSource = await fs.readFile(path.join(root, 'client', 'src', 'services', 'media.js'), 'utf8');
  const mediaStorageSource = await fs.readFile(path.join(root, 'src', 'services', 'mediaStorage.js'), 'utf8');

  assert.match(serverSource, /COMPANION_MODE exige DB_ADAPTER=json/);
  assert.match(mediaRouteSource, /for await \(const rawChunk of req\)/);
  assert.match(mediaClientSource, /body:\s*file/);
  assert.doesNotMatch(mediaClientSource, /FileReader|readAsDataURL/);
  assert.match(mediaStorageSource, /LOCALAPPDATA/);
  assert.match(mediaStorageSource, /scheduleTransientMediaDeletion/);
});
