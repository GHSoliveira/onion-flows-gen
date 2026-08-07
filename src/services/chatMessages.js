import adapter from '../../db/DatabaseAdapter.js';
import { generateId } from '../utils/helpers.js';

const COLLECTION = 'chatMessages';
const DEFAULT_MESSAGE_LIMIT = 500;
const MAX_MESSAGE_LIMIT = 2000;

const normalizeDateValue = (value) => {
  if (!value) return new Date().toISOString();
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
};

const normalizeLimit = (value, fallback = DEFAULT_MESSAGE_LIMIT) => {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(parsed, MAX_MESSAGE_LIMIT);
};

const isUserFacingMessage = (message) => String(message?.sender || '').toLowerCase() !== 'system';

const compactMessage = (message) => {
  if (!message || typeof message !== 'object') return null;
  return {
    id: message.id || message.messageId || null,
    messageId: message.messageId || message.id || null,
    sender: message.sender || null,
    text: message.text || '',
    media: message.media || null,
    buttons: message.buttons || null,
    meta: message.meta || null,
    timestamp: message.timestamp || message.createdAt || null,
    providerMessageId: message.providerMessageId || message.meta?.providerMessageId || null,
    deliveryStatus: message.deliveryStatus || message.meta?.deliveryStatus || null,
    deliveryStatusAt: message.deliveryStatusAt || message.meta?.deliveryStatusAt || null
  };
};

export const normalizeChatMessage = (chat, message = {}) => {
  const messageId = String(message.messageId || message.id || generateId('msg'));
  const timestamp = normalizeDateValue(message.timestamp || message.createdAt);
  const providerMessageId = message.providerMessageId || message.meta?.providerMessageId || null;
  const deliveryStatus = message.deliveryStatus || message.meta?.deliveryStatus || null;
  const deliveryStatusAt = message.deliveryStatusAt || message.meta?.deliveryStatusAt || null;

  return {
    id: `${chat.id}_${messageId}`,
    tenantId: chat.tenantId || null,
    chatId: chat.id,
    messageId,
    sender: message.sender || null,
    text: message.text || '',
    media: message.media || null,
    buttons: message.buttons || null,
    meta: message.meta || null,
    replyTo: message.replyTo || null,
    timestamp,
    providerMessageId,
    deliveryStatus,
    deliveryStatusAt,
    createdAt: message.createdAt || timestamp,
    updatedAt: new Date().toISOString()
  };
};

export const toLegacyChatMessage = (storedMessage) => {
  if (!storedMessage) return null;
  return {
    id: storedMessage.messageId || storedMessage.id,
    sender: storedMessage.sender || null,
    text: storedMessage.text || '',
    media: storedMessage.media || null,
    buttons: storedMessage.buttons || null,
    meta: storedMessage.meta || null,
    replyTo: storedMessage.replyTo || null,
    timestamp: storedMessage.timestamp || storedMessage.createdAt || null,
    providerMessageId: storedMessage.providerMessageId || null,
    deliveryStatus: storedMessage.deliveryStatus || null,
    deliveryStatusAt: storedMessage.deliveryStatusAt || null
  };
};

// Busca uma mensagem específica do chat pela id legacy (messageId). Usado para
// resolver a mensagem que está sendo respondida (reply/quote), já que o
// activeChats.messages embutido pode estar desatualizado — a fonte real é esta
// coleção.
export const getChatMessageById = async ({ chatId, tenantId = null, messageId }) => {
  if (!chatId || !messageId) return null;
  const query = { chatId, messageId: String(messageId) };
  if (tenantId) query.tenantId = tenantId;
  const row = await adapter.findOne(COLLECTION, query, { projection: { _id: 0 } });
  return row ? toLegacyChatMessage(row) : null;
};

// Busca uma mensagem do chat pelo providerMessageId (id no WhatsApp/Telegram).
// Usado para resolver reply inbound: o cliente cita uma mensagem usando o id
// do provedor, e precisamos achar a mensagem correspondente no nosso histórico.
export const getChatMessageByProviderId = async ({ chatId, tenantId = null, providerMessageId }) => {
  if (!chatId || !providerMessageId) return null;
  const pid = String(providerMessageId);
  const query = {
    chatId,
    $or: [
      { providerMessageId: pid },
      { 'meta.providerMessageId': pid }
    ]
  };
  if (tenantId) query.tenantId = tenantId;
  const row = await adapter.findOne(COLLECTION, query, { projection: { _id: 0 } });
  return row ? toLegacyChatMessage(row) : null;
};

// Envios recentes do app (agente) — evita eco Genesys copiar o texto p/ OUTRO chat
const RECENT_APP_AGENT_SENDS = [];
const RECENT_APP_AGENT_TTL_MS = 5 * 60 * 1000;
const RECENT_APP_AGENT_MAX = 80;

export const rememberAppAgentSend = ({ chatId, tenantId, text, messageId }) => {
  const textNorm = String(text || '').trim();
  if (!chatId || !textNorm) return;
  const now = Date.now();
  RECENT_APP_AGENT_SENDS.push({
    chatId: String(chatId),
    tenantId: tenantId || null,
    text: textNorm,
    messageId: messageId || null,
    ts: now
  });
  while (RECENT_APP_AGENT_SENDS.length > RECENT_APP_AGENT_MAX) RECENT_APP_AGENT_SENDS.shift();
  // purge velhos
  while (RECENT_APP_AGENT_SENDS.length && now - RECENT_APP_AGENT_SENDS[0].ts > RECENT_APP_AGENT_TTL_MS) {
    RECENT_APP_AGENT_SENDS.shift();
  }
};

const findRecentAppAgentSendElsewhere = ({ chatId, tenantId, text }) => {
  const textNorm = String(text || '').trim();
  if (!textNorm) return null;
  const now = Date.now();
  for (let i = RECENT_APP_AGENT_SENDS.length - 1; i >= 0; i -= 1) {
    const row = RECENT_APP_AGENT_SENDS[i];
    if (now - row.ts > RECENT_APP_AGENT_TTL_MS) continue;
    if (row.text !== textNorm) continue;
    if (tenantId && row.tenantId && row.tenantId !== tenantId) continue;
    if (String(row.chatId) === String(chatId)) continue; // mesmo chat = ok
    return row; // texto foi enviado pelo app em OUTRO chat
  }
  return null;
};

export const appendChatMessage = async (chatOrId, message = {}, options = {}) => {
  const chat = typeof chatOrId === 'string'
    ? await adapter.findOne('activeChats', { id: chatOrId }, { projection: { _id: 0 } })
    : chatOrId;

  if (!chat?.id) {
    throw new Error('Chat nao encontrado para adicionar mensagem');
  }

  const normalized = normalizeChatMessage(chat, message);
  const providerMessageId = normalized.providerMessageId
    || normalized.meta?.providerMessageId
    || null;
  const metaSource = String(normalized.meta?.source || message.meta?.source || '').toLowerCase();
  const senderKey = String(normalized.sender || '').toLowerCase();
  const hasMedia = Boolean(normalized.media || message.media || message.attachment);
  const chatGx = String(chat.genesysConvId || chat.externalConvId || '').trim();
  const metaGx = String(
    normalized.meta?.genesysConvId
    || message.meta?.genesysConvId
    || ''
  ).trim();

  // Isolamento: meta genesysConvId ≠ chat.genesysConvId → descarta
  if (chatGx && metaGx && chatGx !== metaGx) {
    console.warn('[chatMessages] drop conv mismatch', {
      chatId: chat.id,
      chatGx: chatGx.slice(0, 8),
      metaGx: metaGx.slice(0, 8)
    });
    return {
      chat,
      message: toLegacyChatMessage(normalized),
      inserted: false,
      skipped: true,
      reason: 'genesys_conv_mismatch'
    };
  }

  // Isolamento forte: msg de AGENTE vinda do Genesys (hydrate/notify/backfill)
  // NÃO pode copiar texto que já existe em OUTRO chat recente (app ou genesys).
  // Caso real: "Boa noite... Gustavo" mandado no card Renata e apareceu no Alex.
  if (
    senderKey === 'agent'
    && metaSource !== 'agent_app'
    && normalized.text
    && !hasMedia
  ) {
    const elsewhereMem = findRecentAppAgentSendElsewhere({
      chatId: chat.id,
      tenantId: normalized.tenantId,
      text: normalized.text
    });
    if (elsewhereMem) {
      console.warn('[chatMessages] drop cross-chat agent echo (mem)', {
        targetChatId: chat.id,
        originChatId: elsewhereMem.chatId,
        text: String(normalized.text).slice(0, 40)
      });
      return {
        chat,
        message: toLegacyChatMessage(normalized),
        inserted: false,
        skipped: true,
        reason: 'cross_chat_agent_echo'
      };
    }

    // DB: outro chat com o mesmo texto de agente nos últimos 5 min
    try {
      const textNorm = String(normalized.text).trim();
      const sinceIso = new Date(Date.now() - RECENT_APP_AGENT_TTL_MS).toISOString();
      const others = await adapter.findMany(COLLECTION, {
        query: {
          tenantId: normalized.tenantId,
          sender: 'agent',
          text: textNorm,
          chatId: { $ne: chat.id },
          timestamp: { $gte: sinceIso }
        },
        projection: { _id: 0, chatId: 1, messageId: 1, timestamp: 1 },
        sort: { timestamp: -1 },
        limit: 5
      });
      // fallback se o adapter não filtrar text exato bem: pega recentes do tenant e filtra
      let hit = Array.isArray(others) && others.length ? others[0] : null;
      if (!hit) {
        const recentAll = await adapter.findMany(COLLECTION, {
          query: {
            tenantId: normalized.tenantId,
            sender: 'agent',
            timestamp: { $gte: sinceIso }
          },
          projection: { _id: 0, chatId: 1, text: 1, messageId: 1 },
          sort: { timestamp: -1 },
          limit: 40
        });
        hit = (recentAll || []).find(
          (row) => String(row.chatId) !== String(chat.id)
            && String(row.text || '').trim() === textNorm
        ) || null;
      }
      if (hit) {
        console.warn('[chatMessages] drop cross-chat agent echo (db)', {
          targetChatId: chat.id,
          originChatId: hit.chatId,
          text: textNorm.slice(0, 40)
        });
        return {
          chat,
          message: toLegacyChatMessage(normalized),
          inserted: false,
          skipped: true,
          reason: 'cross_chat_agent_echo_db'
        };
      }
    } catch (err) {
      console.warn('[chatMessages] cross-chat check fail', err?.message || err);
    }
  }

  // providerId já existe em OUTRO chat → não clonar
  if (providerMessageId) {
    const other = await adapter.findOne(COLLECTION, {
      tenantId: normalized.tenantId,
      providerMessageId: String(providerMessageId),
      chatId: { $ne: chat.id }
    }, { projection: { _id: 0, chatId: 1, id: 1 } });
    if (other && other.chatId) {
      console.warn('[chatMessages] drop provider owned by other chat', {
        providerMessageId: String(providerMessageId).slice(0, 8),
        owner: other.chatId,
        target: chat.id
      });
      return {
        chat,
        message: toLegacyChatMessage(normalized),
        inserted: false,
        skipped: true,
        reason: 'provider_other_chat'
      };
    }
  }

  // 1) dedup por messageId
  let existingRow = await adapter.findOne(COLLECTION, {
    tenantId: normalized.tenantId,
    chatId: normalized.chatId,
    messageId: normalized.messageId
  }, { projection: { _id: 0 } });

  // 2) dedup por providerMessageId (Genesys UUID ecoado no hydrate)
  if (!existingRow && providerMessageId) {
    existingRow = await adapter.findOne(COLLECTION, {
      chatId: normalized.chatId,
      $or: [
        { providerMessageId: String(providerMessageId) },
        { 'meta.providerMessageId': String(providerMessageId) },
        { messageId: String(providerMessageId) },
        { messageId: `${String(chat.genesysConvId || '').slice(0, 36)}:${providerMessageId}` },
      ]
    }, { projection: { _id: 0 } });
  }

  // 3) eco Genesys da msg do agente já salva no app (ids diferentes, mesmo texto)
  //    Evita duplicata visual após F4 send + watch/hydrate — SÓ no mesmo chatId
  // Anexos consecutivos costumam compartilhar apenas um placeholder (por
  // exemplo, "[audio]"). Com IDs distintos, cada mídia é uma mensagem real e
  // nunca pode ser fundida por semelhança textual.
  if (!existingRow && normalized.text && !hasMedia) {
    if (senderKey === 'agent' || senderKey === 'bot' || senderKey === 'user') {
      const recent = await adapter.findMany(COLLECTION, {
        query: {
          chatId: normalized.chatId,
          ...(normalized.tenantId ? { tenantId: normalized.tenantId } : {})
        },
        projection: { _id: 0 },
        sort: { timestamp: -1, createdAt: -1 },
        limit: 25
      });
      const textNorm = String(normalized.text || '').trim();
      const ts = new Date(normalized.timestamp).getTime();
      for (const row of (recent || [])) {
        if (String(row.sender || '').toLowerCase() !== senderKey) continue;
        if (String(row.text || '').trim() !== textNorm) continue;
        const rowTs = new Date(row.timestamp || row.createdAt || 0).getTime();
        if (!Number.isFinite(rowTs) || !Number.isFinite(ts)) continue;
        if (Math.abs(rowTs - ts) <= 3 * 60 * 1000) {
          existingRow = row;
          break;
        }
      }
    }
  }

  const isNew = !existingRow;
  let deliveryConfirmed = false;
  if (isNew) {
    await adapter.insertOne(COLLECTION, normalized);
  } else if (providerMessageId) {
    const existingDeliveryStatus = String(
      existingRow.deliveryStatus || existingRow.meta?.deliveryStatus || ''
    ).trim().toLowerCase();
    const isGenesysAgentConfirmation = metaSource === 'genesys'
      && senderKey === 'agent'
      && existingDeliveryStatus === 'pending';
    const shouldAttachProvider = !existingRow.providerMessageId;

    // O eco autoritativo do Genesys confirma a mensagem mesmo se o ACK Socket
    // tiver se perdido ou chegado antes da resposta HTTP do painel.
    try {
      if (shouldAttachProvider || isGenesysAgentConfirmation) {
        const confirmedAt = new Date().toISOString();
        await adapter.updateOne(
          COLLECTION,
          { id: existingRow.id },
          {
            $set: {
              ...(shouldAttachProvider ? {
                providerMessageId: String(providerMessageId),
                'meta.providerMessageId': String(providerMessageId),
                'meta.genesysMessageId': String(providerMessageId),
              } : {}),
              ...(isGenesysAgentConfirmation ? {
                deliveryStatus: 'sent',
                deliveryStatusAt: confirmedAt,
                'meta.deliveryStatus': 'sent',
                'meta.deliveryStatusAt': confirmedAt,
              } : {}),
              updatedAt: confirmedAt
            }
          }
        );
        existingRow = {
          ...existingRow,
          ...(shouldAttachProvider ? { providerMessageId: String(providerMessageId) } : {}),
          ...(isGenesysAgentConfirmation ? {
            deliveryStatus: 'sent',
            deliveryStatusAt: confirmedAt,
          } : {}),
          meta: {
            ...(existingRow.meta || {}),
            ...(shouldAttachProvider ? {
              providerMessageId: String(providerMessageId),
              genesysMessageId: String(providerMessageId)
            } : {}),
            ...(isGenesysAgentConfirmation ? {
              deliveryStatus: 'sent',
              deliveryStatusAt: confirmedAt,
            } : {})
          }
        };
        deliveryConfirmed = isGenesysAgentConfirmation;
      }
    } catch (_) {}
  }

  const storedLegacy = toLegacyChatMessage(isNew ? normalized : {
    ...existingRow,
    providerMessageId: existingRow.providerMessageId || providerMessageId || null
  });

  const now = new Date().toISOString();
  const legacyCount = Array.isArray(chat.messages) ? chat.messages.length : 0;
  const currentCount = Number(chat.messageCount || 0) || legacyCount;
  const summarySet = {
    updatedAt: now,
    messageCount: currentCount + (isNew ? 1 : 0)
  };

  // lastMessage do CARD = preview da mensagem MAIS RECENTE.
  // Regras:
  // 1) Só avança em mensagem NOVA (isNew). Dedup/reprocess NUNCA mexe no preview
  //    (DOM com ts=Date.now() reenviava "Olá" e voltava o card pra 1ª msg).
  // 2) Só avança se o timestamp for >= lastMessageAt (backfill fora de ordem).
  const incomingTs = new Date(normalized.timestamp || 0).getTime();
  const currentLastTs = new Date(
    chat.lastMessageAt
    || chat.lastMessage?.timestamp
    || chat.lastMessage?.createdAt
    || 0
  ).getTime();
  const hasIncomingTs = Number.isFinite(incomingTs) && incomingTs > 0;
  const hasCurrentLastTs = Number.isFinite(currentLastTs) && currentLastTs > 0;
  const isNewerOrEqual = !hasCurrentLastTs
    || (hasIncomingTs && incomingTs >= currentLastTs);

  if (isNew && isUserFacingMessage(normalized) && isNewerOrEqual) {
    summarySet.lastMessage = compactMessage(storedLegacy);
    summarySet.lastMessageAt = normalized.timestamp || chat.lastMessageAt || now;
  } else if (isNew && hasIncomingTs && (!hasCurrentLastTs || incomingTs > currentLastTs)) {
    // msg nova system: avança só o relógio se for mais nova
    summarySet.lastMessageAt = normalized.timestamp;
  }
  // isNew=false → não toca lastMessage/lastMessageAt

  if (isNew && hasIncomingTs) {
    const normalizedSender = String(normalized.sender || '').trim().toLowerCase();
    const customerTimestamp = new Date(chat.lastCustomerMessageAt || 0).getTime();
    const agentTimestamp = new Date(chat.lastAgentMessageAt || 0).getTime();
    if (normalizedSender === 'user' && (!Number.isFinite(customerTimestamp) || incomingTs >= customerTimestamp)) {
      summarySet.lastCustomerMessageAt = normalized.timestamp;
    }
    if (normalizedSender === 'agent' && (!Number.isFinite(agentTimestamp) || incomingTs >= agentTimestamp)) {
      summarySet.lastAgentMessageAt = normalized.timestamp;
    }
  }

  const shouldIncrementUnread = isNew
    && String(normalized.sender || '').toLowerCase() === 'user'
    && options.incrementUnread !== false;

  await adapter.updateOne(
    'activeChats',
    { id: chat.id },
    {
      $set: summarySet,
      ...(shouldIncrementUnread ? { $inc: { unreadByAgentCount: 1 } } : {})
    }
  );

  return {
    chat: {
      ...chat,
      ...summarySet,
      unreadByAgentCount: Number(chat.unreadByAgentCount || 0) + (shouldIncrementUnread ? 1 : 0)
    },
    message: storedLegacy,
    inserted: isNew,
    deliveryConfirmed
  };
};

/**
 * Recalcula lastMessage / lastMessageAt / messageCount a partir do chatMessages.
 * Útil após backfill e para reparar cards com preview na 1ª msg.
 */
export const refreshChatMessageSummary = async (chatOrId) => {
  const chatId = typeof chatOrId === 'string' ? chatOrId : chatOrId?.id;
  if (!chatId) return null;

  const chat = typeof chatOrId === 'object' && chatOrId?.id
    ? chatOrId
    : await adapter.findOne('activeChats', { id: chatId }, { projection: { _id: 0 } });
  if (!chat?.id) return null;

  const rows = await adapter.findMany(COLLECTION, {
    query: { chatId: chat.id, ...(chat.tenantId ? { tenantId: chat.tenantId } : {}) },
    projection: { _id: 0 },
    sort: { timestamp: -1, createdAt: -1 },
    limit: 50
  });
  const list = Array.isArray(rows) ? rows : [];
  const lastFacing = list.find((row) => isUserFacingMessage(row)) || list[0] || null;
  const lastCustomer = list.find((row) => String(row?.sender || '').toLowerCase() === 'user') || null;
  const lastAgent = list.find((row) => String(row?.sender || '').toLowerCase() === 'agent') || null;
  const countRows = await adapter.findMany(COLLECTION, {
    query: { chatId: chat.id, ...(chat.tenantId ? { tenantId: chat.tenantId } : {}) },
    projection: { _id: 0, id: 1 },
    limit: MAX_MESSAGE_LIMIT
  });
  const messageCount = Array.isArray(countRows) ? countRows.length : Number(chat.messageCount || 0);
  const summarySet = {
    messageCount,
    updatedAt: new Date().toISOString(),
    lastMessage: lastFacing ? compactMessage(toLegacyChatMessage(lastFacing)) : null,
    lastMessageAt: lastFacing
      ? (lastFacing.timestamp || lastFacing.createdAt || chat.lastMessageAt || null)
      : (chat.lastMessageAt || null),
    lastCustomerMessageAt: lastCustomer
      ? (lastCustomer.timestamp || lastCustomer.createdAt || chat.lastCustomerMessageAt || null)
      : (chat.lastCustomerMessageAt || null),
    lastAgentMessageAt: lastAgent
      ? (lastAgent.timestamp || lastAgent.createdAt || chat.lastAgentMessageAt || null)
      : (chat.lastAgentMessageAt || null)
  };
  await adapter.updateOne('activeChats', { id: chat.id }, { $set: summarySet });
  return { ...chat, ...summarySet };
};

export const getChatMessages = async (chatId, options = {}) => {
  if (!chatId) return [];
  const limit = normalizeLimit(options.limit);
  const query = { chatId };
  if (options.tenantId) query.tenantId = options.tenantId;
  if (options.before || options.after) {
    query.timestamp = {};
    if (options.before) query.timestamp.$lt = normalizeDateValue(options.before);
    if (options.after) query.timestamp.$gt = normalizeDateValue(options.after);
  }

  const sortDirection = options.sort === 'desc' ? -1 : 1;
  const rows = await adapter.findMany(COLLECTION, {
    query,
    projection: { _id: 0 },
    sort: { timestamp: sortDirection, createdAt: sortDirection },
    limit
  });

  const messages = (Array.isArray(rows) ? rows : []).map(toLegacyChatMessage).filter(Boolean);
  return options.sort === 'desc' ? messages.reverse() : messages;
};

export const getLastChatMessage = async (chatId, options = {}) => {
  if (!chatId) return null;
  const rows = await adapter.findMany(COLLECTION, {
    query: {
      chatId,
      ...(options.tenantId ? { tenantId: options.tenantId } : {})
    },
    projection: { _id: 0 },
    sort: { timestamp: -1, createdAt: -1 },
    limit: 1
  });
  return rows?.[0] ? toLegacyChatMessage(rows[0]) : null;
};

export const hydrateChatWithMessages = async (chat, options = {}) => {
  if (!chat?.id) return chat;
  const storedMessages = await getChatMessages(chat.id, {
    tenantId: chat.tenantId,
    limit: options.limit,
    before: options.before,
    after: options.after
  });

  const legacyMessages = Array.isArray(chat.messages) ? chat.messages : [];
  const byId = new Map();
  [...legacyMessages, ...storedMessages].forEach((message) => {
    const key = String(message?.id || message?.messageId || `${message?.sender || ''}_${message?.timestamp || ''}_${message?.text || ''}`);
    if (key) byId.set(key, message);
  });
  const merged = [...byId.values()]
    .sort((a, b) => new Date(a?.timestamp || a?.createdAt || 0) - new Date(b?.timestamp || b?.createdAt || 0));
  return {
    ...chat,
    messages: merged.slice(-normalizeLimit(options.limit, merged.length || DEFAULT_MESSAGE_LIMIT))
  };
};

export const hydrateChatsWithMessages = async (chats = [], options = {}) => (
  Promise.all((Array.isArray(chats) ? chats : []).map((chat) => hydrateChatWithMessages(chat, options)))
);

export const updateChatMessageDeliveryStatusByProvider = async ({
  providerMessageId,
  status,
  deliveryStatusAt,
  errors = null
}) => {
  if (!providerMessageId || !status) return null;
  const message = await adapter.findOne(COLLECTION, {
    $or: [
      { providerMessageId: String(providerMessageId) },
      { 'meta.providerMessageId': String(providerMessageId) }
    ]
  }, { projection: { _id: 0 } });

  if (!message?.id) return null;

  const nextMeta = {
    ...(message.meta || {}),
    providerMessageId,
    deliveryStatus: status,
    deliveryStatusAt,
    deliveryErrors: status === 'failed' ? (errors || null) : null
  };
  const nextMessage = {
    ...message,
    providerMessageId,
    deliveryStatus: status,
    deliveryStatusAt,
    meta: nextMeta,
    updatedAt: new Date().toISOString()
  };

  await adapter.updateOne(COLLECTION, { id: message.id }, { $set: nextMessage });

  const chat = await adapter.findOne('activeChats', { id: message.chatId }, {
    projection: { _id: 0, id: 1, tenantId: 1, lastMessage: 1 }
  });
  if (chat?.lastMessage && String(chat.lastMessage.providerMessageId || chat.lastMessage.meta?.providerMessageId || '') === String(providerMessageId)) {
    await adapter.updateOne('activeChats', { id: chat.id }, {
      $set: {
        lastMessage: compactMessage(toLegacyChatMessage(nextMessage)),
        updatedAt: new Date().toISOString()
      }
    });
  }

  return {
    chatId: message.chatId,
    message: toLegacyChatMessage(nextMessage)
  };
};

export const deleteChatMessagesByChatIds = async ({ tenantId, chatIds = [] }) => {
  const ids = (Array.isArray(chatIds) ? chatIds : []).filter(Boolean);
  if (!ids.length) return 0;
  const result = await adapter.deleteMany(COLLECTION, {
    ...(tenantId ? { tenantId } : {}),
    chatId: { $in: ids }
  });
  return result?.deletedCount || 0;
};
