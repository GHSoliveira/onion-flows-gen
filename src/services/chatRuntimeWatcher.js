import adapter from '../../db/DatabaseAdapter.js';
import { getTelegramConfig, getWhatsAppConfig, resolveWhatsAppFlowId, resolveWhatsAppSender } from './channelConfig.js';
import { addBotMessage, applyFlowRuntimeReset, runFlow } from './flowRunner.js';
import { sendTelegramMedia, sendTelegramMessage } from './telegramApi.js';
import { sendWhatsAppMedia, sendWhatsAppText } from './whatsappApi.js';
import { normalizeWhatsappNumber } from './activeOutreach.js';
import { withChatLock } from './chatLocks.js';
import { getTenantSettings } from './tenantSettings.js';
import { getCachedRuntimeFlow, getCachedRuntimeSchedules, getCachedRuntimeTemplates } from './flowRuntimeCache.js';
import { CHAT_EVENT_TYPES, emitChatEvent } from './chatEvents.js';
import {
  GENESYS_CALL_DEFAULT_TTL_MS,
  isGenesysCallShell,
  isGenesysChat,
  isGenesysEmptyShell,
  relayHydrateGenesys
} from './extensionAtendimento.js';
import { getIo } from './logs.js';

const normalizeWatchIntervalMs = (value) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return 30 * 1000;
  return Math.min(Math.max(Math.round(numeric), 1000), 60 * 1000);
};

const WATCH_INTERVAL_MS = normalizeWatchIntervalMs(process.env.CHAT_RUNTIME_WATCHER_INTERVAL_MS);

const normalizeMinutesMs = (value, fallbackMinutes, minMinutes, maxMinutes) => {
  const numeric = Number(value);
  const minutes = Number.isFinite(numeric) && numeric > 0 ? numeric : fallbackMinutes;
  return Math.min(Math.max(minutes, minMinutes), maxMinutes) * 60 * 1000;
};

// Silêncio a partir do qual um espelho Genesys aberto é suspeito de ter buraco.
const GENESYS_RECONCILE_IDLE_MS = normalizeMinutesMs(
  process.env.GENESYS_RECONCILE_IDLE_MINUTES, 10, 2, 120
);
// Piso entre dois pedidos de hydrate para o mesmo chat.
const GENESYS_RECONCILE_COOLDOWN_MS = normalizeMinutesMs(
  process.env.GENESYS_RECONCILE_COOLDOWN_MINUTES, 15, 5, 240
);
const genesysReconcileLastAskedAt = new Map();

// Quanto tempo um card de ligação sem sinal continua visível antes de fechar.
const GENESYS_CALL_ZOMBIE_MS = normalizeMinutesMs(
  process.env.GENESYS_CALL_ZOMBIE_MINUTES, 5, 1, 60
);
const TIMEOUT_NODE_TYPES = new Set(['inputNode', 'menuNode', 'ratingNode', 'whatsappTemplateNode', 'sequentialNode', 'holderNode']);
let watcherStarted = false;
let watcherTimer = null;
let watcherRunning = false;

const getOperationalChats = async () => {
  const chats = await adapter.findDocuments('activeChats', { status: { $ne: 'closed' } });
  return Array.isArray(chats) ? chats : [];
};

const getLastMessageTimestamp = (chat) => {
  const messages = Array.isArray(chat?.messages) ? chat.messages : [];
  if (!messages.length) return null;
  const last = messages[messages.length - 1];
  const timestamp = new Date(last?.timestamp || last?.createdAt || 0);
  return Number.isNaN(timestamp.getTime()) ? null : timestamp;
};

const getChatActivityDate = (chat) => {
  const lastMessageAt = getLastMessageTimestamp(chat);
  if (lastMessageAt) return lastMessageAt;
  const updatedAt = new Date(chat?.updatedAt || chat?.createdAt || 0);
  return Number.isNaN(updatedAt.getTime()) ? new Date() : updatedAt;
};

const resolveFlowForChat = async (chat) => {
  if (!chat?.tenantId) return null;

  let flowId = null;
  if (chat.channel === 'telegram') {
    const config = await getTelegramConfig(chat.tenantId);
    flowId = config?.flowId || null;
  } else if (chat.channel === 'whatsapp') {
    const config = await getWhatsAppConfig(chat.tenantId);
    flowId = resolveWhatsAppFlowId(config, chat.whatsappPhoneNumberId) || null;
  }

  return getCachedRuntimeFlow({
    tenantId: chat.tenantId,
    flowId,
    loader: async () => {
      const flows = await adapter.getCollection('flows', chat.tenantId);
      if (!Array.isArray(flows) || !flows.length) return null;
      let flow = null;
      if (flowId) {
        flow = flows.find((item) => item.id === flowId) || null;
      }
      if (!flow) {
        flow = flows.find((item) => item.published && item.published.nodes && item.published.nodes.length > 0) || flows[0] || null;
      }
      return flow ? (flow.published || flow) : null;
    }
  });
};

const loadTemplates = async (tenantId) => getCachedRuntimeTemplates({
  tenantId,
  loader: async () => {
    const scoped = await adapter.getCollection('templates', tenantId);
    if (Array.isArray(scoped) && scoped.length) return scoped;
    const fallback = await adapter.getCollection('messageTemplates', tenantId);
    return Array.isArray(fallback) ? fallback : [];
  }
});

const loadSchedules = async (tenantId) => getCachedRuntimeSchedules({
  tenantId,
  loader: async () => {
    const schedules = await adapter.getCollection('schedules', tenantId);
    return Array.isArray(schedules) ? schedules : [];
  }
});

const resolveWhatsAppPhoneNumberId = (chat, config) => (
  chat?.whatsappPhoneNumberId
  || resolveWhatsAppSender(config)?.phoneNumberId
  || config?.phoneNumberId
  || null
);

const buildChatTransport = async (chat) => {
  if (!chat) return { sendMessage: null, sendMedia: null };

  if (chat.channel === 'telegram' && chat.channelChatId) {
    const config = chat.tenantId ? await getTelegramConfig(chat.tenantId) : null;
    const botToken = config?.botToken || process.env.TELEGRAM_BOT_TOKEN || null;
    if (!botToken) return { sendMessage: null, sendMedia: null };
    return {
      sendMessage: async (text, buttons) => {
        await sendTelegramMessage(chat.channelChatId, text, buttons || null, botToken);
        return null;
      },
      sendMedia: async ({ mediaType, mediaUrl, caption }) => (
        sendTelegramMedia({
          chatId: chat.channelChatId,
          mediaType,
          mediaUrl,
          caption,
          token: botToken
        })
      )
    };
  }

  if (chat.channel === 'whatsapp' && chat.channelUserId) {
    const config = chat.tenantId ? await getWhatsAppConfig(chat.tenantId) : null;
    const accessToken = config?.accessToken || null;
    const phoneNumberId = resolveWhatsAppPhoneNumberId(chat, config);
    if (!accessToken || !phoneNumberId) return { sendMessage: null, sendMedia: null };
    const to = normalizeWhatsappNumber(chat.channelUserId);
    return {
      sendMessage: async (text) => (
        sendWhatsAppText({
          accessToken,
          phoneNumberId,
          to,
          text
        })
      ),
      sendMedia: async ({ mediaType, mediaUrl, caption, fileName }) => (
        sendWhatsAppMedia({
          accessToken,
          phoneNumberId,
          to,
          mediaType,
          mediaUrl,
          caption,
          filename: fileName || null
        })
      )
    };
  }

  return { sendMessage: null, sendMedia: null };
};

const buildChatSendMessage = async (chat) => {
  const { sendMessage, sendMedia } = await buildChatTransport(chat);
  if (sendMessage && sendMedia) {
    sendMessage.__sendMedia = sendMedia;
  }
  return sendMessage;
};

const buildChatSendMedia = async (chat) => {
  const { sendMedia } = await buildChatTransport(chat);
  return sendMedia;
};

const resolveNodeTimeoutTarget = (flowData, node) => {
  if (!flowData || !node) return null;

  if (node.type === 'menuNode') {
    const elseEdge = flowData.edges.find(
      (edge) => edge.source === node.id && String(edge.sourceHandle || '') === 'else'
    );
    if (elseEdge) {
      const nextEdge = flowData.edges.find((edge) => edge.source === elseEdge.target);
      return nextEdge?.target || null;
    }
  }

  const directEdge = flowData.edges.find((edge) => edge.source === node.id);
  if (!directEdge) return null;

  const targetNode = flowData.nodes.find((item) => item.id === directEdge.target);
  if (targetNode?.type === 'caseNode') {
    const nextEdge = flowData.edges.find((edge) => edge.source === targetNode.id);
    return nextEdge?.target || null;
  }

  return directEdge.target || null;
};

const handleDelayedFlow = async (chat) => {
  if (!chat?.tenantId || chat?.status !== 'bot') return;
  if (!chat?.delayUntil || !chat?.delayNextNodeId) return;

  await withChatLock(chat.id, async () => {
    const liveChat = await adapter.getDocument('activeChats', { id: chat.id });
    if (!liveChat) return;

    const resumeAt = new Date(liveChat.delayUntil);
    if (Number.isNaN(resumeAt.getTime()) || resumeAt.getTime() > Date.now()) return;

    const flowData = await resolveFlowForChat(liveChat);
    if (!flowData?.nodes) return;

    const nextNodeId = liveChat.delayNextNodeId;
    if (!nextNodeId) return;

    liveChat.delayNodeId = null;
    liveChat.delayNextNodeId = null;
    liveChat.delayUntil = null;
    liveChat.currentNodeId = null;
    liveChat.currentNodeEnteredAt = null;
    liveChat.holderContext = null;
    liveChat.updatedAt = new Date().toISOString();
    await adapter.saveDocument('activeChats', liveChat);

    const templates = await loadTemplates(liveChat.tenantId);
    const schedules = await loadSchedules(liveChat.tenantId);
    const sendMessage = await buildChatSendMessage(liveChat);
    const sendMedia = await buildChatSendMedia(liveChat);
    await runFlow({
      nodeId: nextNodeId,
      flowData,
      currentVars: liveChat.vars || {},
      chatId: liveChat.id,
      templates,
      schedules,
      sendMessage,
      sendMedia
    });
  });
};

const handleNodeTimeout = async (chat) => {
  if (!chat?.currentNodeId || !chat?.tenantId) return;

  const flowData = await resolveFlowForChat(chat);
  if (!flowData?.nodes) return;

  const node = flowData.nodes.find((item) => item.id === chat.currentNodeId);
  if (!node || !TIMEOUT_NODE_TYPES.has(node.type)) return;

  // whatsappTemplateNode só aguarda resposta quando waitForReply está habilitado
  if (node.type === 'whatsappTemplateNode' && !node.data?.waitForReply) return;

  const timeoutMinutes = Number(node.data?.timeoutMinutes || 0);
  if (!Number.isFinite(timeoutMinutes) || timeoutMinutes <= 0) return;

  const enteredAt = new Date(chat.currentNodeEnteredAt || chat.updatedAt || chat.createdAt || 0);
  if (Number.isNaN(enteredAt.getTime())) return;

  if ((Date.now() - enteredAt.getTime()) < timeoutMinutes * 60 * 1000) {
    return;
  }

  await withChatLock(chat.id, async () => {
    const sendMessage = await buildChatSendMessage(chat);
    const sendMedia = await buildChatSendMedia(chat);
    const timeoutMessage = String(node.data?.timeoutMessage || '').trim();
    if (timeoutMessage) {
      await addBotMessage(chat.id, timeoutMessage, null, sendMessage);
    }

    const nextNodeId = resolveNodeTimeoutTarget(flowData, node);
    const liveChat = await adapter.getDocument('activeChats', { id: chat.id });
    if (!liveChat) return;

    const expiredNodeId = liveChat.currentNodeId;
    liveChat.currentNodeId = null;
    liveChat.currentNodeEnteredAt = null;
    liveChat.updatedAt = new Date().toISOString();
    await adapter.saveDocument('activeChats', liveChat);

    await emitChatEvent({
      tenantId: liveChat.tenantId,
      chatId: liveChat.id,
      type: CHAT_EVENT_TYPES.FLOW_TIMEOUT,
      actor: { kind: 'system' },
      context: {
        nodeId: expiredNodeId,
        nodeType: node.type,
        nodeLabel: node.data?.label || null,
        timeoutMinutes,
        nextNodeId: nextNodeId || null
      }
    });

    if (!nextNodeId) return;

    const templates = await loadTemplates(chat.tenantId);
    const schedules = await loadSchedules(chat.tenantId);
    await runFlow({
      nodeId: nextNodeId,
      flowData,
      currentVars: liveChat.vars || {},
      chatId: chat.id,
      templates,
      schedules,
      sendMessage,
      sendMedia
    });
  });
};

const handleGlobalInactivity = async (chat) => {
  if (!chat?.tenantId) return;

  // Inatividade global só encerra conversas presas no fluxo automático (bot).
  // Atendimento humano (open) e fila (waiting) não são encerrados por este
  // mecanismo — quem decide é o agente/fila. Evita fechar um atendimento ativo
  // só porque ninguém digitou por X tempo.
  if (chat.status !== 'bot') return;

  const settings = await getTenantSettings(chat.tenantId);
  const inactivityHours = Number(settings?.inactivityMaxHours || 0);
  if (!Number.isFinite(inactivityHours) || inactivityHours <= 0) return;

  const activityDate = getChatActivityDate(chat);
  if ((Date.now() - activityDate.getTime()) < inactivityHours * 60 * 60 * 1000) {
    return;
  }

  await withChatLock(chat.id, async () => {
    const liveChat = await adapter.getDocument('activeChats', { id: chat.id });
    if (!liveChat) return;
    // Revalida dentro do lock: se o agente puxou o chat (open) ou foi pra fila
    // (waiting) entre a leitura e agora, não encerra.
    if (liveChat.status !== 'bot') return;

    const sendMessage = await buildChatSendMessage(liveChat);
    const closingText = String(settings?.inactivityMessage || '').trim();
    if (closingText) {
      await addBotMessage(liveChat.id, closingText, null, sendMessage);
    }

    applyFlowRuntimeReset(liveChat);
    liveChat.status = 'closed';
    liveChat.closedAt = new Date().toISOString();
    liveChat.closedByInactivity = true;
    liveChat.outreachPendingReply = false;
    liveChat.updatedAt = new Date().toISOString();
    await adapter.saveDocument('activeChats', liveChat);

    await emitChatEvent({
      tenantId: liveChat.tenantId,
      chatId: liveChat.id,
      type: CHAT_EVENT_TYPES.CLOSED_BY_INACTIVITY,
      actor: { kind: 'system' },
      context: {
        inactivityHours,
        lastActivityAt: activityDate.toISOString(),
        queue: liveChat.queue || null,
        agentId: liveChat.agentId || null,
        fromStatus: chat.status
      }
    });
  });
};

/**
 * Rede de segurança do card de ligação.
 *
 * O cronômetro é ancorado no cliente (`conectadoEm`), então ele continua
 * subindo mesmo sem a extensão — um card zumbi mostra uma ligação de horas que
 * já acabou. `expiraEm` é o antídoto: sem renovação, o card se acusa.
 *
 * Dois estágios de propósito. Primeiro marca `stale` (o painel congela o
 * cronômetro e mostra "sem sinal") — reversível, porque um keepalive atrasado
 * não deve matar ligação real. Só depois de GENESYS_CALL_ZOMBIE_MS sem
 * nenhuma notícia é que o card fecha.
 */
const handleGenesysCallExpiry = async (chat) => {
  if (!isGenesysCallShell(chat) || chat.status !== 'open') return;

  const call = chat.genesysCall && typeof chat.genesysCall === 'object' ? chat.genesysCall : null;
  // Call shell sem estado é card anterior ao contrato: sem TTL, nada a decidir.
  if (!call || call.estado === 'disconnected') return;

  const now = Date.now();
  const expiresAt = Number(call.expiraEm)
    || (Number(call.atualizadoEm || 0) + GENESYS_CALL_DEFAULT_TTL_MS);
  if (!Number.isFinite(expiresAt) || now <= expiresAt) return;

  const alreadyStale = call.stale === true;
  const staleSince = Number(call.staleAt || 0);
  // Ligação que chegou a conectar nunca fecha sozinha: se a extensão morreu no
  // meio da conversa, o agente ainda está falando. Card congelado é
  // recuperável, card fechado é perda. Só some o que travou em `alerting`.
  const everConnected = Number(call.conectadoEm || 0) > 0;
  const shouldClose = alreadyStale
    && !everConnected
    && staleSince > 0
    && (now - staleSince) >= GENESYS_CALL_ZOMBIE_MS;
  if (alreadyStale && !shouldClose) return;

  let updated = null;
  await withChatLock(chat.id, async () => {
    const live = await adapter.getDocument('activeChats', { id: chat.id });
    if (!live || live.status !== 'open') return;
    const liveCall = live.genesysCall && typeof live.genesysCall === 'object' ? live.genesysCall : null;
    if (!liveCall || liveCall.estado === 'disconnected') return;
    // Revalida sob lock: um evento fresco entre a leitura e agora renova o TTL.
    const liveExpiresAt = Number(liveCall.expiraEm)
      || (Number(liveCall.atualizadoEm || 0) + GENESYS_CALL_DEFAULT_TTL_MS);
    if (Number.isFinite(liveExpiresAt) && Date.now() <= liveExpiresAt) return;

    if (shouldClose) {
      live.genesysCall = { ...liveCall, estado: 'disconnected', stale: true };
      live.status = 'closed';
      live.closedAt = new Date().toISOString();
      live.closeReason = 'genesys_ligacao_sem_sinal';
      live.genesysMirrorPhase = 'closed';
      live.waitingSince = null;
    } else {
      live.genesysCall = { ...liveCall, stale: true, staleAt: Date.now() };
    }
    live.updatedAt = new Date().toISOString();
    await adapter.saveDocument('activeChats', live);
    updated = live;
  });

  if (!updated) return;

  const io = getIo();
  if (!io || !updated.tenantId) return;
  const room = io.to(`tenant:${updated.tenantId}`);
  room.emit('genesys_call_state', {
    chatId: updated.id,
    convId: updated.genesysConvId || updated.externalConvId || null,
    call: updated.genesysCall
  });
  if (shouldClose) {
    room.emit('chat_closed', {
      chatId: updated.id,
      convId: updated.genesysConvId || updated.externalConvId || null,
      motivo: 'genesys_ligacao_sem_sinal',
      source: 'watcher'
    });
    console.warn('[CHAT_RUNTIME_WATCHER] ligação sem sinal encerrada', {
      chatId: updated.id,
      staleMs: now - staleSince
    });
  }
};

/**
 * Rede de segurança do espelho Genesys.
 *
 * Os outboxes da extensão vivem em chrome.storage.session, que o Chrome apaga
 * ao fechar o navegador: deltas pendentes somem sem que o app saiba. Um chat
 * aberto, já seedado e calado há muito tempo é o sintoma disso — então o app
 * pede à extensão um sync/watch por conta própria, em vez de esperar o agente
 * clicar em hidratar (o buraco é invisível no card).
 *
 * Não força re-seed do histórico: `force: false` deixa a extensão decidir o que
 * falta, e o dedup por messageId cobre qualquer repetição.
 */
const handleGenesysMirrorReconcile = async (chat) => {
  if (!isGenesysChat(chat)) return;
  // Só espelho vivo, já bootstrapado e com dono — hydrate exige agentId.
  if (chat.status !== 'open' || !chat.agentId) return;
  if (!chat.historySeeded) return;
  // Voz/callback não tem mensagem por natureza; reconciliar seria pedir vazio pra sempre.
  if (isGenesysEmptyShell(chat)) return;

  const now = Date.now();
  const idleMs = now - getChatActivityDate(chat).getTime();
  if (idleMs < GENESYS_RECONCILE_IDLE_MS) return;

  const lastAskedAt = Number(genesysReconcileLastAskedAt.get(chat.id) || 0);
  if (now - lastAskedAt < GENESYS_RECONCILE_COOLDOWN_MS) return;
  genesysReconcileLastAskedAt.set(chat.id, now);

  const result = await relayHydrateGenesys({
    chat,
    agentId: chat.agentId,
    force: false,
    watch: true
  }).catch((error) => ({ ok: false, reason: error?.message || 'relay_failed' }));

  // Extensão offline é o caso comum e esperado (agente fechou o Chrome):
  // não polui o log, e o cooldown já evita insistência.
  if (!result?.ok && result?.reason !== 'extension_offline') {
    console.warn('[CHAT_RUNTIME_WATCHER] reconcile Genesys falhou', {
      chatId: chat.id,
      reason: result?.reason || 'desconhecido'
    });
  }
};

const pruneGenesysReconcileState = (now = Date.now()) => {
  for (const [chatId, askedAt] of genesysReconcileLastAskedAt) {
    if (now - Number(askedAt || 0) > GENESYS_RECONCILE_COOLDOWN_MS * 4) {
      genesysReconcileLastAskedAt.delete(chatId);
    }
  }
};

const processWatcherTick = async () => {
  if (watcherRunning) return;
  watcherRunning = true;

  try {
    const chats = await getOperationalChats();
    for (const chat of chats) {
      await handleDelayedFlow(chat);
      const afterDelayChat = await adapter.getDocument('activeChats', { id: chat.id });
      if (!afterDelayChat || afterDelayChat.status === 'closed') continue;

      await handleNodeTimeout(afterDelayChat);
      const liveChat = await adapter.getDocument('activeChats', { id: chat.id });
      if (!liveChat || liveChat.status === 'closed') continue;
      await handleGlobalInactivity(liveChat);

      const afterInactivityChat = await adapter.getDocument('activeChats', { id: chat.id });
      if (!afterInactivityChat || afterInactivityChat.status === 'closed') continue;
      await handleGenesysCallExpiry(afterInactivityChat);
      await handleGenesysMirrorReconcile(afterInactivityChat);
    }
    pruneGenesysReconcileState();
  } catch (error) {
    console.error('[CHAT_RUNTIME_WATCHER] Erro no watcher de runtime:', error?.message || error);
  } finally {
    watcherRunning = false;
  }
};

export const startChatRuntimeWatcher = () => {
  if (watcherStarted) return;
  watcherStarted = true;
  watcherTimer = setInterval(processWatcherTick, WATCH_INTERVAL_MS);
  if (typeof watcherTimer?.unref === 'function') {
    watcherTimer.unref();
  }
  setTimeout(() => {
    processWatcherTick().catch(() => {});
  }, 5000);
  console.log(`[CHAT_RUNTIME_WATCHER] Ativo com intervalo de ${WATCH_INTERVAL_MS}ms`);
};
