import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolveGenesysConversationStartedAt } from '../client/src/utils/genesysInactivity.js';

test('contador global prioriza a abertura imutável da conversa Genesys', () => {
  const startedAt = '2026-08-14T18:00:00.000Z';
  assert.equal(resolveGenesysConversationStartedAt({
    genesysStartedAt: startedAt,
    createdAt: '2026-08-14T18:04:00.000Z',
    lastMessageAt: '2026-08-14T18:09:30.000Z',
  }), new Date(startedAt).getTime());
});

test('mensagens e eventos técnicos não alteram a âncora global', () => {
  const startedAt = '2026-08-14T18:00:00.000Z';
  assert.equal(resolveGenesysConversationStartedAt({
    genesysStartedAt: startedAt,
    lastCustomerMessageAt: '2026-08-14T18:05:00.000Z',
    lastAgentMessageAt: '2026-08-14T18:07:00.000Z',
    updatedAt: '2026-08-14T18:09:00.000Z',
  }), new Date(startedAt).getTime());
});

test('card legado usa createdAt sem depender da última interação', () => {
  const createdAt = '2026-08-14T18:02:00.000Z';
  assert.equal(resolveGenesysConversationStartedAt({
    createdAt,
    lastMessageAt: '2026-08-14T18:09:00.000Z',
  }), new Date(createdAt).getTime());
});

test('contrato preserva o início Genesys no upsert e na lista leve', async () => {
  const relay = await readFile(new URL('../src/services/extensionAtendimento.js', import.meta.url), 'utf8');
  const routes = await readFile(new URL('../src/routes/chats.js', import.meta.url), 'utf8');
  const summaries = await readFile(new URL('../src/services/chatSummaries.js', import.meta.url), 'utf8');
  assert.match(relay, /genesysStartedAt: abertoEm \|\| now/);
  assert.match(relay, /incomingStartMs < currentStartMs/);
  assert.match(routes, /genesysStartedAt: 1/);
  assert.match(summaries, /genesysStartedAt: chat\?\.genesysStartedAt \|\| null/);
});
