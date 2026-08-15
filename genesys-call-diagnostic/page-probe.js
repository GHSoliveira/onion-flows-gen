(() => {
  if (window.__onionCallDiagnosticProbe) return;
  window.__onionCallDiagnosticProbe = true;

  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const UUID_GLOBAL_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/ig;
  const TECH_ID_RE = /^[a-zA-Z0-9_-]{8,160}$/;
  const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
  let enabled = false;

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

  function sanitizeMessageReference(reference = {}) {
    return {
      id: cleanTechnicalId(reference.messageId || reference.id),
      timestamp: cleanTime(reference.timestamp || reference.createdTime || reference.time),
      keys: keysOf(reference)
    };
  }

  function sanitizeMessageCommunication(communication = {}) {
    const references = Array.isArray(communication.messages) ? communication.messages : [];
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
      directMessageId: cleanTechnicalId(communication.messageId),
      messageRefs: references.slice(0, 500).map(sanitizeMessageReference).filter((item) => item.id),
      keys: keysOf(communication)
    };
  }

  function participantUserId(participant = {}) {
    const direct = cleanId(participant.userId);
    if (direct) return direct;
    const match = String(participant.userUri || "")
      .match(/\/api\/v2\/users\/([0-9a-f-]{36})(?:$|[/?#])/i);
    return cleanId(match?.[1]);
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
      messages: (Array.isArray(participant.messages) ? participant.messages : [])
        .slice(0, 30)
        .map(sanitizeMessageCommunication),
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
    const sanitizedParticipants = participants.slice(0, 40).map(sanitizeParticipant);
    const mediaTypes = [];
    if (sanitizedParticipants.some((participant) => participant.calls.length)) mediaTypes.push("voice");
    if (sanitizedParticipants.some((participant) => participant.messages.length)) mediaTypes.push("message");
    return {
      id,
      active: participants.length
        ? participants.some((participant) => !participant?.endTime)
        : null,
      startTime: cleanTime(conversation.startTime),
      endTime: cleanTime(conversation.endTime),
      mediaTypes,
      participants: sanitizedParticipants,
      keys: keysOf(conversation)
    };
  }

  function sanitizeMessageEntity(item = {}) {
    const normalized = item?.normalizedMessage && typeof item.normalizedMessage === "object"
      ? item.normalizedMessage
      : {};
    const media = [
      ...(Array.isArray(item.media) ? item.media : []),
      ...(Array.isArray(normalized.media) ? normalized.media : []),
      ...(Array.isArray(normalized.content) ? normalized.content : [])
    ];
    return {
      id: cleanTechnicalId(item.id || item.messageId),
      direction: cleanText(item.direction || normalized.direction, 30).toLowerCase(),
      state: cleanText(item.state || item.status, 40).toLowerCase(),
      type: cleanText(item.type || normalized.type || normalized.channel, 50).toLowerCase(),
      timestamp: cleanTime(item.timestamp || item.createdTime || item.time),
      hasText: Boolean(item.textBody || item.text || normalized.text || normalized.textBody),
      mediaCount: Math.min(50, media.length),
      mediaTypes: [...new Set(media.map((entry) => cleanText(
        entry?.mediaType || entry?.contentType || entry?.type,
        80
      ).toLowerCase()).filter(Boolean))].slice(0, 20),
      keys: keysOf(item),
      normalizedKeys: keysOf(normalized)
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
      .filter((item) => (
        item
        && typeof item === "object"
        && (
          Array.isArray(item.participants)
          || Array.isArray(item?.conversation?.participants)
        )
      ))
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
    return ["active_roster", "message_bulk", "message_detail", "conversation_detail"]
      .includes(routeKind(path));
  }

  function routeKind(path) {
    if (/^\/api\/v2\/conversations\/?$/i.test(path)) return "active_roster";
    if (/\/messages\/bulk$/i.test(path)) return "message_bulk";
    if (/^\/api\/v2\/conversations\/messages\/[0-9a-f-]{36}\/?$/i.test(path)) return "message_detail";
    if (/^\/api\/v2\/conversations\/[0-9a-f-]{36}\/?$/i.test(path)) return "conversation_detail";
    return "ignored";
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
    if (route && !observableConversationPath(route)) return;
    const conversations = extractConversations(payload, fallbackId);
    if (!conversations.length) return;
    post({
      kind: "network_conversations",
      transport,
      routeKind: routeKind(route),
      route: cleanText(route, 300).replace(UUID_GLOBAL_RE, "{uuid}"),
      topic: cleanText(topic, 300).replace(UUID_GLOBAL_RE, "{uuid}"),
      status,
      conversations
    });
  }

  function publishMessageBatch({ transport, route = "", status = 0, payload, requestedIds = [] }) {
    const conversationId = routeConversationId(route);
    if (!conversationId) return;
    const candidates = Array.isArray(payload)
      ? payload
      : Array.isArray(payload?.entities)
        ? payload.entities
        : [];
    post({
      kind: "network_messages",
      transport,
      route: cleanText(route, 300).replace(UUID_GLOBAL_RE, "{uuid}"),
      routeKind: "message_bulk",
      status,
      conversationId,
      requestedIds: requestedIds.map(cleanTechnicalId).filter(Boolean).slice(0, 500),
      messages: candidates.slice(0, 500).map(sanitizeMessageEntity).filter((item) => item.id)
    });
  }

  function parseRequestedMessageIds(body) {
    if (typeof body !== "string" || body.length > 100000) return [];
    try {
      const parsed = JSON.parse(body);
      return (Array.isArray(parsed) ? parsed : []).map(cleanTechnicalId).filter(Boolean).slice(0, 500);
    } catch (_) {
      return [];
    }
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

  const socketRegistry = new Set();
  function socketEndpointKind(url) {
    try {
      const parsed = new URL(String(url || ""));
      if (parsed.hostname.startsWith("streaming.")) return parsed.pathname.startsWith("/stream/")
        ? "streaming_xmpp"
        : "streaming_notifications";
      if (parsed.hostname.startsWith("realtime.")) return "realtime_socketio";
      return "other";
    } catch (_) {
      return "unknown";
    }
  }

  function publishSocketState(socket, state, event = {}) {
    post({
      kind: "transport_state",
      transport: "websocket",
      endpointKind: socketEndpointKind(socket?.url),
      state,
      readyState: Number(socket?.readyState ?? -1),
      closeCode: state === "closed" ? Number(event?.code || 0) : 0,
      wasClean: state === "closed" ? event?.wasClean === true : null
    });
  }

  const NativeWebSocket = window.WebSocket;
  if (typeof NativeWebSocket === "function") {
    function DiagnosticWebSocket(url, protocols) {
      const socket = protocols === undefined
        ? new NativeWebSocket(url)
        : new NativeWebSocket(url, protocols);
      socketRegistry.add(socket);
      publishSocketState(socket, "created");
      socket.addEventListener("open", (event) => publishSocketState(socket, "open", event));
      socket.addEventListener("close", (event) => {
        publishSocketState(socket, "closed", event);
        socketRegistry.delete(socket);
      });
      socket.addEventListener("error", (event) => publishSocketState(socket, "error", event));
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
              if (routeKind(path) === "message_bulk") {
                publishMessageBatch({
                  transport: "fetch",
                  route: path,
                  status: response.status,
                  payload,
                  requestedIds: parseRequestedMessageIds(init?.body)
                });
              } else {
                publishNetwork({
                  transport: "fetch",
                  route: path,
                  status: response.status,
                  payload,
                  fallbackId: routeConversationId(path)
                });
              }
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
    this.__onionCallDiagnosticRequestedIds = parseRequestedMessageIds(arguments[0]);
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
        if (routeKind(path) === "message_bulk") {
          publishMessageBatch({
            transport: "xhr",
            route: path,
            status: Number(this.status || 0),
            payload,
            requestedIds: this.__onionCallDiagnosticRequestedIds
          });
        } else {
          publishNetwork({
            transport: "xhr",
            route: path,
            status: Number(this.status || 0),
            payload,
            fallbackId: routeConversationId(path)
          });
        }
      });
    }
    return nativeSend.apply(this, arguments);
  };

  window.addEventListener("message", (message) => {
    if (message.source !== window) return;
    if (message.data?.source !== "onion-call-diagnostic-control") return;
    enabled = message.data.enabled === true;
    if (enabled) {
      for (const socket of socketRegistry) publishSocketState(socket, "snapshot");
    }
  });
})();
