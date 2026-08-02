import adapter from '../../db/DatabaseAdapter.js';
import { ensureTenantLimit } from './tenantLimits.js';
import { sanitizeChatState } from './chatStateGuard.js';
import { generateId } from '../utils/helpers.js';
import { appendChatMessage } from './chatMessages.js';

const normalizeDigits = (value) => String(value || '').replace(/\D/g, '');

export const normalizeWhatsappNumber = (value) => {
  const digits = normalizeDigits(value);
  if (!digits) return '';
  if (digits.length === 10) {
    return `55${digits.slice(0, 2)}9${digits.slice(2)}`;
  }
  if (digits.length === 11) {
    return `55${digits}`;
  }
  if (digits.startsWith('55') && digits.length === 12) {
    return `${digits.slice(0, 4)}9${digits.slice(4)}`;
  }
  return digits;
};

const buildContactVars = (contact, phoneNumber) => ({
  nome_cliente: contact?.name || null,
  contato_nome: contact?.name || null,
  contato_empresa: contact?.company || null,
  contato_email: contact?.email || null,
  contato_id: contact?.id || null,
  contato_telefone: phoneNumber || null
});

const createChatMessage = ({ sender, text, meta = null }) => ({
  id: generateId('msg'),
  sender,
  text,
  meta,
  providerMessageId: meta?.providerMessageId || null,
  deliveryStatus: meta?.deliveryStatus || null,
  deliveryStatusAt: meta?.deliveryStatusAt || null,
  timestamp: new Date().toISOString()
});

export const ensureAgentWhatsAppChat = async ({
  tenantId,
  contact,
  phoneNumber,
  agent,
  senderPhoneNumberId = null,
  senderLabel = null
}) => {
  const normalizedPhone = normalizeWhatsappNumber(phoneNumber);
  const existing = await adapter.findOne('activeChats', {
    tenantId,
    channel: 'whatsapp',
    channelUserId: normalizedPhone,
    status: { $ne: 'closed' }
  });

  if (existing?.agentId && existing.agentId !== agent.id) {
    const ownerName = existing.agentName || 'outro agente';
    const error = new Error(`Este contato ja esta em atendimento com ${ownerName}.`);
    error.status = 409;
    throw error;
  }

  const now = new Date().toISOString();
  const contactVars = buildContactVars(contact, normalizedPhone);

  if (existing) {
    const nextChat = {
      ...existing,
      status: 'open',
      agentId: agent.id,
      agentName: agent.name,
      activeOutreach: true,
      queue: 'ATIVO',
      waitingSince: null,
      currentNodeId: null,
      flowStarted: false,
      resumeNodeId: null,
      resumePending: false,
      continueFlowAfterQueue: false,
      catalogContext: null,
      transferredTo: null,
      transferReason: null,
      closedAt: null,
      secureVars: {},
      secureVarNames: [],
      outreachPendingReply: false,
      customerName: contact?.name || existing.customerName || null,
      contactId: contact?.id || existing.contactId || null,
      channelUserId: normalizedPhone,
      channelChatId: normalizedPhone,
      whatsappPhoneNumberId: senderPhoneNumberId || existing.whatsappPhoneNumberId || null,
      whatsappSenderLabel: senderLabel || existing.whatsappSenderLabel || null,
      vars: {
        ...(existing.vars || {}),
        ...contactVars
      },
      updatedAt: now
    };
    const sanitized = sanitizeChatState(nextChat);
    await adapter.updateOne('activeChats', { id: existing.id }, { $set: sanitized.chat });
    return sanitized.chat;
  }

  await ensureTenantLimit(tenantId, 'chats');
  const chat = {
    id: generateId('chat'),
    customerCpf: `wa_${normalizedPhone}`,
    customerName: contact?.name || null,
    contactId: contact?.id || null,
    status: 'open',
    queue: 'ATIVO',
    messages: [],
    lastMessage: null,
    lastMessageAt: null,
    messageCount: 0,
    unreadByAgentCount: 0,
    vars: contactVars,
    tenantId,
    channel: 'whatsapp',
    channelUserId: normalizedPhone,
    channelChatId: normalizedPhone,
    whatsappPhoneNumberId: senderPhoneNumberId || null,
    whatsappSenderLabel: senderLabel || null,
    activeOutreach: true,
    currentNodeId: null,
    processedMessageIds: [],
    agentId: agent.id,
    agentName: agent.name,
    flowStarted: false,
    createdAt: now,
    updatedAt: now
  };

  const sanitized = sanitizeChatState(chat);
  await adapter.insertOne('activeChats', sanitized.chat);
  return sanitized.chat;
};

export const appendAgentOutreachMessage = async ({
  chatId,
  templateName,
  previewText,
  meta = null
}) => {
  const existing = await adapter.findOne('activeChats', { id: chatId });
  if (!existing) {
    throw new Error('Chat nao encontrado');
  }

  const now = new Date().toISOString();
  const message = createChatMessage({
    sender: 'agent',
    text: previewText || `Template enviado: ${templateName}`,
    meta: {
      type: 'whatsapp_template',
      templateName,
      deliveryStatus: 'sent',
      deliveryStatusAt: now,
      ...meta
    }
  });

  const nextChat = sanitizeChatState({
    ...existing,
    activeOutreach: true,
    outreachPendingReply: true,
    outreachLastSentAt: now,
    updatedAt: now
  }).chat;

  await adapter.updateOne('activeChats', { id: chatId }, {
    $set: {
      activeOutreach: true,
      outreachPendingReply: true,
      outreachLastSentAt: now,
      updatedAt: now
    }
  });
  const appended = await appendChatMessage(nextChat, message, { incrementUnread: false });

  return { message: appended.message || message, chat: appended.chat || nextChat };
};
