const timestampOf = (value) => {
  const timestamp = new Date(value || 0).getTime();
  return Number.isFinite(timestamp) && timestamp > 0 ? timestamp : 0;
};

export const resolveGenesysConversationStartedAt = (chat) => {
  const candidates = [
    chat?.genesysStartedAt,
    chat?.startTime,
    chat?.startedAt,
    chat?.createdAt,
  ];
  for (const candidate of candidates) {
    const timestamp = timestampOf(candidate);
    if (timestamp) return timestamp;
  }
  return 0;
};
