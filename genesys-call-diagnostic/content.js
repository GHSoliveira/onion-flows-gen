(() => {
  if (window.__onionCallDiagnosticContent) return;
  window.__onionCallDiagnosticContent = true;

  const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
  const UUID_EXACT_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const TECH_ID_RE = /^[a-zA-Z0-9_-]{8,160}$/;
  const CARD_SELECTOR = ".interaction-group, .acd-interaction-card-v2";
  const SELECTED_SELECTOR = ".interaction-group.is-selected, .acd-interaction-card-v2.is-selected";
  const HEADER_SELECTOR = "#interaction-header-participant-name, gux-truncate[class*='displayName']";
  let active = false;
  let domTimer = 0;
  let lastDomSignature = "";

  function cleanId(value) {
    const text = String(value || "").trim();
    return UUID_EXACT_RE.test(text) ? text : "";
  }

  function cleanTechnicalId(value) {
    const text = String(value || "").trim();
    return TECH_ID_RE.test(text) ? text : "";
  }

  function cleanTime(value) {
    if (typeof value === "number" && Number.isFinite(value)) return value;
    const text = String(value || "").trim();
    return /^\d{4}-\d{2}-\d{2}T/.test(text) ? text.slice(0, 50) : "";
  }

  function safeReason(value) {
    return String(value || "").replace(/[^a-zA-Z0-9_.:-]/g, "").slice(0, 80);
  }

  function sanitizeOnionObserverConversation(item = {}) {
    return {
      id: cleanId(item.conversationId || item.id),
      participantIds: (Array.isArray(item.participantIds) ? item.participantIds : [])
        .map(cleanId).filter(Boolean).slice(0, 50),
      agentCommunicationIds: (Array.isArray(item.agentCommunicationIds) ? item.agentCommunicationIds : [])
        .map(cleanId).filter(Boolean).slice(0, 20),
      messageIds: (Array.isArray(item.messageIds) ? item.messageIds : [])
        .map(cleanTechnicalId).filter(Boolean).slice(0, 500),
      messageRefs: (Array.isArray(item.messageRefs) ? item.messageRefs : []).slice(0, 500).map((reference) => ({
        id: cleanTechnicalId(reference?.id),
        purpose: safeReason(reference?.purpose),
        participantId: cleanId(reference?.participantId),
        userId: cleanId(reference?.userId),
        senderKind: safeReason(reference?.senderKind)
      })).filter((reference) => reference.id),
      inlineMessages: (Array.isArray(item.messages) ? item.messages : []).slice(0, 500).map((message) => ({
        id: cleanTechnicalId(message?.id),
        sender: safeReason(message?.sender),
        senderKind: safeReason(message?.senderKind),
        senderPurpose: safeReason(message?.senderPurpose),
        senderParticipantId: cleanId(message?.senderParticipantId),
        senderUserId: cleanId(message?.senderUserId),
        timestamp: cleanTime(message?.ts),
        hasText: Boolean(message?.text),
        hasMedia: message?.hasMedia === true
      })).filter((message) => message.id),
      openedAt: cleanTime(item.openedAt),
      assignedAt: cleanTime(item.assignedAt),
      genesysMediaType: ["voice", "message"].includes(String(item.genesysMediaType || "").toLowerCase())
        ? String(item.genesysMediaType).toLowerCase()
        : "",
      callState: safeReason(item?.call?.estado),
      agentActive: typeof item.agentActive === "boolean" ? item.agentActive : null,
      active: typeof item.active === "boolean" ? item.active : null
    };
  }

  function emitDiagnosticEvent(event) {
    if (!active || !event || typeof event !== "object") return;
    chrome.runtime.sendMessage({ type: "CALL_DIAG_EVENT", event }).catch(() => {});
  }

  function setProbeEnabled(value) {
    active = value === true;
    window.postMessage({
      source: "onion-call-diagnostic-control",
      enabled: active
    }, "*");
  }

  function conversationIdFromCard(card) {
    const candidates = [
      card?.getAttribute?.("data-conversation-id"),
      card?.getAttribute?.("data-conversationid"),
      card?.getAttribute?.("data-interaction-id"),
      card?.id
    ];
    for (const node of card?.querySelectorAll?.(
      "[data-conversation-id], [data-conversationid], [data-interaction-id], [href], [id]"
    ) || []) {
      candidates.push(
        node.getAttribute("data-conversation-id"),
        node.getAttribute("data-conversationid"),
        node.getAttribute("data-interaction-id"),
        node.getAttribute("href"),
        node.id
      );
    }
    for (const candidate of candidates) {
      const match = String(candidate || "").match(UUID_RE);
      if (match) return match[0];
    }
    const fallback = String(card?.outerHTML || "").match(UUID_RE);
    return fallback?.[0] || "";
  }

  function collectCards() {
    const groups = [...document.querySelectorAll(".interaction-group")];
    const cards = groups.length ? groups : [...document.querySelectorAll(".acd-interaction-card-v2")];
    return cards.map((card) => {
      const searchable = `${card.className || ""} ${[...card.querySelectorAll("[class]")]
        .slice(0, 30)
        .map((node) => node.className || "")
        .join(" ")}`.toLowerCase();
      const domId = /^ember\d+$/i.test(String(card.id || "")) ? String(card.id) : "";
      const iconNames = [...card.querySelectorAll("gux-icon, [icon-name], [name]")]
        .map((node) => node.getAttribute("icon-name") || node.getAttribute("name") || "")
        .map((value) => String(value).trim().toLowerCase())
        .filter((value) => /^[a-z0-9_-]{2,60}$/.test(value))
        .slice(0, 20);
      const voiceHint = /(?:^|[-_ ])(?:call|voice|phone|telefone)(?:$|[-_ ])/.test(searchable)
        || iconNames.some((name) => /phone|call|voice/.test(name));
      const messageHint = /(?:^|[-_ ])(?:message|messaging|chat)(?:$|[-_ ])/.test(searchable)
        || iconNames.some((name) => /message|chat/.test(name));
      return {
        conversationId: conversationIdFromCard(card),
        domId,
        selected: card.matches(SELECTED_SELECTOR) || card.classList.contains("is-selected"),
        connected: card.isConnected,
        voiceHint,
        messageHint,
        mediaHint: voiceHint ? "voice" : messageHint ? "message" : "unknown",
        iconNames,
        classes: [...card.classList].slice(0, 30),
        attributeNames: [...card.attributes].map((attribute) => attribute.name).slice(0, 30)
      };
    });
  }

  function domSnapshot(phase = "change") {
    const cards = collectCards();
    const selectedCard = document.querySelector(SELECTED_SELECTOR);
    return {
      phase,
      count: cards.length,
      headerPresent: Boolean(document.querySelector(HEADER_SELECTOR)),
      selectedConversationId: conversationIdFromCard(selectedCard),
      cards
    };
  }

  function sendDomSnapshot(phase = "change", force = false) {
    if (!active || window !== window.top) return;
    const snapshot = domSnapshot(phase);
    const signature = JSON.stringify({
      count: snapshot.count,
      selectedConversationId: snapshot.selectedConversationId,
      cards: snapshot.cards.map((card) => [
        card.conversationId,
        card.domId,
        card.selected,
        card.connected,
        card.mediaHint,
        card.iconNames
      ])
    });
    if (!force && signature === lastDomSignature) return;
    lastDomSignature = signature;
    emitDiagnosticEvent({
      at: Date.now(),
      kind: "dom_roster",
      frame: "top",
      page: `${location.origin}${location.pathname}`,
      snapshot
    });
  }

  function scheduleDomSnapshot() {
    if (!active || window !== window.top) return;
    if (domTimer) return;
    domTimer = setTimeout(() => {
      domTimer = 0;
      sendDomSnapshot("change");
    }, 25);
  }

  function applyCaptureState(nextActive, phase = "change") {
    setProbeEnabled(nextActive);
    if (!nextActive) {
      clearTimeout(domTimer);
      domTimer = 0;
      return;
    }
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", () => sendDomSnapshot(phase, true), { once: true });
    } else {
      sendDomSnapshot(phase, true);
    }
  }

  window.addEventListener("message", (message) => {
    if (!active || message.source !== window) return;
    const data = message.data || {};
    if (data.source === "onion-dev-sync-stage") {
      const event = data.event || {};
      emitDiagnosticEvent({
        at: Number(event.at || Date.now()),
        kind: "onion_pipeline",
        conversationId: cleanId(event.conversationId),
        stage: safeReason(event.stage),
        expectedCount: Number(event.expectedCount || 0),
        hydratedCount: Number(event.hydratedCount || 0),
        storedCount: Number(event.storedCount || 0),
        missingCount: Number(event.missingCount || 0),
        pendingCount: Number(event.pendingCount || 0),
        attempt: Number(event.attempt || 0),
        latencyMs: Number(event.latencyMs || 0),
        result: safeReason(event.result),
        reason: safeReason(event.reason),
        source: safeReason(event.source),
        messageId: cleanTechnicalId(event.messageId),
        traceId: safeReason(event.traceId),
        persisted: event.persisted === true,
        volatile: event.volatile === true,
        complete: event.complete === true
      });
      return;
    }
    if (data.source === "onion-call-diagnostic-probe") {
      const event = data.event;
      if (!event || typeof event !== "object") return;
      let encoded = "";
      try { encoded = JSON.stringify(event); } catch (_) { return; }
      if (!encoded || encoded.length > 350000) return;
      emitDiagnosticEvent(event);
      return;
    }
    if (data.source === "onion-dev-network-observation-health") {
      emitDiagnosticEvent({
        at: Date.now(),
        kind: "onion_observer",
        observerEvent: "health",
        installed: data.installed === true,
        schemaVersion: Number(data.schemaVersion || 0)
      });
      return;
    }
    if (data.source === "onion-dev-network-observation") {
      emitDiagnosticEvent({
        at: Number(data.observedAt || Date.now()),
        kind: "onion_observer",
        observerEvent: "network_observation",
        schemaVersion: Number(data.schemaVersion || 0),
        routeKind: safeReason(data.routeKind),
        method: safeReason(data.method),
        status: Number(data.status || 0),
        transport: safeReason(data.transport),
        conversations: (Array.isArray(data.conversations) ? data.conversations : [])
          .slice(0, 200)
          .map(sanitizeOnionObserverConversation)
          .filter((item) => item.id)
      });
      return;
    }
    if (data.source === "onion-dev-conversation-notification") {
      emitDiagnosticEvent({
        at: Number(data.observedAt || Date.now()),
        kind: "onion_observer",
        observerEvent: "conversation_notification",
        schemaVersion: Number(data.schemaVersion || 0),
        conversationId: cleanId(data.conversationId),
        conversations: data.conversation
          ? [sanitizeOnionObserverConversation(data.conversation)].filter((item) => item.id)
          : []
      });
      return;
    }
    if (data.source === "onion-dev-communication") {
      emitDiagnosticEvent({
        at: Date.now(),
        kind: "onion_observer",
        observerEvent: "communication_candidate",
        conversationId: cleanId(data.conversationId),
        communicationId: cleanId(data.communicationId),
        reason: safeReason(data.reason)
      });
      return;
    }
    if (data.source === "onion-dev-focus") {
      emitDiagnosticEvent({
        at: Date.now(),
        kind: "onion_observer",
        observerEvent: "focus_candidate",
        conversationId: cleanId(data.conversationId),
        reason: safeReason(data.reason)
      });
    }
  });

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.type !== "CALL_DIAG_SET_ACTIVE") return;
    applyCaptureState(message.active === true, message.phase);
    sendResponse({ ok: true });
  });

  const observer = new MutationObserver(scheduleDomSnapshot);
  const startObserver = () => observer.observe(document.documentElement || document, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["class", "data-conversation-id", "data-conversationid", "data-interaction-id"]
  });
  if (document.documentElement) startObserver();
  else document.addEventListener("DOMContentLoaded", startObserver, { once: true });

  chrome.runtime.sendMessage({ type: "CALL_DIAG_FRAME_READY" })
    .then((status) => applyCaptureState(status?.active === true, "change"))
    .catch(() => {});
})();
