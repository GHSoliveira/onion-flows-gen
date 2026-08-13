const TOOL_VERSION = "0.1.0";
const STORAGE_PREFIX = "onionCallDiagnostic:";
const MAX_EVENTS = 4000;
const MAX_CAPTURE_BYTES = 4 * 1024 * 1024;
const MAX_CAPTURE_MS = 20 * 60 * 1000;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const UUID_GLOBAL_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/ig;
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
    keys: cleanKeys(participant.keys)
  };
}

function sanitizeConversation(conversation = {}) {
  return {
    id: cleanId(conversation.id),
    active: typeof conversation.active === "boolean" ? conversation.active : null,
    startTime: cleanTime(conversation.startTime),
    endTime: cleanTime(conversation.endTime),
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
      classes: cleanKeys(card.classes).slice(0, 30),
      attributeNames: cleanKeys(card.attributeNames).slice(0, 30)
    }))
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
    schemaVersion: 1,
    tool: "Onion Call Diagnostic",
    toolVersion: TOOL_VERSION,
    privacy: "Sem tokens, cookies, mensagens, CPF, nomes, telefones ou enderecos.",
    active: true,
    startedAt: now,
    endedAt: 0,
    tabPage: framePage(tabUrl),
    nextSeq: 1,
    truncated: false,
    droppedEvents: 0,
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

function buildSummary(capture) {
  const sourceCounts = {};
  const conversationIds = new Set();
  const callLastState = new Map();
  const callTransitions = [];
  const domTimeline = [];
  let previousDomSignature = "";
  for (const event of capture.events) {
    sourceCounts[event.kind] = Number(sourceCounts[event.kind] || 0) + 1;
    if (event.kind === "network_conversations") {
      sourceCounts[event.transport] = Number(sourceCounts[event.transport] || 0) + 1;
      for (const conversation of event.conversations || []) {
        conversationIds.add(conversation.id);
        for (const participant of conversation.participants || []) {
          for (const call of participant.calls || []) {
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
        }
      }
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
    }
  }
  const initialDom = domTimeline.find((item) => item.phase === "initial") || domTimeline[0] || null;
  const finalDom = [...domTimeline].reverse().find((item) => item.phase === "final")
    || domTimeline[domTimeline.length - 1]
    || null;
  const initialIds = new Set(initialDom?.conversationIds || []);
  const finalIds = new Set(finalDom?.conversationIds || []);
  return {
    durationMs: Math.max(0, Number(capture.endedAt || Date.now()) - Number(capture.startedAt || 0)),
    eventCount: capture.events.length,
    droppedEvents: Number(capture.droppedEvents || 0),
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
    callTransitions
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
      fileName: `onion-call-diagnostic-${new Date(current.startedAt).toISOString().replace(/[:.]/g, "-")}.json`,
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
