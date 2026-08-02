/**
 * Genesys ⇄ OnionFlows — handlers dos eventos da extensão coletora (v1 + fase 4).
 *
 * Extensão → app:  ext:atendimento:*
 * App → extensão:  cmd:enviar_mensagem | cmd:enviar_midia | cmd:encerrar
 * Extensão → app:  cmd:resultado (ack opcional)
 */
import adapter from '../../db/DatabaseAdapter.js';
import { generateId } from '../utils/helpers.js';
import { appendChatMessage, hydrateChatWithMessages, refreshChatMessageSummary } from './chatMessages.js';
import { withChatLock } from './chatLocks.js';
import { getIo } from './logs.js';
import { storeTenantMediaBuffer } from './mediaStorage.js';

export const EXTENSION_CLIENT_KINDS = new Set([
  'genesys-extension', 'extension', 'genesys', 'coletor'
]);

export const extensionRoomForAgent = (agentId) => `agent:${agentId}:extension`;
const onlyDigits = (value) => String(value || '').replace(/\D/g, '');
const GENESYS_UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const pickString = (...values) => {
  for (const value of values) {
    if (value === undefined || value === null) continue;
    const text = String(value).trim();
    if (text) return text;
  }
  return '';
};
const sanitizeIxcData = (value) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
  return {
    ...value,
    ...(Array.isArray(value.logins)
      ? { logins: value.logins.filter((login) => login?.active === true) }
      : {}),
  };
};

const inferMediaType = (mime, fileName, hint) => {
  const h = String(hint || '').toLowerCase();
  if (/(image|img|photo|picture|sticker)/i.test(h)) return 'image';
  if (/video/i.test(h)) return 'video';
  if (/(audio|voice|ptt)/i.test(h)) return 'audio';
  if (/(document|file|pdf)/i.test(h)) return 'document';
  const m = String(mime || '').toLowerCase();
  if (m.startsWith('image/')) return 'image';
  if (m.startsWith('video/')) return 'video';
  if (m.startsWith('audio/') || m === 'application/ogg') return 'audio';
  const fn = String(fileName || '').toLowerCase();
  if (/\.(jpe?g|png|gif|webp|bmp|heic)$/i.test(fn)) return 'image';
  if (/\.(mp4|webm|mov|mkv|m4v)$/i.test(fn)) return 'video';
  if (/\.(mp3|ogg|oga|opus|wav|m4a|aac|weba)$/i.test(fn)) return 'audio';
  return 'document';
};

const normalizeExtensionMedia = async (raw, tenantId) => {
  if (!raw || typeof raw !== 'object') return null;
  const fileName = pickString(raw.fileName, raw.filename, raw.name) || null;
  const receivedMimeType = pickString(raw.mimeType, raw.mime, raw.contentType) || null;
  const normalizedReceivedMime = String(receivedMimeType || '').toLowerCase().split(';')[0].trim();
  const mimeType = normalizedReceivedMime === 'application/ogg'
    ? 'audio/ogg'
    : normalizedReceivedMime || null;
  const type = ['image', 'video', 'audio', 'document'].includes(String(raw.type || '').toLowerCase())
    ? String(raw.type).toLowerCase()
    : inferMediaType(mimeType, fileName, raw.type || raw.mediaType);
  const caption = pickString(raw.caption) || '';
  let url = pickString(raw.url, raw.mediaUrl, raw.href) || null;
  const dataUrl = pickString(raw.dataUrl) || null;
  if (dataUrl && dataUrl.startsWith('data:') && tenantId) {
    try {
      const commaIndex = dataUrl.indexOf(',');
      const metadata = commaIndex > 5 ? dataUrl.slice(5, commaIndex) : '';
      const metadataParts = metadata.split(';').map((part) => part.trim()).filter(Boolean);
      const dataMimeType = String(metadataParts[0] || '').toLowerCase().split(';')[0].trim();
      const isBase64 = metadataParts.slice(1).some((part) => part.toLowerCase() === 'base64');
      if (commaIndex > 0 && isBase64) {
        const buffer = Buffer.from(dataUrl.slice(commaIndex + 1), 'base64');
        if (buffer.length > 0 && buffer.length <= 20 * 1024 * 1024) {
          const stored = await storeTenantMediaBuffer({
            tenantId, buffer,
            mimeType: mimeType || dataMimeType || 'application/octet-stream',
            originalName: fileName || `genesys_${type || 'file'}`,
            prefix: 'gx'
          });
          url = stored.url;
        }
      }
    } catch (err) {
      console.warn('[EXT_ATENDIMENTO] media store dataUrl fail', err?.message || err);
    }
  }
  if (!url) return null;
  return {
    type: type || 'document', url, caption,
    fileName: fileName || null, mimeType: mimeType || null,
    mediaId: pickString(raw.mediaId, raw.id) || null
  };
};

export const isGenesysChat = (chat) => {
  if (!chat) return false;
  const channel = String(chat.channel || '').toLowerCase();
  const source = String(chat.externalSource || '').toLowerCase();
  return channel === 'genesys'
    || source === 'genesys'
    || Boolean(chat.genesysConvId)
    || (Boolean(chat.externalConvId) && source === 'genesys');
};

const genesysConversationKind = (chat) => String(
  chat?.genesysMediaType || chat?.conversationType || chat?.mediaType
  || chat?.interactionType || chat?.kind || ''
).trim().toLowerCase();

export const isGenesysEmptyShell = (chat) => {
  if (!isGenesysChat(chat)) return false;
  if (['message', 'messaging', 'chat', 'webmessaging'].includes(genesysConversationKind(chat))) return false;
  const count = Number(chat.messageCount || 0);
  const arrLen = Array.isArray(chat.messages) ? chat.messages.length : 0;
  const last = chat.lastMessage;
  return count <= 0 && arrLen <= 0
    && !(last && (String(last.text || '').trim() || last.type || last.mediaType));
};

// Ausência de mensagem não prova que é voz; exige tipo explícito.
export const isGenesysCallShell = (chat) => {
  if (!isGenesysEmptyShell(chat)) return false;
  return ['voice', 'call', 'phone', 'callback'].includes(genesysConversationKind(chat));
};

export const resolveGenesysConvId = (chat) => pickString(
  chat?.genesysConvId,
  chat?.externalConvId
);

const normalizeSender = (raw) => {
  const key = String(raw || 'user').trim().toLowerCase();
  if (['user', 'customer', 'cliente', 'client', 'visitor', 'inbound'].includes(key)) return 'user';
  if (['agent', 'agente', 'humano', 'human', 'outbound'].includes(key)) return 'agent';
  if (['bot', 'system_bot', 'automacao', 'automação'].includes(key)) return 'bot';
  if (['system', 'sistema'].includes(key)) return 'system';
  return 'user';
};

const extensionSenderMeta = (raw = {}, normalizedSender = 'user') => {
  const allowedKinds = new Set(['customer', 'self_agent', 'other_agent', 'bot', 'system']);
  const fallbackKind = normalizedSender === 'user'
    ? 'customer'
    : normalizedSender === 'bot'
      ? 'bot'
      : normalizedSender === 'system'
        ? 'system'
        : 'self_agent';
  const requestedKind = pickString(raw.senderKind, raw.sender_kind).toLowerCase();
  const senderKind = allowedKinds.has(requestedKind) ? requestedKind : fallbackKind;
  const participantId = pickString(raw.senderParticipantId, raw.participantId);
  const userId = pickString(raw.senderUserId, raw.userId);
  return {
    senderKind,
    senderPurpose: pickString(raw.senderPurpose, raw.purpose).toLowerCase().slice(0, 40),
    senderParticipantId: GENESYS_UUID_RE.test(participantId) ? participantId : null,
    senderName: pickString(raw.senderName, raw.participantName).replace(/\s+/g, ' ').slice(0, 200) || null,
    senderUserId: GENESYS_UUID_RE.test(userId) ? userId : null,
  };
};

const toIsoFromTs = (ts, fallback = null) => {
  if (ts === undefined || ts === null || ts === '') {
    return fallback || new Date().toISOString();
  }
  if (typeof ts === 'number' && Number.isFinite(ts)) {
    // epoch seconds vs ms
    const ms = ts < 1e12 ? ts * 1000 : ts;
    const date = new Date(ms);
    return Number.isNaN(date.getTime()) ? (fallback || new Date().toISOString()) : date.toISOString();
  }
  const date = new Date(ts);
  return Number.isNaN(date.getTime()) ? (fallback || new Date().toISOString()) : date.toISOString();
};

const buildClienteVars = (cliente = {}) => {
  // Card: nomeWhatsapp / displayName (Genesys participant)
  // Infos: nomeIxc / fullName / nome → vars.nome_cliente
  let nomeWhatsapp = pickString(
    cliente.nomeWhatsapp,
    cliente.nome_whatsapp,
    cliente.displayName,
    cliente.channelName
  );
  // NÃO usar cliente.customerName aqui (pode ser lixo antigo)
  let nomeIxc = pickString(
    cliente.nomeIxc,
    cliente.nome_ixc,
    cliente.fullName
  );
  // `nome` só conta como IXC se for diferente do WhatsApp (ou se não houver WA)
  const nomeRaw = pickString(cliente.nome, cliente.name);
  if (!nomeIxc && nomeRaw && nomeRaw !== nomeWhatsapp) {
    nomeIxc = nomeRaw;
  } else if (!nomeIxc && nomeRaw && !nomeWhatsapp) {
    // só `nome` sem WA: se tem cpf/endereco, é IXC; senão é nome de canal
    if (cliente.cpf || cliente.endereco || cliente.address) nomeIxc = nomeRaw;
  }

  // Nunca deixar o card com o nome legal IXC
  if (nomeWhatsapp && nomeIxc && nomeWhatsapp === nomeIxc) {
    nomeWhatsapp = '';
  }

  const cpf = onlyDigits(pickString(cliente.cpf, cliente.document, cliente.documento));
  const endereco = pickString(cliente.endereco, cliente.address, cliente.endereço);
  const telefone = onlyDigits(pickString(cliente.telefone, cliente.phone, cliente.whatsapp, cliente.celular));
  const ativo = cliente.ativo === undefined ? null : Boolean(cliente.ativo);
  const filial = pickString(cliente.filial, cliente.branch, cliente.filialId);
  const cidade = pickString(cliente.cidade, cliente.city, cliente.municipio);
  const pppoe = pickString(cliente.pppoe, cliente.loginPppoe, cliente.login_pppoe);
  const ip = pickString(cliente.ip, cliente.ipv4, cliente.ipAddress);
  const contratoId = pickString(cliente.contratoId, cliente.contractId, cliente.idContrato, cliente.id_contrato);
  const olt = pickString(cliente.olt, cliente.oltName);
  const ponId = pickString(cliente.ponId, cliente.pon, cliente.ponLink, cliente.pon_link);
  const fonteDadosPrimarios = pickString(cliente.fonteDadosPrimarios, cliente.dataSource);

  const vars = {};
  if (nomeIxc) vars.nome_cliente = nomeIxc;
  if (cpf) vars.cpf = cpf;
  if (endereco) vars.endereco = endereco;
  if (telefone) vars.telefone = telefone;
  if (ativo !== null) vars.ativo = ativo ? 'sim' : 'nao';
  if (filial) vars.filial = filial;
  if (cidade) vars.cidade = cidade;
  if (pppoe) vars.pppoe = pppoe;
  if (ip) vars.ip = ip;
  if (contratoId) vars.contrato_id = contratoId;
  if (olt) vars.olt = olt;
  if (ponId) vars.pon_id = ponId;
  if (fonteDadosPrimarios) vars.fonte_dados_primarios = fonteDadosPrimarios;
  if (cliente.ixcData && typeof cliente.ixcData === 'object' && !Array.isArray(cliente.ixcData)) {
    try {
      const serialized = JSON.stringify(cliente.ixcData);
      if (serialized.length <= 250000) vars.ixc_dados = sanitizeIxcData(JSON.parse(serialized));
    } catch (_) {
      // Payload IXC inválido não impede a atualização dos campos básicos.
    }
  }
  return {
    vars,
    nomeIxc,
    nomeWhatsapp,
    cpf,
    endereco,
    telefone,
    ativo,
    filial,
    cidade,
    pppoe,
    ip,
    contratoId,
    olt,
    ponId,
    fonteDadosPrimarios
  };
};

/**
 * Card = só nome de canal/WhatsApp (Genesys participant).
 * Nunca grava nome IXC em customerName. Limpa se já estiver poluído.
 */
const applyClienteIdentity = (chat, { nomeWhatsapp, nomeIxc }, { allowNameUpdate = true } = {}) => {
  if (!chat) return;
  const ixc = nomeIxc ? String(nomeIxc).trim() : '';
  if (allowNameUpdate && nomeWhatsapp) {
    const wa = String(nomeWhatsapp).trim();
    if (wa && (!ixc || wa !== ixc)) {
      chat.customerName = wa;
      return;
    }
  }
  // Limpa card se está com o nome legal IXC
  if (ixc && chat.customerName && String(chat.customerName).trim() === ixc) {
    chat.customerName = null;
  }
};

const publicChat = (chat) => {
  if (!chat) return null;
  const { secureVars, secureVarNames, ...rest } = chat;
  return rest;
};

const emitToAgentPanel = (chat, eventName, payload) => {
  const io = getIo();
  if (!io || !chat?.tenantId) return;

  const roomTenant = `tenant:${chat.tenantId}`;
  io.to(roomTenant).emit(eventName, payload);

  if (chat.agentId) {
    io.to(`agent:${chat.agentId}`).emit(eventName, payload);
  }
};

const pickNewestChat = (rows = []) => {
  const list = Array.isArray(rows) ? rows.filter((c) => c && c.id) : [];
  if (!list.length) return null;
  return list.slice().sort((a, b) => {
    const ta = new Date(a.updatedAt || a.lastMessageAt || a.createdAt || 0).getTime();
    const tb = new Date(b.updatedAt || b.lastMessageAt || b.createdAt || 0).getTime();
    return (Number.isFinite(tb) ? tb : 0) - (Number.isFinite(ta) ? ta : 0);
  })[0];
};

const findChatByConvId = async ({ tenantId, convId, agentId = null }) => {
  if (!tenantId || !convId) return null;

  // Pode existir mais de 1 doc com o mesmo genesysConvId (re-upsert).
  // Sempre prefere o ABERTO mais recente — evita gravar msg no card “gêmeo” errado.
  const openQueries = [
    { tenantId, genesysConvId: convId, status: { $ne: 'closed' } },
    { tenantId, externalConvId: convId, status: { $ne: 'closed' } },
  ];
  if (agentId) {
    for (const q of openQueries) {
      const rows = await adapter.findMany('activeChats', {
        query: { ...q, agentId },
        projection: { _id: 0 },
        limit: 20,
      });
      const hit = pickNewestChat(rows);
      if (hit) return hit;
    }
  }
  for (const query of openQueries) {
    const rows = await adapter.findMany('activeChats', {
      query,
      projection: { _id: 0 },
      limit: 20,
    });
    const hit = pickNewestChat(rows);
    if (hit) return hit;
  }
  // Fechados só se não houver aberto (reabrir) — também o mais recente
  for (const query of [
    { tenantId, genesysConvId: convId },
    { tenantId, externalConvId: convId }
  ]) {
    const rows = await adapter.findMany('activeChats', {
      query,
      projection: { _id: 0 },
      limit: 20,
    });
    const hit = pickNewestChat(rows);
    if (hit) return hit;
  }
  return null;
};

const ensureAgentContext = (socket) => {
  const agentId = socket?.userId || null;
  const tenantId = socket?.tenantId || null;
  const agentName = socket?.userName || 'Agente';
  if (!agentId) {
    const err = new Error('Agente nao autenticado');
    err.code = 'AUTH';
    throw err;
  }
  if (!tenantId) {
    const err = new Error('Agente sem tenantId — use uma conta de agente do tenant');
    err.code = 'TENANT';
    throw err;
  }
  return { agentId, tenantId, agentName };
};

export const handleExtUpsert = async (socket, payload = {}) => {
  const { agentId, tenantId, agentName } = ensureAgentContext(socket);
  const convId = pickString(payload.convId, payload.conversationId, payload.id);
  if (!convId) {
    return { ok: false, error: 'convId obrigatorio' };
  }
  const communicationId = pickString(
    payload.communicationId,
    payload.genesysCommunicationId
  );
  const syncGeneration = pickString(payload.syncGeneration);
  if (communicationId && !GENESYS_UUID_RE.test(communicationId)) {
    return { ok: false, error: 'communicationId invalido' };
  }

  const { vars: clienteVars, nomeIxc, nomeWhatsapp, cpf, telefone } = buildClienteVars(payload.cliente || {});
  const statusRaw = pickString(payload.status, 'open').toLowerCase();
  const status = statusRaw === 'waiting' ? 'waiting' : 'open';
  const canal = pickString(payload.canal, payload.channel, 'genesys').toLowerCase() || 'genesys';
  const genesysMediaType = pickString(
    payload.genesysMediaType,
    payload.conversationType,
    payload.mediaType,
    payload.kind
  ).toLowerCase();
  const abertoEm = payload.abertoEm !== undefined
    ? toIsoFromTs(payload.abertoEm)
    : null;
  const now = new Date().toISOString();

  let chat = await findChatByConvId({ tenantId, convId, agentId });
  let created = false;

  // genesysConvId é chave imutável: se diverge, não reaproveita o doc
  if (chat) {
    const existingConv = pickString(chat.genesysConvId, chat.externalConvId);
    if (existingConv && existingConv !== convId) {
      chat = null;
    }
  }

  const ixcOnlyUpsert = payload.ixcOnly === true
    || payload.ixcOnly === 'true'
    || payload.ixcOnly === 1;
  const identityOnly = payload.identityOnly === true
    || payload.identityOnly === 'true';
  const freezeIdentity = payload.freezeIdentity === true
    || payload.freezeIdentity === 'true'
    || false;

  if (!chat || chat.status === 'closed') {
    created = true;
    const channelUserId = telefone || `genesys_${onlyDigits(convId).slice(-10) || convId.slice(-10)}`;
    const safeCardName = (!ixcOnlyUpsert && nomeWhatsapp && nomeWhatsapp !== nomeIxc)
      ? nomeWhatsapp
      : null;
    chat = {
      id: generateId('chat'),
      // Chave primária do espelho — não muda depois
      genesysConvId: convId,
      genesysCommunicationId: communicationId || null,
      genesysSyncGeneration: syncGeneration || null,
      externalConvId: convId,
      externalSource: 'genesys',
      customerCpf: cpf ? `cpf_${onlyDigits(cpf) || cpf}` : `gx_${channelUserId}`,
      customerName: safeCardName,
      customerPhone: (!ixcOnlyUpsert && telefone) ? telefone : null,
      status,
      messages: [],
      lastMessage: null,
      lastMessageAt: null,
      messageCount: 0,
      unreadByAgentCount: 0,
      vars: { ...clienteVars },
      variables: { ...clienteVars },
      tenantId,
      channel: canal,
      genesysMediaType: genesysMediaType || null,
      conversationType: genesysMediaType || null,
      channelUserId,
      channelChatId: channelUserId,
      currentNodeId: null,
      processedMessageIds: [],
      createdAt: abertoEm || now,
      updatedAt: now,
      secureVars: {},
      secureVarNames: [],
      flowStarted: false,
      resumeNodeId: null,
      resumePending: false,
      continueFlowAfterQueue: false,
      closedAt: null,
      queue: 'ATENDIMENTO',
      waitingSince: status === 'waiting' ? now : null,
      agentId: status === 'open' ? agentId : null,
      agentName: status === 'open' ? agentName : null,
      closeReason: null,
      // Plano bootstrap→freeze→live
      genesysMirrorPhase: 'bootstrapping',
      historySeeded: false,
      identityFrozen: !!(safeCardName || freezeIdentity),
    };
  } else {
    // UPDATE: genesysConvId já fixo — não reescreve para outro id
    if (!chat.genesysConvId) chat.genesysConvId = convId;
    if (!chat.externalConvId) chat.externalConvId = convId;
    if (communicationId) chat.genesysCommunicationId = communicationId;
    if (syncGeneration) chat.genesysSyncGeneration = syncGeneration;
    chat.externalSource = 'genesys';
    chat.channel = canal || chat.channel || 'genesys';
    if (genesysMediaType) {
      chat.genesysMediaType = genesysMediaType;
      chat.conversationType = genesysMediaType;
    }
    chat.updatedAt = now;

    // Vars IXC / extras: merge (não apaga)
    if (Object.keys(clienteVars).length) {
      chat.vars = { ...(chat.vars || {}), ...clienteVars };
      chat.variables = { ...(chat.variables || {}), ...clienteVars };
    }

    const idFrozen = chat.identityFrozen === true;
    if (ixcOnlyUpsert || identityOnly) {
      // não mexe em identidade de canal (ou só preenche se vazio)
      if (!idFrozen && nomeWhatsapp && !chat.customerName) {
        applyClienteIdentity(chat, { nomeWhatsapp, nomeIxc }, { allowNameUpdate: true });
      } else if (idFrozen) {
        applyClienteIdentity(chat, { nomeWhatsapp: '', nomeIxc }, { allowNameUpdate: false });
      }
    } else if (idFrozen) {
      // FREEZE: não troca nome/telefone/channel do card
      if (!chat.customerName && nomeWhatsapp) {
        applyClienteIdentity(chat, { nomeWhatsapp, nomeIxc }, { allowNameUpdate: true });
      } else {
        applyClienteIdentity(chat, { nomeWhatsapp: '', nomeIxc }, { allowNameUpdate: false });
      }
    } else {
      applyClienteIdentity(chat, { nomeWhatsapp, nomeIxc }, { allowNameUpdate: true });
      if (!ixcOnlyUpsert && telefone) {
        chat.customerPhone = telefone;
        if (!chat.channelUserId || String(chat.channelUserId).length < 8) {
          chat.channelUserId = telefone;
          chat.channelChatId = telefone;
        }
      }
    }

    if (cpf) {
      chat.customerCpf = `cpf_${onlyDigits(cpf) || cpf}`;
    }
    if (freezeIdentity || (nomeWhatsapp && chat.customerName)) {
      chat.identityFrozen = true;
    }
    if (!chat.genesysMirrorPhase || chat.genesysMirrorPhase === 'closed') {
      chat.genesysMirrorPhase = chat.historySeeded ? 'live' : 'bootstrapping';
    }

    if (status === 'open' || chat.status === 'open' || chat.status === 'waiting') {
      chat.status = status === 'waiting' ? 'waiting' : 'open';
      if (chat.status === 'open') {
        chat.agentId = agentId;
        chat.agentName = agentName;
        chat.waitingSince = null;
      } else {
        chat.agentId = null;
        chat.agentName = null;
        chat.waitingSince = chat.waitingSince || now;
      }
    }
  }

  await adapter.saveDocument('activeChats', chat);
  // identityOnly / ixcOnly: não hidrata 500 msgs (evita race e payload pesado)
  const light = identityOnly || ixcOnlyUpsert;
  const hydrated = light ? null : await hydrateChatWithMessages(chat, { limit: 500 });
  const pub = publicChat(hydrated || chat);

  emitToAgentPanel(chat, 'agent_assigned', { chat: pub });
  emitToAgentPanel(chat, 'chat_updated', { chat: pub });
  if (created) {
    emitToAgentPanel(chat, 'new_chat', { chat: pub });
  }

  return {
    ok: true,
    created,
    chatId: chat.id,
    convId,
    communicationId: chat.genesysCommunicationId || null,
    status: chat.status,
    historySeeded: !!chat.historySeeded,
    identityFrozen: !!chat.identityFrozen,
    genesysMirrorPhase: chat.genesysMirrorPhase || null,
  };
};

export const handleExtBackfill = async (socket, payload = {}) => {
  const { agentId, tenantId } = ensureAgentContext(socket);
  const convId = pickString(payload.convId, payload.conversationId);
  if (!convId) return { ok: false, error: 'convId obrigatorio' };

  const chat = await findChatByConvId({ tenantId, convId, agentId });
  if (!chat) return { ok: false, error: 'Atendimento nao encontrado — envie upsert antes do backfill' };
  if (chat.status === 'closed') return { ok: false, error: 'Atendimento ja encerrado' };
  const chatConv = pickString(chat.genesysConvId, chat.externalConvId);
  if (chatConv && chatConv !== convId) {
    return { ok: false, error: 'convId_mismatch', chatId: chat.id };
  }

  // Bootstrap único: não re-seed histórico (card/conversa não mudam mais)
  const snapshotId = pickString(payload.snapshotId, payload.eventId);
  const isReliableSnapshot = Boolean(snapshotId);
  const forceBackfill = isReliableSnapshot || payload.force === true || payload.force === 'true';
  if (isReliableSnapshot && chat.genesysSync?.lastSnapshotId === snapshotId) {
    return {
      ok: true,
      duplicate: true,
      snapshotId,
      chatId: chat.id,
      convId,
      storedMessageCount: Number(chat.genesysSync?.storedMessageCount || chat.messageCount || 0),
      acceptedMessageIds: Array.isArray(chat.genesysSync?.acceptedMessageIds) ? chat.genesysSync.acceptedMessageIds : [],
      messageSetHash: chat.genesysSync?.messageSetHash || null,
      complete: true,
    };
  }
  if (chat.historySeeded && !forceBackfill) {
    return {
      ok: true,
      skipped: true,
      reason: 'history_already_seeded',
      chatId: chat.id,
      convId,
      inserted: 0,
      skippedCount: 0,
    };
  }

  const list = Array.isArray(payload.mensagens)
    ? payload.mensagens
    : (Array.isArray(payload.messages) ? payload.messages : []);

  let inserted = 0;
  let skipped = 0;
  let liveChat = chat;
  const acceptedMessageIds = [];
  const {
    vars: snapshotClienteVars,
    cpf: snapshotCpf,
  } = buildClienteVars(payload.cliente || {});

  await withChatLock(chat.id, async () => {
    // re-lê sob lock e revalida convId
    liveChat = await adapter.findOne('activeChats', { id: chat.id }, { projection: { _id: 0 } }) || chat;
    const lockedConv = pickString(liveChat.genesysConvId, liveChat.externalConvId);
    if (lockedConv && lockedConv !== convId) {
      return;
    }
    if (Object.keys(snapshotClienteVars).length) {
      liveChat.vars = { ...(liveChat.vars || {}), ...snapshotClienteVars };
      liveChat.variables = { ...(liveChat.variables || {}), ...snapshotClienteVars };
    }
    if (snapshotCpf) liveChat.customerCpf = `cpf_${onlyDigits(snapshotCpf)}`;

    for (let index = 0; index < list.length; index += 1) {
      const entry = list[index];
      if (entry === undefined || entry === null) continue;

      let text = '';
      let sender = 'user';
      let messageId = null;
      let timestamp = null;
      let mediaRaw = null;

      if (typeof entry === 'string') {
        text = entry;
        messageId = `gx_bf_${convId}_${index}`;
      } else if (typeof entry === 'object') {
        text = pickString(entry.text, entry.message, entry.body, entry.content);
        sender = normalizeSender(entry.sender || entry.from || entry.role);
        messageId = pickString(entry.id, entry.messageId, entry.msgId) || `gx_bf_${convId}_${index}`;
        timestamp = entry.ts !== undefined ? entry.ts : (entry.timestamp || entry.createdAt);
        mediaRaw = entry.media || entry.attachment || null;
      }
      const sourceMessageId = String(messageId || '');
      const senderMeta = extensionSenderMeta(
        typeof entry === 'object' && entry ? entry : {},
        sender
      );

      const media = await normalizeExtensionMedia(mediaRaw, liveChat.tenantId || tenantId);
      if (!text && media) {
        text = media.caption || `[${media.type || 'mídia'}]`;
      }
      if (!text) continue;

      // messageId isolado por conversa (genesysConvId)
      let mid = messageId;
      if (!String(mid).includes(String(convId).slice(0, 12))) {
        mid = `${String(convId).slice(0, 36)}:${mid}`;
      }
      const result = await appendChatMessage(liveChat, {
        id: mid,
        messageId: mid,
        sender,
        text,
        media: media || null,
        timestamp: toIsoFromTs(timestamp),
        providerMessageId: mid,
        meta: {
          source: 'genesys',
          genesysMessageId: mid,
          genesysConvId: convId,
          ...senderMeta,
          ...(media?.mediaId ? { genesysMediaId: media.mediaId } : {})
        }
      }, { incrementUnread: sender === 'user' });

      liveChat = result.chat || liveChat;
      if (sourceMessageId) acceptedMessageIds.push(sourceMessageId);
      if (result.inserted) {
        inserted += 1;
        emitToAgentPanel(liveChat, 'new_message', {
          chatId: liveChat.id,
          message: result.message
        });
      } else {
        if (result.deliveryConfirmed && result.message?.id) {
          emitToAgentPanel(liveChat, 'message_delivery', {
            chatId: liveChat.id,
            messageId: result.message.id,
            providerMessageId: result.message.providerMessageId || null,
            deliveryStatus: 'sent',
            source: 'genesys_echo'
          });
        }
        // Um snapshot autoritativo também corrige a autoria de mensagens já
        // armazenadas (por exemplo, histórico que antes aparecia como "Você").
        await adapter.updateOne(
          'chatMessages',
          { chatId: liveChat.id, messageId: mid },
          {
            $set: {
              sender,
              'meta.senderKind': senderMeta.senderKind,
              'meta.senderPurpose': senderMeta.senderPurpose,
              'meta.senderParticipantId': senderMeta.senderParticipantId,
              'meta.senderName': senderMeta.senderName,
              'meta.senderUserId': senderMeta.senderUserId,
            }
          }
        ).catch(() => {});
        if (media?.url) {
          const existing = await adapter.findOne(
            'chatMessages',
            { chatId: liveChat.id, messageId: mid },
            { projection: { _id: 0 } }
          );
          const existingUrl = String(existing?.media?.url || '');
          const hasTemporaryGenesysUrl = /^https:\/\/api-downloads\.sae1\.pure\.cloud\//i.test(existingUrl);
          if (!existingUrl || hasTemporaryGenesysUrl) {
            await adapter.updateOne(
              'chatMessages',
              { chatId: liveChat.id, messageId: mid },
              {
                $set: {
                  text: text || existing?.text || `[${media.type || 'mídia'}]`,
                  media,
                  updatedAt: new Date().toISOString(),
                  'meta.genesysMediaId': media.mediaId || null
                }
              }
            );
          }
        }
        skipped += 1;
      }
    }

    liveChat.historySeeded = true;
    liveChat.genesysMirrorPhase = 'live';
    if (isReliableSnapshot) {
      liveChat.genesysSync = {
        ...(liveChat.genesysSync || {}),
        contractVersion: Number(payload.contractVersion || 1),
        lastSnapshotId: snapshotId,
        expectedMessageCount: Number(payload.expectedMessageCount ?? list.length),
        storedMessageCount: acceptedMessageIds.length,
        acceptedMessageIds,
        messageSetHash: pickString(payload.messageSetHash) || null,
        acknowledgedAt: new Date().toISOString(),
      };
    }
    liveChat.updatedAt = new Date().toISOString();
    await adapter.saveDocument('activeChats', liveChat);
  });

  // Preview do card = última msg real (não a 1ª do bootstrap)
  try {
    liveChat = await refreshChatMessageSummary(liveChat) || liveChat;
  } catch (err) {
    console.warn('[EXT_ATENDIMENTO] refresh summary fail', err?.message || err);
  }

  const hydrated = await hydrateChatWithMessages(liveChat, { limit: 500 });
  emitToAgentPanel(liveChat, 'agent_assigned', { chat: publicChat(hydrated || liveChat) });

  return {
    ok: true,
    chatId: chat.id,
    convId,
    inserted,
    skipped,
    snapshotId: snapshotId || null,
    expectedMessageCount: Number(payload.expectedMessageCount ?? list.length),
    storedMessageCount: acceptedMessageIds.length,
    acceptedMessageIds,
    messageSetHash: pickString(payload.messageSetHash) || null,
    complete: acceptedMessageIds.length === Number(payload.expectedMessageCount ?? list.length),
    historySeeded: true,
    genesysMirrorPhase: 'live',
  };
};

export const handleExtMensagem = async (socket, payload = {}) => {
  const { agentId, tenantId } = ensureAgentContext(socket);
  const convId = pickString(payload.convId, payload.conversationId);
  if (!convId) return { ok: false, error: 'convId obrigatorio' };

  const rawMsg = payload.mensagem || payload.message || payload;
  let text = pickString(rawMsg?.text, rawMsg?.message, rawMsg?.body, payload.text);
  let messageId = pickString(rawMsg?.id, rawMsg?.messageId, payload.id);
  const mediaRaw = rawMsg?.media || rawMsg?.attachment || payload.media || null;
  if (!messageId) return { ok: false, error: 'mensagem.id obrigatorio (dedup)' };

  // Isola id por conversa (evita colisão "dom_hash" entre chats)
  if (!String(messageId).includes(String(convId).slice(0, 12))) {
    messageId = `${String(convId).slice(0, 36)}:${messageId}`;
  }

  const chat = await findChatByConvId({ tenantId, convId });
  if (!chat) return { ok: false, error: 'Atendimento nao encontrado — envie upsert antes' };
  if (chat.status === 'closed') return { ok: false, error: 'Atendimento ja encerrado' };

  // Trava de isolamento: genesysConvId do doc DEVE bater com o payload
  const chatConv = pickString(chat.genesysConvId, chat.externalConvId);
  if (chatConv && chatConv !== convId) {
    console.warn('[EXT_ATENDIMENTO] convId mismatch', { chatConv, convId, chatId: chat.id });
    return { ok: false, error: 'convId_mismatch', chatId: chat.id };
  }
  // Agente dono (se já atribuído) deve ser o do socket
  if (chat.agentId && chat.agentId !== agentId) {
    return { ok: false, error: 'chat_de_outro_agente', chatId: chat.id };
  }

  const media = await normalizeExtensionMedia(mediaRaw, chat.tenantId || tenantId);
  if (!text && media) {
    text = media.caption || `[${media.type || 'mídia'}]`;
  }
  if (!text) return { ok: false, error: 'mensagem.text ou media obrigatorio' };

  const sender = normalizeSender(rawMsg?.sender || rawMsg?.from || payload.sender);
  const senderMeta = extensionSenderMeta(rawMsg, sender);
  const timestamp = toIsoFromTs(rawMsg?.ts ?? rawMsg?.timestamp ?? payload.ts);

  // Msg de AGENTE com id DOM = bolha residual de outro chat na tela Genesys.
  // Agente só entra via app (F4) ou bulk API (backfill com UUID Genesys real).
  const midStr = String(messageId || '');
  if (
    (sender === 'agent' || sender === 'agente')
    && (midStr.startsWith('dom_') || midStr.includes(':dom_'))
  ) {
    console.warn('[EXT_ATENDIMENTO] drop DOM agent message', {
      chatId: chat.id,
      convId: String(convId).slice(0, 8),
      text: String(text).slice(0, 40),
    });
    return {
      ok: true,
      skipped: true,
      reason: 'dom_agent_blocked',
      chatId: chat.id,
      convId,
      inserted: false,
      messageId,
    };
  }

  let result;
  await withChatLock(chat.id, async () => {
    // re-lê o chat sob lock para não appendar em doc trocado
    const live = await adapter.findOne('activeChats', { id: chat.id }, { projection: { _id: 0 } }) || chat;
    const liveConv = pickString(live.genesysConvId, live.externalConvId);
    if (liveConv && liveConv !== convId) {
      result = { inserted: false, chat: live };
      return;
    }
    // provider = id Genesys “cru” (sem prefixo convId:) p/ casar com cmd:resultado / eco
    const rawGenesysId = String(messageId).includes(':')
      ? String(messageId).split(':').slice(1).join(':')
      : String(messageId);
    result = await appendChatMessage(live, {
      id: messageId,
      messageId,
      sender,
      text,
      media: media || null,
      timestamp,
      providerMessageId: rawGenesysId,
      meta: {
        source: 'genesys',
        genesysMessageId: rawGenesysId,
        genesysConvId: convId,
        ...senderMeta,
        ...(media?.mediaId ? { genesysMediaId: media.mediaId } : {})
      }
    }, { incrementUnread: sender === 'user' });
  });

  if (result?.inserted) {
    // marca fase live no doc (append-only após bootstrap)
    try {
      const updated = result.chat || chat;
      if (updated && updated.genesysMirrorPhase !== 'live') {
        updated.genesysMirrorPhase = 'live';
        if (updated.historySeeded !== true && updated.messageCount > 0) {
          // se entrou msg live sem seed formal, ainda assim congela histórico parcial
          updated.historySeeded = updated.historySeeded || false;
        }
        await adapter.saveDocument('activeChats', updated);
      }
    } catch (_) {}
    emitToAgentPanel(result.chat || chat, 'new_message', {
      chatId: chat.id,
      message: result.message
    });
  } else if (result?.deliveryConfirmed && result?.message?.id) {
    emitToAgentPanel(result.chat || chat, 'message_delivery', {
      chatId: chat.id,
      messageId: result.message.id,
      providerMessageId: result.message.providerMessageId || null,
      deliveryStatus: 'sent',
      source: 'genesys_echo'
    });
  }

  return {
    ok: true,
    chatId: chat.id,
    convId,
    inserted: Boolean(result?.inserted),
    messageId
  };
};

export const handleExtCliente = async (socket, payload = {}) => {
  const { agentId, tenantId } = ensureAgentContext(socket);
  const convId = pickString(payload.convId, payload.conversationId);
  if (!convId) return { ok: false, error: 'convId obrigatorio' };

  const chat = await findChatByConvId({ tenantId, convId, agentId });
  if (!chat) return { ok: false, error: 'Atendimento nao encontrado' };
  const chatConvCli = pickString(chat.genesysConvId, chat.externalConvId);
  if (chatConvCli && chatConvCli !== convId) {
    return { ok: false, error: 'convId_mismatch', chatId: chat.id };
  }

  const ixcOnly = payload.ixcOnly === true
    || payload.ixcOnly === 'true'
    || payload.ixcOnly === 1;
  const { vars: clienteVars, nomeWhatsapp, nomeIxc, telefone, cpf } = buildClienteVars(payload.cliente || {});
  if (!Object.keys(clienteVars).length && !nomeWhatsapp) {
    return { ok: false, error: 'cliente sem campos uteis' };
  }

  // Sempre mergeia vars IXC (nome_cliente, cpf, endereco, …) — não mexe em mensagens
  chat.vars = { ...(chat.vars || {}), ...clienteVars };
  chat.variables = { ...(chat.variables || {}), ...clienteVars };
  if (payload.cliente?.ixcData && typeof payload.cliente.ixcData === 'object' && !Array.isArray(payload.cliente.ixcData)) {
    try {
      const serializedIxcData = JSON.stringify(payload.cliente.ixcData);
      if (serializedIxcData.length <= 250000) {
        const incomingIxcData = sanitizeIxcData(JSON.parse(serializedIxcData));
        chat.ixcData = payload.ixcMerge === true
          ? { ...(chat.ixcData || {}), ...incomingIxcData }
          : incomingIxcData;
        if (payload.ixcMerge === true) {
          chat.vars.ixc_dados = chat.ixcData;
          chat.variables.ixc_dados = chat.ixcData;
        }
      }
    } catch (_) {
      // Mantém o último resultado válido se o payload detalhado vier corrompido.
    }
  }

  // ixcOnly / identityFrozen: NUNCA altera customerName / phone do card
  if (ixcOnly || chat.identityFrozen) {
    applyClienteIdentity(chat, { nomeWhatsapp: '', nomeIxc }, { allowNameUpdate: false });
  } else {
    applyClienteIdentity(chat, { nomeWhatsapp, nomeIxc }, { allowNameUpdate: true });
    if (telefone && String(telefone).replace(/\D/g, '').length >= 10) {
      chat.customerPhone = telefone;
    }
    if (nomeWhatsapp && chat.customerName) chat.identityFrozen = true;
  }

  if (cpf) chat.customerCpf = `cpf_${onlyDigits(cpf) || cpf}`;
  chat.updatedAt = new Date().toISOString();

  await adapter.saveDocument('activeChats', chat);
  // NÃO hidratar 200 msgs só pra update de CPF — evita payload pesado e race de troca de chat
  const pub = publicChat(chat);
  emitToAgentPanel(chat, 'chat_updated', { chat: pub });
  // agent_assigned leve (sem reordenar histórico)
  emitToAgentPanel(chat, 'agent_assigned', { chat: pub });

  return {
    ok: true,
    chatId: chat.id,
    convId,
    vars: chat.vars,
    customerName: chat.customerName,
    ixcOnly,
  };
};

export const handleExtEncerrar = async (socket, payload = {}) => {
  const { agentId, tenantId } = ensureAgentContext(socket);
  const convId = pickString(payload.convId, payload.conversationId);
  if (!convId) return { ok: false, error: 'convId obrigatorio' };

  const notifyClosed = ({ chatId = null, motivo = 'genesys_agente', missing = false } = {}) => {
    const io = getIo();
    if (!io) return;
    const event = {
      chatId,
      convId,
      motivo,
      missing,
      source: 'genesys_extension'
    };
    io.to(`tenant:${tenantId}`).emit('chat_closed', event);
    if (agentId) io.to(`agent:${agentId}`).emit('chat_closed', event);
  };

  const chat = await findChatByConvId({ tenantId, convId, agentId });
  if (!chat) {
    notifyClosed({
      motivo: pickString(payload.motivo, payload.reason, 'genesys_ausente'),
      missing: true
    });
    return { ok: true, chatId: null, convId, missing: true };
  }
  const chatConvEnd = pickString(chat.genesysConvId, chat.externalConvId);
  if (chatConvEnd && chatConvEnd !== convId) {
    return { ok: false, error: 'convId_mismatch', chatId: chat.id };
  }
  if (chat.status === 'closed') {
    notifyClosed({
      chatId: chat.id,
      motivo: pickString(payload.motivo, payload.reason, chat.closeReason, 'genesys_agente')
    });
    return { ok: true, chatId: chat.id, convId, alreadyClosed: true };
  }

  const motivo = pickString(payload.motivo, payload.reason, 'genesys_agente');
  const now = new Date().toISOString();

  await withChatLock(chat.id, async () => {
    const live = await adapter.findOne('activeChats', { id: chat.id }, { projection: { _id: 0 } }) || chat;
    if (live.status === 'closed') return;
    live.status = 'closed';
    live.closedAt = now;
    live.updatedAt = now;
    live.closeReason = motivo;
    if (payload.wrapupCode) {
      live.genesysWrapup = {
        code: pickString(payload.wrapupCode),
        name: pickString(payload.wrapupName),
        confirmedAt: now
      };
    }
    live.waitingSince = null;
    live.outreachPendingReply = false;
    live.genesysMirrorPhase = 'closed';
    await adapter.saveDocument('activeChats', live);
  });

  notifyClosed({ chatId: chat.id, motivo });

  return { ok: true, chatId: chat.id, convId, motivo };
};

// ─── Fase 4: app → extensão ─────────────────────────────────────────────────

export const isExtensionSocket = (socket) => {
  const raw = pickString(
    socket?.handshake?.auth?.client,
    socket?.handshake?.auth?.source,
    socket?.handshake?.query?.client,
    socket?.clientKind
  ).toLowerCase();
  return EXTENSION_CLIENT_KINDS.has(raw);
};

export const countExtensionSockets = async (agentId) => {
  const io = getIo();
  if (!io || !agentId) return 0;
  try {
    const sockets = await io.in(extensionRoomForAgent(agentId)).fetchSockets();
    return Array.isArray(sockets) ? sockets.length : 0;
  } catch {
    return 0;
  }
};

/**
 * Emite comando para a(s) extensao(oes) do agente.
 * Nao envia para o browser do painel — so room agent:{id}:extension.
 */
export const emitCmdToExtension = async (agentId, eventName, payload = {}) => {
  const io = getIo();
  if (!io || !agentId) {
    console.warn('[GENESYS F4] emitCmd fail: no_io_or_agent', { agentId, eventName });
    return { ok: false, relayed: false, reason: 'no_io_or_agent', listeners: 0 };
  }
  const listeners = await countExtensionSockets(agentId);
  if (listeners <= 0) {
    console.warn('[GENESYS F4] emitCmd fail: extension_offline', {
      agentId,
      eventName,
      room: extensionRoomForAgent(agentId),
    });
    return { ok: false, relayed: false, reason: 'extension_offline', listeners: 0 };
  }
  console.log('[GENESYS F4] emitCmd → extension', {
    agentId,
    eventName,
    listeners,
    convId: payload?.convId || payload?.conversationId || null,
    textLen: payload?.text ? String(payload.text).length : 0,
  });
  io.to(extensionRoomForAgent(agentId)).emit(eventName, payload);
  return { ok: true, relayed: true, reason: null, listeners };
};

export const emitCmdToExtensionWithAck = async (agentId, eventName, payload = {}, timeoutMs = 15000) => {
  const io = getIo();
  if (!io || !agentId) return { ok: false, reason: 'no_io_or_agent' };
  const listeners = await countExtensionSockets(agentId);
  if (listeners <= 0) return { ok: false, reason: 'extension_offline' };
  return new Promise((resolve) => {
    io.timeout(timeoutMs).to(extensionRoomForAgent(agentId)).emit(eventName, payload, (error, responses = []) => {
      const response = responses.find((item) => item?.ok === true) || responses[0];
      if (response && typeof response === 'object') resolve(response);
      else if (error) resolve({ ok: false, reason: 'extension_timeout', error: error.message || 'timeout' });
      else resolve({ ok: false, reason: 'invalid_extension_ack' });
    });
  });
};

export const relayGenesysWrapupCodes = async ({ chat, agentId = null } = {}) => {
  if (!isGenesysChat(chat)) return { ok: false, reason: 'not_genesys' };
  const convId = resolveGenesysConvId(chat);
  const targetAgentId = agentId || chat.agentId || null;
  if (!convId) return { ok: false, reason: 'missing_convId' };
  if (!targetAgentId) return { ok: false, reason: 'missing_agentId' };
  return emitCmdToExtensionWithAck(targetAgentId, 'cmd:listar_tabulacoes', {
    convId, chatId: chat.id, agentId: targetAgentId, ts: Date.now()
  });
};

export const relayFinalizeGenesysWithWrapup = async ({
  chat, agentId = null, wrapupCode, wrapupName = '', notes = ''
} = {}) => {
  if (!isGenesysChat(chat)) return { ok: false, reason: 'not_genesys' };
  const convId = resolveGenesysConvId(chat);
  const targetAgentId = agentId || chat.agentId || null;
  if (!convId) return { ok: false, reason: 'missing_convId' };
  if (!targetAgentId) return { ok: false, reason: 'missing_agentId' };
  if (!GENESYS_UUID_RE.test(String(wrapupCode || ''))) return { ok: false, reason: 'wrapup_code_invalid' };
  return emitCmdToExtensionWithAck(targetAgentId, 'cmd:finalizar_com_tabulacao', {
    convId,
    chatId: chat.id,
    wrapupCode: String(wrapupCode),
    wrapupName: pickString(wrapupName),
    notes: String(notes || '').slice(0, 1000),
    agentId: targetAgentId,
    ts: Date.now()
  }, 25000);
};

/**
 * App → extensão: enviar texto no Genesys.
 */
export const relayAgentMessageToGenesys = async ({
  chat,
  message,
  agentId = null,
  agentName = null,
  replyTo = null
} = {}) => {
  if (!isGenesysChat(chat)) {
    return { ok: true, skipped: true, reason: 'not_genesys' };
  }
  const convId = resolveGenesysConvId(chat);
  if (!convId) {
    return { ok: false, relayed: false, reason: 'missing_convId' };
  }
  const targetAgentId = agentId || chat.agentId || null;
  if (!targetAgentId) {
    return { ok: false, relayed: false, reason: 'missing_agentId' };
  }

  const payload = {
    commandId: generateId('gcmd'),
    convId,
    communicationId: pickString(chat.genesysCommunicationId) || null,
    expectedGeneration: pickString(chat.genesysSyncGeneration) || null,
    chatId: chat.id,
    messageId: message?.id || message?.messageId || null,
    text: String(message?.text || ''),
    ts: message?.timestamp ? new Date(message.timestamp).getTime() : Date.now(),
    agentId: targetAgentId,
    agentName: agentName || chat.agentName || null,
    replyTo: replyTo || message?.replyTo || null
  };
  payload.createdAt = Date.now();
  payload.expiresAt = payload.createdAt + 30000;

  if (!payload.expectedGeneration) {
    return { ok: false, relayed: false, reason: 'missing_sync_generation' };
  }

  if (!payload.text.trim()) {
    return { ok: false, relayed: false, reason: 'empty_text' };
  }

  const result = await emitCmdToExtensionWithAck(
    targetAgentId,
    'cmd:enviar_mensagem',
    payload,
    35000
  );
  const confirmed = result?.ok === true;
  return {
    ...result,
    confirmed,
    relayed: confirmed,
    reason: confirmed ? null : pickString(result?.reason, result?.error, 'genesys_send_failed'),
    convId,
    messageId: payload.messageId
  };
};

/**
 * App → extensão: enviar anexo no Genesys usando o upload web autenticado.
 * O binário não trafega pelo Socket.IO: a extensão baixa o arquivo do
 * servidor Onion local e o envia diretamente para a URL assinada da Genesys.
 */
export const relayAgentMediaToGenesys = async ({
  chat,
  message,
  agentId = null,
  agentName = null
} = {}) => {
  if (!isGenesysChat(chat)) {
    return { ok: true, skipped: true, reason: 'not_genesys' };
  }
  const convId = resolveGenesysConvId(chat);
  if (!convId) {
    return { ok: false, relayed: false, reason: 'missing_convId' };
  }
  const targetAgentId = agentId || chat.agentId || null;
  if (!targetAgentId) {
    return { ok: false, relayed: false, reason: 'missing_agentId' };
  }

  const media = message?.media && typeof message.media === 'object'
    ? message.media
    : {};
  const mediaUrl = pickString(media.url, media.mediaUrl);
  const fileName = pickString(media.fileName, media.filename, 'arquivo');
  const mimeType = pickString(media.mimeType, media.mime, 'application/octet-stream');
  const contentLengthBytes = Number.parseInt(media.contentLengthBytes, 10);
  if (!mediaUrl) {
    return { ok: false, relayed: false, reason: 'missing_media_url' };
  }
  if (!Number.isFinite(contentLengthBytes) || contentLengthBytes <= 0) {
    return { ok: false, relayed: false, reason: 'invalid_media_size' };
  }

  const payload = {
    commandId: generateId('gmedia'),
    convId,
    communicationId: pickString(chat.genesysCommunicationId) || null,
    expectedGeneration: pickString(chat.genesysSyncGeneration) || null,
    chatId: chat.id,
    messageId: message?.id || message?.messageId || null,
    mediaUrl,
    fileName,
    mimeType,
    mediaType: pickString(media.type, 'document'),
    contentLengthBytes,
    caption: String(media.caption || '').slice(0, 2000),
    ts: message?.timestamp ? new Date(message.timestamp).getTime() : Date.now(),
    agentId: targetAgentId,
    agentName: agentName || chat.agentName || null
  };
  payload.createdAt = Date.now();
  payload.expiresAt = payload.createdAt + (2 * 60 * 1000);

  if (!payload.expectedGeneration) {
    return { ok: false, relayed: false, reason: 'missing_sync_generation' };
  }

  const result = await emitCmdToExtensionWithAck(
    targetAgentId,
    'cmd:enviar_midia',
    payload,
    125000
  );
  const confirmed = result?.ok === true;
  return {
    ...result,
    confirmed,
    relayed: confirmed,
    reason: confirmed ? null : pickString(result?.reason, result?.error, 'genesys_media_send_failed'),
    convId,
    messageId: payload.messageId
  };
};

/**
 * App → extensão: hydrate/sync conversa Genesys (histórico 1× ou deltas).
 * Não exige foco da aba no Genesys — só extensão + token + convId.
 */
export const relayHydrateGenesys = async ({
  chat,
  agentId = null,
  force = false,
  watch = true,
} = {}) => {
  if (!isGenesysChat(chat)) {
    return { ok: false, relayed: false, reason: 'not_genesys' };
  }
  const convId = resolveGenesysConvId(chat);
  if (!convId) {
    return { ok: false, relayed: false, reason: 'missing_convId' };
  }
  const targetAgentId = agentId || chat.agentId || null;
  if (!targetAgentId) {
    return { ok: false, relayed: false, reason: 'missing_agentId' };
  }
  const payload = {
    convId,
    chatId: chat.id,
    force: Boolean(force),
    watch: watch !== false,
    historySeeded: Boolean(chat.historySeeded),
    ts: Date.now(),
    agentId: targetAgentId,
  };
  const result = await emitCmdToExtension(targetAgentId, 'cmd:hydrate_conversa', payload);
  return { ...result, convId };
};

/**
 * App → extensão: busca manual no IXC/ZAAZ (não automática ao cair cliente).
 */
export const relayBuscarIxc = async ({
  chat,
  agentId = null,
  cpf = null,
} = {}) => {
  if (!isGenesysChat(chat)) {
    return { ok: false, relayed: false, reason: 'not_genesys' };
  }
  const convId = resolveGenesysConvId(chat);
  if (!convId) {
    return { ok: false, relayed: false, reason: 'missing_convId' };
  }
  const targetAgentId = agentId || chat.agentId || null;
  if (!targetAgentId) {
    return { ok: false, relayed: false, reason: 'missing_agentId' };
  }
  const cpfDigits = onlyDigits(
    cpf
    || chat?.vars?.cpf
    || chat?.variables?.cpf
    || ''
  );
  const payload = {
    convId,
    chatId: chat.id,
    cpf: cpfDigits || null,
    documentType: cpfDigits && cpfDigits.length === 14 ? 'CNPJ' : (cpfDigits ? 'CPF' : null),
    ts: Date.now(),
    agentId: targetAgentId,
  };
  const result = await emitCmdToExtension(targetAgentId, 'cmd:buscar_ixc', payload);
  return { ...result, convId, cpf: payload.cpf };
};

export const relayRefreshIxcLogins = async ({ chat, agentId = null } = {}) => {
  if (!isGenesysChat(chat)) {
    return { ok: false, relayed: false, reason: 'not_genesys' };
  }
  const convId = resolveGenesysConvId(chat);
  const targetAgentId = agentId || chat.agentId || null;
  const clientId = pickString(chat?.ixcData?.clientId, chat?.vars?.ixc_dados?.clientId);
  if (!convId) return { ok: false, relayed: false, reason: 'missing_convId' };
  if (!targetAgentId) return { ok: false, relayed: false, reason: 'missing_agentId' };
  if (!clientId) return { ok: false, relayed: false, reason: 'missing_ixc_clientId' };

  const payload = {
    convId,
    chatId: chat.id,
    clientId,
    ts: Date.now(),
    agentId: targetAgentId,
  };
  const result = await emitCmdToExtension(targetAgentId, 'cmd:refresh_ixc_logins', payload);
  return { ...result, convId, clientId };
};

export const relayIxcOs = async ({ chat, agentId = null, operation = {} } = {}) => {
  if (!isGenesysChat(chat)) return { ok: false, relayed: false, reason: 'not_genesys' };
  const convId = resolveGenesysConvId(chat);
  const targetAgentId = agentId || chat.agentId || null;
  if (!convId) return { ok: false, relayed: false, reason: 'missing_convId' };
  if (!targetAgentId) return { ok: false, relayed: false, reason: 'missing_agentId' };
  const payload = {
    ...operation,
    convId,
    chatId: chat.id,
    cpf: onlyDigits(operation.cpf || chat?.ixcData?.cpf || chat?.vars?.cpf || chat?.variables?.cpf || ''),
    clientId: pickString(operation.clientId, chat?.ixcData?.clientId),
    requestId: pickString(operation.requestId, generateId('ixc_os')),
    agentId: targetAgentId,
    ts: Date.now()
  };
  const result = await emitCmdToExtension(targetAgentId, 'cmd:ixc_os', payload);
  return { ...result, convId, requestId: payload.requestId };
};

/**
 * App → extensão: encerrar conversa no Genesys.
 */
export const relayAgentCloseToGenesys = async ({
  chat,
  agentId = null,
  motivo = 'app_agente',
  silent = false
} = {}) => {
  if (!isGenesysChat(chat)) {
    return { ok: true, skipped: true, reason: 'not_genesys' };
  }
  const convId = resolveGenesysConvId(chat);
  if (!convId) {
    return { ok: false, relayed: false, reason: 'missing_convId' };
  }
  const targetAgentId = agentId || chat.agentId || null;
  if (!targetAgentId) {
    return { ok: false, relayed: false, reason: 'missing_agentId' };
  }

  const payload = {
    convId,
    chatId: chat.id,
    motivo: pickString(motivo, 'app_agente'),
    silent: silent === true,
    agentId: targetAgentId,
    ts: Date.now()
  };

  const result = await emitCmdToExtension(targetAgentId, 'cmd:encerrar', payload);
  return { ...result, convId };
};

/**
 * Extensão → app: resultado de um comando (ack).
 * Atualiza delivery da mensagem quando enviar_mensagem ok + genesysMessageId.
 */
export const handleCmdResultado = async (socket, payload = {}) => {
  const { agentId, tenantId } = ensureAgentContext(socket);
  const cmd = pickString(payload.cmd, payload.command).toLowerCase();
  const ok = payload.ok !== false;
  const convId = pickString(payload.convId, payload.conversationId);
  const chatId = pickString(payload.chatId);
  const messageId = pickString(payload.messageId, payload.appMessageId);
  const genesysMessageId = pickString(
    payload.genesysMessageId,
    payload.providerMessageId,
    payload.externalMessageId
  );
  const error = pickString(payload.error, payload.message) || null;

  let chat = null;
  if (chatId) {
    chat = await adapter.findOne('activeChats', { id: chatId }, { projection: { _id: 0 } });
  }
  if (!chat && convId) {
    chat = await findChatByConvId({ tenantId, convId });
  }

  const isSendCommand = [
    'enviar_mensagem', 'enviar', 'send_message',
    'enviar_midia', 'enviar_media', 'send_media'
  ].includes(cmd);
  if (isSendCommand) {
    if (ok && chat?.id && messageId) {
      const now = new Date().toISOString();
      const deliveryPatch = {
        deliveryStatus: 'sent',
        deliveryStatusAt: now,
        ...(genesysMessageId ? {
          providerMessageId: genesysMessageId,
          'meta.providerMessageId': genesysMessageId,
          'meta.deliveryStatus': 'sent',
          'meta.deliveryStatusAt': now,
          'meta.source': 'genesys'
        } : {})
      };

      try {
        await adapter.updateOne(
          'chatMessages',
          { chatId: chat.id, messageId },
          { $set: deliveryPatch }
        );
      } catch (err) {
        console.warn('[EXT_CMD] falha ao atualizar delivery da mensagem', err?.message || err);
      }

      const io = getIo();
      if (io && chat.tenantId) {
        io.to(`tenant:${chat.tenantId}`).emit('message_delivery', {
          chatId: chat.id,
          messageId,
          providerMessageId: genesysMessageId || null,
          deliveryStatus: 'sent',
          source: 'genesys'
        });
        if (agentId) {
          io.to(`agent:${agentId}`).emit('message_delivery', {
            chatId: chat.id,
            messageId,
            providerMessageId: genesysMessageId || null,
            deliveryStatus: 'sent',
            source: 'genesys'
          });
        }
      }
    }

    if (!ok) {
      console.warn('[EXT_CMD] comando de envio falhou na extensao', {
        agentId,
        convId,
        messageId,
        error
      });
      const failedAt = new Date().toISOString();
      if (chat?.id && messageId) {
        try {
          await adapter.updateOne(
            'chatMessages',
            { chatId: chat.id, messageId },
            {
              $set: {
                deliveryStatus: 'failed',
                deliveryStatusAt: failedAt,
                'meta.deliveryStatus': 'failed',
                'meta.deliveryStatusAt': failedAt,
                'meta.deliveryErrors': error || 'genesys_send_failed',
                'meta.source': 'genesys'
              }
            }
          );
        } catch (err) {
          console.warn('[EXT_CMD] falha ao marcar mensagem como failed', err?.message || err);
        }
      }
      const io = getIo();
      if (io && agentId) {
        io.to(`agent:${agentId}`).emit('message_delivery', {
          chatId: chat?.id || chatId || null,
          messageId,
          deliveryStatus: 'failed',
          deliveryStatusAt: failedAt,
          error,
          source: 'genesys'
        });
        io.to(`agent:${agentId}`).emit('genesys_cmd_failed', {
          cmd: ['enviar_midia', 'enviar_media', 'send_media'].includes(cmd)
            ? 'enviar_midia'
            : 'enviar_mensagem',
          convId,
          chatId: chat?.id || chatId || null,
          messageId,
          error
        });
      }
    }
  }

  if ((cmd === 'encerrar' || cmd === 'close') && !ok) {
    console.warn('[EXT_CMD] encerrar falhou na extensao', { agentId, convId, error });
    const io = getIo();
    if (io && agentId) {
      io.to(`agent:${agentId}`).emit('genesys_cmd_failed', {
        cmd: 'encerrar',
        convId,
        chatId: chat?.id || chatId || null,
        error
      });
    }
  }

  if (cmd === 'ixc_os') {
    const io = getIo();
    if (io && agentId) {
      io.to(`agent:${agentId}`).emit('genesys_cmd_result', {
        cmd: 'ixc_os',
        ok,
        convId,
        chatId: chat?.id || chatId || null,
        requestId: pickString(payload.requestId) || null,
        selectedOsId: pickString(payload.selectedOsId) || null,
        os2Id: pickString(payload.os2Id) || null,
        finalizedOnly: payload.finalizedOnly === true,
        attachments: Array.isArray(payload.attachments) ? payload.attachments.slice(0, 12) : [],
        attachedCount: Number(payload.attachedCount || 0),
        attachmentFailedCount: Number(payload.attachmentFailedCount || 0),
        error
      });
    }
  }

  return {
    ok: true,
    received: true,
    cmd: cmd || null,
    convId: convId || null,
    messageId: messageId || null
  };
};

/**
 * Registra handlers no socket autenticado.
 * - Todos os agentes: podem receber cmds se forem extensão (room dedicada).
 * - Extensão emite ext:atendimento:* e cmd:resultado.
 * Ack opcional em todos os handlers.
 */
export const registerExtensionAtendimentoHandlers = (socket) => {
  const wrap = (handler, eventName) => async (payload, ack) => {
    try {
      const result = await handler(socket, payload || {});
      if (typeof ack === 'function') ack(result);
      if (result && result.ok === false) {
        console.warn(`[EXT_ATENDIMENTO] ${eventName}:`, result.error || result);
      }
      return result;
    } catch (error) {
      const result = {
        ok: false,
        error: error?.message || 'Falha no handler da extensao',
        code: error?.code || 'INTERNAL'
      };
      console.error(`[EXT_ATENDIMENTO] ${eventName} falhou`, error);
      if (typeof ack === 'function') ack(result);
      socket.emit('ext:atendimento:error', { event: eventName, ...result });
      return result;
    }
  };

  // Extensão → app (fase 1–3)
  socket.on('ext:atendimento:upsert', wrap(handleExtUpsert, 'upsert'));
  socket.on('ext:atendimento:backfill', wrap(handleExtBackfill, 'backfill'));
  socket.on('ext:atendimento:mensagem', wrap(handleExtMensagem, 'mensagem'));
  socket.on('ext:atendimento:cliente', wrap(handleExtCliente, 'cliente'));
  socket.on('ext:atendimento:encerrar', wrap(handleExtEncerrar, 'encerrar'));

  // Extensão → app (fase 4 ack)
  socket.on('cmd:resultado', wrap(handleCmdResultado, 'cmd:resultado'));
  socket.on('ext:cmd:resultado', wrap(handleCmdResultado, 'ext:cmd:resultado'));

  // Registro explicito (opcional) — reforça room da extensao
  socket.on('ext:register', (payload = {}, ack) => {
    const kind = pickString(payload.client, payload.source, 'genesys-extension').toLowerCase();
    socket.clientKind = kind;
    if (socket.userId && (EXTENSION_CLIENT_KINDS.has(kind) || isExtensionSocket(socket))) {
      socket.join(extensionRoomForAgent(socket.userId));
      socket.isGenesysExtension = true;
    }
    const result = {
      ok: true,
      registered: Boolean(socket.isGenesysExtension),
      room: socket.userId ? extensionRoomForAgent(socket.userId) : null
    };
    if (typeof ack === 'function') ack(result);
  });
};

