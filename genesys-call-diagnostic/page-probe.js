(() => {
  if (window.__onionCallDiagnosticProbe) return;
  window.__onionCallDiagnosticProbe = true;

  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const UUID_GLOBAL_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/ig;
  const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
  let enabled = false;

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

  function keysOf(value) {
    if (!value || typeof value !== "object") return [];
    return Object.keys(value)
      .filter((key) => /^[a-zA-Z0-9_.:-]+$/.test(key))
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
      keys: keysOf(segment)
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
      keys: keysOf(call)
    };
  }

  function participantUserId(participant = {}) {
    const direct = cleanId(participant.userId);
    if (direct) return direct;
    const match = String(participant.userUri || "").match(UUID_RE);
    return cleanId(match?.[0]);
  }

  function sanitizeParticipant(participant = {}) {
    return {
      id: cleanId(participant.id || participant.participantId),
      purpose: cleanText(participant.purpose, 40).toLowerCase(),
      userId: participantUserId(participant),
      ended: Boolean(participant.endTime),
      startTime: cleanTime(participant.startTime),
      connectedTime: cleanTime(participant.connectedTime),
      endTime: cleanTime(participant.endTime),
      calls: (Array.isArray(participant.calls) ? participant.calls : []).slice(0, 30).map(sanitizeCall),
      keys: keysOf(participant)
    };
  }

  function sanitizeConversation(raw = {}, fallbackId = "") {
    const conversation = raw?.conversation && typeof raw.conversation === "object"
      ? raw.conversation
      : raw;
    const id = cleanId(conversation?.conversationId || conversation?.id || fallbackId);
    if (!id) return null;
    const participants = Array.isArray(conversation.participants) ? conversation.participants : [];
    return {
      id,
      active: participants.length
        ? participants.some((participant) => !participant?.endTime)
        : null,
      startTime: cleanTime(conversation.startTime),
      endTime: cleanTime(conversation.endTime),
      participants: participants.slice(0, 40).map(sanitizeParticipant),
      keys: keysOf(conversation)
    };
  }

  function routeConversationId(path) {
    const match = String(path || "").match(/\/api\/v2\/conversations(?:\/messages)?\/([0-9a-f-]{36})(?:\/|$)/i);
    return cleanId(match?.[1]);
  }

  function extractConversations(payload, fallbackId = "") {
    const candidates = Array.isArray(payload)
      ? payload
      : Array.isArray(payload?.entities)
        ? payload.entities
        : [payload];
    return candidates
      .slice(0, 100)
      .map((item) => sanitizeConversation(item, fallbackId))
      .filter(Boolean);
  }

  function safePath(url) {
    try {
      const parsed = new URL(String(url || ""), location.origin);
      if (parsed.hostname !== "api.sae1.pure.cloud") return "";
      return parsed.pathname;
    } catch (_) {
      return "";
    }
  }

  function observableConversationPath(path) {
    if (!/^\/api\/v2\/conversations(?:\/|$)/i.test(path)) return false;
    return !/\/messages\/bulk$|\/communications\/|\/media\/|\/uploads(?:\/|$)/i.test(path);
  }

  function pagePath() {
    return `${location.origin}${location.pathname}`.slice(0, 300);
  }

  function post(event) {
    if (!enabled) return;
    window.postMessage({
      source: "onion-call-diagnostic-probe",
      event: {
        at: Date.now(),
        frame: window === window.top ? "top" : "child",
        page: pagePath(),
        ...event
      }
    }, "*");
  }

  function publishNetwork({ transport, route = "", topic = "", status = 0, payload, fallbackId = "" }) {
    const conversations = extractConversations(payload, fallbackId);
    if (!conversations.length) return;
    post({
      kind: "network_conversations",
      transport,
      route: cleanText(route, 300).replace(UUID_GLOBAL_RE, "{uuid}"),
      topic: cleanText(topic, 300).replace(UUID_GLOBAL_RE, "{uuid}"),
      status,
      conversations
    });
  }

  function parseSocketData(data) {
    if (typeof data !== "string") return null;
    const text = data.trim();
    if (!text || text.length > MAX_RESPONSE_BYTES) return null;
    try {
      return JSON.parse(text);
    } catch (_) {
      const framed = text.match(/^\d+(\[.*\]|\{.*\})$/s);
      if (!framed) return null;
      try { return JSON.parse(framed[1]); } catch (_) { return null; }
    }
  }

  function inspectSocketPayload(payload) {
    const envelopes = Array.isArray(payload) ? payload : [payload];
    for (const envelope of envelopes) {
      if (!envelope || typeof envelope !== "object") continue;
      const topic = cleanText(envelope.topicName || envelope.topic, 300);
      if (!topic.toLowerCase().includes("conversations")) continue;
      const body = envelope.eventBody || envelope.body || envelope;
      publishNetwork({
        transport: "websocket",
        topic,
        payload: body,
        fallbackId: cleanId(body?.conversationId || body?.id)
      });
    }
  }

  function inspectSocketMessage(data) {
    if (!enabled) return;
    if (typeof data === "string") {
      const payload = parseSocketData(data);
      if (payload) inspectSocketPayload(payload);
      return;
    }
    if (data instanceof ArrayBuffer) {
      const payload = parseSocketData(new TextDecoder().decode(data));
      if (payload) inspectSocketPayload(payload);
      return;
    }
    if (data instanceof Blob && data.size <= MAX_RESPONSE_BYTES) {
      data.text().then((text) => {
        const payload = parseSocketData(text);
        if (payload) inspectSocketPayload(payload);
      }).catch(() => {});
    }
  }

  const NativeWebSocket = window.WebSocket;
  if (typeof NativeWebSocket === "function") {
    function DiagnosticWebSocket(url, protocols) {
      const socket = protocols === undefined
        ? new NativeWebSocket(url)
        : new NativeWebSocket(url, protocols);
      socket.addEventListener("message", (event) => inspectSocketMessage(event.data));
      return socket;
    }
    DiagnosticWebSocket.prototype = NativeWebSocket.prototype;
    Object.setPrototypeOf(DiagnosticWebSocket, NativeWebSocket);
    for (const key of ["CONNECTING", "OPEN", "CLOSING", "CLOSED"]) {
      Object.defineProperty(DiagnosticWebSocket, key, { value: NativeWebSocket[key] });
    }
    window.WebSocket = DiagnosticWebSocket;
  }

  const nativeFetch = window.fetch;
  if (typeof nativeFetch === "function") {
    window.fetch = async function diagnosticFetch(input, init) {
      const response = await nativeFetch.apply(this, arguments);
      if (enabled) {
        const path = safePath(typeof input === "string" ? input : input?.url || response.url);
        if (observableConversationPath(path)) {
          const declaredSize = Number(response.headers?.get?.("content-length") || 0);
          const contentType = String(response.headers?.get?.("content-type") || "").toLowerCase();
          if ((!declaredSize || declaredSize <= MAX_RESPONSE_BYTES) && contentType.includes("json")) {
            response.clone().text().then((text) => {
              if (!text || text.length > MAX_RESPONSE_BYTES) return;
              let payload;
              try { payload = JSON.parse(text); } catch (_) { return; }
              publishNetwork({
                transport: "fetch",
                route: path,
                status: response.status,
                payload,
                fallbackId: routeConversationId(path)
              });
            }).catch(() => {});
          }
        }
      }
      return response;
    };
  }

  const nativeOpen = XMLHttpRequest.prototype.open;
  const nativeSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function diagnosticOpen(method, url) {
    this.__onionCallDiagnosticUrl = String(url || "");
    return nativeOpen.apply(this, arguments);
  };
  XMLHttpRequest.prototype.send = function diagnosticSend() {
    if (!this.__onionCallDiagnosticListener) {
      this.__onionCallDiagnosticListener = true;
      this.addEventListener("loadend", () => {
        if (!enabled) return;
        const path = safePath(this.__onionCallDiagnosticUrl || this.responseURL);
        if (!observableConversationPath(path)) return;
        const contentType = String(this.getResponseHeader?.("content-type") || "").toLowerCase();
        if (!contentType.includes("json") || ["blob", "arraybuffer"].includes(this.responseType)) return;
        let text = "";
        try {
          text = this.responseType === "json" ? JSON.stringify(this.response) : String(this.responseText || "");
        } catch (_) {
          return;
        }
        if (!text || text.length > MAX_RESPONSE_BYTES) return;
        let payload;
        try { payload = JSON.parse(text); } catch (_) { return; }
        publishNetwork({
          transport: "xhr",
          route: path,
          status: Number(this.status || 0),
          payload,
          fallbackId: routeConversationId(path)
        });
      });
    }
    return nativeSend.apply(this, arguments);
  };

  window.addEventListener("message", (message) => {
    if (message.source !== window) return;
    if (message.data?.source !== "onion-call-diagnostic-control") return;
    enabled = message.data.enabled === true;
  });
})();
