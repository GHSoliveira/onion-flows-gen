import adapter from '../../db/DatabaseAdapter.js';
import { invalidateRuntimeFlowCache } from './flowRuntimeCache.js';
import { encryptString, tryDecrypt } from '../utils/crypto.js';

// Fields persisted in ciphertext when DATA_ENCRYPTION_KEYS is configured.
// Reads decrypt transparently; writes encrypt idempotently.
const TELEGRAM_SECRET_FIELDS = ['botToken', 'webhookSecret'];
const WHATSAPP_SECRET_FIELDS = ['accessToken', 'webhookVerifyToken', 'appSecret'];

const decryptInPlace = (target, fields) => {
  if (!target) return target;
  for (const key of fields) {
    if (target[key]) target[key] = tryDecrypt(target[key]);
  }
  return target;
};

const encryptForStorage = (target, fields) => {
  if (!target) return target;
  for (const key of fields) {
    if (target[key]) target[key] = encryptString(target[key]);
  }
  return target;
};

const CACHE_TTL_MS = (() => {
  const parsed = Number.parseInt(String(process.env.CHANNEL_CONFIG_CACHE_TTL_MS || '').trim(), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 60000;
})();
let cacheByTenant = new Map();
let cacheAll = null;
let cacheAllAt = 0;

const isFresh = (timestamp) => timestamp && Date.now() - timestamp < CACHE_TTL_MS;

const setCacheEntry = (tenantId, config) => {
  if (!tenantId) return;
  cacheByTenant.set(tenantId, { value: config, at: Date.now() });
  cacheAll = null;
  cacheAllAt = 0;
};

const normalize = (value) => {
  if (value === undefined || value === null) return null;
  const trimmed = String(value).trim();
  return trimmed.length ? trimmed : null;
};

const resolveSecretValue = (incoming, existing) => {
  const normalized = normalize(incoming);
  if (!normalized || normalized === '***') return normalize(existing);
  return normalized;
};

const getRecordRecency = (record) => {
  const updatedAt = Date.parse(record?.updatedAt || record?.whatsapp?.updatedAt || record?.telegram?.updatedAt || '');
  if (Number.isFinite(updatedAt)) return updatedAt;
  const createdAt = Date.parse(record?.createdAt || '');
  return Number.isFinite(createdAt) ? createdAt : 0;
};

const dedupeChannelConfigs = (records = []) => {
  const selected = new Map();

  (Array.isArray(records) ? records : []).forEach((record) => {
    const tenantId = normalize(record?.tenantId);
    if (!tenantId) return;

    const current = selected.get(tenantId);
    if (!current || getRecordRecency(record) >= getRecordRecency(current)) {
      selected.set(tenantId, record);
    }
  });

  return Array.from(selected.values());
};

const normalizeSenderNumbers = (whatsappConfig = {}) => {
  const legacyPhoneNumberId = normalize(whatsappConfig.phoneNumberId);
  const rawSenders = Array.isArray(whatsappConfig.senderNumbers) ? whatsappConfig.senderNumbers : [];

  const deduped = [];
  const seen = new Set();

  rawSenders.forEach((item, index) => {
    const phoneNumberId = normalize(item?.phoneNumberId);
    if (!phoneNumberId || seen.has(phoneNumberId)) return;
    seen.add(phoneNumberId);
    deduped.push({
      id: normalize(item?.id) || `wa_sender_${phoneNumberId}`,
      label: normalize(item?.label) || (index === 0 ? 'Principal' : `Numero ${index + 1}`),
      displayNumber: normalize(item?.displayNumber),
      phoneNumberId,
      flowId: normalize(item?.flowId),
      enabled: item?.enabled !== false,
      isDefault: Boolean(item?.isDefault)
    });
  });

  if (legacyPhoneNumberId && !seen.has(legacyPhoneNumberId)) {
    deduped.unshift({
      id: `wa_sender_${legacyPhoneNumberId}`,
      label: 'Principal',
      displayNumber: null,
      phoneNumberId: legacyPhoneNumberId,
      flowId: normalize(whatsappConfig.flowId),
      enabled: true,
      isDefault: true
    });
  }

  if (!deduped.length && legacyPhoneNumberId) {
    deduped.push({
      id: `wa_sender_${legacyPhoneNumberId}`,
      label: 'Principal',
      displayNumber: null,
      phoneNumberId: legacyPhoneNumberId,
      flowId: normalize(whatsappConfig.flowId),
      enabled: true,
      isDefault: true
    });
  }

  if (deduped.length > 0) {
    const preferred = deduped.find((item) => item.isDefault && item.enabled !== false)
      || deduped.find((item) => item.enabled !== false)
      || deduped[0];
    deduped.forEach((item) => {
      item.isDefault = item.phoneNumberId === preferred.phoneNumberId;
    });
  }

  return deduped;
};

const normalizeTelegramPayload = (telegram) => {
  const out = {
    ...telegram,
    botToken: normalize(telegram?.botToken),
    flowId: normalize(telegram?.flowId),
    webhookUrl: normalize(telegram?.webhookUrl),
    webhookSecret: normalize(telegram?.webhookSecret),
    usePolling: telegram?.usePolling !== false
  };
  return decryptInPlace(out, TELEGRAM_SECRET_FIELDS);
};

const normalizeWhatsAppPayload = (whatsapp) => {
  const senderNumbers = normalizeSenderNumbers(whatsapp);
  const defaultSender = senderNumbers.find((item) => item.isDefault) || senderNumbers[0] || null;

  const out = {
    ...whatsapp,
    accessToken: normalize(whatsapp?.accessToken),
    phoneNumberId: defaultSender?.phoneNumberId || normalize(whatsapp?.phoneNumberId),
    senderNumbers,
    wabaId: normalize(whatsapp?.wabaId),
    flowId: normalize(whatsapp?.flowId),
    webhookVerifyToken: normalize(whatsapp?.webhookVerifyToken),
    appSecret: normalize(whatsapp?.appSecret),
    enabled: Boolean(whatsapp?.enabled),
    updatedAt: whatsapp?.updatedAt
  };
  return decryptInPlace(out, WHATSAPP_SECRET_FIELDS);
};

const normalizeChannelConfigRecord = (record) => {
  if (!record) return null;
  return {
    ...record,
    telegram: record.telegram ? normalizeTelegramPayload(record.telegram) : null,
    whatsapp: record.whatsapp ? normalizeWhatsAppPayload(record.whatsapp) : null
  };
};

const hasValidWhatsAppSender = (whatsapp) => {
  const senders = Array.isArray(whatsapp?.senderNumbers) ? whatsapp.senderNumbers : [];
  return Boolean(
    whatsapp?.accessToken &&
    (whatsapp?.phoneNumberId || senders.some((item) => item?.enabled !== false && item?.phoneNumberId))
  );
};

export const resolveWhatsAppSender = (config, requestedPhoneNumberId = null) => {
  if (!config) return null;

  const normalized = normalizeWhatsAppPayload(config);
  const senders = Array.isArray(normalized.senderNumbers) ? normalized.senderNumbers : [];
  const enabledSenders = senders.filter((item) => item.enabled !== false && item.phoneNumberId);
  const requested = normalize(requestedPhoneNumberId);

  if (requested) {
    const exact = enabledSenders.find((item) => item.phoneNumberId === requested);
    if (exact) return exact;
    return null;
  }

  return enabledSenders.find((item) => item.isDefault)
    || enabledSenders[0]
    || (normalized.phoneNumberId
      ? {
        id: `wa_sender_${normalized.phoneNumberId}`,
        label: 'Principal',
        displayNumber: null,
        phoneNumberId: normalized.phoneNumberId,
        flowId: normalize(normalized.flowId),
        enabled: true,
        isDefault: true
      }
      : null);
};

export const resolveWhatsAppFlowId = (config, requestedPhoneNumberId = null) => {
  if (!config) return null;
  const sender = resolveWhatsAppSender(config, requestedPhoneNumberId);
  return normalize(sender?.flowId) || normalize(config?.flowId) || null;
};

export const getChannelConfig = async (tenantId) => {
  if (!tenantId) return null;
  const cached = cacheByTenant.get(tenantId);
  if (cached && isFresh(cached.at)) return cached.value || null;

  const all = await adapter.findMany('channelConfigs', {
    query: { tenantId },
    sort: { updatedAt: -1, createdAt: -1 },
    limit: 5
  });
  const raw = dedupeChannelConfigs(all).find((c) => c.tenantId === tenantId) || null;
  const config = normalizeChannelConfigRecord(raw);
  setCacheEntry(tenantId, config);
  return config;
};

export const getTelegramConfig = async (tenantId) => {
  const config = await getChannelConfig(tenantId);
  if (!config || !config.telegram) return null;
  return config.telegram;
};

export const getWhatsAppConfig = async (tenantId) => {
  const config = await getChannelConfig(tenantId);
  if (!config || !config.whatsapp) return null;
  return config.whatsapp;
};

const buildAllChannelsCache = async () => {
  const all = dedupeChannelConfigs(await adapter.getCollection('channelConfigs'));
  const telegram = [];
  const whatsapp = [];

  all.forEach((config) => {
    const telegramConfig = config.telegram ? normalizeTelegramPayload(config.telegram) : null;
    const whatsappConfig = config.whatsapp ? normalizeWhatsAppPayload(config.whatsapp) : null;

    if (telegramConfig?.botToken && telegramConfig.enabled) {
      telegram.push({
        tenantId: config.tenantId,
        telegram: telegramConfig
      });
    }

    if (whatsappConfig?.enabled && hasValidWhatsAppSender(whatsappConfig)) {
      whatsapp.push({
        tenantId: config.tenantId,
        whatsapp: whatsappConfig
      });
    }
  });

  cacheAll = { telegram, whatsapp };
  cacheAllAt = Date.now();
  return cacheAll;
};

export const getAllTelegramConfigs = async () => {
  if (cacheAll && isFresh(cacheAllAt)) {
    return cacheAll.telegram;
  }
  const all = await buildAllChannelsCache();
  return all.telegram;
};

export const getAllWhatsAppConfigs = async () => {
  if (cacheAll && isFresh(cacheAllAt)) {
    return cacheAll.whatsapp;
  }
  const all = await buildAllChannelsCache();
  return all.whatsapp;
};

export const findWhatsAppConfigByPhoneNumberId = async (phoneNumberId) => {
  const normalizedId = normalize(phoneNumberId);
  if (!normalizedId) return null;

  const configs = await getAllWhatsAppConfigs();
  for (const entry of configs) {
    const sender = resolveWhatsAppSender(entry.whatsapp, normalizedId);
    if (sender) {
      return {
        tenantId: entry.tenantId,
        whatsapp: entry.whatsapp,
        sender
      };
    }
  }
  return null;
};

export const saveTelegramConfig = async (tenantId, telegramConfig) => {
  const all = await adapter.getCollection('channelConfigs');
  const now = new Date().toISOString();
  const index = all.findIndex((config) => config.tenantId === tenantId);
  const existingTelegram = index >= 0 ? (all[index].telegram || {}) : {};
  const payload = {
    enabled: Boolean(telegramConfig.enabled),
    botToken: resolveSecretValue(telegramConfig.botToken, existingTelegram.botToken),
    flowId: normalize(telegramConfig.flowId),
    webhookUrl: normalize(telegramConfig.webhookUrl),
    webhookSecret: resolveSecretValue(telegramConfig.webhookSecret, existingTelegram.webhookSecret),
    usePolling: telegramConfig.usePolling !== false,
    updatedAt: now
  };
  encryptForStorage(payload, TELEGRAM_SECRET_FIELDS);

  if (index === -1) {
    all.push({
      id: `channels_${tenantId}`,
      tenantId,
      telegram: payload,
      createdAt: now,
      updatedAt: now
    });
  } else {
    all[index] = {
      ...all[index],
      tenantId,
      telegram: {
        ...all[index].telegram,
        ...payload
      },
      updatedAt: now
    };
  }

  await adapter.saveCollection('channelConfigs', all);
  setCacheEntry(tenantId, normalizeChannelConfigRecord(all.find((config) => config.tenantId === tenantId) || null));
  invalidateRuntimeFlowCache(tenantId);
  return payload;
};

export const saveWhatsAppConfig = async (tenantId, whatsappConfig) => {
  const all = await adapter.getCollection('channelConfigs');
  const now = new Date().toISOString();
  const index = all.findIndex((config) => config.tenantId === tenantId);
  const existingWhatsapp = index >= 0 ? (all[index].whatsapp || {}) : {};
  const normalizedIncoming = normalizeWhatsAppPayload(whatsappConfig);
  const existingSenders = normalizeSenderNumbers(existingWhatsapp);
  const findExistingSender = (sender) => existingSenders.find((item) => (
    (sender.id && item.id === sender.id) || (sender.phoneNumberId && item.phoneNumberId === sender.phoneNumberId)
  ));
  const senderNumbers = normalizedIncoming.senderNumbers.map((sender) => {
    const existingSender = findExistingSender(sender);
    return {
      ...sender,
      flowId: normalize(sender.flowId) || normalize(existingSender?.flowId)
    };
  });
  const payload = {
    enabled: Boolean(whatsappConfig.enabled),
    accessToken: resolveSecretValue(whatsappConfig.accessToken, existingWhatsapp.accessToken),
    phoneNumberId: normalizedIncoming.phoneNumberId,
    senderNumbers,
    wabaId: normalize(whatsappConfig.wabaId),
    flowId: normalize(whatsappConfig.flowId),
    webhookVerifyToken: resolveSecretValue(whatsappConfig.webhookVerifyToken, existingWhatsapp.webhookVerifyToken),
    appSecret: resolveSecretValue(whatsappConfig.appSecret, existingWhatsapp.appSecret),
    updatedAt: now
  };
  encryptForStorage(payload, WHATSAPP_SECRET_FIELDS);

  if (index === -1) {
    all.push({
      id: `channels_${tenantId}`,
      tenantId,
      telegram: null,
      whatsapp: payload,
      createdAt: now,
      updatedAt: now
    });
  } else {
    all[index] = {
      ...all[index],
      tenantId,
      whatsapp: {
        ...all[index].whatsapp,
        ...payload
      },
      updatedAt: now
    };
  }

  await adapter.saveCollection('channelConfigs', all);
  setCacheEntry(tenantId, normalizeChannelConfigRecord(all.find((config) => config.tenantId === tenantId) || null));
  invalidateRuntimeFlowCache(tenantId);
  return payload;
};

export const updateChannelFlowRoute = async (tenantId, route = {}) => {
  const channel = normalize(route.channel);
  const flowId = normalize(route.flowId);
  const senderId = normalize(route.senderId);
  const senderPhoneNumberId = normalize(route.senderPhoneNumberId || route.phoneNumberId);

  if (!tenantId) {
    throw new Error('tenantId obrigatorio');
  }
  if (!['telegram', 'whatsapp'].includes(channel)) {
    const error = new Error('Canal invalido');
    error.status = 400;
    throw error;
  }

  const all = await adapter.getCollection('channelConfigs');
  const now = new Date().toISOString();
  let index = all.findIndex((config) => config.tenantId === tenantId);
  if (index === -1) {
    all.push({
      id: `channels_${tenantId}`,
      tenantId,
      telegram: null,
      whatsapp: null,
      createdAt: now,
      updatedAt: now
    });
    index = all.length - 1;
  }

  const current = all[index];
  if (channel === 'telegram') {
    current.telegram = {
      ...(current.telegram || {}),
      flowId,
      updatedAt: now
    };
  } else {
    const currentWhatsapp = current.whatsapp || {};
    const senderNumbers = normalizeSenderNumbers(currentWhatsapp);

    if (senderId || senderPhoneNumberId) {
      const nextSenders = senderNumbers.map((sender) => {
        const matches = (senderId && sender.id === senderId)
          || (senderPhoneNumberId && sender.phoneNumberId === senderPhoneNumberId);
        return matches ? { ...sender, flowId } : sender;
      });

      if (!nextSenders.some((sender) => (
        (senderId && sender.id === senderId) || (senderPhoneNumberId && sender.phoneNumberId === senderPhoneNumberId)
      ))) {
        const error = new Error('Numero remetente nao encontrado');
        error.status = 404;
        throw error;
      }

      current.whatsapp = {
        ...currentWhatsapp,
        senderNumbers: nextSenders,
        updatedAt: now
      };
    } else {
      current.whatsapp = {
        ...currentWhatsapp,
        flowId,
        updatedAt: now
      };
    }
  }

  current.updatedAt = now;
  all[index] = current;

  await adapter.saveCollection('channelConfigs', all);
  const normalized = normalizeChannelConfigRecord(current);
  setCacheEntry(tenantId, normalized);
  invalidateRuntimeFlowCache(tenantId);
  return normalized;
};
