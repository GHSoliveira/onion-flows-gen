(() => {
  if (window.__onionDevContent) return;
  window.__onionDevContent = true;

  const NAME_SELECTORS = [
    "#interaction-header-participant-name",
    'gux-truncate[class*="displayName"]'
  ];
  const MESSAGE_SELECTORS = [
    "[data-message-id]",
    "[data-automation-id*='message']",
    ".message-content",
    "[class*='messageContent']"
  ];
  const RELEVANT_DOM_SELECTOR = [
    ...NAME_SELECTORS,
    ".interaction-group",
    ".acd-interaction-card-v2",
    ...MESSAGE_SELECTORS
  ].join(",");
  const SELECTED_CARD_SELECTOR = ".interaction-group.is-selected, .acd-interaction-card-v2.is-selected";
  const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
  let localConversationId = "";
  let lastCardConversationId = "";
  let lastName = "";
  let lastBatchSignature = "";
  let scanTimer = 0;
  let pendingConfirmedConversationId = "";
  let lastRosterSignature = "";
  let rosterShapeSignature = "";
  let rosterShapeChangedAt = Date.now();
  let fallbackTimer = 0;
  const contentStartedAt = Date.now();
  const ROSTER_CLOSE_GRACE_MS = 15000;
  const ROSTER_STABLE_MS = 1500;
  const CONFIRMED_CARD_MISSING_GRACE_MS = 1500;
  const TOP_FRAME_FALLBACK_MS = 1250;
  const GADGET_FRAME_FALLBACK_MS = 1800;
  const IDLE_FRAME_FALLBACK_MS = 5000;
  const confirmedCards = new Map();
  const cardConversationCache = new WeakMap();
  const isMessagingGadget = location.href.includes("messaging-gadget");
  const isTopFrame = window === window.top;

  function normalizeName(value) {
    return String(value || "").replace(/\s+/g, " ").trim();
  }
  function participantName() {
    for (const selector of NAME_SELECTORS) {
      const name = normalizeName(document.querySelector(selector)?.textContent);
      if (name) return name;
    }
    return "";
  }
  function hash(value) {
    let result = 2166136261;
    for (let index = 0; index < value.length; index += 1) {
      result ^= value.charCodeAt(index);
      result = Math.imul(result, 16777619);
    }
    return (result >>> 0).toString(16);
  }
  function senderFor(node) {
    const context = `${node.className || ""} ${node.parentElement?.className || ""}`.toLowerCase();
    return /agent|outbound|right/.test(context) ? "agent" : "user";
  }
  function collectMessages() {
    const seen = new Set();
    const nodes = [];
    for (const selector of MESSAGE_SELECTORS) {
      for (const node of document.querySelectorAll(selector)) {
        if (!seen.has(node)) { seen.add(node); nodes.push(node); }
      }
    }
    return nodes.map((node, index) => {
      const text = String(node.innerText || node.textContent || "").replace(/\s+/g, " ").trim();
      const sender = senderFor(node);
      const nativeId = node.getAttribute("data-message-id") || node.id || "";
      return { id: nativeId || `dom_${hash(`${sender}|${text}|${index}`)}`, sender, text, ts: Date.now() };
    }).filter((message) => message.text && message.text.length <= 20000);
  }
  function selectedCardConversationId() {
    if (window !== window.top) return "";
    const card = document.querySelector(SELECTED_CARD_SELECTOR);
    if (!card) return "";
    return cardConversationId(card);
  }
  function cardConversationId(card) {
    if (!card) return "";
    const cached = cardConversationCache.get(card);
    if (cached?.id) return cached.id;
    if (cached && Date.now() - cached.checkedAt < 5000) return "";
    const candidates = [
      card.getAttribute("data-conversation-id"),
      card.getAttribute("data-conversationid"),
      card.getAttribute("data-id"),
      card.getAttribute("data-interaction-id"),
      card.id
    ];
    for (const node of card.querySelectorAll(
      "[data-conversation-id], [data-conversationid], [data-interaction-id], [href], [id]"
    )) {
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
      if (match) {
        cardConversationCache.set(card, { id: match[0], checkedAt: Date.now() });
        return match[0];
      }
    }
    // Fallback caro para versões do Genesys que escondem o UUID em outro
    // atributo. É executado no máximo uma vez a cada 5 s por card.
    const fallbackMatch = String(card.outerHTML || "").match(UUID_RE);
    const id = fallbackMatch?.[0] || "";
    cardConversationCache.set(card, { id, checkedAt: Date.now() });
    if (id) return id;
    return "";
  }
  function reportSelectedCard() {
    const conversationId = selectedCardConversationId();
    if (!conversationId || conversationId === lastCardConversationId) return;
    lastCardConversationId = conversationId;
    localConversationId = conversationId;
    lastBatchSignature = "";
    chrome.runtime.sendMessage({
      type: "DEV_FOCUS_CANDIDATE",
      conversationId,
      reason: "selected-card"
    }).catch(() => {});
  }
  function reportCardRoster() {
    if (window !== window.top) return;
    // O acd-interaction-card-v2 costuma estar dentro de interaction-group.
    // Usar os dois seletores juntos contava cada cliente duas vezes.
    const interactionGroups = [...document.querySelectorAll(".interaction-group")];
    const cards = interactionGroups.length
      ? interactionGroups
      : [...document.querySelectorAll(".acd-interaction-card-v2")];
    const names = cards.map((card) => normalizeName(
      card.querySelector(".participant-name, .cpf-card-name")?.textContent
    )).filter(Boolean);
    const conversationIds = [...new Set(cards.map(cardConversationId).filter(Boolean))];
    const shapeSignature = `${cards.length}|${conversationIds.slice().sort().join("|")}|${names.slice().sort().join("|")}`;
    if (shapeSignature !== rosterShapeSignature) {
      rosterShapeSignature = shapeSignature;
      rosterShapeChangedAt = Date.now();
    }
    const allowClose = Date.now() - contentStartedAt >= ROSTER_CLOSE_GRACE_MS
      && Date.now() - rosterShapeChangedAt >= ROSTER_STABLE_MS;
    // A mudança false → true também precisa ser enviada, mesmo sem alteração
    // nos cards, para liberar encerramentos apenas depois da remontagem.
    const signature = `${shapeSignature}|close:${allowClose}`;
    if (signature === lastRosterSignature) return;
    lastRosterSignature = signature;
    chrome.runtime.sendMessage({
      type: "DEV_CARD_ROSTER",
      count: cards.length,
      names,
      conversationIds,
      allowClose
    }).catch(() => {});
  }
  function reportParticipant() {
    if (window !== window.top) return;
    const name = participantName();
    if (name === lastName) return;
    lastName = name;
    chrome.runtime.sendMessage({ type: "DEV_PARTICIPANT", name, href: location.href }).catch(() => {});
  }
  function checkConfirmedCards() {
    if (window !== window.top || !confirmedCards.size) return;
    const now = Date.now();
    for (const [conversationId, binding] of confirmedCards) {
      const present = binding.cardDomId
        ? !!document.getElementById(binding.cardDomId)
        : !!binding.node?.isConnected;
      if (present) {
        binding.missingSince = 0;
        continue;
      }
      if (!binding.missingSince) {
        binding.missingSince = now;
        continue;
      }
      // Aguarda uma remontagem curta do React/Ember sem depender do polling.
      if (now - binding.missingSince < CONFIRMED_CARD_MISSING_GRACE_MS) continue;
      confirmedCards.delete(conversationId);
      chrome.runtime.sendMessage({
        type: "DEV_CARD_REMOVED",
        conversationId,
        reason: "genesys_card_removed"
      }).catch(() => {});
    }
  }
  function bindPendingConversationToCard() {
    if (window !== window.top || !pendingConfirmedConversationId) return;
    const card = document.querySelector(SELECTED_CARD_SELECTOR);
    if (!card) return;
    confirmedCards.set(pendingConfirmedConversationId, {
      cardDomId: String(card.id || ""),
      node: card,
      missingSince: 0
    });
    pendingConfirmedConversationId = "";
  }
  function scan() {
    reportParticipant();
    reportCardRoster();
    reportSelectedCard();
    bindPendingConversationToCard();
    checkConfirmedCards();
    if (!localConversationId) return;
    const messages = collectMessages();
    if (!messages.length) return;
    const signature = hash(messages.map((message) => `${message.id}:${message.text}`).join("|"));
    if (signature === lastBatchSignature) return;
    lastBatchSignature = signature;
    chrome.runtime.sendMessage({ type: "DEV_MESSAGES", conversationId: localConversationId, messages }).catch(() => {});
  }
  function scheduleScan() {
    clearTimeout(scanTimer);
    scanTimer = setTimeout(scan, 160);
  }
  function mutationTouchesRelevantDom(records) {
    const isRelevantElement = (node) => {
      if (!node || node.nodeType !== Node.ELEMENT_NODE) return false;
      return node.matches?.(RELEVANT_DOM_SELECTOR)
        || node.closest?.(RELEVANT_DOM_SELECTOR)
        || node.querySelector?.(RELEVANT_DOM_SELECTOR);
    };
    for (const record of records) {
      if (record.type === "characterData") {
        if (record.target?.parentElement?.closest?.(RELEVANT_DOM_SELECTOR)) return true;
        continue;
      }
      if (isRelevantElement(record.target)) return true;
      for (const node of record.addedNodes || []) {
        if (isRelevantElement(node)) return true;
      }
      for (const node of record.removedNodes || []) {
        if (isRelevantElement(node)) return true;
      }
    }
    return false;
  }
  function fallbackDelay() {
    if (document.visibilityState === "hidden") return IDLE_FRAME_FALLBACK_MS;
    if (isTopFrame) return TOP_FRAME_FALLBACK_MS;
    if (isMessagingGadget || localConversationId) return GADGET_FRAME_FALLBACK_MS;
    return IDLE_FRAME_FALLBACK_MS;
  }
  function scheduleFallbackScan() {
    clearTimeout(fallbackTimer);
    fallbackTimer = setTimeout(() => {
      scan();
      scheduleFallbackScan();
    }, fallbackDelay());
  }
  function sanitizeObservedConversation(item) {
    return {
      conversationId: String(item?.conversationId || ""),
      participantIds: (Array.isArray(item?.participantIds) ? item.participantIds : []).slice(0, 30).map(String),
      agentCommunicationIds: (Array.isArray(item?.agentCommunicationIds) ? item.agentCommunicationIds : []).slice(0, 10).map(String),
      messageIds: (Array.isArray(item?.messageIds) ? item.messageIds : []).slice(0, 500).map(String),
      messageRefs: (Array.isArray(item?.messageRefs) ? item.messageRefs : []).slice(0, 500).map((reference) => ({
        id: String(reference?.id || "").slice(0, 200),
        purpose: String(reference?.purpose || "").slice(0, 40),
        participantId: String(reference?.participantId || "").slice(0, 80),
        participantName: String(reference?.participantName || "").replace(/\s+/g, " ").trim().slice(0, 200),
        userId: String(reference?.userId || "").slice(0, 80),
        senderKind: String(reference?.senderKind || "").slice(0, 40)
      })),
      messages: (Array.isArray(item?.messages) ? item.messages : []).slice(0, 500).map((message) => ({
        id: String(message?.id || "").slice(0, 200),
        sender: ["user", "agent", "bot", "system"].includes(String(message?.sender || ""))
          ? String(message.sender)
          : "agent",
        senderKind: String(message?.senderKind || "").slice(0, 40),
        senderPurpose: String(message?.senderPurpose || "").slice(0, 40),
        senderParticipantId: String(message?.senderParticipantId || "").slice(0, 80),
        senderName: String(message?.senderName || "").replace(/\s+/g, " ").trim().slice(0, 200),
        senderUserId: String(message?.senderUserId || "").slice(0, 80),
        text: String(message?.text || "").slice(0, 20000),
        ts: Number(message?.ts || Date.now()),
        hasMedia: message?.hasMedia === true
      })),
      customerName: String(item?.customerName || "").replace(/\s+/g, " ").trim().slice(0, 200),
      customerDocument: String(item?.customerDocument || "").trim().slice(0, 40),
      customerAddress: String(item?.customerAddress || "").replace(/\s+/g, " ").trim().slice(0, 500),
      customerCity: String(item?.customerCity || "").replace(/\s+/g, " ").trim().slice(0, 200),
      customerPhone: String(item?.customerPhone || "").replace(/\D/g, "").slice(0, 30),
      customerLegalName: String(item?.customerLegalName || "").replace(/\s+/g, " ").trim().slice(0, 200),
      customerPppoe: String(item?.customerPppoe || "").trim().slice(0, 200),
      customerIp: String(item?.customerIp || "").trim().slice(0, 80),
      customerContractId: String(item?.customerContractId || "").trim().slice(0, 80),
      customerOlt: String(item?.customerOlt || "").replace(/\s+/g, " ").trim().slice(0, 200),
      customerPon: String(item?.customerPon || "").trim().slice(0, 100),
      customerBranch: String(item?.customerBranch || "").trim().slice(0, 80),
      assignedAt: item?.assignedAt || null,
      openedAt: item?.openedAt || null,
      inactivityTimeout: item?.inactivityTimeout || null,
      genesysMediaType: String(item?.genesysMediaType || "").toLowerCase() === "voice" ? "voice" : "",
      call: item?.call && typeof item.call === "object" ? {
        estado: String(item.call.estado || "").slice(0, 30),
        conectadoEm: Number(item.call.conectadoEm || 0) || null,
        desde: Number(item.call.desde || 0) || null,
        direcao: String(item.call.direcao || "").slice(0, 20),
        ani: String(item.call.ani || "").replace(/\D/g, "").slice(0, 30),
        dnis: String(item.call.dnis || "").replace(/\D/g, "").slice(0, 30)
      } : null,
      agentActive: typeof item?.agentActive === "boolean" ? item.agentActive : null,
      active: typeof item?.active === "boolean" ? item.active : null
    };
  }
  window.addEventListener("message", (event) => {
    const data = event.data;
    if (event.source !== window || !data?.source) return;
    if (data.source === "onion-dev-network-observation-health") {
      chrome.runtime.sendMessage({
        type: "DEV_NETWORK_OBSERVATION_HEALTH",
        installed: data.installed === true,
        schemaVersion: Number(data.schemaVersion || 0),
        observedAt: Number(data.observedAt || Date.now())
      }).catch(() => {});
      return;
    }
    if (data.source === "onion-dev-network-observation") {
      const conversations = (Array.isArray(data.conversations) ? data.conversations : [])
        .slice(0, 200)
        .map(sanitizeObservedConversation);
      chrome.runtime.sendMessage({
        type: "DEV_NETWORK_OBSERVATION",
        schemaVersion: Number(data.schemaVersion || 0),
        routeKind: String(data.routeKind || "other").slice(0, 40),
        method: String(data.method || "GET").slice(0, 10),
        status: Number(data.status || 0),
        transport: String(data.transport || "").slice(0, 10),
        observedAt: Number(data.observedAt || Date.now()),
        conversations
      }).catch(() => {});
      return;
    }
    if (!data.conversationId) return;
    if (data.source === "onion-dev-conversation-notification") {
      chrome.runtime.sendMessage({
        type: "DEV_CONVERSATION_NOTIFICATION",
        schemaVersion: Number(data.schemaVersion || 1),
        observedAt: Number(data.observedAt || Date.now()),
        conversationId: String(data.conversationId),
        ...(data.conversation ? {
          conversation: sanitizeObservedConversation(data.conversation)
        } : {})
      }).catch(() => {});
      return;
    }
    if (data.source === "onion-dev-communication" && data.communicationId) {
      chrome.runtime.sendMessage({
        type: "DEV_COMMUNICATION_CANDIDATE",
        conversationId: String(data.conversationId),
        communicationId: String(data.communicationId),
        reason: data.reason || "genesys-web"
      }).catch(() => {});
      return;
    }
    if (data.source !== "onion-dev-focus") return;
    localConversationId = String(data.conversationId);
    lastBatchSignature = "";
    chrome.runtime.sendMessage({ type: "DEV_FOCUS_CANDIDATE", conversationId: localConversationId, reason: data.reason || "network" }).catch(() => {});
    scheduleScan();
  });
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === "DEV_SYNC_DIAGNOSTIC_STAGE" && message.event) {
      window.postMessage({
        source: "onion-dev-sync-stage",
        event: message.event
      }, "*");
      sendResponse({ ok: true });
      return;
    }
    if (message?.type === "DEV_NETWORK_OBSERVATION_CONFIG") {
      window.postMessage({
        source: "onion-dev-observation-config",
        enabled: message.enabled !== false
      }, "*");
      sendResponse({ ok: true });
      return;
    }
    if (message?.type === "DEV_FOCUS_COMMITTED" && window === window.top && message.conversationId) {
      pendingConfirmedConversationId = String(message.conversationId);
      bindPendingConversationToCard();
    }
  });

  const start = () => {
    // Frames sem lista de interações e sem gadget só encaminham os eventos
    // passivos de rede; não precisam observar nem varrer o DOM continuamente.
    if (isTopFrame || isMessagingGadget) {
      const observer = new MutationObserver((records) => {
        if (!mutationTouchesRelevantDom(records)) return;
        scheduleScan();
      });
      observer.observe(document.documentElement, { subtree: true, childList: true, characterData: true });
    }
    scheduleFallbackScan();
    reportParticipant();
    if (isMessagingGadget) {
      chrome.runtime.sendMessage({ type: "DEV_REGISTER_GADGET_FRAME" }).catch(() => {});
    }
    chrome.runtime.sendMessage({ type: "DEV_NETWORK_OBSERVATION_CONFIG_REQUEST" })
      .then((result) => {
        window.postMessage({
          source: "onion-dev-observation-config",
          enabled: result?.enabled !== false
        }, "*");
      })
      .catch(() => {});
  };
  if (document.documentElement) start();
  else document.addEventListener("DOMContentLoaded", start, { once: true });
})();
