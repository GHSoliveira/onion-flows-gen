const timestampOf = (value) => {
  const parsed = new Date(value || 0).getTime();
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
};
const senderKind = (message) => String(
  message?.meta?.senderKind || message?.sender || ''
).trim().toLowerCase();

export const isCustomerChatMessage = (message) => (
  ['user', 'customer', 'cliente', 'visitor'].includes(senderKind(message))
);

export const isAgentChatMessage = (message) => (
  ['agent', 'other_agent', 'agente', 'human'].includes(senderKind(message))
);

const latestMessageTimestamp = (chat, predicate) => {
  const messages = Array.isArray(chat?.messages) ? chat.messages : [];
  let latest = 0;
  messages.forEach((message) => {
    if (!predicate(message)) return;
    latest = Math.max(latest, timestampOf(message?.timestamp || message?.createdAt));
  });
  return latest;
};

export const lastInteractionAt = (chat) => timestampOf(
  chat?.lastMessageAt
  || chat?.lastMessage?.timestamp
  || chat?.updatedAt
  || chat?.createdAt
);

export const lastCustomerMessageAt = (chat) => (
  timestampOf(chat?.lastCustomerMessageAt)
  || latestMessageTimestamp(chat, isCustomerChatMessage)
  || (isCustomerChatMessage(chat?.lastMessage)
    ? timestampOf(chat?.lastMessage?.timestamp || chat?.lastMessageAt)
    : 0)
);

export const lastAgentMessageAt = (chat) => (
  timestampOf(chat?.lastAgentMessageAt)
  || latestMessageTimestamp(chat, isAgentChatMessage)
  || (isAgentChatMessage(chat?.lastMessage)
    ? timestampOf(chat?.lastMessage?.timestamp || chat?.lastMessageAt)
    : 0)
);

export const waitingForAgentSince = (chat) => {
  const customerAt = lastCustomerMessageAt(chat);
  const agentAt = lastAgentMessageAt(chat);
  return customerAt > agentAt ? customerAt : 0;
};

const comparePresentTimestamps = (left, right, newestFirst) => {
  if (!left && !right) return 0;
  if (!left) return 1;
  if (!right) return -1;
  return newestFirst ? right - left : left - right;
};

export const sortChatsForMode = (chats, mode = 'customer_recent', direction = 'desc') => {
  const source = Array.isArray(chats) ? chats : [];
  if (mode === 'manual') return source;

  return source
    .map((chat, index) => ({ chat, index }))
    .sort((leftEntry, rightEntry) => {
      const left = leftEntry.chat;
      const right = rightEntry.chat;
      let compared = 0;

      if (mode === 'interaction') {
        // Maior tempo sem interacao = timestamp mais antigo primeiro.
        compared = comparePresentTimestamps(
          lastInteractionAt(left),
          lastInteractionAt(right),
          direction !== 'desc'
        );
      } else if (mode === 'agent_wait') {
        const leftPending = waitingForAgentSince(left);
        const rightPending = waitingForAgentSince(right);
        // Pendencias reais sempre ficam antes de conversas ja respondidas.
        compared = comparePresentTimestamps(
          leftPending,
          rightPending,
          direction !== 'desc'
        );
        if (compared === 0 && !leftPending && !rightPending) {
          compared = comparePresentTimestamps(lastInteractionAt(left), lastInteractionAt(right), true);
        }
      } else {
        // Mensagem recente do cliente = timestamp mais novo primeiro.
        compared = comparePresentTimestamps(
          lastCustomerMessageAt(left),
          lastCustomerMessageAt(right),
          direction === 'desc'
        );
      }

      return compared || leftEntry.index - rightEntry.index;
    })
    .map((entry) => entry.chat);
};
