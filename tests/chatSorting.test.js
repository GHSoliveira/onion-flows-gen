import test from 'node:test';
import assert from 'node:assert/strict';
import {
  lastAgentMessageAt,
  lastCustomerMessageAt,
  sortChatsForMode,
  waitingForAgentSince,
} from '../client/src/utils/chatSorting.js';

const message = (sender, timestamp) => ({ sender, timestamp, text: `${sender}-${timestamp}` });
const chat = (id, messages) => ({
  id,
  messages,
  lastMessage: messages.at(-1),
  lastMessageAt: messages.at(-1)?.timestamp,
});
test('detecta espera do agente somente depois da mensagem mais recente do cliente', () => {
  const pending = chat('pending', [
    message('agent', '2026-08-05T12:00:00.000Z'),
    message('user', '2026-08-05T12:05:00.000Z'),
  ]);
  const answered = chat('answered', [
    message('user', '2026-08-05T12:00:00.000Z'),
    message('agent', '2026-08-05T12:05:00.000Z'),
  ]);

  assert.equal(waitingForAgentSince(pending), Date.parse('2026-08-05T12:05:00.000Z'));
  assert.equal(waitingForAgentSince(answered), 0);
  assert.equal(lastCustomerMessageAt(pending), Date.parse('2026-08-05T12:05:00.000Z'));
  assert.equal(lastAgentMessageAt(answered), Date.parse('2026-08-05T12:05:00.000Z'));
});

test('ordena maior e menor tempo sem interacao', () => {
  const older = chat('older', [message('user', '2026-08-05T10:00:00.000Z')]);
  const newer = chat('newer', [message('user', '2026-08-05T11:00:00.000Z')]);

  assert.deepEqual(sortChatsForMode([newer, older], 'interaction', 'desc').map((item) => item.id), ['older', 'newer']);
  assert.deepEqual(sortChatsForMode([older, newer], 'interaction', 'asc').map((item) => item.id), ['newer', 'older']);
});

test('prioriza espera real do agente e permite inverter sua idade', () => {
  const olderPending = chat('older-pending', [message('user', '2026-08-05T10:00:00.000Z')]);
  const newerPending = chat('newer-pending', [message('user', '2026-08-05T11:00:00.000Z')]);
  const answered = chat('answered', [
    message('user', '2026-08-05T09:00:00.000Z'),
    message('agent', '2026-08-05T11:30:00.000Z'),
  ]);

  assert.deepEqual(
    sortChatsForMode([answered, newerPending, olderPending], 'agent_wait', 'desc').map((item) => item.id),
    ['older-pending', 'newer-pending', 'answered']
  );
  assert.deepEqual(
    sortChatsForMode([answered, olderPending, newerPending], 'agent_wait', 'asc').map((item) => item.id),
    ['newer-pending', 'older-pending', 'answered']
  );
});

test('mensagem nova do cliente sobe ao inicio', () => {
  const older = chat('older', [message('user', '2026-08-05T10:00:00.000Z')]);
  const now = chat('now', [message('user', '2026-08-05T12:00:00.000Z')]);

  assert.deepEqual(sortChatsForMode([older, now], 'customer_recent', 'desc').map((item) => item.id), ['now', 'older']);
  assert.deepEqual(sortChatsForMode([now, older], 'customer_recent', 'asc').map((item) => item.id), ['older', 'now']);
});
