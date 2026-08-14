import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolveGenesysConversationAssignedAt } from '../client/src/utils/genesysInactivity.js';

test('contador prioriza o instante em que a conversa chegou ao agente', () => {
  const assignedAt = '2026-08-14T18:30:00.000Z';
  assert.equal(resolveGenesysConversationAssignedAt({
    genesysStartedAt: '2026-08-14T18:00:00.000Z',
    genesysAssignedAt: assignedAt,
    createdAt: '2026-08-14T18:04:00.000Z',
    lastMessageAt: '2026-08-14T18:09:30.000Z',
  }), new Date(assignedAt).getTime());
});

test('mensagens e eventos tecnicos nao alteram a ancora da atribuicao', () => {
  const assignedAt = '2026-08-14T18:30:00.000Z';
  assert.equal(resolveGenesysConversationAssignedAt({
    genesysAssignedAt: assignedAt,
    lastCustomerMessageAt: '2026-08-14T18:35:00.000Z',
    lastAgentMessageAt: '2026-08-14T18:37:00.000Z',
    updatedAt: '2026-08-14T18:39:00.000Z',
  }), new Date(assignedAt).getTime());
});

test('card legado usa createdAt sem herdar o inicio antigo da conversa', () => {
  const createdAt = '2026-08-14T18:02:00.000Z';
  assert.equal(resolveGenesysConversationAssignedAt({
    genesysStartedAt: '2026-08-14T17:30:00.000Z',
    createdAt,
    lastMessageAt: '2026-08-14T18:09:00.000Z',
  }), new Date(createdAt).getTime());
});

test('contrato preserva a atribuicao Genesys no upsert, observador e lista leve', async () => {
  const relay = await readFile(new URL('../src/services/extensionAtendimento.js', import.meta.url), 'utf8');
  const routes = await readFile(new URL('../src/routes/chats.js', import.meta.url), 'utf8');
  const summaries = await readFile(new URL('../src/services/chatSummaries.js', import.meta.url), 'utf8');
  const background = await readFile(new URL('../genesys-onion-dev/background.js', import.meta.url), 'utf8');
  const focus = await readFile(new URL('../genesys-onion-dev/genesys-focus.js', import.meta.url), 'utf8');
  assert.match(relay, /genesysAssignedAt: atribuidoEm \|\| now/);
  assert.match(relay, /genesysAssignmentCommunicationId: communicationId \|\| null/);
  assert.match(routes, /genesysAssignedAt: 1/);
  assert.match(summaries, /genesysAssignedAt: chat\?\.genesysAssignedAt \|\| null/);
  assert.match(background, /atribuidoEm: identity\.assignedAt/);
  assert.match(focus, /assignedAt: entry\.assignedAt/);
});
