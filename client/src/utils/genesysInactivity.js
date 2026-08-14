const timestampOf = (value) => {
  const timestamp = new Date(value || 0).getTime();
  return Number.isFinite(timestamp) && timestamp > 0 ? timestamp : 0;
};

const isHumanConversationSender = (sender) => (
  ['user', 'agent'].includes(String(sender || '').trim().toLowerCase())
);

export const resolveGenesysLastActivityAt = (chat) => {
  const reliableTimestamps = [
    timestampOf(chat?.lastCustomerMessageAt),
    timestampOf(chat?.lastAgentMessageAt),
  ].filter(Boolean);

  const messages = Array.isArray(chat?.messages) ? chat.messages : [];
  messages.forEach((message) => {
    if (!isHumanConversationSender(message?.sender)) return;
    const timestamp = timestampOf(message?.timestamp || message?.createdAt);
    if (timestamp) reliableTimestamps.push(timestamp);
  });

  if (isHumanConversationSender(chat?.lastMessage?.sender)) {
    const timestamp = timestampOf(chat?.lastMessage?.timestamp || chat?.lastMessage?.createdAt);
    if (timestamp) reliableTimestamps.push(timestamp);
  }

  if (reliableTimestamps.length) return Math.max(...reliableTimestamps);

  // Compatibilidade com cards antigos que ainda não possuem os resumos por remetente.
  // Se sabemos que a última entrada é técnica, é mais seguro não exibir o relógio.
  if (chat?.lastMessage?.sender && !isHumanConversationSender(chat.lastMessage.sender)) return 0;
  return timestampOf(chat?.lastMessageAt);
};

