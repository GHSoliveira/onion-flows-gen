(() => {
  if (window.__onionDevFocusHook) return;
  window.__onionDevFocusHook = true;
  const OPEN_RE = /\/api\/v2\/conversations\/messages\/([0-9a-fA-F-]{36})(?:$|\?)/;
  const HELD_RE = /\/api\/v2\/conversations\/messages\/([0-9a-fA-F-]{36})\/participants\//;
  const COMMUNICATION_RE = /\/api\/v2\/conversations\/messages\/([0-9a-fA-F-]{36})\/communications\/([0-9a-fA-F-]{36})(?:\/|$|\?)/;
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const OBSERVED_PATH_RE = /^\/api\/v2\/(?:conversations(?:\/|$)|notifications\/channels\/)/i;
  const MAX_OBSERVED_RESPONSE_BYTES = 2 * 1024 * 1024;
  const MAX_OBSERVED_CONVERSATIONS = 200;
  const MAX_OBSERVED_MESSAGE_IDS = 500;
  let last = "";
  let observationEnabled = true;
  const messagePurposeByConversation = new Map();

  function report(id, reason) {
    if (!id || id === last) return;
    last = id;
    window.postMessage({ source: "onion-dev-focus", conversationId: id, reason }, "*");
  }
  function inspect(url, method, body) {
    const text = String(url || "");
    const communicationMatch = COMMUNICATION_RE.exec(text);
    if (communicationMatch) {
      window.postMessage({
        source: "onion-dev-communication",
        conversationId: communicationMatch[1],
        communicationId: communicationMatch[2],
        reason: "web-request"
      }, "*");
    }
    if (/patch/i.test(method || "")) {
      const match = HELD_RE.exec(text);
      if (!match) return;
      try {
        const parsed = typeof body === "string" ? JSON.parse(body) : body;
        if (parsed?.held === false) report(match[1], "held-false");
      } catch (_) {}
      return;
    }
    if (!window.innerWidth || !window.innerHeight) return;
    const match = OPEN_RE.exec(text);
    if (match) report(match[1], "conversation-open");
  }
  function reportNotification(conversationId, conversation = null) {
    const id = String(conversationId || "");
    if (!UUID_RE.test(id)) return;
    window.postMessage({
      source: "onion-dev-conversation-notification",
      schemaVersion: 2,
      observedAt: Date.now(),
      conversationId: id,
      ...(conversation ? { conversation } : {})
    }, "*");
  }
  function inspectNotificationPayload(payload) {
    const envelopes = Array.isArray(payload) ? payload : [payload];
    for (const envelope of envelopes) {
      if (!envelope || typeof envelope !== "object") continue;
      const topic = String(envelope.topicName || envelope.topic || "").toLowerCase();
      if (!topic.includes("conversations")) continue;
      const body = envelope.eventBody || envelope.body || envelope;
      const conversationId = body?.conversationId || body?.id;
      const observed = collectObservation(body, "")
        .find((item) => item.conversationId === String(conversationId || "")) || null;
      reportNotification(conversationId, observed);
      const participants = Array.isArray(body?.participants) ? body.participants : [];
      for (const participant of participants) {
        if (String(participant?.purpose || "").toLowerCase() !== "agent" || participant?.endTime) continue;
        for (const communication of participant?.messages || []) {
          const communicationId = String(communication?.id || "");
          if (!UUID_RE.test(communicationId)) continue;
          window.postMessage({
            source: "onion-dev-communication",
            conversationId,
            communicationId,
            reason: "notification"
          }, "*");
        }
      }
    }
  }
  function inspectSocketData(data) {
    if (typeof data === "string") {
      try { inspectNotificationPayload(JSON.parse(data)); } catch (_) {}
      return;
    }
    if (data instanceof ArrayBuffer) {
      try { inspectNotificationPayload(JSON.parse(new TextDecoder().decode(data))); } catch (_) {}
      return;
    }
    if (data instanceof Blob) {
      data.text()
        .then((text) => inspectNotificationPayload(JSON.parse(text)))
        .catch(() => {});
    }
  }

  function requestPath(url) {
    try {
      const parsed = new URL(String(url || ""), location.origin);
      if (parsed.hostname !== "api.sae1.pure.cloud") return "";
      return parsed.pathname;
    } catch (_) {
      return "";
    }
  }
  function routeConversationId(path) {
    const match = String(path || "").match(/\/api\/v2\/conversations\/messages\/([0-9a-f-]{36})(?:\/|$)/i);
    return UUID_RE.test(String(match?.[1] || "")) ? match[1] : "";
  }
  function routeKind(path) {
    if (/\/messages\/bulk$/i.test(path)) return "messages_bulk";
    if (/\/communications\//i.test(path)) return "message_send";
    if (/\/participants\//i.test(path)) return "participant";
    if (/\/conversations\/messages\/[0-9a-f-]{36}$/i.test(path)) return "conversation_detail";
    if (/\/conversations(?:\/)?$/i.test(path)) return "conversation_list";
    return "other";
  }
  function observedItemHasMedia(item) {
    const queue = [
      item?.normalizedMessage?.content,
      item?.normalizedMessage?.attachments,
      item?.normalizedMessage?.media,
      item?.attachments,
      item?.attachment,
      item?.media
    ].flat().filter(Boolean);
    const visited = new Set();
    let inspected = 0;
    while (queue.length && inspected < 80) {
      const value = queue.shift();
      if (!value || typeof value !== "object" || visited.has(value)) continue;
      visited.add(value);
      inspected += 1;
      if (Array.isArray(value)) {
        queue.push(...value);
        continue;
      }
      if (
        value.url || value.mediaUrl || value.downloadUrl || value.contentUrl
        || value.attachmentUrl || value.fileName || value.filename
      ) return true;
      const mediaType = String(value.mimeType || value.contentType || "").toLowerCase();
      if (/^(?:image|audio|video|application)\//.test(mediaType)) return true;
      for (const child of Object.values(value)) {
        if (child && typeof child === "object") queue.push(child);
      }
    }
    return false;
  }
  function observedParticipantUserId(participant) {
    const direct = String(participant?.userId || "").trim();
    if (UUID_RE.test(direct)) return direct;
    const match = String(participant?.userUri || "")
      .match(/\/api\/v2\/users\/([0-9a-f-]{36})(?:$|[/?#])/i);
    return UUID_RE.test(String(match?.[1] || "")) ? match[1] : "";
  }
  function observedSenderIdentity(participant, currentAgentParticipantId = "") {
    const purpose = String(participant?.purpose || "").trim().toLowerCase();
    const participantId = String(participant?.id || participant?.participantId || "").trim();
    let senderKind = "system";
    if (purpose === "customer") senderKind = "customer";
    else if (["bot", "botflow", "workflow", "ivr"].includes(purpose)) senderKind = "bot";
    else if (purpose === "agent") {
      senderKind = participantId && participantId === currentAgentParticipantId
        ? "self_agent"
        : "other_agent";
    }
    return {
      purpose,
      participantId: UUID_RE.test(participantId) ? participantId : "",
      participantName: String(participant?.name || "").replace(/\s+/g, " ").trim().slice(0, 200),
      userId: observedParticipantUserId(participant),
      senderKind
    };
  }
  function collectObservation(payload, path) {
    const byConversation = new Map();
    const ensureConversation = (conversationId) => {
      const id = String(conversationId || "");
      if (!UUID_RE.test(id) || byConversation.size >= MAX_OBSERVED_CONVERSATIONS) return null;
      if (!byConversation.has(id)) {
        byConversation.set(id, {
          conversationId: id,
          participantIds: new Set(),
          agentCommunicationIds: new Set(),
          messageIds: new Set(),
           messages: [],
           customerName: "",
           customerDocument: "",
           customerAddress: "",
           customerCity: "",
           customerPhone: "",
           customerLegalName: "",
           customerPppoe: "",
           customerIp: "",
           customerContractId: "",
           customerOlt: "",
           customerPon: "",
           customerBranch: "",
           openedAt: null,
           inactivityTimeout: null,
           agentActive: null,
           active: null
        });
      }
      return byConversation.get(id);
    };
    const addMessageId = (entry, value) => {
      const id = String(value || "");
      if (entry && id && entry.messageIds.size < MAX_OBSERVED_MESSAGE_IDS) entry.messageIds.add(id);
    };
    const inspectConversation = (conversation, fallbackId = "") => {
      if (!conversation || typeof conversation !== "object") return;
      const entry = ensureConversation(conversation.id || conversation.conversationId || fallbackId);
      if (!entry) return;
      const participants = Array.isArray(conversation.participants) ? conversation.participants : [];
      const currentAgentParticipant = participants
        .filter((participant) => (
          String(participant?.purpose || "").toLowerCase() === "agent"
          && !participant?.endTime
        ))
        .sort((left, right) => (
          new Date(right?.connectedTime || right?.startTime || 0).getTime()
          - new Date(left?.connectedTime || left?.startTime || 0).getTime()
        ))[0] || null;
      const currentAgentParticipantId = String(currentAgentParticipant?.id || "");
      let purposeByMessage = messagePurposeByConversation.get(entry.conversationId);
      if (!purposeByMessage) {
        purposeByMessage = new Map();
        messagePurposeByConversation.set(entry.conversationId, purposeByMessage);
        if (messagePurposeByConversation.size > MAX_OBSERVED_CONVERSATIONS) {
          messagePurposeByConversation.delete(messagePurposeByConversation.keys().next().value);
        }
      }
      if (participants.length) {
        entry.openedAt = conversation.startTime || conversation.connectedTime || entry.openedAt;
        entry.inactivityTimeout = conversation.inactivityTimeout || entry.inactivityTimeout;
        entry.active = participants.some((participant) => !participant?.endTime);
        const customer = participants.find(
          (participant) => String(participant?.purpose || "").toLowerCase() === "customer"
        );
        entry.openedAt = entry.openedAt || customer?.connectedTime || customer?.startTime || null;
        entry.customerName = String(customer?.name || "").replace(/\s+/g, " ").trim().slice(0, 200);
        const attributes = customer?.attributes && typeof customer.attributes === "object"
          ? customer.attributes
          : {};
        const attributeValue = (...keys) => {
          for (const key of keys) {
            const value = attributes[key];
            if (value !== undefined && value !== null && String(value).trim()) {
              return String(value).trim();
            }
          }
          return "";
        };
        entry.customerDocument = attributeValue("documento", "Documento", "cpf", "CPF", "cnpj", "CNPJ", "cnpj_cpf").slice(0, 40);
        entry.customerAddress = attributeValue("End_completo", "end_completo", "endereco", "Endereço", "address").slice(0, 500);
        entry.customerCity = attributeValue("cidade", "Cidade", "city").slice(0, 200);
        entry.customerLegalName = attributeValue("Titular", "titular", "nome_cliente", "Nome Cliente").slice(0, 200);
        entry.customerPppoe = attributeValue("PPPoE", "pppoe", "login_pppoe", "Login PPPoE", "login").slice(0, 200);
        entry.customerIp = attributeValue("IP", "ip", "IPv4", "ipv4", "ip_address").slice(0, 80);
        entry.customerContractId = attributeValue("ID_Contrato", "ID contrato", "id_contrato", "contrato_id").slice(0, 80);
        entry.customerOlt = attributeValue("olt", "Olt", "OLT").slice(0, 200);
        entry.customerPon = attributeValue("Pon_Link", "pon_link", "PON", "pon", "pon_id").slice(0, 100);
        entry.customerBranch = attributeValue("ID_Filial", "id_filial", "filial", "Filial").slice(0, 80);
        entry.customerPhone = String(
          (Array.isArray(customer?.messages) ? customer.messages : [])
            .map((communication) => (
              communication?.fromAddress?.addressRaw
              || communication?.fromAddress?.addressNormalized
              || ""
            ))
            .find(Boolean)
          || ""
        ).replace(/\D/g, "").slice(0, 30);
        const agents = participants.filter(
          (participant) => String(participant?.purpose || "").toLowerCase() === "agent"
        );
        entry.agentActive = agents.some((participant) => {
          if (participant?.endTime) return false;
          const communications = Array.isArray(participant?.messages) ? participant.messages : [];
          if (!communications.length) return true;
          return communications.some((communication) => (
            !["disconnected", "terminated"].includes(String(communication?.state || "").toLowerCase())
          ));
        });
      }
      for (const participant of participants) {
        const senderIdentity = observedSenderIdentity(participant, currentAgentParticipantId);
        const participantId = String(participant?.id || participant?.participantId || "");
        if (UUID_RE.test(participantId)) entry.participantIds.add(participantId);
        const purpose = String(participant?.purpose || "").toLowerCase();
        const communications = Array.isArray(participant?.messages) ? participant.messages : [];
        for (const communication of communications) {
          const communicationId = String(communication?.id || "");
          if (
            purpose === "agent"
            && UUID_RE.test(communicationId)
            && !participant?.endTime
            && !["disconnected", "terminated"].includes(String(communication?.state || "").toLowerCase())
          ) {
            entry.agentCommunicationIds.add(communicationId);
          }
          addMessageId(entry, communication?.messageId);
          if (communication?.messageId) purposeByMessage.set(String(communication.messageId), senderIdentity);
          for (const reference of Array.isArray(communication?.messages) ? communication.messages : []) {
            const messageId = String(reference?.messageId || reference?.id || "");
            addMessageId(entry, messageId);
            if (messageId) purposeByMessage.set(messageId, senderIdentity);
          }
        }
      }
    };
    const addBulkMessage = (entry, item) => {
      if (!entry || !item || entry.messages.length >= MAX_OBSERVED_MESSAGE_IDS) return;
      const id = String(item?.id || item?.messageId || "");
      if (!id) return;
      addMessageId(entry, id);
      const rawIdentity = messagePurposeByConversation.get(entry.conversationId)?.get(id) || {};
      const identity = typeof rawIdentity === "string" ? { purpose: rawIdentity } : rawIdentity;
      const purpose = String(identity?.purpose || "").toLowerCase();
      const direction = String(item?.direction || item?.normalizedMessage?.direction || "").toLowerCase();
      const senderKind = String(identity?.senderKind || (
        purpose === "customer" || direction.includes("inbound")
          ? "customer"
          : ["bot", "botflow", "workflow", "ivr"].includes(purpose)
            ? "bot"
            : "self_agent"
      ));
      const sender = senderKind === "customer"
        ? "user"
        : senderKind === "bot"
          ? "bot"
          : senderKind === "system"
            ? "system"
            : "agent";
      const text = String(
        item?.normalizedMessage?.text
        || item?.textBody
        || item?.text
        || ""
      ).trim().slice(0, 20000);
      const timestamp = new Date(
        item?.timestamp || item?.createdTime || item?.time || Date.now()
      ).getTime();
      entry.messages.push({
        id,
        sender,
        senderKind,
        senderPurpose: purpose,
        senderParticipantId: String(identity?.participantId || ""),
        senderName: String(identity?.participantName || ""),
        senderUserId: String(identity?.userId || ""),
        text,
        ts: Number.isFinite(timestamp) ? timestamp : Date.now(),
        hasMedia: observedItemHasMedia(item)
      });
    };

    const fallbackId = routeConversationId(path);
    if (Array.isArray(payload)) {
      if (fallbackId && routeKind(path) === "messages_bulk") {
        const entry = ensureConversation(fallbackId);
        for (const item of payload) addBulkMessage(entry, item);
      } else {
        for (const item of payload) inspectConversation(item, fallbackId);
      }
    } else if (payload && typeof payload === "object") {
      const entities = Array.isArray(payload.entities) ? payload.entities : null;
      if (entities) {
        if (fallbackId && routeKind(path) === "messages_bulk") {
          const entry = ensureConversation(fallbackId);
          for (const item of entities) addBulkMessage(entry, item);
        } else {
          for (const item of entities) inspectConversation(item, fallbackId);
        }
      } else {
        inspectConversation(payload, fallbackId);
      }
    }
    if (!byConversation.size && fallbackId) ensureConversation(fallbackId);
    return [...byConversation.values()].map((entry) => {
      const purposeByMessage = messagePurposeByConversation.get(entry.conversationId) || new Map();
      const messageRefs = [...entry.messageIds]
        .slice(0, MAX_OBSERVED_MESSAGE_IDS)
        .map((id) => ({ id, ...(purposeByMessage.get(id) || {}) }));
      return {
        conversationId: entry.conversationId,
        participantIds: [...entry.participantIds],
        agentCommunicationIds: [...entry.agentCommunicationIds],
        messageIds: [...entry.messageIds],
        messageRefs,
        messages: entry.messages,
        customerName: entry.customerName,
        customerDocument: entry.customerDocument,
        customerAddress: entry.customerAddress,
        customerCity: entry.customerCity,
        customerPhone: entry.customerPhone,
        customerLegalName: entry.customerLegalName,
        customerPppoe: entry.customerPppoe,
        customerIp: entry.customerIp,
        customerContractId: entry.customerContractId,
        customerOlt: entry.customerOlt,
        customerPon: entry.customerPon,
        customerBranch: entry.customerBranch,
        openedAt: entry.openedAt,
        inactivityTimeout: entry.inactivityTimeout,
        agentActive: entry.agentActive,
        active: entry.active
      };
    });
  }
  function publishObservation({ path, method, status, payload, transport }) {
    if (!observationEnabled || !OBSERVED_PATH_RE.test(path)) return;
    const conversations = collectObservation(payload, path);
    window.postMessage({
      source: "onion-dev-network-observation",
      schemaVersion: 1,
      routeKind: routeKind(path),
      method: String(method || "GET").toUpperCase(),
      status: Number(status || 0),
      transport,
      observedAt: Date.now(),
      conversations
    }, "*");
  }
  function observeFetchResponse(response, url, method) {
    if (!observationEnabled || !response || typeof response.clone !== "function") return;
    const path = requestPath(url || response.url);
    if (!path || !OBSERVED_PATH_RE.test(path)) return;
    const contentType = String(response.headers?.get?.("content-type") || "").toLowerCase();
    const declaredSize = Number(response.headers?.get?.("content-length") || 0);
    if (!contentType.includes("json") || declaredSize > MAX_OBSERVED_RESPONSE_BYTES) return;
    response.clone().text().then((text) => {
      if (!text || text.length > MAX_OBSERVED_RESPONSE_BYTES) return;
      let payload;
      try { payload = JSON.parse(text); } catch (_) { return; }
      publishObservation({ path, method, status: response.status, payload, transport: "fetch" });
    }).catch(() => {});
  }
  function observeXhrResponse(xhr) {
    if (!observationEnabled || !xhr) return;
    const path = requestPath(xhr.__onionDevUrl);
    if (!path || !OBSERVED_PATH_RE.test(path)) return;
    const contentType = String(xhr.getResponseHeader?.("content-type") || "").toLowerCase();
    if (!contentType.includes("json") || xhr.responseType === "blob" || xhr.responseType === "arraybuffer") return;
    let text = "";
    try {
      text = xhr.responseType === "json" ? JSON.stringify(xhr.response) : String(xhr.responseText || "");
    } catch (_) {
      return;
    }
    if (!text || text.length > MAX_OBSERVED_RESPONSE_BYTES) return;
    let payload;
    try { payload = xhr.responseType === "json" ? xhr.response : JSON.parse(text); } catch (_) { return; }
    publishObservation({
      path,
      method: xhr.__onionDevMethod,
      status: xhr.status,
      payload,
      transport: "xhr"
    });
  }

  const originalFetch = window.fetch;
  if (typeof originalFetch === "function") {
    window.fetch = function (input, init) {
      const url = typeof input === "string" ? input : input?.url;
      const method = init?.method || input?.method || "GET";
      try { inspect(url, method, init?.body); } catch (_) {}
      const result = originalFetch.apply(this, arguments);
      Promise.resolve(result)
        .then((response) => observeFetchResponse(response, url, method))
        .catch(() => {});
      return result;
    };
  }
  const originalOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (method, url) {
    this.__onionDevMethod = method;
    this.__onionDevUrl = url;
    try { if (!/patch/i.test(method)) inspect(url, method); } catch (_) {}
    return originalOpen.apply(this, arguments);
  };
  const originalSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.send = function (body) {
    try { if (/patch/i.test(this.__onionDevMethod || "")) inspect(this.__onionDevUrl, this.__onionDevMethod, body); } catch (_) {}
    try {
      this.addEventListener("loadend", () => observeXhrResponse(this), { once: true });
    } catch (_) {}
    return originalSend.apply(this, arguments);
  };

  const NativeWebSocket = window.WebSocket;
  if (typeof NativeWebSocket === "function") {
    try {
      window.WebSocket = new Proxy(NativeWebSocket, {
        construct(target, args) {
          const socket = Reflect.construct(target, args, target);
          socket.addEventListener("message", (event) => inspectSocketData(event.data));
          return socket;
        }
      });
    } catch (_) {}
  }

  window.addEventListener("message", (event) => {
    if (event.source !== window || event.data?.source !== "onion-dev-observation-config") return;
    observationEnabled = event.data.enabled !== false;
    window.postMessage({
      source: "onion-dev-network-observation-health",
      installed: true,
      schemaVersion: 1,
      observedAt: Date.now()
    }, "*");
  });
  window.postMessage({
    source: "onion-dev-network-observation-health",
    installed: true,
    schemaVersion: 1,
    observedAt: Date.now()
  }, "*");
})();
