const LEGACY_PLACEHOLDER = ['sandbox', 'agent'].join(' ');

/**
 * Nome de exibição é dado opcional do agente. Usuário, id e rótulos de teste
 * nunca podem virar nome por fallback, pois esse valor pode chegar ao cliente.
 */
export const normalizeAgentDisplayName = (value) => {
  if (value === undefined || value === null) return null;
  const name = String(value).replace(/\s+/g, ' ').trim();
  if (!name || name.toLowerCase() === LEGACY_PLACEHOLDER) return null;
  return name.slice(0, 80);
};

export const hasAgentDisplayName = (value) => normalizeAgentDisplayName(value) !== null;
