import adapter from '../../db/DatabaseAdapter.js';

const MAX_ACTIVE_MEMORIES = 50;
const MAX_MEMORY_CONTEXT_CHARS = 20000;

export const getActiveAiMemories = async (tenantId, agentId) => {
  if (!tenantId || !agentId) return [];
  const memories = await adapter.findDocuments('aiMemories', {
    tenantId,
    agentId,
    enabled: { $ne: false }
  });

  return (Array.isArray(memories) ? memories : [])
    .sort((a, b) => Number(a.order || 0) - Number(b.order || 0)
      || String(a.createdAt || '').localeCompare(String(b.createdAt || '')))
    .slice(0, MAX_ACTIVE_MEMORIES);
};

export const buildAiMemoryContext = (memories = []) => {
  let used = 0;
  const lines = [];
  for (const memory of memories) {
    const content = String(memory?.content || '').trim();
    if (!content) continue;
    const title = String(memory?.title || 'Instrucao').trim();
    const line = `${lines.length + 1}. ${title}: ${content}`;
    if (used + line.length > MAX_MEMORY_CONTEXT_CHARS) break;
    lines.push(line);
    used += line.length;
  }
  return lines.join('\n');
};
