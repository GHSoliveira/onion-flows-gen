(() => {
  if (window.__onionCallDiagnosticContent) return;
  window.__onionCallDiagnosticContent = true;

  const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
  const CARD_SELECTOR = ".interaction-group, .acd-interaction-card-v2";
  const SELECTED_SELECTOR = ".interaction-group.is-selected, .acd-interaction-card-v2.is-selected";
  const HEADER_SELECTOR = "#interaction-header-participant-name, gux-truncate[class*='displayName']";
  let active = false;
  let domTimer = 0;
  let lastDomSignature = "";

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
      return {
        conversationId: conversationIdFromCard(card),
        domId,
        selected: card.matches(SELECTED_SELECTOR) || card.classList.contains("is-selected"),
        connected: card.isConnected,
        voiceHint: /(?:^|[-_ ])(?:call|voice|phone|telefone)(?:$|[-_ ])/.test(searchable),
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
        card.voiceHint
      ])
    });
    if (!force && signature === lastDomSignature) return;
    lastDomSignature = signature;
    chrome.runtime.sendMessage({
      type: "CALL_DIAG_EVENT",
      event: {
        at: Date.now(),
        kind: "dom_roster",
        frame: "top",
        page: `${location.origin}${location.pathname}`,
        snapshot
      }
    }).catch(() => {});
  }

  function scheduleDomSnapshot() {
    if (!active || window !== window.top) return;
    clearTimeout(domTimer);
    domTimer = setTimeout(() => sendDomSnapshot("change"), 100);
  }

  function applyCaptureState(nextActive, phase = "change") {
    setProbeEnabled(nextActive);
    if (!nextActive) {
      clearTimeout(domTimer);
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
    if (message.data?.source !== "onion-call-diagnostic-probe") return;
    const event = message.data.event;
    if (!event || typeof event !== "object") return;
    let encoded = "";
    try { encoded = JSON.stringify(event); } catch (_) { return; }
    if (!encoded || encoded.length > 350000) return;
    chrome.runtime.sendMessage({ type: "CALL_DIAG_EVENT", event }).catch(() => {});
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
