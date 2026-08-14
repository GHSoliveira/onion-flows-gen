import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveGenesysLastActivityAt } from '../client/src/utils/genesysInactivity.js';

test('evento técnico mais recente não reinicia o contador de inatividade', () => {
  const customerAt = '2026-08-14T18:00:00.000Z';
  assert.equal(resolveGenesysLastActivityAt({
    lastCustomerMessageAt: customerAt,
    lastMessageAt: '2026-08-14T18:09:30.000Z',
    lastMessage: { sender: 'system', timestamp: '2026-08-14T18:09:30.000Z' },
  }), new Date(customerAt).getTime());
});

test('contador usa a mensagem humana mais recente entre cliente e agente', () => {
  const agentAt = '2026-08-14T18:04:00.000Z';
  assert.equal(resolveGenesysLastActivityAt({
    lastCustomerMessageAt: '2026-08-14T18:00:00.000Z',
    lastAgentMessageAt: agentAt,
    messages: [
      { sender: 'bot', timestamp: '2026-08-14T18:05:00.000Z' },
      { sender: 'user', timestamp: '2026-08-14T18:00:00.000Z' },
    ],
  }), new Date(agentAt).getTime());
});

test('card legado sem remetente ainda usa lastMessageAt como fallback', () => {
  const legacyAt = '2026-08-14T18:02:00.000Z';
  assert.equal(resolveGenesysLastActivityAt({ lastMessageAt: legacyAt }), new Date(legacyAt).getTime());
});

