import fs from 'fs/promises';
import path from 'path';
import { normalizeAgentDisplayName } from '../utils/agentName.js';

const DEFAULT_PATH = path.resolve(process.cwd(), 'data', 'onion-preferences.json');
export const localPreferencesPath = path.resolve(process.env.ONION_PREFERENCES_PATH || DEFAULT_PATH);
const APPEARANCE_FIELDS = new Set([
  'backgroundMode', 'backgroundColor', 'backgroundImage', 'backgroundDim',
  'customBubbles', 'agentBubbleColor', 'agentTextColor', 'customerBubbleColor',
  'customerTextColor', 'customerNameColor', 'bubbleBorderEnabled',
  'bubbleBorderColor', 'ambientGlowStrength', 'ambientGlowColor', 'themeAccentColor',
  'inactivityBarEnabled', 'inactivityLimitMinutes', 'inactivityGradientStartColor',
  'inactivityGradientEndColor'
]);
let writeQueue = Promise.resolve();

const safeKey = (tenantId, userId) => `${String(tenantId || 'local')}:${String(userId || '')}`;
const cleanAppearance = (value) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).filter(([key, fieldValue]) => (
    APPEARANCE_FIELDS.has(key)
    && ['string', 'number', 'boolean'].includes(typeof fieldValue)
    && String(fieldValue).length <= 1_500_000
  )));
};
const cleanSort = (value) => ({
  enabled: value?.enabled === true,
  mode: ['interaction_idle', 'agent_wait', 'customer_recent'].includes(value?.mode)
    ? value.mode
    : 'interaction_idle',
  direction: value?.direction === 'asc' ? 'asc' : 'desc'
});
const readDocument = async () => {
  try {
    const parsed = JSON.parse(await fs.readFile(localPreferencesPath, 'utf8'));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : { version: 1, agents: {} };
  } catch (error) {
    if (error?.code !== 'ENOENT') console.warn('[PREFERENCES] arquivo inválido; usando configuração vazia');
    return { version: 1, agents: {} };
  }
};

export const getLocalPreferences = async ({ tenantId, userId }) => {
  const document = await readDocument();
  const preferences = document.agents?.[safeKey(tenantId, userId)] || null;
  if (!preferences) return null;
  return {
    ...preferences,
    ...(Object.prototype.hasOwnProperty.call(preferences, 'name')
      ? { name: normalizeAgentDisplayName(preferences.name) }
      : {})
  };
};

export const saveLocalPreferences = ({ tenantId, userId, preferences = {} }) => {
  writeQueue = writeQueue.then(async () => {
    const document = await readDocument();
    const key = safeKey(tenantId, userId);
    const previous = document.agents?.[key] || {};
    const next = {
      ...previous,
      ...(preferences.name !== undefined ? { name: normalizeAgentDisplayName(preferences.name) } : {}),
      ...(preferences.theme !== undefined ? { theme: preferences.theme === 'dark' ? 'dark' : 'light' } : {}),
      ...(preferences.appearance !== undefined ? { appearance: cleanAppearance(preferences.appearance) } : {}),
      ...(preferences.sort !== undefined ? { sort: cleanSort(preferences.sort) } : {}),
      updatedAt: new Date().toISOString()
    };
    document.version = 1;
    document.agents = { ...(document.agents || {}), [key]: next };
    await fs.mkdir(path.dirname(localPreferencesPath), { recursive: true });
    await fs.writeFile(localPreferencesPath, `${JSON.stringify(document, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
    return next;
  });
  return writeQueue;
};
