const TOOL_VERSION = "0.3.0";
const STORAGE_PREFIX = "onionCallDiagnostic:";
const MAX_EVENTS = 4000;
const MAX_CAPTURE_BYTES = 4 * 1024 * 1024;
const MAX_CAPTURE_MS = 20 * 60 * 1000;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const UUID_GLOBAL_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/ig;
const TECH_ID_RE = /^[a-zA-Z0-9_-]{8,160}$/;
const EVENT_HEARTBEAT_MS = 5000;
const mutationChains = new Map();

function storageKey(tabId) {
  return `${STORAGE_PREFIX}${tabId}`;
}

function cleanId(value) {
  const text = String(value || "").trim();
  return UUID_RE.test(text) ? text : "";
}

function cleanText(value, max = 100) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, max);
}

function cleanTechnicalId(value) {
  const text = String(value || "").trim();
  return TECH_ID_RE.test(text) ? text : "";
}

function cleanTime(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const text = cleanText(value, 50);
  return /^\d{4}-\d{2}-\d{2}T/.test(text) ? text : "";
}

function cleanKeys(value) {
  return [...new Set((Array.isArray(value) ? value : [])
    .map((item) => cleanText(item, 80))
    .filter((item) => /^[a-zA-Z0-9_.:-]+$/.test(item)))]
    .slice(0, 80)
    .sort();
}

function sanitizeSegment(segment = {}) {
  return {
    segmentType: cleanText(segment.segmentType, 40).toLowerCase(),
    disconnectType: cleanText(segment.disconnectType, 60).toLowerCase(),
    startTime: cleanTime(segment.startTime),
    endTime: cleanTime(segment.endTime),
    conference: segment.conference === true,
    keys: cleanKeys(segment.keys)
  };
}

function sanitizeCall(call = {}) {
  return {
    id: cleanId(call.id),
    state: cleanText(call.state, 40).toLowerCase(),
    initialState: cleanText(call.initialState, 40).toLowerCase(),
    direction: cleanText(call.direction, 30).toLowerCase(),
    held: call.held === true,
    startTime: cleanTime(call.startTime),
    connectedTime: cleanTime(call.connectedTime),
    disconnectedTime: cleanTime(call.disconnectedTime),
    endTime: cleanTime(call.endTime),
    provider: cleanText(call.provider, 60),
    peerId: cleanId(call.peerId),
    segments: (Array.isArray(call.segments) ? call.segments : []).slice(0, 50).map(sanitizeSegment),
    keys: cleanKeys(call.keys)
  };
}

function sanitizeMessageReference(reference = {}) {
  return {
    id: cleanTechnicalId(reference.id || reference.messageId),
    timestamp: cleanTime(reference.timestamp),
    keys: cleanKeys(reference.keys)
  };
}

function sanitizeMessageCommunication(communication = {}) {
  return {
    id: cleanId(communication.id),
    state: cleanText(communication.state, 40).toLowerCase(),
    initialState: cleanText(communication.initialState, 40).toLowerCase(),
    direction: cleanText(communication.direction, 30).toLowerCase(),
    held: communication.held === true,
    startTime: cleanTime(communication.startTime),
    connectedTime: cleanTime(communication.connectedTime),
    disconnectedTime: cleanTime(communication.disconnectedTime),
    endTime: cleanTime(communication.endTime),
    directMessageId: cleanTechnicalId(communication.directMessageId),
    messageRefs: (Array.isArray(communication.messageRefs) ? communication.messageRefs : [])
      .slice(0, 500)
      .map(sanitizeMessageReference)
      .filter((item) => item.id),
    keys: cleanKeys(communication.keys)
  };
}

function sanitizeParticipant(participant = {}) {
  return {
    id: cleanId(participant.id),
    purpose: cleanText(participant.purpose, 40).toLowerCase(),
    userId: cleanId(participant.userId),
    ended: participant.ended === true,
    startTime: cleanTime(participant.startTime),
    connectedTime: cleanTime(participant.connectedTime),
    endTime: cleanTime(participant.endTime),
    calls: (Array.isArray(participant.calls) ? participant.calls : []).slice(0, 30).map(sanitizeCall),
    messages: (Array.isArray(participant.messages) ? participant.messages : [])
      .slice(0, 30)
      .map(sanitizeMessageCommunication),
    keys: cleanKeys(participant.keys)
  };
}

function sanitizeConversation(conversation = {}) {
  return {
    id: cleanId(conversation.id),
    active: typeof conversation.active === "boolean" ? conversation.active : null,
    startTime: cleanTime(conversation.startTime),
    endTime: cleanTime(conversation.endTime),
    mediaTypes: (Array.isArray(conversation.mediaTypes) ? conversation.mediaTypes : [])
      .map((item) => cleanText(item, 20).toLowerCase())
      .filter((item) => ["voice", "message"].includes(item))
      .slice(0, 2),
    participants: (Array.isArray(conversation.participants) ? conversation.participants : [])
      .slice(0, 40)
      .map(sanitizeParticipant),
    keys: cleanKeys(conversation.keys)
  };
}

function sanitizeDomSnapshot(snapshot = {}) {
  return {
    phase: ["initial", "change", "final"].includes(snapshot.phase) ? snapshot.phase : "change",
    count: Math.max(0, Math.min(100, Number(snapshot.count) || 0)),
    headerPresent: snapshot.headerPresent === true,
    selectedConversationId: cleanId(snapshot.selectedConversationId),
    cards: (Array.isArray(snapshot.cards) ? snapshot.cards : []).slice(0, 100).map((card) => ({
      conversationId: cleanId(card.conversationId),
      domId: cleanText(card.domId, 100),
      selected: card.selected === true,
      connected: card.connected !== false,
      voiceHint: card.voiceHint === true,
      messageHint: card.messageHint === true,
      mediaHint: ["voice", "message", "unknown"].includes(card.mediaHint) ? card.mediaHint : "unknown",
      iconNames: cleanKeys(card.iconNames).slice(0, 20),
      classes: cleanKeys(card.classes).slice(0, 30),
      attributeNames: cleanKeys(card.attributeNames).slice(0, 30)
    }))
  };
}

function sanitizeMessageEntity(message = {}) {
  return {
    id: cleanTechnicalId(message.id),
    direction: cleanText(message.direction, 30).toLowerCase(),
    state: cleanText(message.state, 40).toLowerCase(),
    type: cleanText(message.type, 50).toLowerCase(),
    timestamp: cleanTime(message.timestamp),
    hasText: message.hasText === true,
    mediaCount: Math.max(0, Math.min(50, Number(message.mediaCount) || 0)),
    mediaTypes: (Array.isArray(message.mediaTypes) ? message.mediaTypes : [])
      .map((item) => cleanText(item, 80).toLowerCase())
      .filter(Boolean)
      .slice(0, 20),
    keys: cleanKeys(message.keys),
    normalizedKeys: cleanKeys(message.normalizedKeys)
  };
}

function sanitizeObserverConversation(conversation = {}) {
  return {
    id: cleanId(conversation.id || conversation.conversationId),
    participantIds: (Array.isArray(conversation.participantIds) ? conversation.participantIds : [])
      .map(cleanId).filter(Boolean).slice(0, 50),
    agentCommunicationIds: (Array.isArray(conversation.agentCommunicationIds) ? conversation.agentCommunicationIds : [])
      .map(cleanId).filter(Boolean).slice(0, 20),
    messageIds: (Array.isArray(conversation.messageIds) ? conversation.messageIds : [])
      .map(cleanTechnicalId).filter(Boolean).slice(0, 500),
    messageRefs: (Array.isArray(conversation.messageRefs) ? conversation.messageRefs : [])
      .slice(0, 500)
      .map((reference) => ({
        id: cleanTechnicalId(reference?.id),
        purpose: cleanText(reference?.purpose, 40).toLowerCase(),
        participantId: cleanId(reference?.participantId),
        userId: cleanId(reference?.userId),
        senderKind: cleanText(reference?.senderKind, 40).toLowerCase()
      }))
      .filter((reference) => reference.id),
    inlineMessages: (Array.isArray(conversation.inlineMessages) ? conversation.inlineMessages : [])
      .slice(0, 500)
      .map((message) => ({
        id: cleanTechnicalId(message?.id),
        sender: cleanText(message?.sender, 20).toLowerCase(),
        senderKind: cleanText(message?.senderKind, 40).toLowerCase(),
        senderPurpose: cleanText(message?.senderPurpose, 40).toLowerCase(),
        senderParticipantId: cleanId(message?.senderParticipantId),
        senderUserId: cleanId(message?.senderUserId),
        timestamp: cleanTime(message?.timestamp),
        hasText: message?.hasText === true,
        hasMedia: message?.hasMedia === true
      }))
      .filter((message) => message.id),
    openedAt: cleanTime(conversation.openedAt),
    assignedAt: cleanTime(conversation.assignedAt),
    genesysMediaType: ["voice", "message"].includes(String(conversation.genesysMediaType || "").toLowerCase())
      ? String(conversation.genesysMediaType).toLowerCase()
      : "",
    callState: cleanText(conversation.callState, 30).toLowerCase(),
    agentActive: typeof conversation.agentActive === "boolean" ? conversation.agentActive : null,
    active: typeof conversation.active === "boolean" ? conversation.active : null
  };
}

function sanitizeProbeEvent(raw = {}, sender = {}) {
  const kind = cleanText(raw.kind, 40);
  const base = {
    at: Number(raw.at) || Date.now(),
    kind,
    frameId: Math.max(0, Number(sender.frameId) || 0),
    frame: cleanText(raw.frame, 30),
    page: cleanText(raw.page, 300).replace(UUID_GLOBAL_RE, "{uuid}")
  };
  if (kind === "network_conversations") {
    return {
      ...base,
      transport: ["websocket", "fetch", "xhr"].includes(raw.transport) ? raw.transport : "unknown",
      routeKind: cleanText(raw.routeKind, 40),
      route: cleanText(raw.route, 300).replace(UUID_GLOBAL_RE, "{uuid}"),
      topic: cleanText(raw.topic, 300).replace(UUID_GLOBAL_RE, "{uuid}"),
      status: Math.max(0, Math.min(999, Number(raw.status) || 0)),
      conversations: (Array.isArray(raw.conversations) ? raw.conversations : [])
        .slice(0, 100)
        .map(sanitizeConversation)
        .filter((item) => item.id)
    };
  }
  if (kind === "dom_roster") {
    return { ...base, snapshot: sanitizeDomSnapshot(raw.snapshot) };
  }
  if (kind === "network_messages") {
    return {
      ...base,
      transport: ["fetch", "xhr"].includes(raw.transport) ? raw.transport : "unknown",
      route: cleanText(raw.route, 300).replace(UUID_GLOBAL_RE, "{uuid}"),
      routeKind: "message_bulk",
      status: Math.max(0, Math.min(999, Number(raw.status) || 0)),
      conversationId: cleanId(raw.conversationId),
      requestedIds: (Array.isArray(raw.requestedIds) ? raw.requestedIds : [])
        .map(cleanTechnicalId).filter(Boolean).slice(0, 500),
      messages: (Array.isArray(raw.messages) ? raw.messages : [])
        .slice(0, 500)
        .map(sanitizeMessageEntity)
        .filter((item) => item.id)
    };
  }
  if (kind === "transport_state") {
    return {
      ...base,
      transport: raw.transport === "websocket" ? "websocket" : "unknown",
      endpointKind: cleanText(raw.endpointKind, 40),
      state: ["created", "open", "closed", "error", "snapshot"].includes(raw.state) ? raw.state : "unknown",
      readyState: Math.max(-1, Math.min(3, Number(raw.readyState) || 0)),
      closeCode: Math.max(0, Math.min(9999, Number(raw.closeCode) || 0)),
      wasClean: typeof raw.wasClean === "boolean" ? raw.wasClean : null
    };
  }
  if (kind === "onion_observer") {
    return {
      ...base,
      observerEvent: cleanText(raw.observerEvent, 50),
      installed: typeof raw.installed === "boolean" ? raw.installed : null,
      schemaVersion: Math.max(0, Math.min(100, Number(raw.schemaVersion) || 0)),
      routeKind: cleanText(raw.routeKind, 40),
      method: cleanText(raw.method, 10).toUpperCase(),
      status: Math.max(0, Math.min(999, Number(raw.status) || 0)),
      transport: cleanText(raw.transport, 20).toLowerCase(),
      conversationId: cleanId(raw.conversationId),
      communicationId: cleanId(raw.communicationId),
      reason: cleanText(raw.reason, 80),
      conversations: (Array.isArray(raw.conversations) ? raw.conversations : [])
        .slice(0, 200)
        .map(sanitizeObserverConversation)
        .filter((item) => item.id)
    };
  }
  if (kind === "onion_pipeline") {
    const boundedCount = (value) => Math.max(0, Math.min(100000, Number(value) || 0));
    return {
      ...base,
      conversationId: cleanId(raw.conversationId),
      stage: cleanText(raw.stage, 60).replace(/[^a-zA-Z0-9_-]/g, ""),
      expectedCount: boundedCount(raw.expectedCount),
      hydratedCount: boundedCount(raw.hydratedCount),
      storedCount: boundedCount(raw.storedCount),
      missingCount: boundedCount(raw.missingCount),
      pendingCount: boundedCount(raw.pendingCount),
      attempt: boundedCount(raw.attempt),
      latencyMs: Math.max(0, Math.min(30 * 60 * 1000, Number(raw.latencyMs) || 0)),
      result: cleanText(raw.result, 80).replace(/[^a-zA-Z0-9_.:-]/g, ""),
      reason: cleanText(raw.reason, 80).replace(/[^a-zA-Z0-9_.:-]/g, ""),
      source: cleanText(raw.source, 80).replace(/[^a-zA-Z0-9_.:-]/g, ""),
      messageId: cleanTechnicalId(raw.messageId),
      traceId: cleanTechnicalId(raw.traceId),
      persisted: raw.persisted === true,
      volatile: raw.volatile === true,
      complete: raw.complete === true
    };
  }
  return null;
}

async function readCapture(tabId) {
  const key = storageKey(tabId);
  const stored = await chrome.storage.session.get(key);
  return stored[key] || null;
}

async function writeCapture(tabId, capture) {
  await chrome.storage.session.set({ [storageKey(tabId)]: capture });
}

function serialMutation(tabId, task) {
  const previous = mutationChains.get(tabId) || Promise.resolve();
  const next = previous.catch(() => {}).then(task);
  mutationChains.set(tabId, next);
  const cleanup = () => {
    if (mutationChains.get(tabId) === next) mutationChains.delete(tabId);
  };
  next.then(cleanup, cleanup);
  return next;
}

function captureByteLength(capture) {
  try {
    return new TextEncoder().encode(JSON.stringify(capture)).byteLength;
  } catch (_) {
    return Number.MAX_SAFE_INTEGER;
  }
}

function eventDedupKey(event) {
  return [
    event.kind,
    event.frameId,
    event.transport,
    event.routeKind,
    event.route,
    event.observerEvent,
    event.stage,
    event.conversationId,
    event.messageId,
    event.traceId,
    event.endpointKind
  ].map((value) => String(value ?? "")).join("|");
}

function eventPayloadSignature(event) {
  const stable = { ...event, at: 0, seq: 0, offsetMs: 0 };
  const encoded = JSON.stringify(stable);
  let hash = 2166136261;
  for (let index = 0; index < encoded.length; index += 1) {
    hash ^= encoded.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `${encoded.length}:${hash >>> 0}`;
}

async function appendEvent(tabId, rawEvent, sender) {
  return serialMutation(tabId, async () => {
    const capture = await readCapture(tabId);
    if (!capture?.active) return { accepted: false, reason: "inactive" };
    const now = Date.now();
    if (now - Number(capture.startedAt || 0) > MAX_CAPTURE_MS) {
      capture.active = false;
      capture.expired = true;
      capture.endedAt = now;
      await writeCapture(tabId, capture);
      return { accepted: false, reason: "expired" };
    }
    const event = sanitizeProbeEvent(rawEvent, sender);
    if (!event) return { accepted: false, reason: "invalid" };
    const dedupKey = eventDedupKey(event);
    const payloadSignature = eventPayloadSignature(event);
    capture.lastEventSignatures = capture.lastEventSignatures || {};
    const previousSignature = capture.lastEventSignatures[dedupKey];
    if (
      previousSignature?.signature === payloadSignature
      && event.at - Number(previousSignature.at || 0) < EVENT_HEARTBEAT_MS
    ) {
      capture.deduplicatedEvents = Number(capture.deduplicatedEvents || 0) + 1;
      await writeCapture(tabId, capture);
      return { accepted: true, deduplicated: true, count: capture.events.length };
    }
    capture.lastEventSignatures[dedupKey] = { signature: payloadSignature, at: event.at };
    event.seq = Number(capture.nextSeq || 1);
    event.offsetMs = Math.max(0, event.at - Number(capture.startedAt || event.at));
    capture.nextSeq = event.seq + 1;
    capture.events.push(event);
    if (capture.events.length > MAX_EVENTS || captureByteLength(capture) > MAX_CAPTURE_BYTES) {
      capture.events.pop();
      capture.truncated = true;
      capture.droppedEvents = Number(capture.droppedEvents || 0) + 1;
    }
    await writeCapture(tabId, capture);
    return { accepted: true, count: capture.events.length };
  });
}

function framePage(url) {
  try {
    const parsed = new URL(String(url || ""));
    return `${parsed.origin}${parsed.pathname}`.replace(UUID_GLOBAL_RE, "{uuid}").slice(0, 500);
  } catch (_) {
    return "";
  }
}

async function setFramesActive(tabId, active, phase = "change") {
  try {
    await chrome.tabs.sendMessage(tabId, {
      type: "CALL_DIAG_SET_ACTIVE",
      active,
      phase
    });
    return true;
  } catch (_) {
    return false;
  }
}

async function startCapture(tabId, tabUrl) {
  const now = Date.now();
  const capture = {
    schemaVersion: 3,
    tool: "Onion Sync Diagnostic",
    toolVersion: TOOL_VERSION,
    privacy: "Sem tokens, cookies, mensagens, CPF, nomes, telefones ou enderecos.",
    active: true,
    startedAt: now,
    endedAt: 0,
    tabPage: framePage(tabUrl),
    nextSeq: 1,
    truncated: false,
    droppedEvents: 0,
    deduplicatedEvents: 0,
    lastEventSignatures: {},
    events: []
  };
  await serialMutation(tabId, () => writeCapture(tabId, capture));
  const attached = await setFramesActive(tabId, true, "initial");
  if (!attached) {
    capture.active = false;
    capture.endedAt = Date.now();
    await serialMutation(tabId, () => writeCapture(tabId, capture));
    throw new Error("Recarregue a página do Genesys e tente novamente");
  }
  return captureStatus(capture);
}

function callSignature(call) {
  return [call.state, call.held, call.connectedTime, call.disconnectedTime, call.endTime]
    .map((value) => String(value ?? ""))
    .join("|");
}

function messageCommunicationSignature(communication) {
  return [
    communication.state,
    communication.held,
    communication.connectedTime,
    communication.disconnectedTime,
    communication.endTime,
    (communication.messageRefs || []).map((item) => item.id).join(",")
  ].map((value) => String(value ?? "")).join("|");
}

function buildSummary(capture) {
  const sourceCounts = {};
  const conversationIds = new Set();
  const callLastState = new Map();
  const callTransitions = [];
  const messageLastState = new Map();
  const messageTransitions = [];
  const messageBatchTimeline = [];
  const observerTimeline = [];
  const pipelineTimeline = [];
  const transportTimeline = [];
  const rosterTimeline = [];
  const conversationDiagnostics = new Map();
  const domTimeline = [];
  let previousDomSignature = "";
  const touchConversation = (conversationId, source, at) => {
    const id = cleanId(conversationId);
    if (!id) return null;
    if (!conversationDiagnostics.has(id)) {
      conversationDiagnostics.set(id, {
        conversationId: id,
        firstSeenAt: at,
        lastSeenAt: at,
        firstSeenBySource: {},
        mediaTypes: new Set(),
        participantIds: new Set(),
        agentParticipantIds: new Set(),
        agentCommunicationIds: new Set(),
        messageIds: new Set()
      });
    }
    const entry = conversationDiagnostics.get(id);
    entry.firstSeenAt = Math.min(Number(entry.firstSeenAt || at), at);
    entry.lastSeenAt = Math.max(Number(entry.lastSeenAt || at), at);
    if (source && !entry.firstSeenBySource[source]) entry.firstSeenBySource[source] = at;
    return entry;
  };
  for (const event of capture.events) {
    sourceCounts[event.kind] = Number(sourceCounts[event.kind] || 0) + 1;
    if (event.kind === "network_conversations") {
      sourceCounts[event.transport] = Number(sourceCounts[event.transport] || 0) + 1;
      if (event.routeKind === "active_roster") {
        rosterTimeline.push({
          at: event.at,
          offsetMs: event.offsetMs,
          source: `raw_${event.transport}`,
          conversationIds: (event.conversations || []).map((item) => item.id).filter(Boolean).sort()
        });
      }
      for (const conversation of event.conversations || []) {
        conversationIds.add(conversation.id);
        const diagnostic = touchConversation(conversation.id, `raw_${event.transport}`, event.at);
        for (const mediaType of conversation.mediaTypes || []) diagnostic?.mediaTypes.add(mediaType);
        for (const participant of conversation.participants || []) {
          if (participant.id) diagnostic?.participantIds.add(participant.id);
          const activeAgent = participant.purpose === "agent" && participant.ended !== true;
          if (activeAgent && participant.id) diagnostic?.agentParticipantIds.add(participant.id);
          for (const call of participant.calls || []) {
            if (call.id && activeAgent) diagnostic?.agentCommunicationIds.add(call.id);
            const key = `${conversation.id}|${participant.id || participant.purpose}|${call.id || "sem-id"}`;
            const signature = callSignature(call);
            if (callLastState.get(key) === signature) continue;
            callLastState.set(key, signature);
            callTransitions.push({
              at: event.at,
              offsetMs: event.offsetMs,
              conversationId: conversation.id,
              participantId: participant.id,
              purpose: participant.purpose,
              callId: call.id,
              state: call.state,
              held: call.held,
              connectedTime: call.connectedTime,
              disconnectedTime: call.disconnectedTime,
              endTime: call.endTime,
              transport: event.transport
            });
          }
          for (const communication of participant.messages || []) {
            if (communication.id && activeAgent) diagnostic?.agentCommunicationIds.add(communication.id);
            for (const reference of communication.messageRefs || []) {
              if (reference.id) diagnostic?.messageIds.add(reference.id);
            }
            const key = `${conversation.id}|${participant.id || participant.purpose}|${communication.id || "sem-id"}`;
            const signature = messageCommunicationSignature(communication);
            if (messageLastState.get(key) === signature) continue;
            messageLastState.set(key, signature);
            messageTransitions.push({
              at: event.at,
              offsetMs: event.offsetMs,
              conversationId: conversation.id,
              participantId: participant.id,
              purpose: participant.purpose,
              communicationId: communication.id,
              state: communication.state,
              held: communication.held,
              connectedTime: communication.connectedTime,
              disconnectedTime: communication.disconnectedTime,
              endTime: communication.endTime,
              messageIds: (communication.messageRefs || []).map((item) => item.id),
              transport: event.transport
            });
          }
        }
      }
    }
    if (event.kind === "network_messages") {
      const diagnostic = touchConversation(event.conversationId, `bulk_${event.transport}`, event.at);
      const returnedIds = (event.messages || []).map((item) => item.id).filter(Boolean);
      returnedIds.forEach((id) => diagnostic?.messageIds.add(id));
      const returnedSet = new Set(returnedIds);
      messageBatchTimeline.push({
        at: event.at,
        offsetMs: event.offsetMs,
        conversationId: event.conversationId,
        transport: event.transport,
        status: event.status,
        requestedIds: event.requestedIds || [],
        returnedIds,
        missingIds: (event.requestedIds || []).filter((id) => !returnedSet.has(id)),
        messages: event.messages || []
      });
    }
    if (event.kind === "onion_observer") {
      const ids = new Set();
      if (event.conversationId) ids.add(event.conversationId);
      for (const conversation of event.conversations || []) {
        ids.add(conversation.id);
        const diagnostic = touchConversation(conversation.id, "onion_observer", event.at);
        if (conversation.genesysMediaType) diagnostic?.mediaTypes.add(conversation.genesysMediaType);
        (conversation.participantIds || []).forEach((id) => diagnostic?.participantIds.add(id));
        (conversation.agentCommunicationIds || []).forEach((id) => diagnostic?.agentCommunicationIds.add(id));
        (conversation.messageIds || []).forEach((id) => diagnostic?.messageIds.add(id));
        (conversation.messageRefs || []).forEach((item) => diagnostic?.messageIds.add(item.id));
        (conversation.inlineMessages || []).forEach((item) => diagnostic?.messageIds.add(item.id));
      }
      for (const id of ids) touchConversation(id, "onion_observer", event.at);
      observerTimeline.push({
        at: event.at,
        offsetMs: event.offsetMs,
        observerEvent: event.observerEvent,
        routeKind: event.routeKind,
        transport: event.transport,
        status: event.status,
        installed: event.installed,
        conversationId: event.conversationId,
        communicationId: event.communicationId,
        conversationIds: [...ids].sort()
      });
      if (event.routeKind === "active_roster") {
        rosterTimeline.push({
          at: event.at,
          offsetMs: event.offsetMs,
          source: "onion_observer",
          conversationIds: [...ids].sort()
        });
      }
    }
    if (event.kind === "onion_pipeline") {
      if (event.conversationId) conversationIds.add(event.conversationId);
      const diagnostic = touchConversation(
        event.conversationId,
        `pipeline_${event.stage || "unknown"}`,
        event.at
      );
      if (event.messageId) diagnostic?.messageIds.add(event.messageId);
      pipelineTimeline.push({
        at: event.at,
        offsetMs: event.offsetMs,
        conversationId: event.conversationId,
        stage: event.stage,
        expectedCount: event.expectedCount,
        hydratedCount: event.hydratedCount,
        storedCount: event.storedCount,
        missingCount: event.missingCount,
        pendingCount: event.pendingCount,
        attempt: event.attempt,
        latencyMs: event.latencyMs,
        result: event.result,
        reason: event.reason,
        source: event.source,
        messageId: event.messageId,
        traceId: event.traceId,
        persisted: event.persisted,
        volatile: event.volatile,
        complete: event.complete
      });
    }
    if (event.kind === "transport_state") {
      transportTimeline.push({
        at: event.at,
        offsetMs: event.offsetMs,
        endpointKind: event.endpointKind,
        state: event.state,
        readyState: event.readyState,
        closeCode: event.closeCode,
        wasClean: event.wasClean
      });
    }
    if (event.kind === "dom_roster") {
      const ids = (event.snapshot?.cards || []).map((card) => card.conversationId).filter(Boolean).sort();
      const signature = `${event.frameId}|${event.snapshot?.count || 0}|${ids.join("|")}`;
      if (signature === previousDomSignature) continue;
      previousDomSignature = signature;
      domTimeline.push({
        at: event.at,
        offsetMs: event.offsetMs,
        frameId: event.frameId,
        phase: event.snapshot?.phase,
        count: event.snapshot?.count || 0,
        conversationIds: ids,
        selectedConversationId: event.snapshot?.selectedConversationId || ""
      });
      for (const id of ids) touchConversation(id, "dom", event.at);
    }
  }
  const initialDom = domTimeline.find((item) => item.phase === "initial") || domTimeline[0] || null;
  const finalDom = [...domTimeline].reverse().find((item) => item.phase === "final")
    || domTimeline[domTimeline.length - 1]
    || null;
  const initialIds = new Set(initialDom?.conversationIds || []);
  const finalIds = new Set(finalDom?.conversationIds || []);
  const diagnostics = [...conversationDiagnostics.values()].map((entry) => {
    const rawAt = Math.min(
      ...Object.entries(entry.firstSeenBySource)
        .filter(([source]) => source.startsWith("raw_"))
        .map(([, at]) => at)
    );
    const observerAt = Number(entry.firstSeenBySource.onion_observer || 0);
    const domAt = Number(entry.firstSeenBySource.dom || 0);
    return {
      conversationId: entry.conversationId,
      firstSeenAt: entry.firstSeenAt,
      lastSeenAt: entry.lastSeenAt,
      firstSeenBySource: entry.firstSeenBySource,
      rawToObserverMs: Number.isFinite(rawAt) && observerAt ? observerAt - rawAt : null,
      rawToDomMs: Number.isFinite(rawAt) && domAt ? domAt - rawAt : null,
      seenByOnionObserver: Boolean(observerAt),
      seenInDomWithConversationId: Boolean(domAt),
      mediaTypes: [...entry.mediaTypes].sort(),
      participantIds: [...entry.participantIds].sort(),
      agentParticipantIds: [...entry.agentParticipantIds].sort(),
      agentCommunicationIds: [...entry.agentCommunicationIds].sort(),
      messageIds: [...entry.messageIds].sort()
    };
  }).sort((left, right) => left.firstSeenAt - right.firstSeenAt);
  return {
    durationMs: Math.max(0, Number(capture.endedAt || Date.now()) - Number(capture.startedAt || 0)),
    eventCount: capture.events.length,
    droppedEvents: Number(capture.droppedEvents || 0),
    deduplicatedEvents: Number(capture.deduplicatedEvents || 0),
    truncated: capture.truncated === true,
    sourceCounts,
    conversationIds: [...conversationIds].sort(),
    dom: {
      initial: initialDom,
      final: finalDom,
      addedConversationIds: [...finalIds].filter((id) => !initialIds.has(id)),
      removedConversationIds: [...initialIds].filter((id) => !finalIds.has(id)),
      timeline: domTimeline
    },
    rosterTimeline,
    transportTimeline,
    observerTimeline,
    pipelineTimeline,
    conversationDiagnostics: diagnostics,
    callTransitions,
    messageTransitions,
    messageBatchTimeline
  };
}

function buildReport(capture) {
  return {
    schemaVersion: capture.schemaVersion,
    tool: capture.tool,
    toolVersion: capture.toolVersion,
    privacy: capture.privacy,
    startedAt: new Date(capture.startedAt).toISOString(),
    endedAt: new Date(capture.endedAt || Date.now()).toISOString(),
    tabPage: capture.tabPage,
    summary: buildSummary(capture),
    events: capture.events
  };
}

async function stopCapture(tabId) {
  const capture = await readCapture(tabId);
  if (!capture) throw new Error("captura_nao_iniciada");
  if (capture.active) {
    await setFramesActive(tabId, true, "final");
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  return serialMutation(tabId, async () => {
    const current = await readCapture(tabId);
    if (!current) throw new Error("captura_nao_iniciada");
    current.active = false;
    current.endedAt = current.endedAt || Date.now();
    await writeCapture(tabId, current);
    await setFramesActive(tabId, false, "change");
    const report = buildReport(current);
    return {
      status: captureStatus(current),
      fileName: `onion-sync-diagnostic-${new Date(current.startedAt).toISOString().replace(/[:.]/g, "-")}.json`,
      reportJson: JSON.stringify(report, null, 2)
    };
  });
}

function captureStatus(capture) {
  return {
    exists: Boolean(capture),
    active: capture?.active === true,
    expired: capture?.expired === true,
    startedAt: Number(capture?.startedAt || 0),
    endedAt: Number(capture?.endedAt || 0),
    eventCount: Array.isArray(capture?.events) ? capture.events.length : 0,
    droppedEvents: Number(capture?.droppedEvents || 0),
    deduplicatedEvents: Number(capture?.deduplicatedEvents || 0),
    truncated: capture?.truncated === true
  };
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "CALL_DIAG_FRAME_READY") {
    const tabId = sender.tab?.id;
    if (tabId == null) {
      sendResponse({ active: false });
      return;
    }
    readCapture(tabId)
      .then((capture) => sendResponse({ active: capture?.active === true }))
      .catch(() => sendResponse({ active: false }));
    return true;
  }
  if (message?.type === "CALL_DIAG_EVENT") {
    const tabId = sender.tab?.id;
    if (tabId == null) {
      sendResponse({ accepted: false });
      return;
    }
    appendEvent(tabId, message.event, sender)
      .then(sendResponse)
      .catch((error) => sendResponse({ accepted: false, error: error.message }));
    return true;
  }
  if (message?.type === "CALL_DIAG_STATUS") {
    readCapture(Number(message.tabId))
      .then((capture) => sendResponse({ ok: true, status: captureStatus(capture) }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }
  if (message?.type === "CALL_DIAG_START") {
    startCapture(Number(message.tabId), message.tabUrl)
      .then((status) => sendResponse({ ok: true, status }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }
  if (message?.type === "CALL_DIAG_STOP") {
    stopCapture(Number(message.tabId))
      .then((result) => sendResponse({ ok: true, ...result }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }
});
