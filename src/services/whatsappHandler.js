import adapter from '../../db/DatabaseAdapter.js';
import { addUserMedia, addUserMessage, applyUserInput, getChatById, runFlow, startChatFlow, tryHandleGlobalCommand, updateChatMessageDeliveryStatusByProviderMessageId } from './flowRunner.js';
import { findWhatsAppConfigByPhoneNumberId, getWhatsAppConfig, resolveWhatsAppFlowId, resolveWhatsAppSender } from './channelConfig.js';
import { downloadWhatsAppMedia, getWhatsAppMediaMetadata, sendWhatsAppMedia, sendWhatsAppText } from './whatsappApi.js';
import { createLog } from './logs.js';
import { ensureTenantLimit } from './tenantLimits.js';
import { normalizeWhatsappNumber } from './activeOutreach.js';
import { updateOutreachStatusByProviderMessageId } from './outreachHistory.js';
import { storeTenantMediaBuffer } from './mediaStorage.js';
import { withChannelUserLock, withChatLock } from './chatLocks.js';
import { sanitizeChatState } from './chatStateGuard.js';
import { getCachedRuntimeFlow, getCachedRuntimeSchedules, getCachedRuntimeTemplates } from './flowRuntimeCache.js';
import { notifyWhatsAppProblem } from './whatsappAlerts.js';
import { generateId } from '../utils/helpers.js';
import { CHAT_EVENT_TYPES, emitChatEvent } from './chatEvents.js';
import { upsertContactFromChannel } from './contactIdentity.js';
import { getChatMessageByProviderId } from './chatMessages.js';

// Resolve o objeto replyTo quando o cliente cita uma mensagem (reply nativo).
// Busca a mensagem original pelo providerMessageId citado e monta o preview.
const resolveInboundReplyTo = async (chat, replyToProviderId) => {
  if (!replyToProviderId) return null;
  try {
    const original = await getChatMessageByProviderId({
      chatId: chat.id,
      tenantId: chat.tenantId || null,
      providerMessageId: replyToProviderId
    });
    if (!original) return null;
    const rawText = String(original.text || (original.media ? `[${original.media.type || 'mídia'}]` : '') || '').trim();
    const preview = rawText.length > 120 ? `${rawText.slice(0, 117)}…` : rawText;
    return {
      messageId: original.id,
      sender: original.sender || null,
      preview: preview || null,
      hasMedia: Boolean(original.media)
    };
  } catch (_) {
    return null;
  }
};

const normalizeEnvValue = (value) => {
  if (!value) return null;
  const trimmed = String(value).trim();
  return trimmed.length ? trimmed : null;
};

const ensureFlow = async (tenantId, flowId) => getCachedRuntimeFlow({
  tenantId,
  flowId,
  loader: async () => {
    const flows = await adapter.getCollection('flows', tenantId);
    if (!flows || flows.length === 0) return null;
    let flow = null;
    if (flowId) {
      flow = flows.find((f) => f.id === flowId) || null;
    }
    if (!flow) {
      flow = flows.find((f) => f.published && f.published.nodes && f.published.nodes.length > 0) || flows[0];
    }
    return flow ? (flow.published || flow) : null;
  }
});

const ensureTemplates = async (tenantId) => getCachedRuntimeTemplates({
  tenantId,
  loader: async () => {
    const scoped = await adapter.getCollection('templates', tenantId);
    if (scoped && scoped.length) return scoped;
    const scopedAlt = await adapter.getCollection('messageTemplates', tenantId);
    if (scopedAlt && scopedAlt.length) return scopedAlt;
    const all = await adapter.getCollection('templates');
    if (all && all.length) return all;
    return adapter.getCollection('messageTemplates');
  }
});

const ensureSchedules = async (tenantId) => getCachedRuntimeSchedules({
  tenantId,
  loader: async () => {
    const scoped = await adapter.getCollection('schedules', tenantId);
    if (scoped && scoped.length) return scoped;
    return adapter.getCollection('schedules');
  }
});

const parseWebhookMessages = (payload) => {
  const results = [];
  const supportedMediaTypes = new Set(['image', 'video', 'audio', 'document']);
  const entries = Array.isArray(payload?.entry) ? payload.entry : [];
  entries.forEach((entry) => {
    const changes = Array.isArray(entry.changes) ? entry.changes : [];
    changes.forEach((change) => {
      const value = change?.value || {};
      const phoneNumberId = value?.metadata?.phone_number_id || null;
      // Indexa profile name por wa_id para anexar a cada mensagem do contato.
      const profileByWaId = new Map();
      const contacts = Array.isArray(value.contacts) ? value.contacts : [];
      contacts.forEach((entry) => {
        const waId = String(entry?.wa_id || '').replace(/\D/g, '');
        const name = String(entry?.profile?.name || '').trim();
        if (waId && name) profileByWaId.set(waId, name);
      });
      const messages = Array.isArray(value.messages) ? value.messages : [];
      messages.forEach((msg) => {
        const type = String(msg?.type || '').toLowerCase();
        // context.id = id da mensagem citada quando o cliente responde (reply nativo).
        const replyToProviderId = msg?.context?.id ? String(msg.context.id) : null;
        if (type === 'text') {
          const text = msg?.text?.body || '';
          if (!text) return;
          results.push({
            messageId: msg.id,
            kind: 'text',
            from: String(msg.from || ''),
            profileName: profileByWaId.get(String(msg.from || '').replace(/\D/g, '')) || null,
            replyToProviderId,
            text,
            timestamp: msg.timestamp || null,
            phoneNumberId
          });
          return;
        }

        if (type === 'button') {
          const payload = String(msg?.button?.payload || '').trim();
          const buttonText = String(msg?.button?.text || '').trim();
          const text = buttonText || payload;
          if (!text && !payload) return;
          results.push({
            messageId: msg.id,
            kind: 'button',
            from: String(msg.from || ''),
            profileName: profileByWaId.get(String(msg.from || '').replace(/\D/g, '')) || null,
            replyToProviderId,
            text,
            payload: payload || null,
            buttonText: buttonText || null,
            timestamp: msg.timestamp || null,
            phoneNumberId
          });
          return;
        }

        if (type === 'interactive') {
          const interactiveType = String(msg?.interactive?.type || '').toLowerCase();
          const buttonReply = msg?.interactive?.button_reply || null;
          const listReply = msg?.interactive?.list_reply || null;
          const payload = String(
            buttonReply?.id ||
            listReply?.id ||
            ''
          ).trim();
          const buttonText = String(
            buttonReply?.title ||
            listReply?.title ||
            ''
          ).trim();
          const text = buttonText || payload;
          if (!text && !payload) return;
          results.push({
            messageId: msg.id,
            kind: interactiveType === 'list_reply' ? 'list_reply' : 'button',
            from: String(msg.from || ''),
            profileName: profileByWaId.get(String(msg.from || '').replace(/\D/g, '')) || null,
            replyToProviderId,
            text,
            payload: payload || null,
            buttonText: buttonText || null,
            timestamp: msg.timestamp || null,
            phoneNumberId
          });
          return;
        }

        if (!supportedMediaTypes.has(type)) return;
        const mediaPayload = msg?.[type] || {};
        const caption = String(mediaPayload?.caption || '').trim();
        results.push({
          messageId: msg.id,
          kind: 'media',
          messageType: type,
          from: String(msg.from || ''),
          profileName: profileByWaId.get(String(msg.from || '').replace(/\D/g, '')) || null,
          replyToProviderId,
          text: caption || null,
          caption,
          timestamp: msg.timestamp || null,
          phoneNumberId,
          mediaId: String(mediaPayload?.id || '').trim(),
          mimeType: String(mediaPayload?.mime_type || '').trim().toLowerCase() || null,
          fileName: String(mediaPayload?.filename || '').trim() || null,
          sha256: String(mediaPayload?.sha256 || '').trim() || null
        });
      });
    });
  });
  return results;
};

const parseWebhookStatuses = (payload) => {
  const results = [];
  const entries = Array.isArray(payload?.entry) ? payload.entry : [];
  entries.forEach((entry) => {
    const changes = Array.isArray(entry.changes) ? entry.changes : [];
    changes.forEach((change) => {
      const value = change?.value || {};
      const phoneNumberId = value?.metadata?.phone_number_id || null;
      const statuses = Array.isArray(value.statuses) ? value.statuses : [];
      statuses.forEach((st) => {
        results.push({
          id: st.id,
          status: st.status,
          recipientId: st.recipient_id,
          timestamp: st.timestamp || null,
          phoneNumberId,
          errors: Array.isArray(st.errors) ? st.errors : null
        });
      });
    });
  });
  return results;
};

const resolveConfig = async ({ tenantId, phoneNumberId }) => {
  if (tenantId) {
    const config = await getWhatsAppConfig(tenantId);
    const sender = resolveWhatsAppSender(config, phoneNumberId || null);
    return config ? { ...config, sender } : null;
  }
  if (!phoneNumberId) return null;
  const match = await findWhatsAppConfigByPhoneNumberId(phoneNumberId);
  return match ? { ...match.whatsapp, tenantId: match.tenantId, sender: match.sender } : null;
};

const getFilenameFromDisposition = (value) => {
  const source = String(value || '').trim();
  if (!source) return null;
  const utf8Match = source.match(/filename\*=UTF-8''([^;]+)/i);
  if (utf8Match?.[1]) {
    try {
      return decodeURIComponent(utf8Match[1]);
    } catch {
      return utf8Match[1];
    }
  }
  const simpleMatch = source.match(/filename="?([^";]+)"?/i);
  return simpleMatch?.[1] || null;
};

const downloadInboundMedia = async ({ tenantId, accessToken, mediaMessage }) => {
  if (!tenantId || !accessToken || !mediaMessage?.mediaId) {
    throw new Error('Parametros invalidos para download de midia inbound');
  }

  const metadata = await getWhatsAppMediaMetadata({
    accessToken,
    mediaId: mediaMessage.mediaId
  });
  const mediaUrl = String(metadata?.url || '').trim();
  if (!mediaUrl) {
    throw new Error('URL da midia WhatsApp nao encontrada');
  }

  const download = await downloadWhatsAppMedia({
    accessToken,
    mediaUrl
  });
  const originalName = mediaMessage.fileName
    || getFilenameFromDisposition(download.contentDisposition)
    || `${mediaMessage.messageType || 'media'}_${mediaMessage.mediaId}`;

  const stored = await storeTenantMediaBuffer({
    tenantId,
    buffer: download.buffer,
    mimeType: download.mimeType || mediaMessage.mimeType || metadata?.mime_type || '',
    originalName,
    prefix: `wa_${mediaMessage.messageType || 'media'}`
  });

  return {
    ...stored,
    mimeType: stored.mimeType || mediaMessage.mimeType || metadata?.mime_type || null
  };
};

const getOrCreateChat = async ({ from, tenantId, phoneNumberId = null }) => {
  const normalizedFrom = normalizeWhatsappNumber(from);
  const candidates = await adapter.findDocuments('activeChats', {
    tenantId,
    channel: 'whatsapp',
    channelUserId: normalizedFrom,
    status: { $ne: 'closed' }
  });

  const sorted = (Array.isArray(candidates) ? candidates : []).sort((a, b) => {
    const rank = (chat) => {
      if (chat.status === 'open') return 3;
      if (chat.status === 'waiting') return 2;
      if (chat.activeOutreach) return 1;
      return 0;
    };
    const score = rank(b) - rank(a);
    if (score !== 0) return score;
    return new Date(b.updatedAt || b.createdAt || 0) - new Date(a.updatedAt || a.createdAt || 0);
  });

  let chat = sorted[0] || null;

  if (!chat) {
    await ensureTenantLimit(tenantId, 'chats');
    chat = {
      id: generateId('chat'),
      customerCpf: `wa_${normalizedFrom}`,
      status: 'bot',
      messages: [],
      lastMessage: null,
      lastMessageAt: null,
      messageCount: 0,
      unreadByAgentCount: 0,
      vars: {},
      tenantId,
      channel: 'whatsapp',
      channelUserId: normalizedFrom,
      channelChatId: normalizedFrom,
      whatsappPhoneNumberId: phoneNumberId || null,
      currentNodeId: null,
      processedMessageIds: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    const sanitized = sanitizeChatState(chat);
    chat = sanitized.chat;
    await adapter.saveDocument('activeChats', chat);
    await emitChatEvent({
      tenantId,
      chatId: chat.id,
      type: CHAT_EVENT_TYPES.CHAT_OPENED,
      actor: { kind: 'customer', id: normalizedFrom },
      context: { channel: 'whatsapp', channelUserId: normalizedFrom, phoneNumberId: phoneNumberId || null }
    });
  } else if (phoneNumberId && chat.whatsappPhoneNumberId !== phoneNumberId) {
    chat.whatsappPhoneNumberId = phoneNumberId;
    chat.updatedAt = new Date().toISOString();
    const sanitized = sanitizeChatState(chat);
    chat = sanitized.chat;
    await adapter.saveDocument('activeChats', chat);
  } else {
    const sanitized = sanitizeChatState(chat);
    if (sanitized.changed) {
      chat = sanitized.chat;
      await adapter.saveDocument('activeChats', chat);
    }
  }

  return chat;
};

const unlockActiveOutreachReply = async (chatId) => {
  const chat = await adapter.getDocument('activeChats', { id: chatId });
  if (!chat) return;
  if (chat.outreachPendingReply !== true) return;

  chat.outreachPendingReply = false;
  chat.outreachUnlockedAt = new Date().toISOString();
  chat.updatedAt = new Date().toISOString();
  await adapter.saveDocument('activeChats', chat);
};

const markMessageProcessed = async (chatId, messageId) => {
  if (!messageId) return false;
  const chat = await adapter.getDocument('activeChats', { id: chatId });
  if (!chat) return false;
  const processed = Array.isArray(chat.processedMessageIds) ? chat.processedMessageIds : [];
  if (processed.includes(messageId)) return false;
  processed.push(messageId);
  chat.processedMessageIds = processed.slice(-50);
  chat.updatedAt = new Date().toISOString();
  await adapter.saveDocument('activeChats', chat);
  return true;
};

export const handleWhatsAppWebhook = async ({ payload, tenantId = null }) => {
  const messages = parseWebhookMessages(payload);
  const statuses = parseWebhookStatuses(payload);

  if (statuses.length) {
    for (const st of statuses) {
      const config = await resolveConfig({ tenantId, phoneNumberId: st.phoneNumberId });
      const resolvedTenantId = config?.tenantId || tenantId || null;
      await updateOutreachStatusByProviderMessageId({
        providerMessageId: st.id,
        tenantId: resolvedTenantId,
        status: st.status,
        timestamp: st.timestamp,
        errors: st.errors || null
      });
      await updateChatMessageDeliveryStatusByProviderMessageId({
        providerMessageId: st.id,
        status: st.status,
        timestamp: st.timestamp,
        errors: st.errors || null
      });
      const info = {
        messageId: st.id,
        status: st.status,
        recipientId: st.recipientId,
        phoneNumberId: st.phoneNumberId,
        timestamp: st.timestamp,
        errors: st.errors || null,
        tenantId: resolvedTenantId
      };
      console.log('[WHATSAPP] Status update', info);
      await createLog('WHATSAPP_STATUS', info, 'system');
      if (String(st.status || '').toLowerCase() === 'failed') {
        const firstError = Array.isArray(st.errors) ? st.errors[0] : null;
        await notifyWhatsAppProblem({
          operation: 'status_failed',
          tenantId: resolvedTenantId,
          data: { error: firstError || { message: 'Mensagem WhatsApp falhou' } },
          context: {
            recipientId: st.recipientId,
            phoneNumberId: st.phoneNumberId,
            providerMessageId: st.id
          }
        });
      }
    }
  }

  if (!messages.length) return { ok: true, processed: 0 };

  let processed = 0;
  for (const msg of messages) {
    await withChannelUserLock({
      channel: 'whatsapp',
      tenantId: tenantId || msg.phoneNumberId || 'unknown',
      userId: normalizeWhatsappNumber(msg.from)
    }, async () => {
      const config = await resolveConfig({ tenantId, phoneNumberId: msg.phoneNumberId });
      if (!config || !config.enabled || !config.accessToken || !config.phoneNumberId) {
        return;
      }

      const senderPhoneNumberId = config.sender?.phoneNumberId || config.phoneNumberId;
      const resolvedTenantId = config.tenantId || tenantId;
      const chat = await getOrCreateChat({
        from: msg.from,
        tenantId: resolvedTenantId,
        phoneNumberId: senderPhoneNumberId
      });

      // Upsert silencioso do contato com nome de perfil capturado do canal.
      // Best-effort: falha não bloqueia o atendimento.
      upsertContactFromChannel({
        tenantId: resolvedTenantId,
        channel: 'whatsapp',
        rawIdentifier: msg.from,
        channelDisplayName: msg.profileName || null,
        channelMeta: {
          waId: normalizeWhatsappNumber(msg.from),
          phoneNumberId: senderPhoneNumberId || null
        }
      }).catch(() => {});

      await withChatLock(chat.id, async () => {
        const accepted = await markMessageProcessed(chat.id, msg.messageId);
        if (!accepted) return;

        const inboundReplyTo = await resolveInboundReplyTo(chat, msg.replyToProviderId);

        if (msg.kind === 'media') {
          try {
            const storedMedia = await downloadInboundMedia({
              tenantId: chat.tenantId,
              accessToken: config.accessToken,
              mediaMessage: msg
            });
            await addUserMedia(chat.id, {
              mediaType: msg.messageType,
              mediaUrl: storedMedia.url,
              caption: msg.caption || '',
              fileName: storedMedia.originalName || msg.fileName || null,
              mimeType: storedMedia.mimeType || msg.mimeType || null,
              providerMediaId: msg.mediaId,
              sha256: msg.sha256 || null,
              providerMessageId: msg.messageId || null,
              replyTo: inboundReplyTo
            });
          } catch (error) {
            console.error('[WHATSAPP] Falha ao processar midia inbound', {
              messageId: msg.messageId,
              mediaId: msg.mediaId,
              error: error?.message || error
            });
            await addUserMessage(chat.id, msg.caption || `[${msg.messageType || 'media'} recebido(a)]`, { providerMessageId: msg.messageId || null, replyTo: inboundReplyTo });
          }
        } else {
          await addUserMessage(chat.id, msg.text || msg.buttonText || msg.payload || '[interacao]', { providerMessageId: msg.messageId || null, replyTo: inboundReplyTo });
        }
        await unlockActiveOutreachReply(chat.id);

        const flowId = normalizeEnvValue(resolveWhatsAppFlowId(config, senderPhoneNumberId)) || null;
        const flowData = await ensureFlow(chat.tenantId, flowId);
        if (!flowData || !flowData.nodes) {
          processed += 1;
          return;
        }

        const templates = await ensureTemplates(chat.tenantId);
        const schedules = await ensureSchedules(chat.tenantId);

        const sendMessage = async (text) => {
          const to = normalizeWhatsappNumber(msg.from);
          const liveChat = await getChatById(chat.id);
          return await sendWhatsAppText({
            accessToken: config.accessToken,
            phoneNumberId: liveChat?.whatsappPhoneNumberId || senderPhoneNumberId,
            to,
            text
          });
        };
        const sendMedia = async ({ mediaType, mediaUrl, caption, fileName }) => {
          const to = normalizeWhatsappNumber(msg.from);
          const liveChat = await getChatById(chat.id);
          return await sendWhatsAppMedia({
            accessToken: config.accessToken,
            phoneNumberId: liveChat?.whatsappPhoneNumberId || senderPhoneNumberId,
            to,
            mediaType,
            mediaUrl,
            caption,
            filename: fileName
          });
        };
        sendMessage.__sendMedia = sendMedia;

        let currentChat = await getChatById(chat.id);
        if (currentChat?.status === 'open' || currentChat?.status === 'waiting' || currentChat?.activeOutreach === true) {
          processed += 1;
          return;
        }

        const inboundText = msg.text || msg.buttonText || msg.payload || '';
        const handledCommand = await tryHandleGlobalCommand({
          chat: currentChat,
          flowData,
          text: msg.kind === 'text' ? inboundText : null,
          templates,
          schedules,
          sendMessage,
          sendMedia
        });
        if (handledCommand) {
          processed += 1;
          return;
        }

        const flowJustStarted = !currentChat.currentNodeId;
        if (flowJustStarted) {
          await startChatFlow({
            chatId: currentChat.id,
            flowData,
            templates,
            schedules,
            sendMessage,
            sendMedia
          });
          currentChat = await getChatById(currentChat.id);
          if (!currentChat?.currentNodeId) {
            processed += 1;
            return;
          }
          if (msg.kind === 'text') {
            processed += 1;
            return;
          }
        }

        if (inboundText) {
          await applyUserInput({
            chat: currentChat,
            flowData,
            text: inboundText,
            buttonId: msg.payload || null,
            buttonText: msg.buttonText || null,
            responsePayload: msg.payload || null,
            templates,
            schedules,
            sendMessage,
            sendMedia
          });
        }
        processed += 1;
      });
    });
  }

  return { ok: true, processed };
};
