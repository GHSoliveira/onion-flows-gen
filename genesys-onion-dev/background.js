importScripts("external-status.js", "lib/socket.io.min.js");

const EXTENSION_BUILD = "2026.08.05.4";
const SETTINGS_KEY = "onionDevSettings";
const AUTH_KEY = "onionDevAuth";
const COMMUNICATIONS_KEY = "onionDevCommunications";
const SYNC_OUTBOX_KEY = "onionDevSyncOutbox";
const CLOSE_OUTBOX_KEY = "onionDevCloseOutbox";
const DELTA_OUTBOX_KEY = "onionDevDeltaOutbox";
const IXC_OS_COMMAND_TTL_MS = 10 * 60 * 1000;
const ixcOsCommandCache = new Map();
const IXC_USER_CONFIG_KEY = "ixcUserConfig";
const DEFAULTS = {
  enabled: false,
  baseUrl: "http://127.0.0.1:3101",
  observeNetwork: true,
  passiveMessageDeltas: true,
  passiveConversationDiscovery: true,
  passiveRoster: true,
  apiGovernor: true
};
const MAX_QUEUE = 500;
const ACK_TIMEOUT_MS = 8000;
const RATE_LIMIT_PER_MINUTE = 120;
const OUTBOUND_MAX_LENGTH = 10000;
const OUTBOUND_RATE_PER_MINUTE = 30;
const OUTBOUND_MEDIA_RATE_PER_MINUTE = 10;
const OUTBOUND_MEDIA_MAX_BYTES = 25 * 1024 * 1024;
const MAX_OUTBOUND_MEDIA_CONCURRENCY = 2;
const COMMUNICATION_WAIT_MS = 15000;
const COMMUNICATION_MAX_AGE_MS = 12 * 60 * 60 * 1000;
const NOTIFICATION_DEBOUNCE_MS = 300;
const NOTIFICATION_SNAPSHOT_MAX_AGE_MS = 15000;
const MAX_CONVERSATION_SYNC_CONCURRENCY = 5;
const MAX_PASSIVE_CONVERSATION_CONCURRENCY = 5;
const MAX_ONION_DELIVERY_CONCURRENCY = 5;
const MAX_MEDIA_HYDRATION_CONCURRENCY = 1;
const GENESYS_NORMAL_CALLS_PER_MINUTE = 30;
const GENESYS_EMERGENCY_CALLS_PER_MINUTE = 40;
const GENESYS_MAX_CONCURRENT_CALLS = 2;
const GENESYS_REQUEST_QUEUE_MAX = 200;
const MAX_PERSISTED_SNAPSHOT_BYTES = 600000;
const MAX_SYNC_OUTBOX_BYTES = 2000000;
const MAX_DELTA_OUTBOX_BYTES = 2500000;
const MAX_CLOSE_OUTBOX_BYTES = 350000;
const PASSIVE_ROSTER_MAX_AGE_MS = 5000;
const PASSIVE_ROSTER_AUDIT_INTERVAL_MS = 2 * 60 * 1000;
const STARTUP_ROSTER_WAIT_MS = 3500;
const STARTUP_ROSTER_CONFIRMATION_WINDOW_MS = 10000;
const STARTUP_ROSTER_CACHE_MS = 30000;
const STARTUP_ROSTER_API_RETRY_MS = 30000;
const CLOSED_STATE_RETENTION_MS = 30 * 60 * 1000;
const AUTHORITATIVE_ROSTER_AUDIT_MS = 2 * 60 * 1000;
const AUTHORITATIVE_ROSTER_CACHE_MS = 30000;
const GENESYS_TRANSFER_DIVISIONS_CACHE_MS = 10 * 60 * 1000;
const GENESYS_CURRENT_USER_CACHE_MS = 10 * 60 * 1000;
const GENESYS_TRANSFER_SEARCH_CACHE_MS = 30 * 1000;
const GENESYS_TRANSFER_QUEUE_APPROVAL_MS = 5 * 60 * 1000;
const GENESYS_TRANSFER_MAX_DIVISIONS = 3;
const ZAAZ_SEARCH_URL = "https://sistema.zaaztelecom.com.br/aplicativo/cliente/action/action.php?action=grid&relation=true&advanced_search=false";
const ZAAZ_OS_URL = "https://sistema.zaaztelecom.com.br/aplicativo/su_oss_chamado/action/action.php?action=grid&relation=true&advanced_search=false";
const ZAAZ_LOGIN_URL = "https://sistema.zaaztelecom.com.br/aplicativo/radusuarios/action/action.php?action=grid&relation=true&advanced_search=false";
const ZAAZ_OS_CLOSE_URL = "https://sistema.zaaztelecom.com.br/aplicativo/su_oss_chamado_fechar/action/action.php?action=novo";
const ZAAZ_OS_SECTOR_URL = "https://sistema.zaaztelecom.com.br/aplicativo/su_oss_chamado_alterar_setor/action/action.php?action=novo";
const ZAAZ_OS_SCHEDULE_URL = "https://sistema.zaaztelecom.com.br/aplicativo/su_oss_chamado_reagendar/action/action.php?action=novo";
const ZAAZ_OS_FILES_URL = "https://sistema.zaaztelecom.com.br/aplicativo/su_oss_chamado_arquivos/action/action.php?action=novo";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const OUTBOX_KEYS = [SYNC_OUTBOX_KEY, DELTA_OUTBOX_KEY, CLOSE_OUTBOX_KEY];
const outboxStorage = () => chrome.storage.session || chrome.storage.local;
const OUTBOX_BATCH_WRITE_MS = 75;
const outboxMemoryCache = new Map();
const outboxWriteTimers = new Map();
const GENESYS_OUTBOUND_MEDIA_MIMES = new Set([
  "image/jpeg", "image/png", "image/webp", "image/gif",
  "video/mp4", "video/webm", "video/quicktime",
  "audio/mpeg", "audio/ogg", "audio/wav", "audio/webm",
  "application/pdf"
]);
let socket = null;
let connecting = null;
let focused = { conversationId: "", name: "", generation: 0, at: 0 };
let pendingFocus = { conversationId: "", at: 0 };
const queue = [];
const conversations = new Map();
const logs = [];
const extensionErrorNotifications = new Map();
const EXTENSION_ERROR_DEDUPE_MS = 60000;
const rateWindow = [];
let participantResolveSeq = 0;
let focusValidationSeq = 0;
let lastParticipantResolve = { key: "", at: 0 };
let participantTabId = null;
const registeredGadgetFrames = new Set();
const gadgetFrameByConversation = new Map();
const communicationIdByConversation = new Map();
const communicationWaiters = new Map();
let rosterReconcileTimer = 0;
let rosterReconcileSeq = 0;
const closureSuspicions = new Map();
const outboundCommands = new Map();
const outboundRateWindow = [];
const outboundMediaRateWindow = [];
const outboundMediaConversationsInFlight = new Set();
let activeOutboundMediaUploads = 0;
const notificationTimers = new Map();
const notificationSnapshots = new Map();
const quarantinedNotificationIds = new Set();
const manualReloadAt = new Map();
const pendingConversationSyncs = new Set();
let activeConversationSyncs = 0;
let outboxMutation = Promise.resolve();
let closeOutboxMutation = Promise.resolve();
let deltaOutboxMutation = Promise.resolve();
let outboxStorageRecovery = Promise.resolve();
let startupStorageRepair = Promise.resolve();
const volatileSyncOutbox = new Map();
const snapshotDeliveriesInFlight = new Set();
const deltaDeliveriesInFlight = new Set();
const mediaHydrationQueue = [];
let activeMediaHydrations = 0;
const observationDivergenceLogAt = new Map();
const inactiveNotificationLogAt = new Map();
let latestPassiveRoster = { ids: new Set(), at: 0 };
let latestDomRoster = { ids: new Set(), count: 0, complete: false, at: 0 };
let passiveRosterCandidate = {
  signature: "",
  ids: new Set(),
  confirmations: 0,
  firstAt: 0,
  lastAt: 0
};
let deliveryRosterGuard = {
  generation: 0,
  blocking: true,
  authoritative: false,
  activeIds: new Set(),
  startedAt: 0,
  confirmedAt: 0,
  source: "startup"
};
let lastAuthoritativeRoster = { ids: new Set(), at: 0, source: "none" };
let lastStartupRosterApiAttemptAt = 0;
let startupRosterRetryTimer = 0;
let lastPassiveRosterAuditAt = 0;
let lastAuthoritativeRosterAuditAt = 0;
const authoritativeConversationDetails = new Map();
let genesysTransferDivisionsCache = { divisions: [], at: 0 };
let genesysCurrentUserCache = { id: "", at: 0 };
const genesysTransferSearchCache = new Map();
const genesysTransferQueueApprovals = new Map();
const observationMetrics = {
  installed: false,
  schemaVersion: 0,
  installedAt: 0,
  lastResponseAt: 0,
  responses: 0,
  conversationSightings: 0,
  messageReferences: 0,
  divergentConversations: 0,
  passiveMessageCandidates: 0,
  passiveMessagesApplied: 0,
  passiveMediaFallbacks: 0,
  passiveMessagesSkipped: 0,
  passiveDiscoveryCandidates: 0,
  passiveConversationsCreated: 0,
  passiveDiscoveryRejected: 0,
  notificationFrames: 0,
  notificationMessageReferences: 0,
  notificationTargetedSyncs: 0,
  lastRouteKind: "",
  lastTransport: ""
};
const genesysApiCallWindow = [];
const genesysGovernorStartWindow = [];
const genesysGovernorQueue = [];
const genesysGovernorActiveConversations = new Set();
let genesysGovernorActive = 0;
let genesysGovernorSeq = 0;
let genesysGovernorTimer = 0;
let genesysGovernorBackoffUntil = 0;
const genesysApiMetrics = {
  totalCalls: 0,
  failedCalls: 0,
  rateLimitedCalls: 0,
  lastCallAt: 0,
  lastStatus: 0,
  peakCallsPerMinute: 0
};

async function mapWithConcurrency(items, limit, worker) {
  const list = Array.isArray(items) ? items : [];
  if (!list.length) return [];
  const results = new Array(list.length);
  let nextIndex = 0;
  const workerCount = Math.min(
    list.length,
    Math.max(1, Math.floor(Number(limit) || 1))
  );
  await Promise.all(Array.from({ length: workerCount }, async () => {
    while (nextIndex < list.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await worker(list[index], index);
    }
  }));
  return results;
}

function drainMediaHydrationQueue() {
  while (
    activeMediaHydrations < MAX_MEDIA_HYDRATION_CONCURRENCY
    && mediaHydrationQueue.length
  ) {
    const job = mediaHydrationQueue.shift();
    activeMediaHydrations += 1;
    Promise.resolve()
      .then(job.execute)
      .then(job.resolve, job.reject)
      .finally(() => {
        activeMediaHydrations -= 1;
        drainMediaHydrationQueue();
      });
  }
}

function scheduleMediaHydration(execute) {
  return new Promise((resolve, reject) => {
    mediaHydrationQueue.push({ execute, resolve, reject });
    drainMediaHydrationQueue();
  });
}

function pruneGenesysCallWindows(now = Date.now()) {
  while (genesysApiCallWindow.length && now - genesysApiCallWindow[0] > 60000) {
    genesysApiCallWindow.shift();
  }
  while (genesysGovernorStartWindow.length && now - genesysGovernorStartWindow[0] > 60000) {
    genesysGovernorStartWindow.shift();
  }
}

function recordGenesysApiCall(status = 0) {
  const now = Date.now();
  pruneGenesysCallWindows(now);
  genesysApiCallWindow.push(now);
  genesysApiMetrics.totalCalls += 1;
  genesysApiMetrics.lastCallAt = now;
  genesysApiMetrics.lastStatus = Number(status || 0);
  if (!status || status >= 400) genesysApiMetrics.failedCalls += 1;
  if (Number(status) === 429) genesysApiMetrics.rateLimitedCalls += 1;
  genesysApiMetrics.peakCallsPerMinute = Math.max(
    genesysApiMetrics.peakCallsPerMinute,
    genesysApiCallWindow.length
  );
}
function genesysApiStatus() {
  const now = Date.now();
  pruneGenesysCallWindows(now);
  return {
    ...genesysApiMetrics,
    callsLastMinute: genesysApiCallWindow.length,
    admittedLastMinute: genesysGovernorStartWindow.length,
    queued: genesysGovernorQueue.length,
    active: genesysGovernorActive,
    backoffUntil: genesysGovernorBackoffUntil
  };
}

function genesysRequestPriority(value) {
  if (value === "critical") return 0;
  if (value === "audit") return 2;
  return 1;
}
function inferGenesysConversationId(path) {
  const match = String(path || "").match(/\/conversations(?:\/messages)?\/([0-9a-f-]{36})(?:\/|$|\?)/i);
  return UUID_RE.test(String(match?.[1] || "")) ? match[1] : "";
}
function inferGenesysRequestPriority(path, method = "GET") {
  const normalizedMethod = String(method || "GET").toUpperCase();
  if (
    normalizedMethod === "PATCH"
    || /\/participants\/[^/]+\/replace\/queue(?:\?|$)/i.test(path)
    || /\/communications\/[^/]+\/messages(?:\?|$)/i.test(path)
    || /\/wrapup(?:codes)?(?:\?|$)/i.test(path)
  ) return "critical";
  if (/^\/api\/v2\/conversations(?:\?|$)/i.test(path)) return "audit";
  return "normal";
}
function parseRetryAfterMs(response) {
  const raw = String(response?.headers?.get("retry-after") || "").trim();
  if (!raw) return 0;
  const seconds = Number(raw);
  if (Number.isFinite(seconds)) return Math.max(1000, seconds * 1000);
  const at = new Date(raw).getTime();
  return Number.isFinite(at) ? Math.max(1000, at - Date.now()) : 0;
}
function scheduleGenesysGovernorPump(delayMs = 0) {
  clearTimeout(genesysGovernorTimer);
  genesysGovernorTimer = setTimeout(runGenesysGovernor, Math.max(0, delayMs));
}
function runGenesysGovernor() {
  clearTimeout(genesysGovernorTimer);
  genesysGovernorTimer = 0;
  const now = Date.now();
  pruneGenesysCallWindows(now);
  for (let index = genesysGovernorQueue.length - 1; index >= 0; index -= 1) {
    const job = genesysGovernorQueue[index];
    if (now <= job.expiresAt) continue;
    genesysGovernorQueue.splice(index, 1);
    job.reject(new Error("governador_genesys_tempo_esgotado"));
  }
  if (!genesysGovernorQueue.length) return;
  if (genesysGovernorBackoffUntil > now) {
    scheduleGenesysGovernorPump(genesysGovernorBackoffUntil - now + 25);
    return;
  }
  genesysGovernorQueue.sort((left, right) => left.priority - right.priority || left.seq - right.seq);
  let started = false;
  while (genesysGovernorActive < GENESYS_MAX_CONCURRENT_CALLS) {
    const jobIndex = genesysGovernorQueue.findIndex((job) => {
      if (job.conversationId && genesysGovernorActiveConversations.has(job.conversationId)) return false;
      const limit = job.priority === 0
        ? GENESYS_EMERGENCY_CALLS_PER_MINUTE
        : GENESYS_NORMAL_CALLS_PER_MINUTE;
      return genesysGovernorStartWindow.length < limit;
    });
    if (jobIndex < 0) break;
    const [job] = genesysGovernorQueue.splice(jobIndex, 1);
    genesysGovernorStartWindow.push(Date.now());
    genesysGovernorActive += 1;
    if (job.conversationId) genesysGovernorActiveConversations.add(job.conversationId);
    started = true;
    Promise.resolve()
      .then(job.execute)
      .then(job.resolve, job.reject)
      .finally(() => {
        genesysGovernorActive -= 1;
        if (job.conversationId) genesysGovernorActiveConversations.delete(job.conversationId);
        scheduleGenesysGovernorPump();
      });
  }
  if (!started && genesysGovernorQueue.length) {
    const oldest = genesysGovernorStartWindow[0] || now;
    scheduleGenesysGovernorPump(Math.max(100, 60050 - (now - oldest)));
  }
}
function scheduleGenesysRequest(execute, {
  priority = "normal",
  conversationId = "",
  timeoutMs = 90000
} = {}) {
  if (genesysGovernorQueue.length >= GENESYS_REQUEST_QUEUE_MAX) {
    return Promise.reject(new Error("governador_genesys_fila_cheia"));
  }
  return new Promise((resolve, reject) => {
    genesysGovernorQueue.push({
      execute,
      resolve,
      reject,
      priority: genesysRequestPriority(priority),
      conversationId: UUID_RE.test(conversationId) ? conversationId : "",
      expiresAt: Date.now() + Math.max(5000, Number(timeoutMs) || 90000),
      seq: ++genesysGovernorSeq
    });
    scheduleGenesysGovernorPump();
  });
}

function messageSetHash(messages = []) {
  const ids = messages.map((message) => String(message?.id || "")).filter(Boolean).sort();
  let value = 2166136261;
  for (const char of ids.join("|")) {
    value ^= char.charCodeAt(0);
    value = Math.imul(value, 16777619);
  }
  return (value >>> 0).toString(16).padStart(8, "0");
}
function serializedByteLength(value) {
  try {
    return new TextEncoder().encode(JSON.stringify(value)).byteLength;
  } catch {
    return Number.MAX_SAFE_INTEGER;
  }
}
function isStorageQuotaError(error) {
  return /quota|kquotabytes/i.test(String(error?.message || error || ""));
}
function pruneOutboxInPlace(outbox, {
  maxEntryBytes,
  maxTotalBytes,
  maxEntries
}) {
  const entries = Object.entries(outbox || {})
    .map(([key, entry]) => ({
      key,
      entry,
      bytes: serializedByteLength(entry),
      createdAt: Number(entry?.createdAt || 0)
    }))
    .sort((left, right) => right.createdAt - left.createdAt);
  const keep = new Set();
  let totalBytes = 0;
  for (const candidate of entries) {
    if (keep.size >= maxEntries) continue;
    if (candidate.bytes > maxEntryBytes) continue;
    if (totalBytes + candidate.bytes > maxTotalBytes) continue;
    keep.add(candidate.key);
    totalBytes += candidate.bytes;
  }
  let removed = 0;
  for (const key of Object.keys(outbox || {})) {
    if (keep.has(key)) continue;
    delete outbox[key];
    removed += 1;
  }
  return { removed, totalBytes };
}
function pruneSyncOutboxInPlace(outbox) {
  return pruneOutboxInPlace(outbox, {
    maxEntryBytes: MAX_PERSISTED_SNAPSHOT_BYTES,
    maxTotalBytes: MAX_SYNC_OUTBOX_BYTES,
    maxEntries: 12
  });
}
function pruneDeltaOutboxInPlace(outbox) {
  return pruneOutboxInPlace(outbox, {
    maxEntryBytes: 500000,
    maxTotalBytes: MAX_DELTA_OUTBOX_BYTES,
    maxEntries: 80
  });
}
function pruneCloseOutboxInPlace(outbox) {
  return pruneOutboxInPlace(outbox, {
    maxEntryBytes: 50000,
    maxTotalBytes: MAX_CLOSE_OUTBOX_BYTES,
    maxEntries: 100
  });
}
async function migrateLegacyOutboxesToSession() {
  if (!chrome.storage.session) return;
  const [legacy, current] = await Promise.all([
    chrome.storage.local.get(OUTBOX_KEYS),
    chrome.storage.session.get(OUTBOX_KEYS)
  ]);
  const migrated = {};
  let foundLegacy = false;
  for (const key of OUTBOX_KEYS) {
    const legacyEntries = legacy[key] && typeof legacy[key] === "object" ? legacy[key] : {};
    const currentEntries = current[key] && typeof current[key] === "object" ? current[key] : {};
    if (Object.keys(legacyEntries).length) foundLegacy = true;
    migrated[key] = { ...legacyEntries, ...currentEntries };
  }
  if (foundLegacy) await chrome.storage.session.set(migrated);
  await chrome.storage.local.remove(OUTBOX_KEYS);
}
async function recoverOutboxStorageQuota() {
  outboxStorageRecovery = outboxStorageRecovery.catch(() => {}).then(async () => {
    const storage = outboxStorage();
    const stored = await storage.get(OUTBOX_KEYS);
    const cachedOrStored = (key) => outboxMemoryCache.get(key)
      || (stored[key] && typeof stored[key] === "object" ? stored[key] : {});
    const syncOutbox = cachedOrStored(SYNC_OUTBOX_KEY);
    const deltaOutbox = cachedOrStored(DELTA_OUTBOX_KEY);
    const closeOutbox = cachedOrStored(CLOSE_OUTBOX_KEY);
    const syncResult = pruneSyncOutboxInPlace(syncOutbox);
    const deltaResult = pruneDeltaOutboxInPlace(deltaOutbox);
    const closeResult = pruneCloseOutboxInPlace(closeOutbox);
    outboxMemoryCache.set(SYNC_OUTBOX_KEY, syncOutbox);
    outboxMemoryCache.set(DELTA_OUTBOX_KEY, deltaOutbox);
    outboxMemoryCache.set(CLOSE_OUTBOX_KEY, closeOutbox);
    await storage.remove(OUTBOX_KEYS);
    try {
      await storage.set({
        [SYNC_OUTBOX_KEY]: syncOutbox,
        [DELTA_OUTBOX_KEY]: deltaOutbox,
        [CLOSE_OUTBOX_KEY]: closeOutbox
      });
    } catch (error) {
      if (!isStorageQuotaError(error)) throw error;
      // Encerramentos são pequenos e têm prioridade. Snapshots/deltas podem
      // ser reconstruídos do Genesys; nunca bloquear a conversa por cache.
      await storage.remove([SYNC_OUTBOX_KEY, DELTA_OUTBOX_KEY]);
      try {
        await storage.set({ [CLOSE_OUTBOX_KEY]: closeOutbox });
      } catch (closeError) {
        if (!isStorageQuotaError(closeError)) throw closeError;
        // Se até a fila pequena de encerramentos não couber, o roster atual
        // consegue reconstruí-la. Libera todas as filas sem travar a extensão.
        await storage.remove(OUTBOX_KEYS);
        log("warn", "Filas locais zeradas por falta de espaço", "serão reconstruídas pelo roster");
      }
    }
    const removed = syncResult.removed + deltaResult.removed + closeResult.removed;
    log("warn", "Armazenamento da extensão compactado", `${removed} item(ns) antigo(s) removido(s)`);
  });
  return outboxStorageRecovery;
}
async function loadOutbox(key) {
  if (outboxMemoryCache.has(key)) return outboxMemoryCache.get(key);
  const stored = await outboxStorage().get(key);
  const outbox = stored[key] && typeof stored[key] === "object" ? stored[key] : {};
  outboxMemoryCache.set(key, outbox);
  return outbox;
}
async function writeOutboxNow(key) {
  const outbox = outboxMemoryCache.get(key) || {};
  const storage = outboxStorage();
  try {
    await storage.set({ [key]: outbox });
    return true;
  } catch (error) {
    if (!isStorageQuotaError(error)) throw error;
    await recoverOutboxStorageQuota();
    try {
      await storage.set({ [key]: outbox });
      return true;
    } catch (retryError) {
      if (!isStorageQuotaError(retryError)) throw retryError;
      await storage.remove(key);
      log("warn", "Fila persistente convertida em volátil", key);
      return false;
    }
  }
}
async function persistOutbox(key, outbox) {
  outboxMemoryCache.set(key, outbox);
  if (outboxWriteTimers.has(key)) return true;
  const timer = setTimeout(() => {
    outboxWriteTimers.delete(key);
    writeOutboxNow(key).catch((error) => {
      log("warn", "Falha ao gravar lote da fila de sessão", error?.message || key);
    });
  }, OUTBOX_BATCH_WRITE_MS);
  outboxWriteTimers.set(key, timer);
  return true;
}
async function loadAllOutboxes() {
  const entries = await Promise.all(OUTBOX_KEYS.map(async (key) => [key, await loadOutbox(key)]));
  return Object.fromEntries(entries);
}
function mutateSyncOutbox(mutator) {
  outboxMutation = outboxMutation.catch(() => {}).then(async () => {
    await startupStorageRepair.catch(() => {});
    const outbox = await loadOutbox(SYNC_OUTBOX_KEY);
    await mutator(outbox);
    pruneSyncOutboxInPlace(outbox);
    await persistOutbox(SYNC_OUTBOX_KEY, outbox);
  });
  return outboxMutation;
}
async function removeSyncOutboxEvent(eventId) {
  volatileSyncOutbox.delete(eventId);
  await mutateSyncOutbox((outbox) => { delete outbox[eventId]; });
}
async function removeSyncOutboxThroughSnapshot(entry) {
  const conversationId = outboxConversationId(entry);
  const createdAt = Number(entry?.createdAt || 0);
  if (!UUID_RE.test(conversationId)) {
    await removeSyncOutboxEvent(entry?.eventId);
    return;
  }
  for (const [eventId, candidate] of volatileSyncOutbox.entries()) {
    if (
      outboxConversationId(candidate) === conversationId
      && Number(candidate?.createdAt || 0) <= createdAt
    ) volatileSyncOutbox.delete(eventId);
  }
  await mutateSyncOutbox((outbox) => {
    for (const [eventId, candidate] of Object.entries(outbox)) {
      if (
        outboxConversationId(candidate) === conversationId
        && Number(candidate?.createdAt || 0) <= createdAt
      ) delete outbox[eventId];
    }
  });
}
async function removeSyncOutboxForConversation(conversationId) {
  if (!UUID_RE.test(String(conversationId || ""))) return;
  for (const [eventId, entry] of volatileSyncOutbox.entries()) {
    const entryConversationId = String(
      entry?.conversationId || entry?.payload?.convId || ""
    );
    if (entryConversationId === conversationId) volatileSyncOutbox.delete(eventId);
  }
  await mutateSyncOutbox((outbox) => {
    for (const [eventId, entry] of Object.entries(outbox)) {
      const entryConversationId = String(
        entry?.conversationId || entry?.payload?.convId || ""
      );
      if (entryConversationId === conversationId) delete outbox[eventId];
    }
  });
}
async function mutateSnapshotEntry(entry, mutator) {
  const volatileEntry = volatileSyncOutbox.get(entry?.eventId);
  if (volatileEntry) {
    await mutator(volatileEntry);
    return;
  }
  await mutateSyncOutbox((outbox) => {
    const current = outbox[entry?.eventId];
    if (current) return mutator(current);
  });
}
function isTerminalClosedResponse(response) {
  const text = [
    response?.error,
    response?.reason,
    response?.message
  ].filter(Boolean).join(" ")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
  return /atendimento.*(?:ja )?encerrado/.test(text)
    || /(?:chat|conversation|conversa).*(?:closed|encerrad)/.test(text);
}
function isTerminalMissingResponse(response) {
  const text = [
    response?.error,
    response?.reason,
    response?.message
  ].filter(Boolean).join(" ")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
  return /atendimento.*nao encontrado/.test(text);
}
function hasRecentActiveEvidence(conversationId, maxAgeMs = 15000) {
  const state = conversations.get(conversationId);
  if (!state || state.closed || ["CLOSING", "CLOSED"].includes(state.lifecycle)) return false;
  const lastConfirmedAt = Math.max(
    Number(state.lastNetworkSeenAt || 0),
    Number(state.lastDomSeenAt || 0),
    Number(state.lastApiConfirmedAt || 0)
  );
  const focusedRecently = focused.conversationId === conversationId
    && Date.now() - Number(focused.at || 0) <= maxAgeMs;
  return focusedRecently
    || (state.lifecycle === "ACTIVE" && Date.now() - lastConfirmedAt <= maxAgeMs);
}
function outboxConversationId(entry) {
  return String(entry?.conversationId || entry?.payload?.convId || entry?.payload?.conversationId || "");
}
function hasGuardedActiveEvidence(conversationId, maxAgeMs = 15000) {
  if (!UUID_RE.test(String(conversationId || ""))) return false;
  const state = conversations.get(conversationId);
  if (
    state?.closed
    || ["SUSPECTED_ABSENT", "CLOSING", "CLOSED"].includes(state?.lifecycle)
  ) return false;
  if (deliveryRosterGuard.activeIds.has(conversationId)) return true;
  if (
    Date.now() - Number(latestPassiveRoster.at || 0) <= PASSIVE_ROSTER_MAX_AGE_MS
    && latestPassiveRoster.ids.has(conversationId)
  ) return true;
  if (
    Date.now() - Number(latestDomRoster.at || 0) <= 15000
    && latestDomRoster.ids.has(conversationId)
  ) return true;
  if (
    focused.conversationId === conversationId
    && Date.now() - Number(focused.at || 0) <= maxAgeMs
  ) return true;
  if (!state || state.observedAgentActive !== true) return false;
  const lastConfirmedAt = Math.max(
    Number(state.lastNetworkSeenAt || 0),
    Number(state.lastApiConfirmedAt || 0),
    Number(state.lastDomSeenAt || 0)
  );
  return Date.now() - lastConfirmedAt <= maxAgeMs;
}
function canDeliverActiveConversation(conversationId) {
  if (!deliveryRosterGuard.blocking) return true;
  return hasGuardedActiveEvidence(conversationId);
}
function canDeliverConversationClose(conversationId) {
  if (!deliveryRosterGuard.blocking) return true;
  if (!deliveryRosterGuard.authoritative) return false;
  return !hasGuardedActiveEvidence(conversationId);
}
function eventRequiresActiveConversation(event) {
  return [
    "ext:atendimento:upsert",
    "ext:atendimento:cliente",
    "ext:atendimento:mensagem"
  ].includes(String(event || ""));
}
function deliveryPriority(conversationId, createdAt = 0) {
  const focusedPriority = focused.conversationId === conversationId ? 2 : 0;
  const rosterPriority = hasGuardedActiveEvidence(conversationId) ? 1 : 0;
  return (focusedPriority + rosterPriority) * 10 ** 15 + Number(createdAt || 0);
}
async function deliverReliableSnapshot(entry) {
  const conversationId = outboxConversationId(entry);
  if (
    !socket?.connected
    || !entry?.eventId
    || snapshotDeliveriesInFlight.has(entry.eventId)
    || !canDeliverActiveConversation(conversationId)
  ) return false;
  snapshotDeliveriesInFlight.add(entry.eventId);
  return new Promise((resolve, reject) => {
    const finish = (value) => {
      snapshotDeliveriesInFlight.delete(entry.eventId);
      resolve(value);
    };
    try {
      socket.timeout(ACK_TIMEOUT_MS).emit("ext:atendimento:backfill", entry.payload, async (error, response) => {
      try {
      const expectedIds = entry.payload.mensagens.map((message) => String(message?.id || "")).filter(Boolean).sort();
      const acceptedIds = (Array.isArray(response?.acceptedMessageIds) ? response.acceptedMessageIds : [])
        .map((id) => String(id || "")).filter(Boolean).sort();
      const validAck = !error
        && response?.ok === true
        && response?.snapshotId === entry.eventId
        && response?.complete === true
        && Number(response?.storedMessageCount) === Number(entry.payload.expectedMessageCount)
        && response?.messageSetHash === entry.payload.messageSetHash
        && expectedIds.join("|") === acceptedIds.join("|");
      if (validAck) {
        await removeSyncOutboxThroughSnapshot(entry).catch(() => {});
        log("ok", "Snapshot confirmado pelo Onion", `${entry.payload.convId.slice(0, 8)} · ${response.storedMessageCount}`);
        finish(true);
        return;
      }
      const ackResult = response || (error?.message ? { error: error.message } : {});
      if (isTerminalClosedResponse(ackResult)) {
        const closedConversationId = String(entry.conversationId || entry.payload?.convId || "");
        await removeSyncOutboxForConversation(closedConversationId).catch(() => {});
        const state = conversations.get(closedConversationId);
        if (state) {
          state.closed = true;
          state.lifecycle = "CLOSED";
          state.closedAt = Date.now();
        }
        deliveryRosterGuard.activeIds.delete(closedConversationId);
        log("drop", "Snapshot descartado; atendimento encerrado", entry.payload.convId.slice(0, 8));
        finish(true);
        return;
      }
      if (isTerminalMissingResponse(ackResult)) {
        const missingConversationId = String(entry.conversationId || entry.payload?.convId || "");
        const entryAge = Date.now() - Number(entry.createdAt || 0);
        const missingState = conversations.get(missingConversationId);
        const confirmedInactive = Boolean(
          missingState?.closed
          || ["SUSPECTED_ABSENT", "CLOSING", "CLOSED"].includes(missingState?.lifecycle)
        );
        if (hasRecentActiveEvidence(missingConversationId)) {
          const communicationId = await knownCommunicationId(missingConversationId).catch(() => "");
          const participantName = validParticipantName(entry.payload?.participantName) || "Cliente";
          const recoveryState = conversationState(missingConversationId);
          const recovered = await deliverPassiveConversationToOnion({
            convId: missingConversationId,
            syncGeneration: recoveryState.syncGeneration,
            ...(communicationId ? { communicationId } : {}),
            canal: "genesys",
            genesysMediaType: "message",
            conversationType: "message",
            status: "open",
            cliente: {
              nome: participantName,
              nome_whatsapp: participantName,
              displayName: participantName
            },
            abertoEm: Number(entry.createdAt || Date.now()),
            source: "genesys-snapshot-recovery",
            environment: "dev"
          }).catch(() => false);
          if (recovered) {
            const state = conversationState(missingConversationId);
            state.upserted = true;
            state.lifecycle = "ACTIVE";
            await mutateSnapshotEntry(entry, (current) => {
              current.nextAttemptAt = Date.now() + 500;
            }).catch(() => {});
            setTimeout(() => flushReliableOutbox().catch(() => {}), 750);
            log("ok", "Upsert recuperado antes do snapshot", missingConversationId.slice(0, 8));
            finish(false);
            return;
          }
        } else if (confirmedInactive || entryAge > 2 * 60 * 1000) {
          await removeSyncOutboxEvent(entry.eventId).catch(() => {});
          log("drop", "Snapshot órfão expirado", missingConversationId.slice(0, 8));
          finish(true);
          return;
        }
      }
      await mutateSnapshotEntry(entry, (current) => {
        current.attempts = Number(current.attempts || 0) + 1;
        current.lastError = error?.message || response?.error || "ack_incompleto";
        current.nextAttemptAt = Date.now() + Math.min(30000, 1000 * (2 ** Math.min(current.attempts, 5)));
      }).catch(() => {});
      log("warn", "Snapshot sem confirmação completa", error?.message || response?.error || "ACK divergente");
      finish(false);
      } catch (callbackError) {
        snapshotDeliveriesInFlight.delete(entry.eventId);
        reject(callbackError);
      }
      });
    } catch (error) {
      snapshotDeliveriesInFlight.delete(entry.eventId);
      reject(error);
    }
  });
}
async function queueReliableSnapshot(conversationId, messages, participantName, options = {}) {
  if (!UUID_RE.test(conversationId)) return false;
  const cleanMessages = Array.isArray(messages)
    ? messages.filter((message) => message?.id && (message.text || message.media))
    : [];
  let resolvedDocument = null;
  for (let index = cleanMessages.length - 1; index >= 0 && !resolvedDocument; index -= 1) {
    resolvedDocument = findValidDocuments(cleanMessages[index]?.text)[0] || null;
  }
  const eventId = crypto.randomUUID();
  const payload = {
    contractVersion: 1,
    snapshotId: eventId,
    eventId,
    convId: conversationId,
    mensagens: cleanMessages,
    participantName: participantName || "Cliente",
    expectedMessageCount: cleanMessages.length,
    messageSetHash: messageSetHash(cleanMessages),
    ...(resolvedDocument ? {
      cliente: {
        cpf: resolvedDocument.digits,
        document: resolvedDocument.digits,
        documentType: resolvedDocument.type
      }
    } : {}),
    force: true,
    environment: "dev"
  };
  const entry = { eventId, conversationId, payload, attempts: 0, createdAt: Date.now(), nextAttemptAt: Date.now() };
  const entryBytes = serializedByteLength(entry);
  if (options.volatileOnly === true || entryBytes > MAX_PERSISTED_SNAPSHOT_BYTES) {
    volatileSyncOutbox.set(eventId, entry);
    log(
      "info",
      "Snapshot grande mantido em memória",
      `${conversationId.slice(0, 8)} · ${(entryBytes / (1024 * 1024)).toFixed(1)} MB`
    );
  } else {
    try {
      await mutateSyncOutbox((outbox) => { outbox[eventId] = entry; });
    } catch (error) {
      // A fila persistente melhora a recuperação após suspensão, mas não faz
      // parte do carregamento da conversa. Falha nela nunca bloqueia o Onion.
      volatileSyncOutbox.set(eventId, entry);
      log("warn", "Snapshot mantido em memória", error?.message || "storage_indisponivel");
    }
  }
  return deliverReliableSnapshot(entry);
}
async function flushReliableOutbox() {
  if (!socket?.connected) return;
  const entriesById = new Map(Object.entries(await loadOutbox(SYNC_OUTBOX_KEY)));
  for (const [eventId, entry] of volatileSyncOutbox.entries()) {
    entriesById.set(eventId, entry);
  }
  const newestByConversation = new Map();
  for (const entry of entriesById.values()) {
    const conversationId = outboxConversationId(entry);
    const previous = newestByConversation.get(conversationId);
    if (
      !previous
      || Number(entry?.createdAt || 0) >= Number(previous?.createdAt || 0)
    ) newestByConversation.set(conversationId, entry);
  }
  const entries = [...newestByConversation.values()]
    .filter((entry) => canDeliverActiveConversation(outboxConversationId(entry)))
    .filter((entry) => Number(entry?.nextAttemptAt || 0) <= Date.now())
    .sort((a, b) => (
      deliveryPriority(outboxConversationId(b), b.createdAt)
      - deliveryPriority(outboxConversationId(a), a.createdAt)
    ))
    .slice(0, 10);
  await mapWithConcurrency(entries, MAX_ONION_DELIVERY_CONCURRENCY, async (entry) => {
    if (!socket?.connected) return false;
    return deliverReliableSnapshot(entry);
  });
}
function mutateCloseOutbox(mutator) {
  closeOutboxMutation = closeOutboxMutation.catch(() => {}).then(async () => {
    await startupStorageRepair.catch(() => {});
    const outbox = await loadOutbox(CLOSE_OUTBOX_KEY);
    await mutator(outbox);
    pruneCloseOutboxInPlace(outbox);
    await persistOutbox(CLOSE_OUTBOX_KEY, outbox);
  });
  return closeOutboxMutation;
}
async function removeCloseOutboxEvent(conversationId) {
  await mutateCloseOutbox((outbox) => { delete outbox[conversationId]; });
}
async function deliverReliableClose(entry) {
  const conversationId = String(entry?.conversationId || entry?.payload?.convId || "");
  if (
    !socket?.connected
    || !UUID_RE.test(conversationId)
    || !canDeliverConversationClose(conversationId)
  ) return false;
  return new Promise((resolve) => {
    socket.timeout(ACK_TIMEOUT_MS).emit("ext:atendimento:encerrar", entry.payload, async (error, response) => {
      const completed = !error && (
        response?.ok === true
        || isTerminalClosedResponse(response)
        || isTerminalMissingResponse(response)
      );
      if (completed) {
        await Promise.all([
          removeCloseOutboxEvent(conversationId).catch(() => {}),
          removeSyncOutboxForConversation(conversationId).catch(() => {}),
          removeDeltaOutboxForConversation(conversationId).catch(() => {})
        ]);
        const state = conversations.get(conversationId);
        if (state) {
          state.closed = true;
          state.lifecycle = "CLOSED";
          state.closedAt = Date.now();
        }
        deliveryRosterGuard.activeIds.delete(conversationId);
        log("ok", "Encerramento confirmado pelo Onion", conversationId.slice(0, 8));
        resolve(true);
        return;
      }
      await mutateCloseOutbox((outbox) => {
        const current = outbox[conversationId];
        if (!current) return;
        current.attempts = Number(current.attempts || 0) + 1;
        current.lastError = error?.message || response?.error || "ack_incompleto";
        current.nextAttemptAt = Date.now() + Math.min(30000, 1000 * (2 ** Math.min(current.attempts, 5)));
      }).catch(() => {});
      log("warn", "Encerramento aguardando ACK do Onion", error?.message || response?.error || "ack_incompleto");
      resolve(false);
    });
  });
}
async function queueReliableClose(payload = {}) {
  const conversationId = String(payload.convId || payload.conversationId || "");
  if (!UUID_RE.test(conversationId)) return false;
  const closeOutbox = await loadOutbox(CLOSE_OUTBOX_KEY);
  const existing = closeOutbox[conversationId];
  const entry = {
    eventId: existing?.eventId || crypto.randomUUID(),
    conversationId,
    payload: {
      ...payload,
      convId: conversationId,
      closeEventId: existing?.eventId || crypto.randomUUID()
    },
    attempts: Number(existing?.attempts || 0),
    createdAt: Number(existing?.createdAt || Date.now()),
    nextAttemptAt: Date.now()
  };
  entry.payload.closeEventId = entry.eventId;
  await mutateCloseOutbox((outbox) => { outbox[conversationId] = entry; });
  const state = conversationState(conversationId);
  state.lifecycle = "CLOSING";
  return deliverReliableClose(entry);
}
async function flushReliableCloseOutbox() {
  if (!socket?.connected) return;
  const entries = Object.values(await loadOutbox(CLOSE_OUTBOX_KEY))
    .filter((entry) => canDeliverConversationClose(outboxConversationId(entry)))
    .filter((entry) => Number(entry?.nextAttemptAt || 0) <= Date.now())
    .sort((a, b) => Number(a.createdAt || 0) - Number(b.createdAt || 0))
    .slice(0, 20);
  await mapWithConcurrency(entries, MAX_ONION_DELIVERY_CONCURRENCY, async (entry) => {
    if (!socket?.connected) return false;
    return deliverReliableClose(entry);
  });
}

function mutateDeltaOutbox(mutator) {
  deltaOutboxMutation = deltaOutboxMutation.catch(() => {}).then(async () => {
    await startupStorageRepair.catch(() => {});
    const outbox = await loadOutbox(DELTA_OUTBOX_KEY);
    await mutator(outbox);
    pruneDeltaOutboxInPlace(outbox);
    await persistOutbox(DELTA_OUTBOX_KEY, outbox);
  });
  return deltaOutboxMutation;
}
function deltaOutboxId(conversationId, messageId) {
  return `${conversationId}:${messageId}`;
}
async function removeDeltaOutboxEvent(eventId) {
  await mutateDeltaOutbox((outbox) => { delete outbox[eventId]; });
}
async function removeDeltaOutboxForConversation(conversationId) {
  if (!UUID_RE.test(conversationId)) return;
  await mutateDeltaOutbox((outbox) => {
    for (const [eventId, entry] of Object.entries(outbox)) {
      if (String(entry?.conversationId || entry?.payload?.convId || "") === conversationId) {
        delete outbox[eventId];
      }
    }
  });
}
async function deliverReliableDelta(entry) {
  const conversationId = outboxConversationId(entry);
  if (
    !socket?.connected
    || !entry?.eventId
    || deltaDeliveriesInFlight.has(entry.eventId)
    || !canDeliverActiveConversation(conversationId)
  ) return false;
  deltaDeliveriesInFlight.add(entry.eventId);
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      deltaDeliveriesInFlight.delete(entry.eventId);
      resolve(value);
    };
    try {
      socket.timeout(ACK_TIMEOUT_MS).emit("ext:atendimento:mensagem", entry.payload, async (error, response) => {
        try {
          const terminal = isTerminalClosedResponse(response) || isTerminalMissingResponse(response);
          if ((!error && response?.ok === true) || terminal) {
            await removeDeltaOutboxEvent(entry.eventId).catch(() => {});
            const state = conversations.get(entry.conversationId);
            const messageId = String(entry.payload?.mensagem?.id || "");
            state?.passivePendingMessageIds?.delete(messageId);
            if (!terminal && state && messageId) state.messageIds.add(messageId);
            finish(true);
            return;
          }
          await mutateDeltaOutbox((outbox) => {
            const current = outbox[entry.eventId];
            if (!current) return;
            current.attempts = Number(current.attempts || 0) + 1;
            current.lastError = error?.message || response?.error || "ack_incompleto";
            current.nextAttemptAt = Date.now() + Math.min(30000, 1000 * (2 ** Math.min(current.attempts, 5)));
          }).catch(() => {});
          finish(false);
        } catch (callbackError) {
          log("error", "Falha ao confirmar delta Onion", callbackError?.message || "erro");
          finish(false);
        }
      });
    } catch (error) {
      log("error", "Falha ao enviar delta Onion", error?.message || "erro");
      finish(false);
    }
  });
}
async function queueReliableDelta(payload = {}) {
  const conversationId = String(payload.convId || payload.conversationId || "");
  const messageId = String(payload?.mensagem?.id || payload?.messageId || "");
  if (!UUID_RE.test(conversationId) || !messageId) return false;
  // data URLs grandes ficam no snapshot/fluxo volátil para não estourar a
  // quota do chrome.storage. Deltas de texto e metadados são persistidos.
  const serializedSize = JSON.stringify(payload).length;
  if (serializedSize > 500000) return emit("ext:atendimento:mensagem", payload);
  const eventId = deltaOutboxId(conversationId, messageId);
  const entry = {
    eventId,
    conversationId,
    payload: { ...payload, deltaEventId: eventId },
    attempts: 0,
    createdAt: Date.now(),
    nextAttemptAt: Date.now()
  };
  await mutateDeltaOutbox((outbox) => {
    if (!outbox[eventId]) outbox[eventId] = entry;
  });
  return deliverReliableDelta(entry);
}
async function flushReliableDeltaOutbox() {
  if (!socket?.connected) return;
  const entries = Object.values(await loadOutbox(DELTA_OUTBOX_KEY))
    .filter((entry) => canDeliverActiveConversation(outboxConversationId(entry)))
    .filter((entry) => Number(entry?.nextAttemptAt || 0) <= Date.now())
    .sort((left, right) => {
      const priorityDifference = (
        deliveryPriority(outboxConversationId(right), 0)
        - deliveryPriority(outboxConversationId(left), 0)
      );
      return priorityDifference || Number(left.createdAt || 0) - Number(right.createdAt || 0);
    })
    .slice(0, 25);
  const entriesByConversation = new Map();
  for (const entry of entries) {
    const conversationId = outboxConversationId(entry);
    if (!entriesByConversation.has(conversationId)) entriesByConversation.set(conversationId, []);
    entriesByConversation.get(conversationId).push(entry);
  }
  await mapWithConcurrency(
    [...entriesByConversation.values()],
    MAX_ONION_DELIVERY_CONCURRENCY,
    async (conversationEntries) => {
      for (const entry of conversationEntries) {
        if (!socket?.connected || deltaDeliveriesInFlight.has(entry.eventId)) break;
        await deliverReliableDelta(entry);
      }
    }
  );
}

function collectCurrentActiveEvidence(seedIds = new Set()) {
  const activeIds = new Set(
    [...(seedIds || [])]
      .map((id) => String(id || ""))
      .filter((id) => (
        UUID_RE.test(id)
        && !conversations.get(id)?.closed
        && !["SUSPECTED_ABSENT", "CLOSING", "CLOSED"].includes(conversations.get(id)?.lifecycle)
      ))
  );
  if (Date.now() - Number(latestPassiveRoster.at || 0) <= PASSIVE_ROSTER_MAX_AGE_MS) {
    for (const conversationId of latestPassiveRoster.ids) activeIds.add(conversationId);
  }
  if (Date.now() - Number(latestDomRoster.at || 0) <= 15000) {
    for (const conversationId of latestDomRoster.ids) activeIds.add(conversationId);
  }
  if (
    UUID_RE.test(focused.conversationId)
    && Date.now() - Number(focused.at || 0) <= 15000
  ) activeIds.add(focused.conversationId);
  for (const [conversationId, state] of conversations.entries()) {
    if (
      state?.observedAgentActive === true
      && !state.closed
      && Date.now() - Math.max(
        Number(state.lastNetworkSeenAt || 0),
        Number(state.lastApiConfirmedAt || 0),
        Number(state.lastDomSeenAt || 0)
      ) <= 15000
    ) activeIds.add(conversationId);
  }
  return activeIds;
}
async function pruneDeliveryQueuesForActiveRoster(activeIds) {
  const allowed = collectCurrentActiveEvidence(activeIds);
  const quarantineStartedAt = Number(deliveryRosterGuard.startedAt || Date.now());
  let removedSnapshots = 0;
  let removedDeltas = 0;
  let removedCloses = 0;
  let removedVolatile = 0;

  await mutateSyncOutbox((outbox) => {
    const newestByConversation = new Map();
    for (const [eventId, entry] of Object.entries(outbox)) {
      const conversationId = outboxConversationId(entry);
      if (!allowed.has(conversationId)) {
        if (Number(entry?.createdAt || 0) >= quarantineStartedAt) continue;
        delete outbox[eventId];
        removedSnapshots += 1;
        continue;
      }
      const previous = newestByConversation.get(conversationId);
      if (!previous) {
        newestByConversation.set(conversationId, { eventId, entry });
        continue;
      }
      const currentIsNewer = Number(entry?.createdAt || 0) >= Number(previous.entry?.createdAt || 0);
      const discardedId = currentIsNewer ? previous.eventId : eventId;
      delete outbox[discardedId];
      removedSnapshots += 1;
      if (currentIsNewer) newestByConversation.set(conversationId, { eventId, entry });
    }
  });

  const newestVolatileByConversation = new Map();
  for (const [eventId, entry] of volatileSyncOutbox.entries()) {
    const conversationId = outboxConversationId(entry);
    if (!allowed.has(conversationId)) {
      if (Number(entry?.createdAt || 0) >= quarantineStartedAt) continue;
      volatileSyncOutbox.delete(eventId);
      removedVolatile += 1;
      continue;
    }
    const previous = newestVolatileByConversation.get(conversationId);
    if (!previous) {
      newestVolatileByConversation.set(conversationId, { eventId, entry });
      continue;
    }
    const currentIsNewer = Number(entry?.createdAt || 0) >= Number(previous.entry?.createdAt || 0);
    const discardedId = currentIsNewer ? previous.eventId : eventId;
    volatileSyncOutbox.delete(discardedId);
    removedVolatile += 1;
    if (currentIsNewer) newestVolatileByConversation.set(conversationId, { eventId, entry });
  }

  await mutateDeltaOutbox((outbox) => {
    for (const [eventId, entry] of Object.entries(outbox)) {
      if (allowed.has(outboxConversationId(entry))) continue;
      if (Number(entry?.createdAt || 0) >= quarantineStartedAt) continue;
      delete outbox[eventId];
      removedDeltas += 1;
    }
  });
  await mutateCloseOutbox((outbox) => {
    for (const [eventId, entry] of Object.entries(outbox)) {
      if (!allowed.has(outboxConversationId(entry))) continue;
      if (Number(entry?.createdAt || 0) >= quarantineStartedAt) continue;
      delete outbox[eventId];
      removedCloses += 1;
    }
  });

  const beforeVolatileEvents = queue.length;
  const retainedEvents = queue.filter((item) => {
    if (Number(item?.enqueuedAt || 0) >= quarantineStartedAt) return true;
    const conversationId = String(item?.payload?.convId || item?.payload?.conversationId || "");
    if (!UUID_RE.test(conversationId)) return true;
    if (item.event === "ext:atendimento:encerrar") return !allowed.has(conversationId);
    if (eventRequiresActiveConversation(item.event)) return allowed.has(conversationId);
    return true;
  });
  queue.splice(0, queue.length, ...retainedEvents);
  return {
    activeIds: allowed,
    removedSnapshots: removedSnapshots + removedVolatile,
    removedDeltas,
    removedCloses,
    removedEvents: beforeVolatileEvents - retainedEvents.length
  };
}
function confirmedPassiveRosterAvailable() {
  return passiveRosterCandidate.confirmations >= 2
    && Date.now() - Number(passiveRosterCandidate.lastAt || 0) <= STARTUP_ROSTER_CONFIRMATION_WINDOW_MS;
}
async function waitForConfirmedPassiveRoster(generation) {
  const deadline = Date.now() + STARTUP_ROSTER_WAIT_MS;
  while (
    Date.now() < deadline
    && deliveryRosterGuard.generation === generation
    && socket?.connected
  ) {
    if (deliveryRosterGuard.authoritative && deliveryRosterGuard.confirmedAt) {
      return new Set(deliveryRosterGuard.activeIds);
    }
    if (confirmedPassiveRosterAvailable()) {
      return new Set(passiveRosterCandidate.ids);
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  return null;
}
async function completeStartupDeliveryReconciliation(next, generation, ids, source) {
  if (
    socket !== next
    || !next?.connected
    || deliveryRosterGuard.generation !== generation
  ) return;
  const result = await pruneDeliveryQueuesForActiveRoster(ids);
  if (
    socket !== next
    || !next?.connected
    || deliveryRosterGuard.generation !== generation
  ) return;
  deliveryRosterGuard = {
    generation,
    blocking: true,
    authoritative: true,
    activeIds: result.activeIds,
    startedAt: Number(deliveryRosterGuard.startedAt || Date.now()),
    confirmedAt: Date.now(),
    source
  };
  lastAuthoritativeRoster = {
    ids: new Set(result.activeIds),
    at: Date.now(),
    source
  };
  let releasedNotifications = 0;
  let discardedNotifications = 0;
  for (const conversationId of [...quarantinedNotificationIds]) {
    quarantinedNotificationIds.delete(conversationId);
    if (result.activeIds.has(conversationId) || hasGuardedActiveEvidence(conversationId)) {
      releasedNotifications += 1;
      scheduleNotificationSync(conversationId);
    } else {
      discardedNotifications += 1;
    }
  }
  log(
    "ok",
    "Fila reconciliada com atendimentos ativos",
    `${result.activeIds.size} ativos · removidos ${result.removedSnapshots + result.removedDeltas + result.removedCloses + result.removedEvents} · notificações ${releasedNotifications}/${releasedNotifications + discardedNotifications} · ${source}`
  );
  flushQueue();
  await Promise.all([
    flushReliableOutbox(),
    flushReliableCloseOutbox(),
    flushReliableDeltaOutbox()
  ]);
}
async function beginStartupDeliveryReconciliation(next) {
  const generation = Number(deliveryRosterGuard.generation || 0) + 1;
  const startedAt = Date.now();
  clearTimeout(startupRosterRetryTimer);
  deliveryRosterGuard = {
    generation,
    blocking: true,
    authoritative: false,
    activeIds: collectCurrentActiveEvidence(),
    startedAt,
    confirmedAt: 0,
    source: "waiting"
  };
  log("info", "Sincronização aguardando roster ativo", "filas antigas em quarentena");

  let activeIds = null;
  let source = "";
  if (
    Date.now() - Number(lastAuthoritativeRoster.at || 0) <= STARTUP_ROSTER_CACHE_MS
  ) {
    activeIds = new Set(lastAuthoritativeRoster.ids);
    source = `cache-${lastAuthoritativeRoster.source}`;
  }
  if (!activeIds && confirmedPassiveRosterAvailable()) {
    activeIds = new Set(passiveRosterCandidate.ids);
    source = "passivo-confirmado";
  }
  if (!activeIds) {
    activeIds = await waitForConfirmedPassiveRoster(generation);
    if (activeIds) {
      source = deliveryRosterGuard.authoritative
        ? deliveryRosterGuard.source
        : "passivo-confirmado";
    }
  }
  if (
    !activeIds
    && Date.now() - lastStartupRosterApiAttemptAt >= STARTUP_ROSTER_API_RETRY_MS
  ) {
    lastStartupRosterApiAttemptAt = Date.now();
    try {
      const entities = await fetchAllGenesysConversations({
        priority: "audit",
        timeoutMs: 60000
      });
      activeIds = new Set(
        entities
          .filter((conversation) => hasActiveAgentMessaging(conversation))
          .map((conversation) => String(conversation?.id || ""))
          .filter((id) => UUID_RE.test(id))
      );
      source = "api-controlada";
    } catch (error) {
      log("warn", "Roster inicial não confirmado pela API", error?.message || "erro");
    }
  }
  if (
    !activeIds
    && Date.now() - Number(latestPassiveRoster.at || 0) <= PASSIVE_ROSTER_MAX_AGE_MS
  ) {
    activeIds = new Set(latestPassiveRoster.ids);
    source = "passivo-fallback";
  }
  if (
    !activeIds
    && latestDomRoster.complete
    && Date.now() - Number(latestDomRoster.at || 0) <= 15000
  ) {
    activeIds = new Set(latestDomRoster.ids);
    source = "dom-estável";
  }
  if (!activeIds) {
    if (
      socket === next
      && next?.connected
      && deliveryRosterGuard.generation === generation
    ) {
      log("warn", "Filas históricas continuam em quarentena", "aguardando roster confiável");
      startupRosterRetryTimer = setTimeout(() => {
        if (socket === next && next?.connected) {
          beginStartupDeliveryReconciliation(next).catch((error) => {
            log("error", "Falha ao repetir reconciliação inicial", error?.message || "erro");
          });
        }
      }, 5000);
    }
    return;
  }
  await completeStartupDeliveryReconciliation(next, generation, activeIds, source);
}

function onlyDocumentDigits(value) {
  return String(value || "").replace(/\D/g, "");
}
function formatIxcDocument(value) {
  const digits = onlyDocumentDigits(value);
  return digits.length === 14
    ? digits.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, "$1.$2.$3/$4-$5")
    : digits.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, "$1.$2.$3-$4");
}
async function fetchIxcCustomer(documentValue) {
  const formatted = formatIxcDocument(documentValue);
  const gridParam = JSON.stringify({
    "0": { TB: "cliente.cnpj_cpf", display: "CNPJ/CPF", OP: "L", P: formatted, C: "AND", G: "_cliente.cnpj_cpf" }
  });
  const body = new URLSearchParams({
    page: "1", rp: "16", sortname: "cliente.id", sortorder: "asc",
    qtype: "cliente.cnpj_cpf", oper: "L", grid_param: gridParam,
    grid_param2: "false", display: "CNPJ/CPF"
  });
  const response = await fetch(ZAAZ_SEARCH_URL, {
    method: "POST", credentials: "include",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString()
  });
  if (!response.ok) throw new Error(`IXC HTTP ${response.status}`);
  const data = await response.json();
  const rows = Array.isArray(data?.rows) ? data.rows : [];
  if (!rows.length) throw new Error("Cliente não encontrado no IXC");
  const activeRow = (row) => /^sim$/i.test(String(row?.cell?.[0] || "").trim());
  const chosen = rows.find(activeRow) || rows[0];
  const cell = chosen.cell || [];
  return {
    active: activeRow(chosen), clientId: cell[1] || "", fullName: cell[3] || "",
    street: cell[10] || "", city: cell[11] || "", state: cell[12] || "",
    neighborhood: cell[14] || "", phone: cell[15] || "", houseNumber: cell[16] || "",
    zipCode: cell[17] || "", complement: cell[19] || "", email: cell[24] || "",
    clientType: cell[25] || "", phoneAlt: cell[29] || ""
  };
}
async function fetchIxcServiceOrders(clientId) {
  if (!clientId) return [];
  const body = new URLSearchParams({
    page: "1", rp: "50", sortname: "su_oss_chamado.id", sortorder: "desc",
    query: clientId, qtype: "su_oss_chamado.id_cliente", oper: "=",
    grid_param: "false", grid_param2: "false", display: ""
  });
  const response = await fetch(ZAAZ_OS_URL, {
    method: "POST", credentials: "include",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString()
  });
  if (!response.ok) throw new Error(`IXC OS HTTP ${response.status}`);
  const data = await response.json();
  return (Array.isArray(data?.rows) ? data.rows : []).map(({ cell = [] }) => ({
    osId: cell[0] || "", filialId: cell[2] || "", openedAt: cell[4] || "",
    status: cell[7] || "", subject: cell[9] || "", sector: cell[10] || "",
    city: cell[11] || "", message: String(cell[16] || "").trim(),
    protocol: cell[17] || "", address: cell[18] || "", complement: cell[19] || "",
    reference: cell[24] || "", scheduledAt: /^00\/00/.test(cell[27] || "") ? "" : (cell[27] || ""),
    phone: cell[30] || "", diagnosis: cell[37] || ""
  }));
}
async function fetchIxcLogins(clientId) {
  if (!clientId) return [];
  const body = new URLSearchParams({
    page: "1", rp: "30", sortname: "radusuarios.id", sortorder: "desc",
    query: clientId, qtype: "radusuarios.id_cliente", oper: "=",
    grid_param: "false", grid_param2: "false", display: ""
  });
  const response = await fetch(ZAAZ_LOGIN_URL, {
    method: "POST", credentials: "include",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString()
  });
  if (!response.ok) throw new Error(`IXC login HTTP ${response.status}`);
  const data = await response.json();
  const logins = (Array.isArray(data?.rows) ? data.rows : []).map(({ cell = [] }) => ({
    loginId: cell[0] || "", active: /^sim$/i.test(String(cell[1] || "").trim()),
    online: /^sim$/i.test(String(cell[2] || "").trim()), connectionType: cell[3] || "",
    contractId: cell[4] || "", plan: cell[5] || "", contractStatus: cell[6] || "",
    accessStatus: cell[7] || "", pppoeUser: cell[10] || "", ipv4: cell[12] || "",
    macOnu: cell[14] || "", street: cell[15] || "", houseNumber: cell[16] || "",
    neighborhood: cell[18] || "", transmitter: cell[20] || cell[21] || "",
    connectedSince: cell[24] || "", lastAccess: cell[25] || "",
    oltName: cell[34] || "", oltBoard: cell[35] || "", oltPort: cell[36] || "",
    onuSerial: cell[45] || ""
  }));
  // Mantém a mesma regra da extensão anterior: cadastro desativado no IXC
  // não participa da interface, do teste de roteador nem do cache do Onion.
  return logins.filter((login) => login.active === true);
}
async function fetchIxcPonId(loginId) {
  if (!loginId) return "";
  try {
    const response = await fetch(
      `https://sistema.zaaztelecom.com.br/aplicativo/radusuarios/rel_22021.php?id=${encodeURIComponent(loginId)}`,
      { credentials: "include" }
    );
    if (!response.ok) return "";
    const html = await response.text();
    const match = html.match(/<dt>\s*Pon ID:?\s*<\/dt>\s*<dd>(.*?)<\/dd>/i);
    return String(match?.[1] || "").replace(/<[^>]+>/g, "").trim();
  } catch {
    return "";
  }
}
async function getIxcOperator() {
  const stored = await chrome.storage.local.get(IXC_USER_CONFIG_KEY);
  const config = stored[IXC_USER_CONFIG_KEY] || {};
  return {
    configured: Boolean(config.techId),
    techId: config.techId ? String(config.techId) : "",
    techName: String(config.techName || ""),
    userId: config.userId ? String(config.userId) : ""
  };
}
async function searchIxcOperators(term) {
  const tokens = String(term || "").trim().split(/\s+/).filter((token) => token.length > 1);
  if (!tokens.length) return [];
  const gridParam = {};
  tokens.forEach((token, index) => {
    gridParam[String(index)] = {
      TB: "funcionarios.funcionario", display: "Colaborador",
      OP: "L", P: token.toUpperCase(), C: "AND", G: "_funcionarios.funcionario"
    };
  });
  const response = await fetch(
    "https://sistema.zaaztelecom.com.br/aplicativo/funcionarios/action/action.php?action=grid&relation=false&advanced_search=false",
    {
      method: "POST", credentials: "include",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        action: "grid", relation: "false", advanced_search: "false",
        page: "1", rp: "50", sortname: "funcionarios.funcionario", sortorder: "asc",
        query: "", qtype: "funcionarios.funcionario", oper: "L",
        grid_param: JSON.stringify(gridParam), grid_param2: "false", display: "Colaborador"
      }).toString()
    }
  );
  if (!response.ok) throw new Error(`IXC HTTP ${response.status}`);
  const data = await response.json();
  return (Array.isArray(data?.rows) ? data.rows : [])
    .filter((row) => /^sim$/i.test(String(row?.cell?.[2] || "").trim()))
    .map((row) => ({ id: String(row.id), name: String(row?.cell?.[1] || "") }));
}
async function handleIxcCommand(next, payload = {}) {
  const convId = String(payload.convId || payload.conversationId || "");
  const cpf = onlyDocumentDigits(payload.cpf);
  if (!UUID_RE.test(convId)) throw new Error("conversationId_invalido");
  if (![11, 14].includes(cpf.length)) throw new Error("cpf_cnpj_invalido");
  log("info", "Buscando cliente no IXC", `${convId.slice(0, 8)} · ${cpf.slice(-4)}`);
  const customer = await fetchIxcCustomer(cpf);
  const [osList, logins] = await Promise.all([
    fetchIxcServiceOrders(customer.clientId),
    fetchIxcLogins(customer.clientId)
  ]);
  const preferredLogin = logins.find((login) => login.online)
    || logins.find((login) => login.active)
    || logins[0]
    || null;
  if (preferredLogin) preferredLogin.ponId = await fetchIxcPonId(preferredLogin.loginId);
  const external = self.OnionExternalStatus
    ? await self.OnionExternalStatus.enrichLogins(logins, { force: false })
    : { logins, externalStatus: null };
  const ixcOperator = await getIxcOperator();
  const ixcData = {
    ...customer,
    cpf,
    logins: external.logins,
    osList,
    ixcOperator,
    externalStatus: external.externalStatus,
    fetchedAt: new Date().toISOString()
  };
  next.timeout(ACK_TIMEOUT_MS).emit("ext:atendimento:cliente", {
    convId, ixcOnly: true,
    cliente: {
      cpf, nomeIxc: customer.fullName, ativo: customer.active,
      telefone: customer.phone,
      endereco: [customer.street, customer.houseNumber, customer.neighborhood, customer.city, customer.state].filter(Boolean).join(", "),
      filial: osList.find((item) => item.filialId)?.filialId || "",
      ixcData
    }
  }, (error, response) => {
    if (error || response?.ok === false) log("error", "Onion rejeitou dados IXC", error?.message || response?.error || "");
    else log("ok", "Dados IXC enviados ao Onion", `${customer.fullName} · ${osList.length} OS`);
  });
  next.emit("cmd:resultado", { cmd: "buscar_ixc", ok: true, convId, totalOs: osList.length });
}

async function handleIxcLoginsRefreshCommand(next, payload = {}) {
  const convId = String(payload.convId || payload.conversationId || "");
  const clientId = String(payload.clientId || "").trim();
  if (!UUID_RE.test(convId)) throw new Error("conversationId_invalido");
  if (!clientId) throw new Error("cliente_ixc_nao_resolvido");

  log("info", "Atualizando IP no IXC", `${convId.slice(0, 8)} · cliente ${clientId}`);
  const logins = await fetchIxcLogins(clientId);
  const preferredLogin = logins.find((login) => login.online)
    || logins.find((login) => login.active)
    || logins[0]
    || null;
  if (preferredLogin) preferredLogin.ponId = await fetchIxcPonId(preferredLogin.loginId);
  const external = self.OnionExternalStatus
    ? await self.OnionExternalStatus.enrichLogins(logins, { force: false })
    : { logins, externalStatus: null };

  next.timeout(ACK_TIMEOUT_MS).emit("ext:atendimento:cliente", {
    convId,
    ixcOnly: true,
    ixcMerge: true,
    cliente: {
      ixcData: {
        clientId,
        logins: external.logins,
        externalStatus: external.externalStatus,
        loginsFetchedAt: new Date().toISOString()
      }
    }
  }, (error, response) => {
    if (error || response?.ok === false) {
      log("error", "Onion rejeitou atualização de IP", error?.message || response?.error || "");
    } else {
      log("ok", "IP atualizado no Onion", `${convId.slice(0, 8)} · ${external.logins.length} login(s)`);
    }
  });
  next.emit("cmd:resultado", {
    cmd: "refresh_ixc_logins",
    ok: true,
    convId,
    totalLogins: external.logins.length
  });
}

async function handleExternalStatusRefreshCommand(next, payload = {}) {
  const convId = String(payload.convId || payload.conversationId || "");
  if (!UUID_RE.test(convId)) throw new Error("conversationId_invalido");
  if (!self.OnionExternalStatus) throw new Error("integracao_externa_indisponivel");
  const incomingLogins = Array.isArray(payload.logins) ? payload.logins.slice(0, 30) : [];
  const networkSource = String(payload.networkSource || "ixc").toLowerCase() === "genesys"
    ? "genesys"
    : "ixc";
  const logins = incomingLogins
    .filter((login) => login && typeof login === "object" && login.active === true)
    .map((login) => JSON.parse(JSON.stringify(login)));
  if (!logins.length) throw new Error("identidade_rede_nao_disponivel");

  log("info", "Atualizando problemas externos", `${convId.slice(0, 8)} · cache global protegido`);
  const external = await self.OnionExternalStatus.enrichLogins(logins, { force: true });
  const networkPatch = networkSource === "genesys"
    ? {
      externalNetwork: {
        source: "genesys",
        logins: external.logins,
        externalStatus: external.externalStatus,
        checkedAt: new Date().toISOString()
      }
    }
    : {
      ixcData: {
        logins: external.logins,
        externalStatus: external.externalStatus
      }
    };
  next.timeout(ACK_TIMEOUT_MS).emit("ext:atendimento:cliente", {
    convId,
    ixcOnly: true,
    ixcMerge: true,
    cliente: networkPatch
  }, (error, response) => {
    if (error || response?.ok === false) {
      log("error", "Onion rejeitou problemas externos", error?.message || response?.error || "");
    } else {
      const noc = external.externalStatus?.nocview?.status || "indisponível";
      const graf = external.externalStatus?.grafana?.status || "indisponível";
      log("ok", "Problemas externos atualizados", `NocView ${noc} · Grafana ${graf}`);
    }
  });
  next.emit("cmd:resultado", {
    cmd: "refresh_external_status",
    ok: true,
    convId,
    externalStatus: external.externalStatus
  });
}

const PRE_OS_TASKS = new Set(["4631", "4633", "4635", "4637", "4641"]);
const ALLOWED_OS_TASKS = new Set(["4533", "4629", ...PRE_OS_TASKS]);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
function formatBRDateTime(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error("data_agendamento_invalida");
  const pad = (number) => String(number).padStart(2, "0");
  return `${pad(date.getDate())}/${pad(date.getMonth() + 1)}/${date.getFullYear()} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}
async function postIxcForm(url, fields, errorLabel) {
  const response = await fetch(url, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(fields).toString()
  });
  if (!response.ok) throw new Error(`IXC HTTP ${response.status}`);
  const data = await response.json();
  if (data?.type !== "success") throw new Error(data?.message || errorLabel);
  return data;
}
async function finalizeSelectedIxcOs({ osId, techId, diagnosisId, nextTaskCode, mensagem }) {
  const now = formatBRDateTime(new Date());
  return postIxcForm(ZAAZ_OS_CLOSE_URL, {
    action: "novo", id_chamado: osId,
    id_tarefa_atual: "813", eh_tarefa_decisao: "S",
    sequencia_atual: "1", proxima_sequencia_forcada: "2",
    finaliza_processo_aux: "S", gera_comissao_aux: "ROS",
    id_processo: "25", data_inicio: now, data_final: now,
    id_resposta: "367", mensagem,
    id_tecnico: techId, id_equipe: "", gera_comissao: "S",
    status: "F", data: "", id_evento: "",
    id_su_diagnostico: diagnosisId, id_diagnostico_especifico: "",
    justificativa_sla_atrasado: "", id_evento_status: "",
    id_proxima_tarefa: "", id_proxima_tarefa_aux: nextTaskCode,
    latitude: "", longitude: "", gps_time: "", historico: ""
  }, "Erro ao finalizar OS");
}
async function forwardIxcOs({ osId, sectorCode }) {
  return postIxcForm(ZAAZ_OS_SECTOR_URL, {
    action: "novo", id_chamado: osId, alterar_setor: "S",
    id_setor: sectorCode, id_tecnico: "", id_assunto: "",
    mensagem: "AGENDAMENTO", status: "EN",
    data: "", id_evento: "", latitude: "", longitude: "", gps_time: "", historico: ""
  }, "Erro ao encaminhar OS");
}
async function scheduleIxcOs({ osId, visitDate }) {
  const start = new Date(visitDate);
  const end = new Date(start.getTime() + 60 * 60 * 1000);
  return postIxcForm(ZAAZ_OS_SCHEDULE_URL, {
    action: "novo", id_chamado: osId,
    melhor_horario_agendamento: "Q",
    data_agendamento: formatBRDateTime(start),
    data_agendamento_final: formatBRDateTime(end),
    id_tecnico: "170785", id_equipe: "", id_resposta: "",
    mensagem: "AGENDAMENTO", status: "AG",
    data: "", id_evento: "", id_compromisso: "",
    latitude: "", longitude: "", gps_time: "", historico: "",
    data_inicio: "", data_final: "", origem_registro: "IP"
  }, "Erro ao agendar OS");
}
async function attachFileToIxcOs({ osId, attachment }) {
  const sourceUrl = String(attachment?.url || "");
  if (!/^https?:\/\/(?:127\.0\.0\.1|localhost)(?::\d+)?\/uploads\//i.test(sourceUrl)) {
    throw new Error("origem_de_anexo_nao_permitida");
  }
  const response = await fetch(sourceUrl, { credentials: "omit" });
  if (!response.ok) throw new Error(`download_anexo_http_${response.status}`);
  const blob = await response.blob();
  if (!blob.size) throw new Error("anexo_vazio");
  if (blob.size > 25 * 1024 * 1024) throw new Error("anexo_maior_que_25mb");
  const fileName = String(attachment.fileName || "anexo")
    .replace(/[^\p{L}\p{N}._-]/gu, "_").slice(0, 120) || "anexo";
  const typedBlob = blob.type || attachment.mimeType
    ? new Blob([blob], { type: blob.type || attachment.mimeType })
    : blob;
  const form = new FormData();
  form.append("id_oss_chamado", String(osId));
  form.append("id_oss_chamado_mensagem", "");
  form.append("nome_arquivo", "");
  form.append("descricao", String(attachment.description || fileName).slice(0, 240));
  form.append("local_arquivo", typedBlob, fileName);
  form.append("anexar_arquivo", "");
  form.append("data_envio", "");
  form.append("classificacao_arquivo", "P");
  const upload = await fetch(ZAAZ_OS_FILES_URL, { method: "POST", credentials: "include", body: form });
  if (!upload.ok) throw new Error(`upload_ixc_http_${upload.status}`);
  const data = await upload.json();
  if (data?.type !== "success") throw new Error(data?.message || "falha_ao_anexar_no_ixc");
  return { id: data.id || null, messageId: attachment.messageId, fileName };
}
async function findSingleNewIxcOs(clientId, previousIds) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    if (attempt > 0) await sleep(1500);
    const list = await fetchIxcServiceOrders(clientId);
    const candidates = list.filter((order) => order.osId && !previousIds.has(String(order.osId)));
    if (candidates.length === 1) return { os: candidates[0], list };
    if (candidates.length > 1) throw new Error("mais_de_uma_os_nova_encontrada_fluxo_interrompido");
  }
  throw new Error("os_2_nao_encontrada_fluxo_interrompido");
}
async function handleIxcOsCommand(next, payload = {}) {
  const convId = String(payload.convId || "");
  const cpf = onlyDocumentDigits(payload.cpf);
  const clientId = String(payload.clientId || "").replace(/\D/g, "");
  const selectedOsId = String(payload.selectedOsId || "").replace(/\D/g, "");
  const operator = await getIxcOperator();
  const techId = String(operator.techId || "").replace(/\D/g, "");
  const diagnosisId = String(payload.diagnosisId || "").replace(/\D/g, "");
  const nextTaskCode = String(payload.nextTaskCode || "").replace(/\D/g, "");
  const sectorCode = String(payload.sectorCode || "").replace(/\D/g, "");
  const mensagem = String(payload.mensagem || "").trim().slice(0, 5000);
  const finalizeOnly = PRE_OS_TASKS.has(nextTaskCode);
  if (!UUID_RE.test(convId)) throw new Error("conversationId_invalido");
  if (![11, 14].includes(cpf.length)) throw new Error("cpf_cnpj_invalido");
  if (!techId) throw new Error("colaborador_ixc_nao_configurado");
  if (!clientId || !selectedOsId || !diagnosisId || !ALLOWED_OS_TASKS.has(nextTaskCode) || !mensagem) {
    throw new Error("dados_da_os_incompletos");
  }
  if (!finalizeOnly && (!sectorCode || !payload.visitDate)) throw new Error("setor_ou_agendamento_ausente");

  const before = await fetchIxcServiceOrders(clientId);
  const selectedOrder = before.find((order) => String(order.osId) === selectedOsId);
  const normalizeOrderLabel = (value) => String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, " ").trim().toUpperCase();
  const validOpenSupportN1 = Boolean(selectedOrder)
    && !/(FINALIZ|ENCERR|FECHAD|CANCEL)/.test(normalizeOrderLabel(selectedOrder.status))
    && normalizeOrderLabel(selectedOrder.subject).startsWith("SUPORTE INICIAL")
    && normalizeOrderLabel(selectedOrder.sector).startsWith("SUPORTE N1");
  if (!validOpenSupportN1) throw new Error("os_selecionada_nao_e_suporte_n1_aberta");
  const previousIds = new Set(before.map((order) => String(order.osId || "")).filter(Boolean));
  log("info", "Finalizando OS selecionada", `#${selectedOsId} · tarefa ${nextTaskCode}`);
  await finalizeSelectedIxcOs({ osId: selectedOsId, techId, diagnosisId, nextTaskCode, mensagem });
  const created = await findSingleNewIxcOs(clientId, previousIds);
  const attachmentResults = [];
  for (const attachment of (Array.isArray(payload.attachments) ? payload.attachments.slice(0, 12) : [])) {
    try {
      const attached = await attachFileToIxcOs({ osId: created.os.osId, attachment });
      attachmentResults.push({ ...attached, ok: true });
    } catch (error) {
      attachmentResults.push({
        ok: false,
        messageId: attachment?.messageId || null,
        fileName: attachment?.fileName || "anexo",
        error: error?.message || "falha_ao_anexar"
      });
    }
  }

  if (!finalizeOnly) {
    await forwardIxcOs({ osId: created.os.osId, sectorCode });
    await scheduleIxcOs({ osId: created.os.osId, visitDate: payload.visitDate });
  }
  await handleIxcCommand(next, { convId, cpf });
  const result = {
    cmd: "ixc_os", ok: true, convId,
    chatId: payload.chatId || null,
    requestId: payload.requestId || null,
    selectedOsId, os2Id: created.os.osId,
    finalizedOnly: finalizeOnly,
    attachments: attachmentResults,
    attachedCount: attachmentResults.filter((item) => item.ok).length,
    attachmentFailedCount: attachmentResults.filter((item) => !item.ok).length
  };
  next.emit("cmd:resultado", result);
  log("ok", finalizeOnly ? "Pré-OS gerada" : "OS encaminhada e agendada", `#${created.os.osId}`);
  return result;
}

function gadgetFrameKey(tabId, frameId) {
  return `${tabId}:${frameId}`;
}
function bindConversationToGadgetFrame(conversationId, tabId, frameId) {
  if (!UUID_RE.test(conversationId) || tabId == null || frameId == null) return;
  for (const [boundConversationId, frame] of gadgetFrameByConversation) {
    if (
      boundConversationId !== conversationId
      && frame.tabId === tabId
      && frame.frameId === frameId
    ) {
      gadgetFrameByConversation.delete(boundConversationId);
    }
  }
  gadgetFrameByConversation.set(conversationId, { tabId, frameId, at: Date.now() });
  log("info", "Conversa vinculada ao compositor", `${conversationId.slice(0, 8)} · frame ${frameId}`);
}
async function rememberCommunicationId(conversationId, communicationId, reason = "genesys-web") {
  const previous = communicationIdByConversation.get(conversationId);
  const changed = previous?.communicationId !== communicationId;
  if (!changed) return false;
  const binding = { communicationId, at: Date.now(), reason };
  communicationIdByConversation.set(conversationId, binding);
  const stored = await chrome.storage.session.get(COMMUNICATIONS_KEY);
  const bindings = stored[COMMUNICATIONS_KEY] || {};
  bindings[conversationId] = binding;
  await chrome.storage.session.set({ [COMMUNICATIONS_KEY]: bindings });
  const waiters = communicationWaiters.get(conversationId);
  if (waiters) {
    communicationWaiters.delete(conversationId);
    for (const resolve of waiters) resolve(communicationId);
  }
  if (changed && !["onion-command", "passive-discovery", "notification-sync"].includes(reason)) {
    const state = conversationState(conversationId);
    if (state.upserted) {
      emit("ext:atendimento:upsert", {
        convId: conversationId,
        communicationId,
        syncGeneration: state.syncGeneration,
        canal: "genesys",
        status: "open",
        identityOnly: true,
        environment: "dev"
      });
    }
  }
  return changed;
}
async function forgetCommunicationId(conversationId) {
  communicationIdByConversation.delete(conversationId);
  const stored = await chrome.storage.session.get(COMMUNICATIONS_KEY);
  const bindings = stored[COMMUNICATIONS_KEY] || {};
  delete bindings[conversationId];
  await chrome.storage.session.set({ [COMMUNICATIONS_KEY]: bindings });
}
async function knownCommunicationId(conversationId) {
  const memory = communicationIdByConversation.get(conversationId);
  if (memory && Date.now() - memory.at <= COMMUNICATION_MAX_AGE_MS) {
    return memory.communicationId;
  }
  const stored = await chrome.storage.session.get(COMMUNICATIONS_KEY);
  const binding = stored[COMMUNICATIONS_KEY]?.[conversationId];
  if (
    binding
    && UUID_RE.test(String(binding.communicationId || ""))
    && Date.now() - Number(binding.at || 0) <= COMMUNICATION_MAX_AGE_MS
  ) {
    communicationIdByConversation.set(conversationId, binding);
    return binding.communicationId;
  }
  return "";
}
async function waitForCommunicationId(conversationId) {
  const known = await knownCommunicationId(conversationId);
  if (known) return known;
  log("info", "Aguardando CommunicationId do Genesys", conversationId.slice(0, 8));
  return new Promise((resolve, reject) => {
    const waiters = communicationWaiters.get(conversationId) || new Set();
    const finish = (communicationId) => {
      clearTimeout(timer);
      resolve(communicationId);
    };
    waiters.add(finish);
    communicationWaiters.set(conversationId, waiters);
    const timer = setTimeout(() => {
      waiters.delete(finish);
      if (!waiters.size) communicationWaiters.delete(conversationId);
      reject(new Error("communicationId_nao_capturado_em_15s"));
    }, COMMUNICATION_WAIT_MS);
  });
}
async function resolveCommunicationFromActiveConversations(conversationId) {
  const body = await genesysFetch(`/api/v2/conversations?communicationType=message&_=${Date.now()}`);
  const activeConversations = Array.isArray(body) ? body : (body.entities || []);
  const conversation = activeConversations.find((item) => String(item.id || "") === conversationId);
  if (!conversation) return "";
  const communicationId = activeAgentCommunicationId(conversation);
  if (!communicationId) return "";
  await rememberCommunicationId(conversationId, communicationId, "active-conversations");
  log("ok", "CommunicationId resolvido nas conversas ativas", `${conversationId.slice(0, 8)} · ${communicationId.slice(0, 8)}`);
  return communicationId;
}

function sanitizeExtensionErrorText(value, maxLength = 180) {
  return String(value || "")
    .replace(/\b[\w.+-]+@[\w.-]+\.[a-z]{2,}\b/gi, "[email]")
    .replace(/\b(?:\+?55\s*)?(?:\(?\d{2}\)?\s*)?\d{4,5}[-.\s]?\d{4}\b/g, "[telefone]")
    .replace(/\b\d{11,14}\b/g, "[documento]")
    .replace(/\b[0-9a-f]{8}-[0-9a-f-]{27,}\b/gi, "[id]")
    .replace(/(authorization|token|secret|password)\s*[:=]\s*[^\s,;]+/gi, "$1=[protegido]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}
function notifyExtensionError(entry) {
  if (!socket?.connected || entry?.level !== "error") return;
  const message = sanitizeExtensionErrorText(entry.message, 120) || "Falha na extensão";
  const detail = sanitizeExtensionErrorText(entry.detail, 180);
  const fingerprint = `${message}|${detail}`.toLowerCase();
  const now = Date.now();
  const lastSentAt = Number(extensionErrorNotifications.get(fingerprint) || 0);
  if (now - lastSentAt < EXTENSION_ERROR_DEDUPE_MS) return;
  extensionErrorNotifications.set(fingerprint, now);
  for (const [key, sentAt] of extensionErrorNotifications) {
    if (now - sentAt > EXTENSION_ERROR_DEDUPE_MS * 5) extensionErrorNotifications.delete(key);
  }
  socket.emit("ext:log:error", { message, detail, at: Number(entry.at || now), fingerprint });
}
function flushExtensionErrorNotifications() {
  logs.filter((entry) => entry.level === "error" && Date.now() - entry.at <= 5 * 60 * 1000)
    .reverse()
    .forEach(notifyExtensionError);
}
function log(level, message, detail = "") {
  const entry = { at: Date.now(), level, message, detail: String(detail || "") };
  logs.unshift(entry);
  logs.splice(100);
  if (level === "error") notifyExtensionError(entry);
}
function normalizeName(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}
function validParticipantName(value) {
  const name = normalizeName(value);
  if (!name || /^(sem nome|nome n[aã]o encontrado|n[aã]o encontrado|cliente)$/i.test(name)) return "";
  return name;
}
function comparableName(value) {
  return normalizeName(value).toLocaleLowerCase("pt-BR");
}
async function resolveConversationByParticipant(name, generation) {
  const key = comparableName(name);
  if (!key) return;
  if (lastParticipantResolve.key === key && Date.now() - lastParticipantResolve.at < 3000) return;
  lastParticipantResolve = { key, at: Date.now() };
  const seq = ++participantResolveSeq;
  try {
    const body = await genesysFetch("/api/v2/conversations", {
      governor: { priority: "audit", timeoutMs: 30000 }
    });
    const entities = Array.isArray(body) ? body : (body.entities || []);
    const matches = entities.map((conversation) => ({
      id: String(conversation.id || ""),
      name: normalizeName((conversation.participants || []).find((participant) => participant.purpose === "customer")?.name)
    })).filter((conversation) => conversation.id && comparableName(conversation.name) === key);
    if (seq !== participantResolveSeq || generation !== focused.generation || comparableName(focused.name) !== key) {
      log("drop", "Resposta Genesys descartada", "participante mudou durante a consulta");
      return;
    }
    if (matches.length !== 1) {
      log("warn", "Fallback API sem correspondência única", `${name} · encontrados ${matches.length}`);
      return;
    }
    if (focused.conversationId === matches[0].id) return;
    pendingFocus = { conversationId: matches[0].id, at: Date.now() };
    log("info", "conversationId resolvido pela API", matches[0].id.slice(0, 8));
    commitPendingFocus();
  } catch (error) {
    log("error", "Erro no fallback Genesys", error.message);
  }
}
async function onionOpenGenesysChats() {
  const cfg = await settings();
  const credentials = await auth();
  if (!credentials?.token) throw new Error("Login Onion indisponível");
  const baseUrl = safeBaseUrl(cfg.baseUrl);
  const response = await fetch(`${baseUrl}/api/chats?limit=500&page=1`, {
    headers: { authorization: `Bearer ${credentials.token}`, accept: "application/json" }
  });
  if (!response.ok) throw new Error(`Onion chats HTTP ${response.status}`);
  const body = await response.json();
  const chats = Array.isArray(body) ? body : (body.items || []);
  return chats.filter((chat) => {
    const channel = String(chat.channel || "").toLowerCase();
    const source = String(chat.externalSource || "").toLowerCase();
    return chat.status !== "closed"
      && (channel === "genesys" || source === "genesys" || chat.genesysConvId || chat.externalConvId);
  });
}
function activeGenesysMessageConversationMap(entities) {
  const active = new Map();
  for (const conversation of (Array.isArray(entities) ? entities : [])) {
    const conversationId = String(conversation?.id || "");
    if (!UUID_RE.test(conversationId) || !hasActiveAgentMessaging(conversation)) continue;
    active.set(conversationId, conversation);
  }
  return active;
}
async function reconcileCardRoster(roster = {}) {
  const seq = ++rosterReconcileSeq;
  try {
    const cfg = await settings();
    const onionChats = await onionOpenGenesysChats();
    if (seq !== rosterReconcileSeq) return;

    const domIds = new Set(
      (Array.isArray(roster.conversationIds) ? roster.conversationIds : [])
        .map((id) => String(id || ""))
        .filter((id) => UUID_RE.test(id))
    );
    const onionIds = new Set(
      onionChats
        .map((chat) => String(chat.genesysConvId || chat.externalConvId || ""))
        .filter((id) => UUID_RE.test(id))
    );
    const passiveRosterFresh = cfg.passiveRoster !== false
      && Date.now() - Number(latestPassiveRoster.at || 0) <= PASSIVE_ROSTER_MAX_AGE_MS;

    let activeIds = new Set(domIds);
    let activeDetails = new Map();
    let rosterComplete = (
      roster.allowClose === true
      && domIds.size === Number(roster.count || 0)
    );
    let authoritative = false;

    try {
      const genesysConversations = await fetchAllGenesysConversations({
        priority: "audit",
        timeoutMs: 60000
      });
      if (seq !== rosterReconcileSeq) return;
      activeDetails = activeGenesysMessageConversationMap(genesysConversations);
      activeIds = new Set(activeDetails.keys());
      authoritative = true;
      rosterComplete = true;
      lastAuthoritativeRosterAuditAt = Date.now();
      lastAuthoritativeRoster = {
        ids: new Set(activeIds),
        at: lastAuthoritativeRosterAuditAt,
        source: "api-message"
      };
      for (const [conversationId, detail] of activeDetails) {
        authoritativeConversationDetails.set(conversationId, {
          detail,
          at: lastAuthoritativeRosterAuditAt
        });
      }
      for (const conversationId of [...authoritativeConversationDetails.keys()]) {
        if (!activeIds.has(conversationId)) authoritativeConversationDetails.delete(conversationId);
      }
      if (
        deliveryRosterGuard.blocking
        && !deliveryRosterGuard.authoritative
        && socket?.connected
      ) {
        await completeStartupDeliveryReconciliation(
          socket,
          deliveryRosterGuard.generation,
          activeIds,
          "api-message"
        );
      } else {
        deliveryRosterGuard.activeIds = new Set(activeIds);
        deliveryRosterGuard.authoritative = true;
        deliveryRosterGuard.blocking = true;
        deliveryRosterGuard.confirmedAt = Date.now();
        deliveryRosterGuard.source = "api-message";
      }
    } catch (error) {
      log("warn", "Roster de mensagens não confirmado pela API", error?.message || "erro");
      if (passiveRosterFresh) {
        activeIds = new Set([...domIds, ...latestPassiveRoster.ids]);
      }
    }
    if (seq !== rosterReconcileSeq) return;

    for (const conversationId of activeIds) {
      const state = conversationState(conversationId);
      reviveClosedConversationState(conversationId, state, "authoritative-roster");
      state.closed = false;
      state.observedAgentActive = true;
      if (authoritative) state.lastApiConfirmedAt = Date.now();
      if (domIds.has(conversationId)) state.lastDomSeenAt = Date.now();
      closureSuspicions.delete(conversationId);

      const existsInOnion = onionIds.has(conversationId);
      if (existsInOnion) {
        state.upserted = true;
        state.lifecycle = "ACTIVE";
      } else {
        state.upserted = false;
        state.backfilled = false;
        state.forceSnapshot = true;
        state.lifecycle = "DISCOVERED";
      }

      const rosterDetail = activeDetails.get(conversationId);
      const rosterCommunicationId = connectedAgentCommunicationCandidates(rosterDetail)[0]?.communicationId
        || activeAgentCommunicationId(rosterDetail);
      if (rosterCommunicationId) {
        await rememberCommunicationId(
          conversationId,
          rosterCommunicationId,
          "authoritative-roster"
        ).catch(() => {});
      }
      if (existsInOnion) continue;
      if (!state.passiveDiscoveryPending) {
        const staggerMs = Math.min(1200, 100 + [...activeIds].indexOf(conversationId) * 150);
        scheduleNotificationSync(conversationId, staggerMs);
      }
    }

    const missingIds = [...activeIds].filter((conversationId) => !onionIds.has(conversationId));
    const staleIds = authoritative && rosterComplete
      ? [...onionIds].filter((conversationId) => !activeIds.has(conversationId))
      : [];

    for (const conversationId of staleIds) {
      const suspectedAt = Number(closureSuspicions.get(conversationId) || 0);
      if (!suspectedAt) {
        closureSuspicions.set(conversationId, Date.now());
        conversationState(conversationId).lifecycle = "SUSPECTED_ABSENT";
        log("warn", "Encerramento aguardando confirmação", conversationId.slice(0, 8));
        setTimeout(() => scheduleRosterReconcile({
          count: Number(roster.count || 0),
          names: Array.isArray(roster.names) ? roster.names : [],
          conversationIds: [...domIds],
          allowClose: true
        }), 5000);
        continue;
      }
      if (Date.now() - suspectedAt < 4000) continue;
      const state = conversationState(conversationId);
      if (state.closed || state.lifecycle === "CLOSING") continue;
      queueReliableClose({
        convId: conversationId,
        motivo: "genesys_roster_reconcile",
        environment: "dev"
      }).catch((error) => {
        log("error", "Falha ao enfileirar encerramento", error?.message || "erro");
      });
      closureSuspicions.delete(conversationId);
    }

    log(
      "ok",
      authoritative ? "Roster autoritativo reconciliado" : "Cards reconciliados por fallback",
      `Genesys ${activeIds.size} · Onion ${onionIds.size} · ausentes ${missingIds.length} · excedentes ${staleIds.length}`
    );
  } catch (error) {
    log("error", "Falha ao reconciliar cards", error.message);
  }
}
function scheduleRosterReconcile(roster = {}) {
  clearTimeout(rosterReconcileTimer);
  rosterReconcileTimer = setTimeout(() => reconcileCardRoster(roster), 500);
}
function schedulePeriodicAuthoritativeRosterAudit() {
  if (Date.now() - Number(lastAuthoritativeRosterAuditAt || 0) < AUTHORITATIVE_ROSTER_AUDIT_MS) return;
  scheduleRosterReconcile({
    count: Number(latestDomRoster.count || 0),
    names: [],
    conversationIds: [...latestDomRoster.ids],
    allowClose: latestDomRoster.complete === true
  });
}

function conversationState(id) {
  if (!conversations.has(id)) conversations.set(id, {
    lifecycle: "DISCOVERED",
    createdAt: Date.now(),
    lastNetworkSeenAt: 0,
    lastDomSeenAt: 0,
    lastApiConfirmedAt: 0,
    observedMessageCount: 0,
    observedAgentCommunicationIds: new Set(),
    participantName: "",
    passiveDiscoveryPending: false,
    passivePendingMessageIds: new Set(),
    passiveMediaPendingAt: new Map(),
    upserted: false,
    backfilled: false,
    forceSnapshot: false,
    closed: false,
    syncing: false,
    rerun: false,
    bulkRetryCount: 0,
    messageIds: new Set(),
    generation: focused.generation,
    syncGeneration: crypto.randomUUID()
  });
  return conversations.get(id);
}
function reviveClosedConversationState(conversationId, state, source = "active-evidence") {
  if (!state || (!state.closed && !["CLOSING", "CLOSED"].includes(state.lifecycle))) return false;
  state.lifecycle = "DISCOVERED";
  state.closed = false;
  state.closedAt = 0;
  state.upserted = false;
  state.backfilled = false;
  state.forceSnapshot = true;
  state.syncGeneration = crypto.randomUUID();
  state.messageIds = new Set();
  state.passivePendingMessageIds = new Set();
  state.passiveMediaPendingAt = new Map();
  state.observedMessageCount = 0;
  state.observedMissingMessageCount = 0;
  closureSuspicions.delete(conversationId);
  log("info", "Conversa Genesys reaberta como nova sessão", `${conversationId.slice(0, 8)} · ${source}`);
  return true;
}
function normalizeNotificationSnapshot(raw, observedAt = Date.now()) {
  const conversationId = String(raw?.conversationId || "");
  if (!UUID_RE.test(conversationId)) return null;
  const messageRefs = [];
  const seenMessageIds = new Set();
  for (const reference of Array.isArray(raw?.messageRefs) ? raw.messageRefs : []) {
    const id = String(reference?.id || "").trim();
    if (!id || seenMessageIds.has(id) || messageRefs.length >= 500) continue;
    seenMessageIds.add(id);
    messageRefs.push({
      id,
      purpose: String(reference?.purpose || "").trim().toLowerCase().slice(0, 40),
      participantId: UUID_RE.test(String(reference?.participantId || "")) ? String(reference.participantId) : "",
      participantName: String(reference?.participantName || "").replace(/\s+/g, " ").trim().slice(0, 200),
      userId: UUID_RE.test(String(reference?.userId || "")) ? String(reference.userId) : "",
      senderKind: ["customer", "bot", "self_agent", "other_agent", "system"].includes(String(reference?.senderKind || ""))
        ? String(reference.senderKind)
        : ""
    });
  }
  for (const rawId of Array.isArray(raw?.messageIds) ? raw.messageIds : []) {
    const id = String(rawId || "").trim();
    if (!id || seenMessageIds.has(id) || messageRefs.length >= 500) continue;
    seenMessageIds.add(id);
    messageRefs.push({ id, purpose: "", participantId: "", participantName: "", userId: "", senderKind: "" });
  }
  return {
    conversationId,
    observedAt: Number(observedAt || Date.now()),
    customerName: validParticipantName(raw?.customerName),
    customerDocument: String(raw?.customerDocument || "").slice(0, 40),
    customerAddress: String(raw?.customerAddress || "").replace(/\s+/g, " ").trim().slice(0, 500),
    customerCity: String(raw?.customerCity || "").replace(/\s+/g, " ").trim().slice(0, 200),
    customerPhone: String(raw?.customerPhone || "").replace(/\D/g, "").slice(0, 30),
    customerLegalName: String(raw?.customerLegalName || "").replace(/\s+/g, " ").trim().slice(0, 200),
    customerPppoe: String(raw?.customerPppoe || "").trim().slice(0, 200),
    customerIp: String(raw?.customerIp || "").trim().slice(0, 80),
    customerContractId: String(raw?.customerContractId || "").trim().slice(0, 80),
    customerOlt: String(raw?.customerOlt || "").replace(/\s+/g, " ").trim().slice(0, 200),
    customerPon: String(raw?.customerPon || "").trim().slice(0, 100),
    customerBranch: String(raw?.customerBranch || "").trim().slice(0, 80),
    openedAt: raw?.openedAt || null,
    inactivityTimeout: raw?.inactivityTimeout || null,
    agentCommunicationIds: (Array.isArray(raw?.agentCommunicationIds) ? raw.agentCommunicationIds : [])
      .map((id) => String(id || ""))
      .filter((id) => UUID_RE.test(id))
      .slice(0, 10),
    messageRefs,
    agentActive: typeof raw?.agentActive === "boolean" ? raw.agentActive : null,
    active: typeof raw?.active === "boolean" ? raw.active : null
  };
}
function rememberNotificationSnapshot(raw, observedAt = Date.now()) {
  const snapshot = normalizeNotificationSnapshot(raw, observedAt);
  if (!snapshot) return null;
  notificationSnapshots.set(snapshot.conversationId, snapshot);
  while (notificationSnapshots.size > 500) {
    notificationSnapshots.delete(notificationSnapshots.keys().next().value);
  }
  const state = conversationState(snapshot.conversationId);
  state.lastNetworkSeenAt = snapshot.observedAt;
  if (snapshot.customerName) state.participantName = snapshot.customerName;
  if (typeof snapshot.agentActive === "boolean") state.observedAgentActive = snapshot.agentActive;
  if (snapshot.agentActive === true) {
    reviveClosedConversationState(snapshot.conversationId, state, "notification-snapshot");
    state.lifecycle = state.upserted ? "ACTIVE" : "DISCOVERED";
    state.closed = false;
    if (deliveryRosterGuard.blocking) deliveryRosterGuard.activeIds.add(snapshot.conversationId);
  } else if (snapshot.agentActive === false) {
    state.observedInactiveAt = snapshot.observedAt;
  }
  state.observedAgentCommunicationIds = new Set(snapshot.agentCommunicationIds);
  state.observedMessageCount = Math.max(state.observedMessageCount || 0, snapshot.messageRefs.length);
  state.observedMissingMessageCount = snapshot.messageRefs.filter((reference) => (
    !state.messageIds.has(reference.id) && !state.passivePendingMessageIds.has(reference.id)
  )).length;
  observationMetrics.notificationFrames += 1;
  observationMetrics.notificationMessageReferences += snapshot.messageRefs.length;
  return snapshot;
}
function registerPassiveRosterCandidate(ids, observedAt = Date.now()) {
  const normalizedIds = new Set(
    [...(ids || [])].map((id) => String(id || "")).filter((id) => UUID_RE.test(id))
  );
  const signature = [...normalizedIds].sort().join("|");
  const at = Number(observedAt || Date.now());
  const sameCandidate = signature === passiveRosterCandidate.signature
    && at - Number(passiveRosterCandidate.lastAt || 0) <= STARTUP_ROSTER_CONFIRMATION_WINDOW_MS;
  passiveRosterCandidate = {
    signature,
    ids: normalizedIds,
    confirmations: sameCandidate
      ? Number(passiveRosterCandidate.confirmations || 0) + 1
      : 1,
    firstAt: sameCandidate ? Number(passiveRosterCandidate.firstAt || at) : at,
    lastAt: at
  };
  if (deliveryRosterGuard.blocking) {
    for (const conversationId of normalizedIds) {
      deliveryRosterGuard.activeIds.add(conversationId);
    }
  }
}
function observeConversationNetwork(message = {}) {
  observationMetrics.lastResponseAt = Date.now();
  observationMetrics.responses += 1;
  observationMetrics.lastRouteKind = String(message.routeKind || "other");
  observationMetrics.lastTransport = String(message.transport || "");
  const observed = Array.isArray(message.conversations) ? message.conversations : [];
  if (
    message.routeKind === "conversation_list"
    && Number(message.status || 0) >= 200
    && Number(message.status || 0) < 300
  ) {
    const activeIds = new Set(
      observed
        .filter((item) => item?.agentActive === true)
        .map((item) => String(item?.conversationId || ""))
        .filter((id) => UUID_RE.test(id))
    );
    latestPassiveRoster = {
      ids: activeIds,
      at: Number(message.observedAt || Date.now())
    };
    registerPassiveRosterCandidate(activeIds, latestPassiveRoster.at);
  }
  observationMetrics.conversationSightings += observed.length;
  let divergent = 0;
  for (const item of observed) {
    const conversationId = String(item?.conversationId || "");
    if (!UUID_RE.test(conversationId)) continue;
    const state = conversationState(conversationId);
    state.lastNetworkSeenAt = Number(message.observedAt || Date.now());
    if (typeof item?.agentActive === "boolean") state.observedAgentActive = item.agentActive;
    if (item.active === true) {
      reviveClosedConversationState(conversationId, state, "passive-network");
      state.lifecycle = state.upserted ? "ACTIVE" : "DISCOVERED";
    }
    if (item.active === false) state.observedInactiveAt = state.lastNetworkSeenAt;
    const communicationIds = (Array.isArray(item.agentCommunicationIds) ? item.agentCommunicationIds : [])
      .map((id) => String(id || ""))
      .filter((id) => UUID_RE.test(id));
    state.observedAgentCommunicationIds = new Set(communicationIds);
    const messageIds = (Array.isArray(item.messageIds) ? item.messageIds : [])
      .map((id) => String(id || ""))
      .filter(Boolean);
    observationMetrics.messageReferences += messageIds.length;
    state.observedMessageCount = Math.max(state.observedMessageCount || 0, messageIds.length);
    const missingIds = messageIds.filter((id) => !state.messageIds.has(id));
    state.observedMissingMessageCount = missingIds.length;
    if (!missingIds.length) continue;
    divergent += 1;
    const previousLogAt = Number(observationDivergenceLogAt.get(conversationId) || 0);
    if (Date.now() - previousLogAt >= 15000) {
      observationDivergenceLogAt.set(conversationId, Date.now());
      log(
        "info",
        "Observação encontrou mensagens ainda não sincronizadas",
        `${conversationId.slice(0, 8)} · ${missingIds.length}`
      );
    }
  }
  observationMetrics.divergentConversations = divergent;
}
function deliverPassiveMessageToOnion(payload) {
  if (!socket?.connected || !rateAllowed()) return Promise.resolve(false);
  return new Promise((resolve) => {
    socket.timeout(ACK_TIMEOUT_MS).emit("ext:atendimento:mensagem", payload, (error, response) => {
      if (error || response?.ok === false) {
        log("warn", "Delta passivo sem confirmação", error?.message || response?.error || "ack_incompleto");
        resolve(false);
        return;
      }
      resolve(true);
    });
  });
}
function deliverConversationUpsertToOnion(payload, failureLabel = "Upsert sem confirmação") {
  if (!socket?.connected || !rateAllowed()) return Promise.resolve(false);
  return new Promise((resolve) => {
    socket.timeout(ACK_TIMEOUT_MS).emit("ext:atendimento:upsert", payload, (error, response) => {
      if (error || response?.ok === false) {
        log("warn", failureLabel, error?.message || response?.error || "ack_incompleto");
        resolve(false);
        return;
      }
      const conversationId = String(payload?.convId || payload?.conversationId || "");
      if (UUID_RE.test(conversationId)) {
        const state = conversationState(conversationId);
        state.upserted = true;
        state.closed = false;
        state.lifecycle = "ACTIVE";
      }
      log("ok", "Upsert confirmado pelo Onion", response?.chatId || conversationId.slice(0, 8));
      resolve(true);
    });
  });
}
function deliverPassiveConversationToOnion(payload) {
  return deliverConversationUpsertToOnion(payload, "Descoberta passiva sem confirmação");
}
async function processPassiveConversationDiscovery(message = {}) {
  const status = Number(message.status || 0);
  if (
    !["conversation_list", "conversation_detail"].includes(message.routeKind)
    || status < 200
    || status >= 300
  ) return;
  const [cfg, credentials] = await Promise.all([settings(), auth()]);
  if (
    !cfg.enabled
    || cfg.observeNetwork === false
    || cfg.passiveConversationDiscovery === false
    || !credentials?.token
    || !socket?.connected
  ) return;

  await mapWithConcurrency(
    Array.isArray(message.conversations) ? message.conversations : [],
    MAX_PASSIVE_CONVERSATION_CONCURRENCY,
    async (item) => {
      const conversationId = String(item?.conversationId || "");
      const customerName = validParticipantName(item?.customerName);
      if (!UUID_RE.test(conversationId) || item?.agentActive !== true || !customerName) {
        observationMetrics.passiveDiscoveryRejected += 1;
        return;
      }
      observationMetrics.passiveDiscoveryCandidates += 1;
      const state = conversationState(conversationId);
      reviveClosedConversationState(conversationId, state, "passive-discovery");
      state.participantName = customerName;
      if (state.upserted || state.passiveDiscoveryPending || state.closed) return;
      state.passiveDiscoveryPending = true;

      try {
        const communicationId = (Array.isArray(item.agentCommunicationIds) ? item.agentCommunicationIds : [])
          .map((id) => String(id || ""))
          .find((id) => UUID_RE.test(id)) || "";
        const primaryClient = genesysPrimaryClientPayload({
          document: findValidDocuments(item?.customerDocument)[0] || null,
          address: item?.customerAddress,
          city: item?.customerCity,
          phone: item?.customerPhone,
          legalName: item?.customerLegalName,
          pppoe: item?.customerPppoe,
          ip: item?.customerIp,
          contractId: item?.customerContractId,
          olt: item?.customerOlt,
          pon: item?.customerPon,
          branch: item?.customerBranch
        }, customerName);
        const delivered = await deliverPassiveConversationToOnion({
          convId: conversationId,
          syncGeneration: state.syncGeneration,
          ...(communicationId ? { communicationId } : {}),
          canal: "genesys",
          genesysMediaType: "message",
          conversationType: "message",
          status: "open",
          cliente: primaryClient,
          abertoEm: Number(message.observedAt || Date.now()),
          source: "genesys-passive-network",
          environment: "dev"
        });
        if (!delivered || state.closed) return;
        state.upserted = true;
        state.lifecycle = "ACTIVE";
        state.lastNetworkSeenAt = Number(message.observedAt || Date.now());
        if (communicationId) {
          await rememberCommunicationId(conversationId, communicationId, "passive-discovery").catch(() => {});
        }
        observationMetrics.passiveConversationsCreated += 1;
        log("ok", "Conversa descoberta passivamente", `${customerName} · ${conversationId.slice(0, 8)}`);
        scheduleNotificationSync(conversationId);
      } finally {
        state.passiveDiscoveryPending = false;
      }
    }
  );
}
async function processPassiveMessageDeltas(message = {}) {
  const status = Number(message.status || 0);
  if (message.routeKind !== "messages_bulk" || status < 200 || status >= 300) return;
  const [cfg, credentials] = await Promise.all([settings(), auth()]);
  if (!cfg.enabled || cfg.observeNetwork === false || cfg.passiveMessageDeltas === false || !credentials?.token) return;

  await mapWithConcurrency(
    Array.isArray(message.conversations) ? message.conversations : [],
    MAX_PASSIVE_CONVERSATION_CONCURRENCY,
    async (item) => {
      const conversationId = String(item?.conversationId || "");
      if (!UUID_RE.test(conversationId)) return;
      const incoming = Array.isArray(item?.messages) ? item.messages : [];
      observationMetrics.passiveMessageCandidates += incoming.length;
      if (!incoming.length) return;
      const state = conversationState(conversationId);
      const canApply = state.upserted
        && state.backfilled
        && !state.closed
        && !["SUSPECTED_ABSENT", "CLOSING", "CLOSED"].includes(state.lifecycle);
      if (!canApply) {
        observationMetrics.passiveMessagesSkipped += incoming.length;
        return;
      }

      const accepted = [];
      let requiresMediaFallback = false;
      for (const raw of incoming) {
        const messageId = String(raw?.id || "");
        if (!messageId || state.messageIds.has(messageId) || state.passivePendingMessageIds.has(messageId)) continue;
        if (raw?.hasMedia === true) {
          const lastMediaFallbackAt = Number(state.passiveMediaPendingAt.get(messageId) || 0);
          if (Date.now() - lastMediaFallbackAt >= 5000) {
            state.passiveMediaPendingAt.set(messageId, Date.now());
            requiresMediaFallback = true;
            observationMetrics.passiveMediaFallbacks += 1;
          }
          continue;
        }
        const text = String(raw?.text || "").trim();
        if (!text) continue;
        const timestamp = Number(raw?.ts || Date.now());
        const normalized = {
          id: messageId,
          sender: ["user", "agent", "bot", "system"].includes(String(raw?.sender || ""))
            ? String(raw.sender)
            : "agent",
          senderKind: String(raw?.senderKind || ""),
          senderPurpose: String(raw?.senderPurpose || ""),
          senderParticipantId: String(raw?.senderParticipantId || ""),
          senderName: String(raw?.senderName || ""),
          senderUserId: String(raw?.senderUserId || ""),
          text: text.slice(0, 20000),
          media: null,
          ts: Number.isFinite(timestamp) ? timestamp : Date.now()
        };
        state.passivePendingMessageIds.add(messageId);
        accepted.push(normalized);
      }
      if (requiresMediaFallback) scheduleNotificationSync(conversationId);
      if (!accepted.length) return;

      const deliveredMessages = [];
      for (const normalized of accepted) {
        try {
          const delivered = await queueReliableDelta({
            convId: conversationId,
            mensagem: normalized,
            participantName: state.participantName || "Cliente",
            source: "genesys-passive-network",
            environment: "dev"
          });
          if (delivered) {
            state.messageIds.add(normalized.id);
            deliveredMessages.push(normalized);
          }
        } catch (error) {
          log("error", "Falha ao entregar delta passivo", `${conversationId.slice(0, 8)} · ${error?.message || "erro"}`);
        } finally {
          state.passivePendingMessageIds.delete(normalized.id);
        }
      }
      if (!deliveredMessages.length) return;
      syncConversationDocument(conversationId, deliveredMessages);
      observationMetrics.passiveMessagesApplied += deliveredMessages.length;
      state.lastPassiveDeltaAt = Date.now();
      log("ok", "Delta passivo Genesys aplicado", `${conversationId.slice(0, 8)} · ${deliveredMessages.length} nova(s)`);
    }
  );
}
function networkObservationStatus() {
  return {
    ...observationMetrics,
    trackedConversations: conversations.size,
    activeConversations: [...conversations.values()].filter((state) => !state.closed).length
  };
}
function broadcastObservationConfig(enabled) {
  const targets = new Map();
  if (participantTabId != null) targets.set(`${participantTabId}:0`, { tabId: participantTabId, frameId: 0 });
  for (const key of registeredGadgetFrames) {
    const [tabIdRaw, frameIdRaw] = String(key).split(":");
    const tabId = Number(tabIdRaw);
    const frameId = Number(frameIdRaw);
    if (Number.isInteger(tabId) && Number.isInteger(frameId)) {
      targets.set(key, { tabId, frameId });
    }
  }
  for (const target of targets.values()) {
    chrome.tabs.sendMessage(
      target.tabId,
      { type: "DEV_NETWORK_OBSERVATION_CONFIG", enabled },
      { frameId: target.frameId }
    ).catch(() => {});
  }
}
async function settings() {
  const stored = await chrome.storage.local.get(SETTINGS_KEY);
  return { ...DEFAULTS, ...(stored[SETTINGS_KEY] || {}) };
}
async function auth() {
  const stored = await chrome.storage.local.get(AUTH_KEY);
  return stored[AUTH_KEY] || null;
}
async function genesysToken() {
  const stored = await chrome.storage.local.get("genesys_token");
  return stored.genesys_token?.token || "";
}
async function genesysFetch(path, options = {}) {
  const { governor = {}, ...fetchOptions } = options || {};
  const conversationId = String(
    governor.conversationId || inferGenesysConversationId(path)
  );
  const priority = governor.priority
    || inferGenesysRequestPriority(path, fetchOptions.method);
  const execute = async () => {
    const token = await genesysToken();
    if (!token) throw new Error("Token Genesys indisponível");
    let response;
    try {
      response = await fetch(`https://api.sae1.pure.cloud${path}`, {
        ...fetchOptions,
        headers: {
          authorization: `bearer ${token}`,
          accept: "application/json",
          ...(fetchOptions.headers || {})
        }
      });
      recordGenesysApiCall(response.status);
    } catch (error) {
      recordGenesysApiCall(0);
      throw error;
    }
    if (response.status === 429) {
      const retryMs = parseRetryAfterMs(response) || 5000;
      genesysGovernorBackoffUntil = Math.max(genesysGovernorBackoffUntil, Date.now() + retryMs);
      scheduleGenesysGovernorPump(retryMs + 25);
    }
    if (!response.ok) throw new Error(`Genesys HTTP ${response.status}`);
    const text = await response.text();
    if (!text) return {};
    try { return JSON.parse(text); } catch (_) { return { text }; }
  };
  const cfg = await settings();
  if (cfg.apiGovernor === false) return execute();
  return scheduleGenesysRequest(execute, {
    priority,
    conversationId,
    timeoutMs: governor.timeoutMs
  });
}
async function fetchAllGenesysConversations(governor = {}) {
  const body = await genesysFetch(
    `/api/v2/conversations?communicationType=message&_=${Date.now()}`,
    {
      governor: {
        priority: governor.priority || "audit",
        timeoutMs: governor.timeoutMs || 60000
      }
    }
  );
  return Array.isArray(body) ? body : (body.entities || []);
}
function genesysParticipantUserId(participant) {
  const direct = String(participant?.userId || "").trim();
  if (UUID_RE.test(direct)) return direct;
  const uri = String(participant?.userUri || "");
  const match = uri.match(/\/api\/v2\/users\/([0-9a-f-]{36})(?:$|[/?#])/i);
  return UUID_RE.test(String(match?.[1] || "")) ? match[1] : "";
}
async function loadCurrentGenesysUserId() {
  const now = Date.now();
  if (
    UUID_RE.test(genesysCurrentUserCache.id)
    && now - genesysCurrentUserCache.at <= GENESYS_CURRENT_USER_CACHE_MS
  ) return genesysCurrentUserCache.id;
  const current = await genesysFetch("/api/v2/users/me", {
    governor: { priority: "critical", timeoutMs: 30000 }
  });
  const id = String(current?.id || "");
  if (!UUID_RE.test(id)) throw new Error("usuario_genesys_atual_nao_identificado");
  genesysCurrentUserCache = { id, at: now };
  return id;
}
function genesysSenderIdentity(participant, currentAgentParticipantId = "") {
  const purpose = String(participant?.purpose || "").trim().toLowerCase();
  const participantId = String(participant?.id || participant?.participantId || "").trim();
  const participantName = String(participant?.name || "").replace(/\s+/g, " ").trim().slice(0, 200);
  const userId = genesysParticipantUserId(participant);
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
    participantName,
    userId,
    senderKind
  };
}
function collectGenesysMessageRefs(detail) {
  const purposeByMessage = new Map();
  const ids = [];
  const currentAgentParticipantId = String(activeAgentParticipant(detail)?.id || "");
  for (const participant of detail?.participants || []) {
    const identity = genesysSenderIdentity(participant, currentAgentParticipantId);
    for (const communication of participant.messages || []) {
      // Compatibilidade com respostas antigas/achatadas.
      const directId = String(communication?.messageId || "");
      if (directId && !purposeByMessage.has(directId)) {
        purposeByMessage.set(directId, identity);
        ids.push(directId);
      }
      // Estrutura real observada: participant.messages[] é a comunicação;
      // os messageId ficam em communication.messages[].
      for (const reference of communication?.messages || []) {
        const messageId = String(reference?.messageId || reference?.id || "");
        if (!messageId || purposeByMessage.has(messageId)) continue;
        purposeByMessage.set(messageId, identity);
        ids.push(messageId);
      }
    }
  }
  return { purposeByMessage, ids };
}
function activeAgentCommunicationId(detail) {
  const candidates = [];
  for (const participant of detail?.participants || []) {
    if (String(participant.purpose || "").toLowerCase() !== "agent") continue;
    for (const communication of participant.messages || []) {
      const id = String(communication.id || "");
      if (!UUID_RE.test(id)) continue;
      const state = String(communication.state || "").toLowerCase();
      if (["disconnected", "terminated"].includes(state)) continue;
      let score = 0;
      if (!participant.endTime) score += 100;
      if (state === "connected") score += 50;
      if (String(communication.direction || "").toLowerCase() === "outbound") score += 20;
      const at = new Date(
        communication.connectedTime
        || communication.startTime
        || participant.startTime
        || 0
      ).getTime() || 0;
      candidates.push({ id, score, at });
    }
  }
  candidates.sort((left, right) => right.score - left.score || right.at - left.at);
  return candidates[0]?.id || "";
}
function hasActiveAgentMessaging(detail) {
  return (detail?.participants || []).some((participant) => {
    if (String(participant?.purpose || "").toLowerCase() !== "agent") return false;
    if (participant?.endTime) return false;
    const communications = Array.isArray(participant?.messages) ? participant.messages : [];
    if (!communications.length) return true;
    return communications.some((communication) => (
      !["disconnected", "terminated"].includes(
        String(communication?.state || "").toLowerCase()
      )
    ));
  });
}
function connectedAgentCommunicationCandidates(conversation) {
  const candidates = [];
  for (const participant of conversation?.participants || []) {
    if (
      String(participant?.purpose || "").toLowerCase() !== "agent"
      || participant?.endTime
    ) continue;
    for (const communication of participant?.messages || []) {
      const communicationId = String(communication?.id || "");
      const state = String(communication?.state || "").toLowerCase();
      if (!UUID_RE.test(communicationId) || state !== "connected") continue;
      candidates.push({
        participantId: String(participant?.id || ""),
        communicationId,
        connectedAt: new Date(
          communication?.connectedTime
          || communication?.startTime
          || participant?.connectedTime
          || participant?.startTime
          || 0
        ).getTime() || 0
      });
    }
  }
  const unique = new Map();
  for (const candidate of candidates) {
    if (!unique.has(candidate.communicationId)) {
      unique.set(candidate.communicationId, candidate);
    }
  }
  return [...unique.values()].sort((left, right) => right.connectedAt - left.connectedAt);
}
async function resolveConnectedAgentCommunication(conversationId) {
  const activeConversations = await fetchAllGenesysConversations({
    priority: "critical",
    timeoutMs: 30000
  });
  const conversation = activeConversations.find(
    (item) => String(item?.id || "") === conversationId
  );
  if (!conversation) throw new Error("conversa_nao_encontrada_na_lista_ativa");
  const candidates = connectedAgentCommunicationCandidates(conversation);
  if (!candidates.length) {
    throw new Error("communicationId_nao_disponivel_para_esta_conversa");
  }
  if (candidates.length > 1) {
    throw new Error("mais_de_um_communicationId_ativo_para_esta_conversa");
  }
  return candidates[0];
}
function activeAgentParticipant(detail, currentUserId = "") {
  const agents = (detail?.participants || [])
    .filter((participant) => String(participant.purpose || "").toLowerCase() === "agent")
    .sort((left, right) => {
      const leftActive = left.endTime ? 0 : 1;
      const rightActive = right.endTime ? 0 : 1;
      return rightActive - leftActive
        || (new Date(right.startTime || 0).getTime() - new Date(left.startTime || 0).getTime());
    });
  if (UUID_RE.test(currentUserId)) {
    const currentAgent = agents.find(
      (participant) => genesysParticipantUserId(participant) === currentUserId && !participant?.endTime
    );
    if (currentAgent) return currentAgent;
  }
  return agents[0] || null;
}
async function loadGenesysWrapupContext(conversationId, { requireCurrentUser = false } = {}) {
  if (!UUID_RE.test(conversationId)) throw new Error("conversationId_invalido");
  const detail = await genesysFetch(`/api/v2/conversations/messages/${conversationId}`);
  const currentUserId = requireCurrentUser ? await loadCurrentGenesysUserId() : "";
  let participant = activeAgentParticipant(detail, currentUserId);
  let currentUserConfirmed = !requireCurrentUser
    || genesysParticipantUserId(participant) === currentUserId;
  if (requireCurrentUser && !currentUserConfirmed) {
    const activeConversations = await fetchAllGenesysConversations({
      priority: "critical",
      timeoutMs: 30000
    });
    const activeConversation = activeConversations.find(
      (conversation) => String(conversation?.id || "") === conversationId
    );
    const rosterParticipant = activeAgentParticipant(activeConversation, currentUserId);
    if (
      rosterParticipant
      && !rosterParticipant.endTime
      && genesysParticipantUserId(rosterParticipant) === currentUserId
    ) {
      const detailParticipant = (detail?.participants || []).find(
        (candidate) => String(candidate?.id || "") === String(rosterParticipant.id || "")
      );
      participant = detailParticipant && !detailParticipant.endTime
        ? detailParticipant
        : rosterParticipant;
      currentUserConfirmed = true;
      log(
        "info",
        "Participante do agente confirmado pelo roster",
        `${conversationId.slice(0, 8)} · ${String(rosterParticipant.id || "").slice(0, 8)}`
      );
    }
  }
  const participantId = String(participant?.id || "");
  if (!UUID_RE.test(participantId)) throw new Error("participante_agente_nao_encontrado");
  if (requireCurrentUser && !currentUserConfirmed) {
    throw new Error("participante_agente_nao_corresponde_ao_usuario_logado");
  }
  const codes = await genesysFetch(
    `/api/v2/conversations/messages/${conversationId}/participants/${participantId}/wrapupcodes`
  );
  return {
    detail,
    participant,
    participantId,
    codes: (Array.isArray(codes) ? codes : (codes?.entities || []))
      .map((code) => ({
        id: String(code?.id || ""),
        name: String(code?.name || "").trim(),
        description: String(code?.description || "").trim()
      }))
      .filter((code) => UUID_RE.test(code.id) && code.name)
  };
}
async function listGenesysWrapupCodes(payload = {}) {
  const conversationId = String(payload.convId || payload.conversationId || "");
  const context = await loadGenesysWrapupContext(conversationId);
  return {
    ok: true,
    convId: conversationId,
    chatId: payload.chatId || null,
    participantId: context.participantId,
    codes: context.codes
  };
}
function normalizeGenesysTransferQuery(value) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, 60);
}
function cleanupGenesysTransferCaches(now = Date.now()) {
  for (const [key, entry] of genesysTransferSearchCache.entries()) {
    if (now - Number(entry?.at || 0) > GENESYS_TRANSFER_SEARCH_CACHE_MS) {
      genesysTransferSearchCache.delete(key);
    }
  }
  for (const [queueId, entry] of genesysTransferQueueApprovals.entries()) {
    if (now - Number(entry?.at || 0) > GENESYS_TRANSFER_QUEUE_APPROVAL_MS) {
      genesysTransferQueueApprovals.delete(queueId);
    }
  }
  while (genesysTransferSearchCache.size > 50) {
    genesysTransferSearchCache.delete(genesysTransferSearchCache.keys().next().value);
  }
  while (genesysTransferQueueApprovals.size > 200) {
    genesysTransferQueueApprovals.delete(genesysTransferQueueApprovals.keys().next().value);
  }
}
async function loadGenesysTransferDivisions() {
  const now = Date.now();
  if (
    genesysTransferDivisionsCache.divisions.length
    && now - genesysTransferDivisionsCache.at <= GENESYS_TRANSFER_DIVISIONS_CACHE_MS
  ) return genesysTransferDivisionsCache.divisions;
  const response = await genesysFetch(
    "/api/v2/authorization/divisionspermitted/paged/me?pageSize=50&permission=conversation%3Acommunication%3Atarget",
    { governor: { priority: "normal", timeoutMs: 30000 } }
  );
  const divisions = (Array.isArray(response) ? response : (response?.entities || []))
    .map((division) => ({
      id: String(division?.id || ""),
      name: String(division?.name || "").trim()
    }))
    .filter((division) => UUID_RE.test(division.id));
  if (!divisions.length) throw new Error("nenhuma_divisao_permitida_para_transferencia");
  genesysTransferDivisionsCache = { divisions, at: now };
  return divisions;
}
async function searchGenesysTransferQueues(payload = {}) {
  const conversationId = String(payload.convId || payload.conversationId || "");
  const query = normalizeGenesysTransferQuery(payload.query);
  if (!UUID_RE.test(conversationId)) throw new Error("conversationId_invalido");
  if (query.length < 2) throw new Error("pesquisa_de_fila_muito_curta");
  const now = Date.now();
  cleanupGenesysTransferCaches(now);
  const cacheKey = query.toLocaleLowerCase("pt-BR");
  const cached = genesysTransferSearchCache.get(cacheKey);
  if (cached && now - cached.at <= GENESYS_TRANSFER_SEARCH_CACHE_MS) {
    for (const queue of cached.queues) {
      genesysTransferQueueApprovals.set(queue.id, { ...queue, convId: conversationId, at: now });
    }
    return {
      ok: true,
      convId: conversationId,
      chatId: payload.chatId || null,
      query,
      queues: cached.queues,
      cached: true
    };
  }
  const divisions = (await loadGenesysTransferDivisions())
    .slice(0, GENESYS_TRANSFER_MAX_DIVISIONS);
  const queuesById = new Map();
  for (const division of divisions) {
    if (queuesById.size >= 10) break;
    const path = "/api/v2/routing/queues/divisionviews"
      + `?name=${encodeURIComponent(`**${query}**`)}`
      + "&pageNumber=1&pageSize=10&sortBy=name&sortOrder=ASC&myQueuesOnly=false"
      + `&divisionId=${encodeURIComponent(division.id)}`;
    const response = await genesysFetch(path, {
      governor: { priority: "normal", timeoutMs: 30000 }
    });
    for (const raw of response?.entities || []) {
      const id = String(raw?.id || "");
      const name = String(raw?.name || "").trim();
      if (!UUID_RE.test(id) || !name || queuesById.has(id)) continue;
      queuesById.set(id, {
        id,
        name,
        divisionId: UUID_RE.test(String(raw?.division?.id || ""))
          ? String(raw.division.id)
          : division.id,
        divisionName: String(raw?.division?.name || division.name || "").trim()
      });
      if (queuesById.size >= 10) break;
    }
  }
  const queues = [...queuesById.values()]
    .sort((left, right) => left.name.localeCompare(right.name, "pt-BR"))
    .slice(0, 10);
  genesysTransferSearchCache.set(cacheKey, { queues, at: now });
  for (const queue of queues) {
    genesysTransferQueueApprovals.set(queue.id, { ...queue, convId: conversationId, at: now });
  }
  log("info", "Filas Genesys pesquisadas", `${query} · ${queues.length}`);
  return {
    ok: true,
    convId: conversationId,
    chatId: payload.chatId || null,
    query,
    queues,
    cached: false
  };
}
async function transferGenesysWithWrapup(payload = {}) {
  const conversationId = String(payload.convId || payload.conversationId || "");
  const queueId = String(payload.queueId || "");
  const wrapupCode = String(payload.wrapupCode || "");
  if (!UUID_RE.test(conversationId)) throw new Error("conversationId_invalido");
  if (!UUID_RE.test(queueId)) throw new Error("queueId_invalido");
  if (!UUID_RE.test(wrapupCode)) throw new Error("wrapup_code_invalido");
  cleanupGenesysTransferCaches();
  const approvedQueue = genesysTransferQueueApprovals.get(queueId);
  if (
    !approvedQueue
    || approvedQueue.convId !== conversationId
    || Date.now() - Number(approvedQueue.at || 0) > GENESYS_TRANSFER_QUEUE_APPROVAL_MS
  ) throw new Error("fila_nao_confirmada_por_pesquisa_recente");
  const requestedQueueName = String(payload.queueName || "").trim();
  if (requestedQueueName && requestedQueueName !== approvedQueue.name) {
    throw new Error("nome_da_fila_diverge_da_pesquisa");
  }
  const context = await loadGenesysWrapupContext(conversationId, { requireCurrentUser: true });
  const selected = context.codes.find((code) => code.id === wrapupCode);
  if (!selected) throw new Error("wrapup_code_nao_pertence_ao_atendimento");
  if (context.participant?.endTime || !hasActiveAgentMessaging(context.detail)) {
    throw new Error("conversa_sem_participante_agente_ativo");
  }
  const activeConversations = await fetchAllGenesysConversations({
    priority: "critical",
    timeoutMs: 30000
  });
  const activeConversation = activeConversations.find(
    (conversation) => String(conversation?.id || "") === conversationId
  );
  if (!activeConversation) throw new Error("conversa_nao_encontrada_na_lista_ativa");
  const activeParticipant = (activeConversation?.participants || []).find((participant) => (
    String(participant?.id || "") === context.participantId
    && String(participant?.purpose || "").toLowerCase() === "agent"
    && !participant?.endTime
  ));
  if (!activeParticipant) throw new Error("participante_agente_diverge_da_conversa_ativa");

  let transferred = false;
  const participantPath = `/api/v2/conversations/messages/${conversationId}/participants/${context.participantId}`;
  try {
    await genesysFetch(
      `/api/v2/conversations/${conversationId}/participants/${context.participantId}/replace/queue`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ queueId }),
        governor: { priority: "critical", conversationId, timeoutMs: 30000 }
      }
    );
    transferred = true;
    await genesysFetch(participantPath, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ wrapup: { provisional: true, code: selected.id } })
    });
    await genesysFetch(participantPath, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        wrapup: {
          code: selected.id,
          notes: String(payload.notes || "").slice(0, 1000),
          tags: []
        }
      })
    });
  } catch (error) {
    if (transferred) {
      error.message = `transferencia_realizada_mas_tabulacao_falhou:${error?.message || "erro"}`;
      error.transferred = true;
    }
    throw error;
  }

  let confirmed = false;
  let absentChecks = 0;
  for (let attempt = 0; attempt < 8 && !confirmed; attempt += 1) {
    if (attempt) await new Promise((resolve) => setTimeout(resolve, 500));
    try {
      const provisional = await genesysFetch(`${participantPath}/wrapup?provisional=true`);
      if (String(provisional?.code || "") === selected.id) {
        confirmed = true;
        break;
      }
    } catch (_) {}
    try {
      const detail = await genesysFetch(`/api/v2/conversations/messages/${conversationId}`);
      const agent = (detail?.participants || []).find(
        (participant) => participant.id === context.participantId
      );
      if (String(agent?.wrapup?.code || "") === selected.id) {
        confirmed = true;
        break;
      }
    } catch (_) {}
    try {
      const active = await fetchAllGenesysConversations({ priority: "critical" });
      const stillActive = active.some(
        (conversation) => String(conversation?.id || "") === conversationId
      );
      absentChecks = stillActive ? 0 : absentChecks + 1;
      if (absentChecks >= 2) confirmed = true;
    } catch (_) {}
  }
  if (!confirmed) {
    const error = new Error("transferencia_realizada_mas_genesys_nao_confirmou_a_tabulacao");
    error.transferred = true;
    throw error;
  }
  queueReliableClose({
    convId: conversationId,
    motivo: "genesys_transfer_confirmed",
    wrapupCode: selected.id,
    wrapupName: selected.name,
    queueId: approvedQueue.id,
    queueName: approvedQueue.name,
    environment: "dev"
  }).catch((error) => {
    log("error", "Falha ao remover card transferido no Onion", error?.message || "erro");
  });
  genesysTransferQueueApprovals.delete(queueId);
  log(
    "ok",
    "Atendimento transferido no Genesys",
    `${conversationId.slice(0, 8)} · ${approvedQueue.name} · ${selected.name}`
  );
  return {
    ok: true,
    convId: conversationId,
    chatId: payload.chatId || null,
    participantId: context.participantId,
    queueId: approvedQueue.id,
    queueName: approvedQueue.name,
    wrapupCode: selected.id,
    wrapupName: selected.name,
    transferred: true,
    confirmed: true
  };
}
async function finalizeGenesysWithWrapup(payload = {}) {
  const conversationId = String(payload.convId || payload.conversationId || "");
  const wrapupCode = String(payload.wrapupCode || "");
  if (!UUID_RE.test(wrapupCode)) throw new Error("wrapup_code_invalido");
  const context = await loadGenesysWrapupContext(conversationId);
  const selected = context.codes.find((code) => code.id === wrapupCode);
  if (!selected) throw new Error("wrapup_code_nao_pertence_ao_atendimento");
  const participantPath = `/api/v2/conversations/messages/${conversationId}/participants/${context.participantId}`;
  const communications = Array.isArray(context.participant?.messages) ? context.participant.messages : [];
  if (communications.some((communication) => communication?.held === true)) {
    await genesysFetch(participantPath, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ held: false })
    });
  }
  await genesysFetch(participantPath, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ state: "DISCONNECTED" })
  });
  await genesysFetch(participantPath, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      wrapup: {
        code: selected.id,
        notes: String(payload.notes || "").slice(0, 1000),
        tags: []
      }
    })
  });
  let confirmed = false;
  let absentChecks = 0;
  for (let attempt = 0; attempt < 8 && !confirmed; attempt += 1) {
    if (attempt) await new Promise((resolve) => setTimeout(resolve, 500));
    try {
      const provisional = await genesysFetch(`${participantPath}/wrapup?provisional=true`);
      if (String(provisional?.code || "") === selected.id) {
        confirmed = true;
        break;
      }
    } catch (_) {}
    try {
      const detail = await genesysFetch(`/api/v2/conversations/messages/${conversationId}`);
      const agent = (detail?.participants || []).find((participant) => participant.id === context.participantId);
      if (String(agent?.wrapup?.code || "") === selected.id) {
        confirmed = true;
        break;
      }
    } catch (_) {}
    try {
      const active = await fetchAllGenesysConversations();
      const stillActive = active.some((conversation) => String(conversation?.id || "") === conversationId);
      absentChecks = stillActive ? 0 : absentChecks + 1;
      // Os dois PATCHes já responderam OK. Duas ausências consecutivas na
      // lista autoritativa confirmam que o Genesys concluiu o encerramento,
      // mesmo quando o gadget deixa de expor o wrap-up após remover o card.
      if (absentChecks >= 2) confirmed = true;
    } catch (_) {}
  }
  if (!confirmed) throw new Error("genesys_nao_confirmou_a_tabulacao");
  queueReliableClose({
    convId: conversationId,
    motivo: "genesys_wrapup_confirmado",
    wrapupCode: selected.id,
    wrapupName: selected.name,
    environment: "dev"
  }).catch((error) => {
    log("error", "Falha ao confirmar encerramento no Onion", error?.message || "erro");
  });
  log("ok", "Atendimento finalizado no Genesys", `${conversationId.slice(0, 8)} · ${selected.name}`);
  return {
    ok: true,
    convId: conversationId,
    chatId: payload.chatId || null,
    participantId: context.participantId,
    wrapupCode: selected.id,
    wrapupName: selected.name,
    confirmed: true
  };
}
function communicationStructure(detail) {
  return (detail?.participants || []).map((participant) => ({
    purpose: String(participant.purpose || ""),
    participantId: String(participant.id || "").slice(0, 8),
    ended: Boolean(participant.endTime),
    communications: (participant.messages || []).map((communication) => ({
      id: String(communication.id || "").slice(0, 8),
      state: String(communication.state || ""),
      direction: String(communication.direction || ""),
      mediaType: String(communication.mediaType || "")
    }))
  }));
}
function calculateCpfCheckDigit(cpfDigits, factor) {
  let sum = 0;
  for (let index = 0; index < factor - 1; index += 1) {
    sum += Number(cpfDigits[index]) * (factor - index);
  }
  const remainder = (sum * 10) % 11;
  return remainder === 10 ? 0 : remainder;
}
function isValidBrazilianCpf(value) {
  const cpf = onlyDocumentDigits(value);
  if (cpf.length !== 11 || /^(\d)\1{10}$/.test(cpf)) return false;
  return calculateCpfCheckDigit(cpf, 10) === Number(cpf[9])
    && calculateCpfCheckDigit(cpf, 11) === Number(cpf[10]);
}
function isValidBrazilianCnpj(value) {
  const cnpj = onlyDocumentDigits(value);
  if (cnpj.length !== 14 || /^(\d)\1{13}$/.test(cnpj)) return false;
  const calculateDigit = (base, weights) => {
    const sum = weights.reduce((total, weight, index) => total + Number(base[index]) * weight, 0);
    const remainder = sum % 11;
    return remainder < 2 ? 0 : 11 - remainder;
  };
  const first = calculateDigit(cnpj.slice(0, 12), [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  const second = calculateDigit(cnpj.slice(0, 13), [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  return first === Number(cnpj[12]) && second === Number(cnpj[13]);
}
function findValidDocuments(text) {
  const found = new Map();
  const source = String(text || "");
  const expressions = [
    /\d(?:[\s.,\-\/]*\d){10,20}/g,
    /(?<!\d)\d{11}(?!\d)|(?<!\d)\d{14}(?!\d)/g
  ];
  for (const expression of expressions) {
    for (const match of source.matchAll(expression)) {
      const digits = onlyDocumentDigits(match[0]);
      if (digits.length === 11 && isValidBrazilianCpf(digits)) found.set(digits, "CPF");
      if (digits.length === 14 && isValidBrazilianCnpj(digits)) found.set(digits, "CNPJ");
    }
  }
  return [...found].map(([digits, type]) => ({ digits, type }));
}
function syncConversationDocument(conversationId, messages) {
  if (!UUID_RE.test(conversationId)) return null;
  const list = Array.isArray(messages) ? messages : [];
  let selected = null;
  for (let index = list.length - 1; index >= 0 && !selected; index -= 1) {
    const message = list[index];
    const documents = findValidDocuments(message?.text);
    if (documents.length) selected = documents[0];
  }
  if (!selected) return null;
  const state = conversationState(conversationId);
  if (state.documentDigits === selected.digits) return selected;
  state.documentDigits = selected.digits;
  emit("ext:atendimento:cliente", {
    convId: conversationId,
    ixcOnly: true,
    cliente: {
      cpf: selected.digits,
      document: selected.digits,
      documentType: selected.type
    },
    environment: "dev"
  });
  log("ok", `${selected.type} resolvido pelas mensagens`, `${conversationId.slice(0, 8)} · ${selected.digits.slice(-4)}`);
  return selected;
}
function isExplicitGenesysMediaReference(value, url, mimeType, fileName, kind) {
  const normalizedKind = String(kind || "").toLowerCase();
  const normalizedMime = String(mimeType || "").toLowerCase().split(";")[0].trim();
  const kindSaysMedia = /(attachment|media|image|img|photo|picture|sticker|video|audio|voice|ptt|document|file)/i.test(normalizedKind);
  const kindSaysLink = /(^|[^a-z])(link|url|hyperlink|preview|text)([^a-z]|$)/i.test(normalizedKind);
  const mimeSaysMedia = /^(image|audio|video)\//i.test(normalizedMime)
    || /^application\/(pdf|octet-stream|zip|x-zip-compressed|msword|vnd\.|rtf|x-rar-compressed|gzip)/i.test(normalizedMime);
  const urlSaysDownload = (() => {
    try {
      const parsed = new URL(String(url || ""), "https://api.sae1.pure.cloud");
      const mediaHost = /^(?:api-downloads|fileupload)\.[a-z0-9-]+\.pure\.cloud$/i.test(parsed.hostname);
      const mediaPath = /\/(attachments?|media|downloads?|uploads?)(?:\/|$)/i.test(parsed.pathname);
      const filePath = /\.(?:png|jpe?g|gif|webp|bmp|svg|mp4|webm|mov|m4v|mp3|ogg|oga|wav|m4a|aac|opus|weba|pdf|docx?|xlsx?|pptx?|csv|txt|zip|rar|7z)(?:$|[?#])/i.test(parsed.pathname);
      return mediaHost || mediaPath || filePath;
    } catch (_) {
      return false;
    }
  })();
  // O preview de um link pode usar internamente uma URL de media/download do Genesys.
  // O tipo semântico "link" continua prevalecendo se não houver evidência de arquivo real.
  if (kindSaysLink && !kindSaysMedia && !mimeSaysMedia && !fileName) return false;
  if (!urlSaysDownload && !mimeSaysMedia && !fileName) return false;
  return Boolean(kindSaysMedia || mimeSaysMedia || fileName || urlSaysDownload);
}
function genesysMediaDescriptors(item) {
  const roots = [
    item?.normalizedMessage?.content,
    item?.normalizedMessage?.attachments,
    item?.normalizedMessage?.media,
    item?.attachments,
    item?.attachment,
    item?.media
  ];
  const queue = roots.flat().filter(Boolean);
  const visited = new Set();
  const descriptors = [];
  const descriptorKeys = new Set();
  while (queue.length) {
    const value = queue.shift();
    if (!value || typeof value !== "object" || visited.has(value)) continue;
    visited.add(value);
    if (Array.isArray(value)) {
      queue.push(...value);
      continue;
    }
    const nested = value.attachment || value.media || value.file;
    if (nested && typeof nested === "object") queue.push(nested);
    const url = String(
      value.url || value.mediaUrl || value.downloadUrl || value.href
      || value.contentUrl || value.attachmentUrl || ""
    ).trim();
    const mimeType = String(
      value.mimeType || value.mime || value.contentType || value.mediaType || ""
    ).trim();
    const kind = String(value.type || value.kind || value.mediaType || value.contentType || "").toLowerCase();
    const explicitFileName = String(
      value.fileName || value.filename || value.originalName || ""
    ).trim();
    const fileName = explicitFileName || (
      /(attachment|media|document|file)/i.test(kind)
        ? String(value.name || "").trim()
        : ""
    );
    if (
      url
      && isExplicitGenesysMediaReference(value, url, mimeType, fileName, kind)
    ) {
      const descriptor = {
        url,
        mimeType: mimeType.includes("/") ? mimeType : "",
        fileName,
        type: kind,
        mediaId: String(value.id || value.mediaId || "")
      };
      const descriptorKey = descriptor.mediaId || `${descriptor.url}|${descriptor.fileName}|${descriptor.mimeType}`;
      if (!descriptorKeys.has(descriptorKey)) {
        descriptorKeys.add(descriptorKey);
        descriptors.push(descriptor);
      }
    }
    for (const child of Object.values(value)) {
      if (child && typeof child === "object") queue.push(child);
    }
  }
  return descriptors;
}
function genesysMediaDescriptor(item) {
  return genesysMediaDescriptors(item)[0] || null;
}
function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }
  return btoa(binary);
}
async function hydrateGenesysMedia(raw) {
  if (!raw?.url) return null;
  const token = await genesysToken();
  if (!token) return null;
  const url = /^https?:\/\//i.test(raw.url)
    ? raw.url
    : `https://api.sae1.pure.cloud${raw.url.startsWith("/") ? raw.url : `/${raw.url}`}`;
  const target = new URL(url);
  const headers = { accept: "*/*" };
  const genesysMediaHost = [
    "api.sae1.pure.cloud",
    "api-downloads.sae1.pure.cloud"
  ].includes(target.hostname);
  if (genesysMediaHost) {
    headers.authorization = `bearer ${token}`;
  }
  let response;
  const execute = async () => {
    try {
      const result = await fetch(url, {
        credentials: "include",
        headers
      });
      if (genesysMediaHost) recordGenesysApiCall(result.status);
      if (result.status === 429) {
        const retryMs = parseRetryAfterMs(result) || 5000;
        genesysGovernorBackoffUntil = Math.max(genesysGovernorBackoffUntil, Date.now() + retryMs);
      }
      return result;
    } catch (error) {
      if (genesysMediaHost) recordGenesysApiCall(0);
      throw error;
    }
  };
  if (genesysMediaHost && (await settings()).apiGovernor !== false) {
    response = await scheduleGenesysRequest(execute, {
      priority: "audit",
      conversationId: inferGenesysConversationId(target.pathname),
      timeoutMs: 90000
    });
  } else {
    response = await execute();
  }
  if (!response.ok) throw new Error(`Genesys mídia HTTP ${response.status}`);
  const declaredSize = Number(response.headers.get("content-length") || 0);
  if (declaredSize > 20 * 1024 * 1024) throw new Error("Mídia Genesys excede 20 MB");
  const buffer = await response.arrayBuffer();
  if (!buffer.byteLength || buffer.byteLength > 20 * 1024 * 1024) {
    throw new Error("Mídia Genesys vazia ou acima de 20 MB");
  }
  const declaredMimeType = String(
    raw.mimeType || response.headers.get("content-type") || "application/octet-stream"
  ).toLowerCase().split(";")[0].trim();
  const mimeType = declaredMimeType === "application/ogg"
    ? "audio/ogg"
    : declaredMimeType;
  const disposition = response.headers.get("content-disposition") || "";
  const dispositionName = disposition.match(/filename\*?=(?:UTF-8''|[\"']?)([^\"';]+)/i)?.[1] || "";
  let fileName = raw.fileName || dispositionName;
  try { fileName = decodeURIComponent(fileName); } catch (_) {}
  return {
    ...raw,
    url: "",
    dataUrl: `data:${mimeType};base64,${arrayBufferToBase64(buffer)}`,
    mimeType,
    fileName: fileName || `genesys_${raw.mediaId || Date.now()}`,
    type: mimeType.startsWith("audio/")
      ? "audio"
      : mimeType.startsWith("image/")
        ? "image"
        : mimeType.startsWith("video/")
          ? "video"
          : raw.type
  };
}
async function messageData(item, purposeByMessage) {
  const id = String(item?.id || item?.messageId || "");
  const rawIdentity = purposeByMessage.get(id) || {};
  const identity = typeof rawIdentity === "string" ? { purpose: rawIdentity } : rawIdentity;
  const purpose = String(identity?.purpose || "").toLowerCase();
  const direction = String(item?.direction || item?.normalizedMessage?.direction || "").toLowerCase();
  const senderKind = String(identity?.senderKind || (
    purpose === "customer" || direction.includes("inbound")
      ? "customer"
      : ["bot", "botflow", "workflow", "ivr"].includes(purpose)
        ? "bot"
        : purpose === "agent"
          ? "other_agent"
          : "self_agent"
  ));
  const sender = senderKind === "customer"
    ? "user"
    : senderKind === "bot"
      ? "bot"
      : senderKind === "system"
        ? "system"
        : "agent";
  const text = String(item?.normalizedMessage?.text || item?.textBody || item?.text || "").trim();
  const timestamp = item?.timestamp || item?.createdTime || item?.time || Date.now();
  const descriptors = genesysMediaDescriptors(item);
  const mediaItems = [];
  let mediaHydrationFailed = false;
  for (let index = 0; index < descriptors.length; index += 1) {
    try {
      const hydrated = await scheduleMediaHydration(() => hydrateGenesysMedia(descriptors[index]));
      if (hydrated) mediaItems.push(hydrated);
    } catch (error) {
      mediaHydrationFailed = true;
      log("error", "Falha ao baixar mídia Genesys", `${id.slice(0, 8)} · anexo ${index + 1} · ${error.message}`);
    }
  }
  return {
    id,
    sender,
    senderKind,
    senderPurpose: purpose,
    senderParticipantId: String(identity?.participantId || ""),
    senderName: String(identity?.participantName || ""),
    senderUserId: String(identity?.userId || ""),
    text,
    media: mediaItems[0] || null,
    additionalMedia: mediaItems.slice(1),
    mediaHydrationFailed,
    ts: new Date(timestamp).getTime() || Date.now()
  };
}
function expandGenesysMessageMedia(message) {
  if (!message) return [];
  const { additionalMedia = [], ...primary } = message;
  return [primary, ...additionalMedia.map((media, index) => ({
    ...primary,
    id: `${primary.id}:media:${media.mediaId || index + 2}`,
    text: media.caption || "",
    media,
    mediaHydrationFailed: false
  }))];
}
function genesysAttributeValue(attributes, candidates) {
  if (!attributes || typeof attributes !== "object") return "";
  for (const key of candidates) {
    const direct = attributes[key];
    if (direct !== undefined && direct !== null && String(direct).trim()) return String(direct).trim();
  }
  const normalizedCandidates = new Set(
    candidates.map((key) => String(key).toLocaleLowerCase("pt-BR").replace(/[^a-z0-9]/g, ""))
  );
  for (const [key, value] of Object.entries(attributes)) {
    const normalizedKey = String(key).toLocaleLowerCase("pt-BR").replace(/[^a-z0-9]/g, "");
    if (normalizedCandidates.has(normalizedKey) && value !== undefined && value !== null && String(value).trim()) {
      return String(value).trim();
    }
  }
  return "";
}
function conversationCustomerIdentity(detail) {
  const participants = Array.isArray(detail?.participants) ? detail.participants : [];
  const customer = participants.find(
    (participant) => String(participant?.purpose || "").toLowerCase() === "customer"
  ) || null;
  const attributes = customer?.attributes && typeof customer.attributes === "object"
    ? customer.attributes
    : {};
  const documentRaw = genesysAttributeValue(attributes, [
    "documento", "Documento", "cpf", "CPF", "cnpj", "CNPJ", "cnpj_cpf"
  ]);
  const document = findValidDocuments(documentRaw)[0] || null;
  const address = genesysAttributeValue(attributes, [
    "End_completo", "end_completo", "endereco", "Endereço", "address"
  ]);
  const city = genesysAttributeValue(attributes, ["cidade", "Cidade", "city"]);
  const legalName = genesysAttributeValue(attributes, ["Titular", "titular", "nome_cliente", "Nome Cliente"]);
  const pppoe = genesysAttributeValue(attributes, ["PPPoE", "pppoe", "login_pppoe", "Login PPPoE", "login"]);
  const ip = genesysAttributeValue(attributes, ["IP", "ip", "IPv4", "ipv4", "ip_address"]);
  const contractId = genesysAttributeValue(attributes, ["ID_Contrato", "ID contrato", "id_contrato", "contrato_id"]);
  const olt = genesysAttributeValue(attributes, ["olt", "Olt", "OLT"]);
  const pon = genesysAttributeValue(attributes, ["Pon_Link", "pon_link", "PON", "pon", "pon_id"]);
  const branch = genesysAttributeValue(attributes, ["ID_Filial", "id_filial", "filial", "Filial"]);
  const phone = String(
    (Array.isArray(customer?.messages) ? customer.messages : [])
      .map((communication) => (
        communication?.fromAddress?.addressRaw
        || communication?.fromAddress?.addressNormalized
        || ""
      ))
      .find(Boolean)
    || ""
  ).replace(/\D/g, "");
  return {
    customer,
    name: normalizeName(customer?.name) || "Cliente",
    document,
    address,
    city,
    phone,
    legalName,
    pppoe,
    ip,
    contractId,
    olt,
    pon,
    branch,
    communicationId: activeAgentCommunicationId(detail),
    openedAt: detail?.startTime || Date.now(),
    inactivityTimeout: detail?.inactivityTimeout || null
  };
}
function genesysPrimaryClientPayload(identity, customerName) {
  const visibleName = normalizeName(customerName || identity?.name) || "Cliente";
  const legalName = normalizeName(identity?.legalName);
  return {
    nome: visibleName,
    nome_whatsapp: visibleName,
    displayName: visibleName,
    ...(legalName && comparableName(legalName) !== comparableName(visibleName)
      ? { nomeIxc: legalName }
      : {}),
    ...(identity?.document ? {
      cpf: identity.document.digits,
      document: identity.document.digits,
      documentType: identity.document.type
    } : {}),
    ...(identity?.address ? { endereco: identity.address } : {}),
    ...(identity?.city ? { cidade: identity.city } : {}),
    ...(identity?.phone ? { telefone: identity.phone } : {}),
    ...(identity?.pppoe ? { pppoe: identity.pppoe } : {}),
    ...(identity?.ip ? { ip: identity.ip } : {}),
    ...(identity?.contractId ? { contratoId: identity.contractId } : {}),
    ...(identity?.olt ? { olt: identity.olt } : {}),
    ...(identity?.pon ? { ponId: identity.pon } : {}),
    ...(identity?.branch ? { filial: identity.branch } : {}),
    fonteDadosPrimarios: "genesys"
  };
}

async function syncGenesysExternalStatus(conversationId, identity, primaryClient) {
  const oltName = String(identity?.olt || "").trim();
  if (!UUID_RE.test(conversationId) || !oltName || !self.OnionExternalStatus) return false;
  const technicalLogin = {
    loginId: `genesys_${conversationId}`,
    active: true,
    online: null,
    source: "genesys",
    oltName,
    ponId: String(identity?.pon || "").trim(),
    pppoeUser: String(identity?.pppoe || "").trim(),
    ipv4: String(identity?.ip || "").trim(),
    city: String(identity?.city || "").trim(),
    fullAddress: String(identity?.address || "").trim()
  };
  const external = await self.OnionExternalStatus.enrichLogins([technicalLogin], { force: false });
  await emit("ext:atendimento:cliente", {
    convId: conversationId,
    ixcOnly: true,
    cliente: {
      ...(primaryClient || {}),
      externalNetwork: {
        source: "genesys",
        logins: external.logins,
        externalStatus: external.externalStatus,
        checkedAt: new Date().toISOString()
      }
    },
    environment: "dev"
  });
  log("ok", "Rede comparada pela OLT do Genesys", `${conversationId.slice(0, 8)} · ${oltName}`);
  return true;
}

async function syncConversationFromNotification(conversationId) {
  if (!UUID_RE.test(conversationId)) return;
  const state = conversationState(conversationId);
  if (state.syncing) {
    state.rerun = true;
    return;
  }
  state.syncing = true;
  try {
    const [cfg, credentials] = await Promise.all([settings(), auth()]);
    if (!cfg.enabled || !credentials?.token) return;
    const notificationSnapshot = notificationSnapshots.get(conversationId);
    const useNotificationSnapshot = (
      notificationSnapshot
      && Date.now() - Number(notificationSnapshot.observedAt || 0) <= NOTIFICATION_SNAPSHOT_MAX_AGE_MS
      && notificationSnapshot.agentActive === true
      && Boolean(notificationSnapshot.customerName)
    );
    let identity;
    let refs;
    if (useNotificationSnapshot) {
      const document = findValidDocuments(notificationSnapshot.customerDocument)[0] || null;
      identity = {
        name: notificationSnapshot.customerName,
        document,
        address: notificationSnapshot.customerAddress,
        city: notificationSnapshot.customerCity,
        phone: notificationSnapshot.customerPhone,
        legalName: notificationSnapshot.customerLegalName,
        pppoe: notificationSnapshot.customerPppoe,
        ip: notificationSnapshot.customerIp,
        contractId: notificationSnapshot.customerContractId,
        olt: notificationSnapshot.customerOlt,
        pon: notificationSnapshot.customerPon,
        branch: notificationSnapshot.customerBranch,
        communicationId: notificationSnapshot.agentCommunicationIds[0] || "",
        openedAt: notificationSnapshot.openedAt || notificationSnapshot.observedAt || Date.now(),
        inactivityTimeout: notificationSnapshot.inactivityTimeout || null
      };
      refs = {
        ids: notificationSnapshot.messageRefs.map((reference) => reference.id),
        purposeByMessage: new Map(
          notificationSnapshot.messageRefs.map((reference) => [reference.id, {
            purpose: reference.purpose,
            participantId: reference.participantId,
            participantName: reference.participantName,
            userId: reference.userId,
            senderKind: reference.senderKind
          }])
        )
      };
      observationMetrics.notificationTargetedSyncs += 1;
    } else {
      const cached = authoritativeConversationDetails.get(conversationId);
      const detail = (
        cached
        && Date.now() - Number(cached.at || 0) <= AUTHORITATIVE_ROSTER_CACHE_MS
      )
        ? cached.detail
        : await genesysFetch(`/api/v2/conversations/messages/${conversationId}`);
      authoritativeConversationDetails.set(conversationId, { detail, at: Date.now() });
      if (hasActiveAgentMessaging(detail)) {
        identity = conversationCustomerIdentity(detail);
        refs = collectGenesysMessageRefs(detail);
      }
    }
    if (!identity || !refs) {
      state.observedAgentActive = false;
      state.observedInactiveAt = Date.now();
      if (!state.upserted) state.lifecycle = "DISCOVERED";
      await Promise.all([
        removeSyncOutboxForConversation(conversationId).catch(() => {}),
        removeDeltaOutboxForConversation(conversationId).catch(() => {})
      ]);
      const previousLogAt = Number(inactiveNotificationLogAt.get(conversationId) || 0);
      if (Date.now() - previousLogAt >= 30000) {
        inactiveNotificationLogAt.set(conversationId, Date.now());
        log("drop", "Evento histórico ignorado", `${conversationId.slice(0, 8)} · agente inativo`);
      }
      return;
    }

    const customerName = identity.name;
    state.observedAgentActive = true;
    if (useNotificationSnapshot) state.lastNetworkSeenAt = notificationSnapshot.observedAt;
    else state.lastApiConfirmedAt = Date.now();
    state.participantName = customerName;
    reviveClosedConversationState(conversationId, state, "notification-sync");
    state.closed = false;
    if (deliveryRosterGuard.blocking) {
      deliveryRosterGuard.activeIds.add(conversationId);
    }

    const purposeByMessage = refs.purposeByMessage;
    const primaryClient = genesysPrimaryClientPayload(identity, customerName);
    const primaryClientSignature = JSON.stringify(primaryClient);
    const forceSnapshot = state.forceSnapshot === true;
    const unseenIds = [];
    for (const id of refs.ids) {
      if (!state.messageIds.has(id) && !state.passivePendingMessageIds.has(id)) unseenIds.push(id);
    }

    let upsertedNow = false;
    if (!state.upserted) {
      const delivered = await deliverConversationUpsertToOnion({
        convId: conversationId,
        syncGeneration: state.syncGeneration,
        ...(identity.communicationId ? { communicationId: identity.communicationId } : {}),
        canal: "genesys",
        genesysMediaType: "message",
        conversationType: "message",
        status: "open",
        cliente: primaryClient,
        abertoEm: identity.openedAt,
        inactivityTimeout: identity.inactivityTimeout,
        source: forceSnapshot
          ? "genesys-authoritative-repair"
          : useNotificationSnapshot
            ? "genesys-websocket"
            : "genesys-notification",
        environment: "dev"
      }, "Upsert Genesys sem confirmação");
      if (!delivered) {
        state.upserted = false;
        state.lifecycle = "DISCOVERED";
        setTimeout(() => scheduleNotificationSync(conversationId, 1500), 1500);
        return;
      }
      upsertedNow = true;
      state.primaryClientSignature = primaryClientSignature;
      state.lifecycle = "ACTIVE";
      if (identity.communicationId) {
        await rememberCommunicationId(
          conversationId,
          identity.communicationId,
          "notification-sync"
        ).catch(() => {});
      }
      log(
        "ok",
        forceSnapshot ? "Card ausente recuperado no Onion" : "Conversa descoberta por notification",
        `${customerName} · ${conversationId.slice(0, 8)}`
      );
      setTimeout(() => {
        Promise.resolve(scheduleConversationSettle(conversationId))
          .catch((error) => log("error", "Falha na conferência final", error?.message || "erro"));
      }, 2500 + Math.floor(Math.random() * 1000));
    } else if (identity.communicationId) {
      await rememberCommunicationId(
        conversationId,
        identity.communicationId,
        "notification-sync"
      ).catch(() => {});
    }

    const documentChanged = identity.document && state.documentDigits !== identity.document.digits;
    if (!upsertedNow && state.primaryClientSignature !== primaryClientSignature) {
      emit("ext:atendimento:cliente", {
        convId: conversationId,
        ixcOnly: true,
        cliente: primaryClient,
        environment: "dev"
      });
      state.primaryClientSignature = primaryClientSignature;
    }
    if (documentChanged) {
      state.documentDigits = identity.document.digits;
      log(
        "ok",
        `${identity.document.type} resolvido pelos atributos Genesys`,
        `${conversationId.slice(0, 8)} · ${identity.document.digits.slice(-4)}`
      );
    }

    const externalNetworkSignature = JSON.stringify([
      String(identity.olt || "").trim(),
      String(identity.pon || "").trim()
    ]);
    if (identity.olt && state.externalNetworkSignature !== externalNetworkSignature) {
      state.externalNetworkSignature = externalNetworkSignature;
      Promise.resolve(syncGenesysExternalStatus(conversationId, identity, primaryClient))
        .catch((error) => {
          state.externalNetworkSignature = "";
          log("error", "Falha ao comparar OLT Genesys", error?.message || "erro");
        });
    }

    const snapshotMode = forceSnapshot || !state.backfilled;
    const selectedIds = snapshotMode ? refs.ids.slice(-500) : unseenIds.slice(-80);
    if (!selectedIds.length) {
      if (snapshotMode) {
        state.forceSnapshot = false;
        state.backfilled = true;
      }
      return;
    }

    const entities = [];
    for (let offset = 0; offset < selectedIds.length; offset += 80) {
      const chunk = selectedIds.slice(offset, offset + 80);
      const bulk = await genesysFetch(
        `/api/v2/conversations/messages/${conversationId}/messages/bulk`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(chunk)
        }
      );
      entities.push(...(Array.isArray(bulk) ? bulk : (bulk?.entities || [])));
    }
    const hydratedItems = (await Promise.all(
      entities.map((item) => messageData(item, purposeByMessage))
    )).flatMap(expandGenesysMessageMedia);
    const failedMediaIds = new Set(
      hydratedItems
        .filter((item) => item.mediaHydrationFailed)
        .map((item) => item.id)
        .filter(Boolean)
    );
    const messages = hydratedItems.filter((item) => (
      item.id
      && !item.mediaHydrationFailed
      && (item.text || item.media)
      && (
        forceSnapshot
        || (
          !state.messageIds.has(item.id)
          && !state.passivePendingMessageIds.has(item.id)
        )
      )
    ));
    syncConversationDocument(conversationId, messages);
    const returnedIds = new Set(
      entities
        .map((item) => String(item?.id || item?.messageId || ""))
        .filter((id) => id && !failedMediaIds.has(id))
    );
    returnedIds.forEach((id) => {
      state.messageIds.add(id);
      state.passiveMediaPendingAt.delete(id);
    });
    const missingIds = selectedIds.filter((id) => !returnedIds.has(id));
    if (failedMediaIds.size) {
      log(
        "warn",
        "Mídia Genesys aguardando novo download",
        `${conversationId.slice(0, 8)} · ${failedMediaIds.size} arquivo(s)`
      );
    }
    if (missingIds.length && state.bulkRetryCount < 3) {
      state.bulkRetryCount += 1;
      setTimeout(() => scheduleNotificationSync(conversationId, 1200), state.bulkRetryCount * 500);
      log(
        "warn",
        "Bulk Genesys incompleto",
        `${conversationId.slice(0, 8)} · faltaram ${missingIds.length} · tentativa ${state.bulkRetryCount}/3`
      );
    } else if (!missingIds.length) {
      state.bulkRetryCount = 0;
    }

    if (snapshotMode) {
      state.backfilled = missingIds.length === 0;
      state.forceSnapshot = missingIds.length > 0;
      if (messages.length) {
        await queueReliableSnapshot(conversationId, messages, customerName);
      }
    } else {
      for (const message of messages) {
        queueReliableDelta({
          convId: conversationId,
          mensagem: message,
          participantName: customerName,
          environment: "dev"
        }).catch((error) => log("error", "Falha ao persistir delta", error?.message || "erro"));
      }
    }
    log(
      "ok",
      snapshotMode
        ? "Snapshot autoritativo sincronizado"
        : useNotificationSnapshot
          ? "Delta WebSocket Genesys sincronizado"
          : "Delta Genesys sincronizado",
      `${conversationId.slice(0, 8)} · ${messages.length} novas`
    );
  } catch (error) {
    log("error", "Falha na notification Genesys", `${conversationId.slice(0, 8)} · ${error.message}`);
  } finally {
    state.syncing = false;
    if (state.rerun) {
      state.rerun = false;
      scheduleNotificationSync(conversationId);
    }
  }
}
function drainConversationSyncQueue() {
  while (activeConversationSyncs < MAX_CONVERSATION_SYNC_CONCURRENCY && pendingConversationSyncs.size) {
    const conversationId = pendingConversationSyncs.values().next().value;
    pendingConversationSyncs.delete(conversationId);
    activeConversationSyncs += 1;
    syncConversationFromNotification(conversationId)
      .catch(() => {})
      .finally(() => {
        activeConversationSyncs -= 1;
        drainConversationSyncQueue();
      });
  }
}
function scheduleNotificationSync(conversationId, delayMs = NOTIFICATION_DEBOUNCE_MS) {
  if (!UUID_RE.test(conversationId)) return;
  if (
    deliveryRosterGuard.blocking
    && !hasGuardedActiveEvidence(conversationId)
  ) {
    if (!deliveryRosterGuard.authoritative) {
      quarantinedNotificationIds.add(conversationId);
      while (quarantinedNotificationIds.size > 500) {
        quarantinedNotificationIds.delete(quarantinedNotificationIds.values().next().value);
      }
      if (!socket?.connected && !connecting) ensureSocket().catch(() => {});
    }
    return;
  }
  quarantinedNotificationIds.delete(conversationId);
  clearTimeout(notificationTimers.get(conversationId));
  notificationTimers.set(conversationId, setTimeout(() => {
    notificationTimers.delete(conversationId);
    pendingConversationSyncs.add(conversationId);
    drainConversationSyncQueue();
  }, Math.max(NOTIFICATION_DEBOUNCE_MS, Number(delayMs) || 0)));
}
function scheduleConversationSettle(conversationId) {
  const state = conversationState(conversationId);
  if (state.closed || !state.upserted) return;
  if (state.syncing) {
    scheduleNotificationSync(conversationId, 750);
    return;
  }
  const passiveFresh = (
    Number(state.lastNetworkSeenAt || 0) > 0
    && Date.now() - Number(state.lastNetworkSeenAt || 0) <= 10000
  );
  const passiveFoundGap = (
    Number(state.observedMissingMessageCount || 0) > 0
    || Number(state.observedMessageCount || 0) > state.messageIds.size
  );
  const passiveConfirmedSnapshot = (
    passiveFresh
    && Number(state.observedMessageCount || 0) > 0
    && !passiveFoundGap
  );
  // Uma resposta passiva recente, já sem IDs faltantes, confirma o snapshot.
  // Sem essa confirmação ainda fazemos uma consulta incremental de segurança.
  if (passiveConfirmedSnapshot && state.backfilled) return;
  scheduleNotificationSync(conversationId);
}
async function reloadConversationFromGenesys(next, payload = {}) {
  const conversationId = String(payload.convId || payload.conversationId || "").trim();
  if (!UUID_RE.test(conversationId)) {
    next.emit("cmd:resultado", {
      cmd: "hydrate_conversa", ok: false,
      convId: conversationId || null, chatId: payload.chatId || null,
      error: "conversationId_invalido"
    });
    return;
  }
  const now = Date.now();
  const previous = Number(manualReloadAt.get(conversationId) || 0);
  if (now - previous < 5000) {
    next.emit("cmd:resultado", {
      cmd: "hydrate_conversa", ok: false,
      convId: conversationId, chatId: payload.chatId || null,
      error: "aguarde_antes_de_recarregar_novamente"
    });
    return;
  }
  manualReloadAt.set(conversationId, now);
  try {
    const detail = await genesysFetch(`/api/v2/conversations/messages/${conversationId}`);
    const participants = Array.isArray(detail?.participants) ? detail.participants : [];
    const customer = participants.find((participant) => participant.purpose === "customer");
    const customerName = normalizeName(customer?.name) || "Cliente";
    const { purposeByMessage, ids } = collectGenesysMessageRefs(detail);
    const messages = [];
    for (let offset = 0; offset < ids.length; offset += 80) {
      const chunk = ids.slice(offset, offset + 80);
      const bulk = await genesysFetch(
        `/api/v2/conversations/messages/${conversationId}/messages/bulk`,
        { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(chunk) }
      );
      const entities = Array.isArray(bulk) ? bulk : (bulk?.entities || []);
      const hydrated = (await Promise.all(entities.map((item) => messageData(item, purposeByMessage))))
        .flatMap(expandGenesysMessageMedia);
      messages.push(...hydrated.filter((item) => item.id && (item.text || item.media)));
    }
    syncConversationDocument(conversationId, messages);
    const state = conversationState(conversationId);
    state.participantName = customerName;
    messages.forEach((message) => {
      state.messageIds.add(message.id);
      state.passivePendingMessageIds.delete(message.id);
      state.passiveMediaPendingAt.delete(message.id);
    });
    state.backfilled = true;
    state.closed = false;
    state.lifecycle = "ACTIVE";
    state.lastApiConfirmedAt = Date.now();
    try {
      await queueReliableSnapshot(conversationId, messages, customerName);
    } catch (snapshotError) {
      if (!isStorageQuotaError(snapshotError)) throw snapshotError;
      // Última barreira: mesmo que outro contexto da extensão tenha enchido
      // o storage durante a recarga, repete o envio sem qualquer persistência.
      await recoverOutboxStorageQuota().catch(() => {});
      await queueReliableSnapshot(
        conversationId,
        messages,
        customerName,
        { volatileOnly: true }
      );
      log("warn", "Recarga continuou sem armazenamento local", conversationId.slice(0, 8));
    }
    next.emit("cmd:resultado", {
      cmd: "hydrate_conversa", ok: true,
      convId: conversationId, chatId: payload.chatId || null,
      total: ids.length, carregadas: messages.length
    });
    log("ok", "Conversa recarregada sob demanda", `${conversationId.slice(0, 8)} · ${messages.length}/${ids.length}`);
  } catch (error) {
    next.emit("cmd:resultado", {
      cmd: "hydrate_conversa", ok: false,
      convId: conversationId, chatId: payload.chatId || null,
      error: error?.message || "falha_ao_recarregar_conversa"
    });
    log("error", "Falha ao recarregar conversa", `${conversationId.slice(0, 8)} · ${error?.message || error}`);
  }
}
async function backfillConversationFromGenesys(conversationId, generation, detailFromValidation = null) {
  try {
    const detail = detailFromValidation
      || await genesysFetch(`/api/v2/conversations/messages/${conversationId}`);
    const participants = Array.isArray(detail?.participants) ? detail.participants : [];
    const { purposeByMessage, ids } = collectGenesysMessageRefs(detail);
    if (!ids.length) { log("warn", "Genesys sem mensagens para backfill", conversationId.slice(0, 8)); return; }
    const selectedIds = ids.slice(-80);
    const bulk = await genesysFetch(
      `/api/v2/conversations/messages/${conversationId}/messages/bulk`,
      { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(selectedIds) }
    );
    if (generation !== focused.generation || conversationId !== focused.conversationId) {
      log("drop", "Backfill descartado", "conversa mudou durante a consulta");
      return;
    }
    const entities = Array.isArray(bulk) ? bulk : (bulk?.entities || []);
    const messages = (await Promise.all(
      entities.map((item) => messageData(item, purposeByMessage))
    )).flatMap(expandGenesysMessageMedia).filter((item) => item.id && (item.text || item.media));
    syncConversationDocument(conversationId, messages);
    if (!messages.length) { log("warn", "Backfill sem texto aproveitável", conversationId.slice(0, 8)); return; }
    handleMessages({ conversationId, messages });
    log("ok", "Backfill Genesys preparado", `${messages.length} mensagens`);
  } catch (error) {
    log("error", "Falha no backfill Genesys", error.message);
  }
}
function safeBaseUrl(value) {
  const parsed = new URL(String(value || DEFAULTS.baseUrl));
  if (parsed.protocol !== "http:" || !["127.0.0.1", "localhost"].includes(parsed.hostname)) throw new Error("Somente servidor Onion local é permitido");
  return parsed.origin;
}
function disconnect(reason = "manual") {
  try { socket?.disconnect(); } catch (_) {}
  socket = null;
  connecting = null;
  log("info", "Socket desconectado", reason);
}
function rateAllowed() {
  const now = Date.now();
  while (rateWindow.length && now - rateWindow[0] > 60000) rateWindow.shift();
  if (rateWindow.length >= RATE_LIMIT_PER_MINUTE) return false;
  rateWindow.push(now);
  return true;
}
function commandResult(next, payload, result, cmd = "enviar_mensagem", ack = null) {
  const response = {
    cmd,
    commandId: payload.commandId || null,
    convId: payload.convId || null,
    chatId: payload.chatId || null,
    messageId: payload.messageId || null,
    ...result
  };
  if (typeof ack === "function") {
    try { ack(response); } catch (_) {}
  } else {
    next.emit("cmd:resultado", response);
  }
  return response;
}
async function runIdempotentOutboundMutation(kind, payload, worker) {
  const commandId = String(payload?.commandId || "").trim();
  if (!commandId) return worker();
  const commandKey = `${kind}:${commandId}`;
  const now = Date.now();
  for (const [key, command] of outboundCommands) {
    if (now - Number(command?.at || command || 0) > 10 * 60 * 1000) outboundCommands.delete(key);
  }
  const existing = outboundCommands.get(commandKey);
  if (existing?.result) return existing.result;
  if (existing?.promise) return existing.promise;

  const entry = { at: now, result: null, promise: null };
  const operation = Promise.resolve()
    .then(worker)
    .then((result) => {
      entry.result = result;
      entry.promise = null;
      return result;
    })
    .catch((error) => {
      entry.promise = null;
      throw error;
    });
  entry.promise = operation;
  outboundCommands.set(commandKey, entry);
  return operation;
}
function outboundRateAllowed() {
  const now = Date.now();
  while (outboundRateWindow.length && now - outboundRateWindow[0] > 60000) {
    outboundRateWindow.shift();
  }
  if (outboundRateWindow.length >= OUTBOUND_RATE_PER_MINUTE) return false;
  outboundRateWindow.push(now);
  return true;
}
function outboundMediaRateAllowed() {
  const now = Date.now();
  while (outboundMediaRateWindow.length && now - outboundMediaRateWindow[0] > 60000) {
    outboundMediaRateWindow.shift();
  }
  if (outboundMediaRateWindow.length >= OUTBOUND_MEDIA_RATE_PER_MINUTE) return false;
  outboundMediaRateWindow.push(now);
  return true;
}
async function postGenesysTextMessage(conversationId, communicationId, text) {
  return genesysFetch(
    `/api/v2/conversations/messages/${conversationId}/communications/${communicationId}/messages?useNormalizedMessage=true`,
    {
      method: "POST",
      credentials: "include",
      headers: {
        "content-type": "application/json",
        "genesys-app": "messaging_gadget_webui/1008"
      },
      body: JSON.stringify({ textBody: text }),
      governor: { priority: "critical", timeoutMs: 30000 }
    }
  );
}
function normalizeOutboundMediaMime(value) {
  const mime = String(value || "").trim().toLowerCase().split(";")[0].trim();
  if (mime === "application/ogg") return "audio/ogg";
  if (mime === "audio/mp3") return "audio/mpeg";
  return mime;
}
function sanitizeGenesysUploadFileName(value) {
  let name = String(value || "arquivo").split(/[\\/]/).pop().trim();
  name = name.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  name = name.replace(/\s+/g, "_").replace(/[^a-zA-Z0-9._()-]/g, "_");
  name = name.replace(/^\.+/, "").slice(0, 120);
  return name || "arquivo";
}
async function fetchOnionMediaBlob(mediaUrl, expectedSize, expectedMime) {
  let url;
  try {
    url = new URL(String(mediaUrl || ""));
  } catch (_) {
    throw new Error("origem_de_anexo_onion_invalida");
  }
  const cfg = await settings();
  const configuredOnion = new URL(safeBaseUrl(cfg.baseUrl));
  const localHosts = new Set(["127.0.0.1", "localhost"]);
  const urlPort = url.port || (url.protocol === "http:" ? "80" : "443");
  const configuredPort = configuredOnion.port || "80";
  if (
    url.protocol !== "http:"
    || !localHosts.has(url.hostname)
    || !localHosts.has(configuredOnion.hostname)
    || urlPort !== configuredPort
    || !url.pathname.startsWith("/uploads/")
  ) {
    throw new Error("origem_de_anexo_onion_invalida");
  }
  const response = await fetch(url.href, {
    method: "GET",
    credentials: "omit",
    cache: "no-store"
  });
  if (!response.ok) throw new Error(`download_anexo_onion_http_${response.status}`);
  const blob = await response.blob();
  if (!blob.size) throw new Error("anexo_vazio");
  if (blob.size > OUTBOUND_MEDIA_MAX_BYTES) throw new Error("anexo_maior_que_25mb");
  if (Number.isFinite(expectedSize) && expectedSize > 0 && blob.size !== expectedSize) {
    throw new Error("tamanho_do_anexo_diverge_do_onion");
  }
  const responseMime = normalizeOutboundMediaMime(blob.type);
  if (responseMime && responseMime !== expectedMime) {
    throw new Error("mime_do_anexo_diverge_do_onion");
  }
  return blob.type === expectedMime ? blob : blob.slice(0, blob.size, expectedMime);
}
function safeGenesysUploadHeaders(rawHeaders, mimeType) {
  const headers = {};
  for (const [rawName, rawValue] of Object.entries(
    rawHeaders && typeof rawHeaders === "object" ? rawHeaders : {}
  )) {
    const name = String(rawName || "").trim().toLowerCase();
    if (!name || rawValue === undefined || rawValue === null) continue;
    if (["authorization", "cookie", "host", "content-length", "origin", "referer"].includes(name)) continue;
    if (name.startsWith("sec-")) continue;
    if (name.startsWith("x-amz-") || name === "content-md5") {
      headers[name] = String(rawValue);
    }
  }
  headers["content-type"] = mimeType;
  return headers;
}
async function postGenesysMediaMessage(conversationId, communicationId, mediaId, caption = "") {
  const body = { mediaIds: [mediaId] };
  const cleanCaption = String(caption || "").trim().slice(0, 2000);
  if (cleanCaption) body.textBody = cleanCaption;
  return genesysFetch(
    `/api/v2/conversations/messages/${conversationId}/communications/${communicationId}/messages?useNormalizedMessage=true`,
    {
      method: "POST",
      credentials: "include",
      headers: {
        "content-type": "application/json",
        "genesys-app": "messaging_gadget_webui/1008"
      },
      body: JSON.stringify(body),
      governor: { priority: "critical", timeoutMs: 30000 }
    }
  );
}
async function uploadGenesysMediaOnce({
  conversationId,
  communicationId,
  blob,
  fileName,
  mimeType,
  caption,
  expectedGeneration
}) {
  const upload = await genesysFetch(
    `/api/v2/conversations/messages/${conversationId}/communications/${communicationId}/messages/media/uploads`,
    {
      method: "POST",
      credentials: "include",
      headers: {
        "content-type": "application/json",
        "genesys-app": "messaging_gadget_webui/1008"
      },
      body: JSON.stringify({
        contentLengthBytes: blob.size,
        fileName
      }),
      governor: { priority: "critical", timeoutMs: 30000 }
    }
  );
  const mediaId = String(upload?.id || "").trim();
  let uploadUrl;
  try {
    uploadUrl = new URL(String(upload?.uploadUrl || ""));
  } catch (_) {
    throw new Error("genesys_upload_sem_url_valida");
  }
  if (!UUID_RE.test(mediaId)) throw new Error("genesys_upload_sem_media_id");
  if (uploadUrl.protocol !== "https:" || uploadUrl.hostname !== "fileupload.sae1.pure.cloud") {
    throw new Error("genesys_upload_host_invalido");
  }

  const uploadResponse = await fetch(uploadUrl.href, {
    method: "PUT",
    credentials: "omit",
    headers: safeGenesysUploadHeaders(upload?.uploadHeaders, mimeType),
    body: blob
  });
  if (!uploadResponse.ok) {
    if ([401, 403].includes(uploadResponse.status)) throw new Error("upload_genesys_expirou");
    throw new Error(`upload_genesys_http_${uploadResponse.status}`);
  }

  const currentState = conversations.get(conversationId);
  if (
    !currentState
    || !currentState.upserted
    || currentState.closed
    || currentState.syncGeneration !== expectedGeneration
    || ["SUSPECTED_ABSENT", "CLOSING", "CLOSED"].includes(currentState.lifecycle)
  ) {
    throw new Error("conversa_mudou_durante_upload");
  }
  const currentCommunicationId = await knownCommunicationId(conversationId);
  if (currentCommunicationId && currentCommunicationId !== communicationId) {
    throw new Error("communicationId_mudou_durante_upload");
  }

  return postGenesysMediaMessage(
    conversationId,
    communicationId,
    mediaId,
    caption
  );
}
async function forwardMessageThroughGenesysWebRequest(next, payload = {}, ack = null) {
  const convId = String(payload.convId || "").trim();
  const messageId = String(payload.messageId || "").trim();
  const text = String(payload.text || "").trim();
  const commandKey = String(payload.commandId || messageId || `${convId}:${payload.ts || ""}:${text}`);
  const now = Date.now();
  const reply = (result) => commandResult(next, payload, result, "enviar_mensagem", ack);
  for (const [key, command] of outboundCommands) {
    if (now - Number(command?.at || command || 0) > 10 * 60 * 1000) outboundCommands.delete(key);
  }
  if (!UUID_RE.test(convId)) {
    reply({ ok: false, error: "conversationId_invalido" });
    log("drop", "Mensagem Onion recusada", "conversationId inválido");
    return;
  }
  if (!text || text.length > OUTBOUND_MAX_LENGTH) {
    reply({ ok: false, error: !text ? "mensagem_vazia" : "mensagem_muito_longa" });
    log("drop", "Mensagem Onion recusada", !text ? "texto vazio" : "texto acima do limite");
    return;
  }
  const existingCommand = outboundCommands.get(commandKey);
  if (existingCommand) {
    reply(existingCommand.result || { ok: false, error: "comando_em_processamento" });
    log("drop", "Mensagem Onion duplicada", payload.commandId || messageId || convId.slice(0, 8));
    return;
  }
  const createdAt = Number(payload.createdAt || payload.ts || now);
  const expiresAt = Number(payload.expiresAt || (createdAt + 30000));
  if (!Number.isFinite(createdAt) || !Number.isFinite(expiresAt) || createdAt > now + 5000 || expiresAt <= now) {
    reply({ ok: false, error: "comando_expirado" });
    log("drop", "Mensagem Onion recusada", "comando expirado ou com relógio inválido");
    return;
  }
  const state = conversations.get(convId);
  if (
    !state
    || !state.upserted
    || state.closed
    || ["SUSPECTED_ABSENT", "CLOSING", "CLOSED"].includes(state.lifecycle)
  ) {
    reply({ ok: false, error: "conversa_nao_confirmada_ativa" });
    log("drop", "Mensagem Onion recusada", "conversa sem confirmação ativa na extensão");
    return;
  }
  const expectedGeneration = String(payload.expectedGeneration || "");
  if (!expectedGeneration || expectedGeneration !== state.syncGeneration) {
    reply({ ok: false, error: "geracao_da_conversa_divergente" });
    log("drop", "Mensagem Onion recusada", "geração do card diverge da conversa ativa");
    return;
  }
  if (!outboundRateAllowed()) {
    reply({ ok: false, error: "limite_de_envios_atingido" });
    log("drop", "Mensagem Onion recusada", "limite de 30 envios por minuto");
    return;
  }
  outboundCommands.set(commandKey, { at: now, result: null });
  try {
    const suppliedCommunicationId = String(
      payload.communicationId || payload.genesysCommunicationId || ""
    ).trim();
    if (suppliedCommunicationId && !UUID_RE.test(suppliedCommunicationId)) {
      throw new Error("communicationId_recebido_do_onion_invalido");
    }

    const locallyKnownCommunicationId = await knownCommunicationId(convId);
    let communicationId = locallyKnownCommunicationId || suppliedCommunicationId;
    if (
      locallyKnownCommunicationId
      && suppliedCommunicationId
      && locallyKnownCommunicationId !== suppliedCommunicationId
    ) {
      log(
        "warn",
        "CommunicationId do card estava desatualizado",
        `${convId.slice(0, 8)} · usando vínculo local confirmado`
      );
    }
    if (!communicationId) {
      const resolved = await resolveConnectedAgentCommunication(convId);
      communicationId = resolved.communicationId;
      await rememberCommunicationId(convId, communicationId, "active-send-fallback");
      log("info", "CommunicationId resolvido sob demanda", `${convId.slice(0, 8)} · ${communicationId.slice(0, 8)}`);
    } else if (!locallyKnownCommunicationId) {
      await rememberCommunicationId(convId, communicationId, "onion-command");
    }

    let response;
    try {
      response = await postGenesysTextMessage(convId, communicationId, text);
    } catch (firstError) {
      if (!String(firstError?.message || "").includes("Genesys HTTP 404")) throw firstError;
      await forgetCommunicationId(convId);
      const refreshed = await resolveConnectedAgentCommunication(convId);
      const refreshedCommunicationId = String(refreshed?.communicationId || "");
      if (!UUID_RE.test(refreshedCommunicationId) || refreshedCommunicationId === communicationId) {
        throw firstError;
      }
      communicationId = refreshedCommunicationId;
      await rememberCommunicationId(convId, communicationId, "active-send-recovery");
      log("warn", "CommunicationId renovado após rejeição", `${convId.slice(0, 8)} · ${communicationId.slice(0, 8)}`);
      response = await postGenesysTextMessage(convId, communicationId, text);
    }

    const genesysMessageId = String(response?.id || response?.messageId || "");
    const result = {
      ok: true,
      genesysMessageId: genesysMessageId || messageId || `web_${now}`
    };
    outboundCommands.set(commandKey, { at: now, result });
    reply(result);
    log("ok", "Mensagem Onion enviada por vínculo salvo", `${convId.slice(0, 8)} · ${communicationId.slice(0, 8)}`);
  } catch (error) {
    if (String(error?.message || "").includes("Genesys HTTP 404")) {
      await forgetCommunicationId(convId);
    }
    const result = { ok: false, error: error?.message || "envio_web_genesys_falhou" };
    outboundCommands.set(commandKey, { at: now, result });
    reply(result);
    log("error", "Falha ao encaminhar mensagem Onion", error?.message || "erro desconhecido");
  }
}
async function forwardMediaThroughGenesysWebRequest(next, payload = {}, ack = null) {
  const convId = String(payload.convId || "").trim();
  const messageId = String(payload.messageId || "").trim();
  const commandKey = String(payload.commandId || messageId || `${convId}:media:${payload.ts || ""}`);
  const mediaUrl = String(payload.mediaUrl || "").trim();
  const fileName = sanitizeGenesysUploadFileName(payload.fileName);
  const mimeType = normalizeOutboundMediaMime(payload.mimeType);
  const expectedSize = Number(payload.contentLengthBytes);
  const expectedGeneration = String(payload.expectedGeneration || "");
  const now = Date.now();
  const reply = (result) => commandResult(next, payload, result, "enviar_midia", ack);

  for (const [key, command] of outboundCommands) {
    if (now - Number(command?.at || command || 0) > 10 * 60 * 1000) outboundCommands.delete(key);
  }
  if (!UUID_RE.test(convId)) {
    reply({ ok: false, error: "conversationId_invalido" });
    return;
  }
  if (!mediaUrl) {
    reply({ ok: false, error: "anexo_sem_url" });
    return;
  }
  if (!GENESYS_OUTBOUND_MEDIA_MIMES.has(mimeType)) {
    reply({ ok: false, error: "tipo_de_anexo_nao_permitido" });
    return;
  }
  if (!Number.isFinite(expectedSize) || expectedSize <= 0) {
    reply({ ok: false, error: "tamanho_do_anexo_invalido" });
    return;
  }
  if (expectedSize > OUTBOUND_MEDIA_MAX_BYTES) {
    reply({ ok: false, error: "anexo_maior_que_25mb" });
    return;
  }
  const existingCommand = outboundCommands.get(commandKey);
  if (existingCommand) {
    reply(existingCommand.result || { ok: false, error: "comando_em_processamento" });
    return;
  }
  const createdAt = Number(payload.createdAt || payload.ts || now);
  const expiresAt = Number(payload.expiresAt || (createdAt + (2 * 60 * 1000)));
  if (!Number.isFinite(createdAt) || !Number.isFinite(expiresAt) || createdAt > now + 5000 || expiresAt <= now) {
    reply({ ok: false, error: "comando_expirado" });
    return;
  }
  const state = conversations.get(convId);
  if (
    !state
    || !state.upserted
    || state.closed
    || ["SUSPECTED_ABSENT", "CLOSING", "CLOSED"].includes(state.lifecycle)
  ) {
    reply({ ok: false, error: "conversa_nao_confirmada_ativa" });
    return;
  }
  if (!expectedGeneration || expectedGeneration !== state.syncGeneration) {
    reply({ ok: false, error: "geracao_da_conversa_divergente" });
    return;
  }
  if (outboundMediaConversationsInFlight.has(convId)) {
    reply({ ok: false, error: "outro_anexo_em_envio_nesta_conversa" });
    return;
  }
  if (activeOutboundMediaUploads >= MAX_OUTBOUND_MEDIA_CONCURRENCY) {
    reply({ ok: false, error: "limite_de_uploads_simultaneos" });
    return;
  }
  if (!outboundMediaRateAllowed()) {
    reply({ ok: false, error: "limite_de_anexos_atingido" });
    return;
  }

  outboundCommands.set(commandKey, { at: now, result: null });
  outboundMediaConversationsInFlight.add(convId);
  activeOutboundMediaUploads += 1;
  try {
    const blob = await fetchOnionMediaBlob(mediaUrl, expectedSize, mimeType);
    const suppliedCommunicationId = String(
      payload.communicationId || payload.genesysCommunicationId || ""
    ).trim();
    if (suppliedCommunicationId && !UUID_RE.test(suppliedCommunicationId)) {
      throw new Error("communicationId_recebido_do_onion_invalido");
    }
    const locallyKnownCommunicationId = await knownCommunicationId(convId);
    let communicationId = locallyKnownCommunicationId || suppliedCommunicationId;
    if (
      locallyKnownCommunicationId
      && suppliedCommunicationId
      && locallyKnownCommunicationId !== suppliedCommunicationId
    ) {
      log(
        "warn",
        "CommunicationId do anexo estava desatualizado",
        `${convId.slice(0, 8)} · usando vínculo local confirmado`
      );
    }
    if (!communicationId) {
      const resolved = await resolveConnectedAgentCommunication(convId);
      communicationId = String(resolved?.communicationId || "");
      await rememberCommunicationId(convId, communicationId, "active-media-fallback");
    } else if (!locallyKnownCommunicationId) {
      await rememberCommunicationId(convId, communicationId, "onion-media-command");
    }
    if (!UUID_RE.test(communicationId)) {
      throw new Error("communicationId_nao_disponivel_para_esta_conversa");
    }

    const sendOnce = (targetCommunicationId) => uploadGenesysMediaOnce({
      conversationId: convId,
      communicationId: targetCommunicationId,
      blob,
      fileName,
      mimeType,
      caption: payload.caption,
      expectedGeneration
    });

    let response;
    try {
      response = await sendOnce(communicationId);
    } catch (firstError) {
      if (!String(firstError?.message || "").includes("Genesys HTTP 404")) throw firstError;
      await forgetCommunicationId(convId);
      const refreshed = await resolveConnectedAgentCommunication(convId);
      const refreshedCommunicationId = String(refreshed?.communicationId || "");
      if (!UUID_RE.test(refreshedCommunicationId) || refreshedCommunicationId === communicationId) {
        throw firstError;
      }
      communicationId = refreshedCommunicationId;
      await rememberCommunicationId(convId, communicationId, "active-media-recovery");
      response = await sendOnce(communicationId);
    }

    const genesysMessageId = String(response?.id || response?.messageId || "");
    const result = {
      ok: true,
      genesysMessageId: genesysMessageId || messageId || `media_web_${now}`
    };
    outboundCommands.set(commandKey, { at: now, result });
    reply(result);
    log("ok", "Anexo Onion enviado ao Genesys", `${convId.slice(0, 8)} · ${communicationId.slice(0, 8)}`);
  } catch (error) {
    if (String(error?.message || "").includes("Genesys HTTP 404")) {
      await forgetCommunicationId(convId);
    }
    const result = { ok: false, error: error?.message || "envio_midia_genesys_falhou" };
    outboundCommands.set(commandKey, { at: now, result });
    reply(result);
    log("error", "Falha ao encaminhar anexo Onion", error?.message || "erro desconhecido");
  } finally {
    outboundMediaConversationsInFlight.delete(convId);
    activeOutboundMediaUploads = Math.max(0, activeOutboundMediaUploads - 1);
  }
}
async function emit(event, payload) {
  const cfg = await settings();
  if (!cfg.enabled) {
    log("warn", "Evento não enviado", "espelhamento desativado");
    return false;
  }
  const conversationId = String(payload?.convId || payload?.conversationId || "");
  if (
    eventRequiresActiveConversation(event)
    && UUID_RE.test(conversationId)
    && !canDeliverActiveConversation(conversationId)
  ) {
    enqueueSocketEvent(event, payload);
    log("info", "Evento aguardando roster ativo", `${event} · ${conversationId.slice(0, 8)}`);
    if (!socket?.connected) {
      ensureSocket().catch((error) => log("error", "Falha ao conectar", error.message));
    }
    return false;
  }
  if (!rateAllowed()) { log("warn", "Limite de eventos atingido", event); return false; }
  if (socket?.connected) {
    socket.timeout(ACK_TIMEOUT_MS).emit(event, payload, (error, response) => {
      if (error) log("error", `ACK expirou · ${event}`, error.message || "timeout");
      else if (response?.ok === false) log("error", `Onion rejeitou · ${event}`, response.error || "sem detalhe");
      else log("ok", `Onion confirmou · ${event}`, response?.chatId || response?.id || "");
    });
    log("send", event, payload.convId || "");
    return true;
  }
  enqueueSocketEvent(event, payload);
  ensureSocket().catch((error) => log("error", "Falha ao conectar", error.message));
  return false;
}
function socketEventKey(event, payload = {}) {
  const conversationId = String(payload.convId || payload.conversationId || "");
  if (!conversationId) return "";
  if (event === "ext:atendimento:mensagem") {
    const messageId = String(payload?.mensagem?.id || payload?.messageId || "");
    return messageId ? `${event}:${conversationId}:${messageId}` : "";
  }
  if ([
    "ext:atendimento:upsert",
    "ext:atendimento:cliente",
    "ext:atendimento:encerrar"
  ].includes(event)) {
    return `${event}:${conversationId}`;
  }
  return "";
}
function enqueueSocketEvent(event, payload) {
  const key = socketEventKey(event, payload);
  if (key) {
    const existingIndex = queue.findIndex(
      (item) => socketEventKey(item.event, item.payload) === key
    );
    if (existingIndex >= 0) {
      queue[existingIndex] = { event, payload, enqueuedAt: Date.now() };
      return;
    }
  }
  queue.push({ event, payload, enqueuedAt: Date.now() });
  if (queue.length > MAX_QUEUE) queue.splice(0, queue.length - MAX_QUEUE);
}
function flushQueue() {
  if (!socket?.connected) return;
  while (queue.length) {
    let selectedIndex = -1;
    let selectedPriority = Number.NEGATIVE_INFINITY;
    for (let index = 0; index < queue.length; index += 1) {
      const item = queue[index];
      const conversationId = String(item?.payload?.convId || item?.payload?.conversationId || "");
      const eligible = item.event === "ext:atendimento:encerrar"
        ? canDeliverConversationClose(conversationId)
        : !eventRequiresActiveConversation(item.event)
          || canDeliverActiveConversation(conversationId);
      if (!eligible) continue;
      const priority = deliveryPriority(conversationId, item.enqueuedAt);
      if (priority > selectedPriority) {
        selectedIndex = index;
        selectedPriority = priority;
      }
    }
    if (selectedIndex < 0 || !rateAllowed()) break;
    const [item] = queue.splice(selectedIndex, 1);
    socket.timeout(ACK_TIMEOUT_MS).emit(item.event, item.payload, (error, response) => {
      if (error) log("error", `ACK expirou · ${item.event}`, error.message || "timeout");
      else if (response?.ok === false) log("error", `Onion rejeitou · ${item.event}`, response.error || "sem detalhe");
      else log("ok", `Onion confirmou · ${item.event}`, response?.chatId || response?.id || "");
    });
    log("send", item.event, item.payload.convId || "");
  }
}
async function ensureSocket() {
  if (socket?.connected) return socket;
  if (connecting) return connecting;
  connecting = (async () => {
    const cfg = await settings();
    const credentials = await auth();
    if (!cfg.enabled) throw new Error("Espelhamento desativado");
    if (!credentials?.token) throw new Error("Faça login no Onion");
    const baseUrl = safeBaseUrl(cfg.baseUrl);
    disconnect("reconnect");
    const next = io(baseUrl, { auth: { token: credentials.token, client: "genesys-extension" }, transports: ["websocket", "polling"], reconnection: true, reconnectionDelay: 1000, reconnectionDelayMax: 15000, timeout: 10000 });
    socket = next;
    next.on("connect", () => {
      log("ok", "Socket conectado", baseUrl);
      flushExtensionErrorNotifications();
      next.timeout(ACK_TIMEOUT_MS).emit("ext:register", { client: "genesys-extension", environment: "dev" }, (error, response) => {
        if (error) log("error", "Registro Onion sem ACK", error.message || "timeout");
        else if (response?.registered === false) log("error", "Onion não reconheceu a extensão", JSON.stringify(response));
        else log("ok", "Extensão registrada no Onion", response?.room || "");
      });
      beginStartupDeliveryReconciliation(next).catch((error) => {
        log("error", "Falha na reconciliação inicial", error?.message || "erro");
      });
    });
    next.on("disconnect", (reason) => log("warn", "Socket desconectado", reason));
    next.on("connect_error", (error) => log("error", "Erro de conexão", error.message));
    next.on("cmd:enviar_mensagem", (payload = {}, ack) => {
      forwardMessageThroughGenesysWebRequest(next, payload, ack).catch((error) => {
        commandResult(next, payload, { ok: false, error: error?.message || "falha_inesperada" }, "enviar_mensagem", ack);
      });
    });
    next.on("cmd:enviar_midia", (payload = {}, ack) => {
      forwardMediaThroughGenesysWebRequest(next, payload, ack).catch((error) => {
        commandResult(
          next,
          payload,
          { ok: false, error: error?.message || "falha_inesperada" },
          "enviar_midia",
          ack
        );
      });
    });
    next.on("cmd:buscar_ixc", (payload = {}) => {
      handleIxcCommand(next, payload).catch((error) => {
        log("error", "Falha na busca IXC", error?.message || "falha_inesperada");
        next.emit("cmd:resultado", {
          cmd: "buscar_ixc",
          ok: false,
          convId: payload.convId || null,
          error: error?.message || "falha_inesperada"
        });
      });
    });
    next.on("cmd:refresh_ixc_logins", (payload = {}) => {
      handleIxcLoginsRefreshCommand(next, payload).catch((error) => {
        log("error", "Falha ao atualizar IP no IXC", error?.message || "falha_inesperada");
        next.emit("cmd:resultado", {
          cmd: "refresh_ixc_logins",
          ok: false,
          convId: payload.convId || null,
          error: error?.message || "falha_inesperada"
        });
      });
    });
    next.on("cmd:refresh_external_status", (payload = {}) => {
      handleExternalStatusRefreshCommand(next, payload).catch((error) => {
        log("error", "Falha ao atualizar problemas externos", error?.message || "falha_inesperada");
        next.emit("cmd:resultado", {
          cmd: "refresh_external_status",
          ok: false,
          convId: payload.convId || null,
          error: error?.message || "falha_inesperada"
        });
      });
    });
    next.on("cmd:ixc_os", (payload = {}) => {
      const requestId = String(payload.requestId || "").trim();
      const now = Date.now();
      for (const [cachedRequestId, cached] of ixcOsCommandCache) {
        if (now - cached.at > IXC_OS_COMMAND_TTL_MS) ixcOsCommandCache.delete(cachedRequestId);
      }
      const cached = requestId ? ixcOsCommandCache.get(requestId) : null;
      if (cached?.status === "running") {
        log("warn", "Comando de OS duplicado ignorado", requestId);
        return;
      }
      if (cached?.result) {
        next.emit("cmd:resultado", cached.result);
        return;
      }
      if (requestId) ixcOsCommandCache.set(requestId, { status: "running", at: now });
      handleIxcOsCommand(next, payload).then((result) => {
        if (requestId) ixcOsCommandCache.set(requestId, { status: "done", at: Date.now(), result });
      }).catch((error) => {
        log("error", "Falha no fluxo de OS", error?.message || "falha_inesperada");
        const result = {
          cmd: "ixc_os", ok: false,
          convId: payload.convId || null,
          chatId: payload.chatId || null,
          requestId: payload.requestId || null,
          error: error?.message || "falha_inesperada"
        };
        if (requestId) ixcOsCommandCache.set(requestId, { status: "done", at: Date.now(), result });
        next.emit("cmd:resultado", result);
      });
    });
    next.on("cmd:buscar_filas_transferencia", async (payload = {}, ack) => {
      try {
        const result = await searchGenesysTransferQueues(payload);
        if (typeof ack === "function") ack(result);
      } catch (error) {
        const result = { ok: false, error: error?.message || "falha_ao_pesquisar_filas" };
        log("error", "Falha ao pesquisar filas Genesys", result.error);
        if (typeof ack === "function") ack(result);
      }
    });
    next.on("cmd:transferir_com_tabulacao", async (payload = {}, ack) => {
      try {
        const result = await runIdempotentOutboundMutation(
          "transferir_com_tabulacao",
          payload,
          () => transferGenesysWithWrapup(payload)
        );
        if (typeof ack === "function") ack(result);
      } catch (error) {
        const result = {
          ok: false,
          transferred: error?.transferred === true,
          error: error?.message || "falha_ao_transferir_com_tabulacao"
        };
        log(
          "error",
          result.transferred
            ? "Transferência feita, mas tabulação falhou"
            : "Falha ao transferir atendimento",
          result.error
        );
        if (typeof ack === "function") ack(result);
      }
    });
    next.on("cmd:listar_tabulacoes", async (payload = {}, ack) => {
      try {
        const result = await listGenesysWrapupCodes(payload);
        if (typeof ack === "function") ack(result);
      } catch (error) {
        const result = { ok: false, error: error?.message || "falha_ao_listar_tabulacoes" };
        log("error", "Falha ao carregar tabulações", result.error);
        if (typeof ack === "function") ack(result);
      }
    });
    next.on("cmd:finalizar_com_tabulacao", async (payload = {}, ack) => {
      try {
        const result = await runIdempotentOutboundMutation(
          "finalizar_com_tabulacao",
          payload,
          () => finalizeGenesysWithWrapup(payload)
        );
        if (typeof ack === "function") ack(result);
      } catch (error) {
        const result = { ok: false, error: error?.message || "falha_ao_finalizar_com_tabulacao" };
        log("error", "Falha ao finalizar atendimento", result.error);
        if (typeof ack === "function") ack(result);
      }
    });
    next.on("cmd:hydrate_conversa", (payload = {}) => {
      reloadConversationFromGenesys(next, payload).catch((error) => {
        log("error", "Falha no recarregamento manual", error?.message || "falha_inesperada");
      });
    });
    next.on("cmd:encerrar", (payload = {}) => next.emit("cmd:resultado", {
      cmd: "encerrar",
      ok: false,
      convId: payload.convId || null,
      error: "comando_desabilitado_no_ambiente_dev"
    }));
    return next;
  })();
  try { return await connecting; } finally { connecting = null; }
}
async function commitPendingFocus() {
  if (!pendingFocus.conversationId || !focused.name || Date.now() - pendingFocus.at > 5000) return;
  if (pendingFocus.conversationId === focused.conversationId) {
    pendingFocus = { conversationId: "", at: 0 };
    return;
  }
  const candidate = pendingFocus.conversationId;
  const domName = focused.name;
  const generation = focused.generation;
  const validationSeq = ++focusValidationSeq;
  let detail;
  try {
    detail = await genesysFetch(`/api/v2/conversations/messages/${candidate}`);
  } catch (error) {
    log("error", "Não foi possível validar a conversa", error.message);
    return;
  }
  if (!hasActiveAgentMessaging(detail)) {
    log("drop", "Conversa focada já encerrada", candidate.slice(0, 8));
    pendingFocus = { conversationId: "", at: 0 };
    return;
  }
  const apiName = validParticipantName(
    (detail?.participants || []).find((participant) => participant.purpose === "customer")?.name
  );
  if (
    validationSeq !== focusValidationSeq
    || generation !== focused.generation
    || candidate !== pendingFocus.conversationId
    || comparableName(domName) !== comparableName(focused.name)
  ) {
    log("drop", "Validação descartada", "tela mudou durante a consulta");
    return;
  }
  if (!apiName || comparableName(apiName) !== comparableName(domName)) {
    log("drop", "Nome DOM diverge da API", `${domName || "sem nome"} ≠ ${apiName || "sem nome"}`);
    pendingFocus = { conversationId: "", at: 0 };
    return;
  }
  focused = { conversationId: candidate, name: domName, generation, at: Date.now() };
  const focusedState = conversationState(focused.conversationId);
  focusedState.generation = focused.generation;
  focusedState.lifecycle = "ACTIVE";
  focusedState.observedAgentActive = true;
  focusedState.lastApiConfirmedAt = Date.now();
  focusedState.participantName = focused.name;
  deliveryRosterGuard.activeIds.add(focused.conversationId);
  pendingFocus = { conversationId: "", at: 0 };
  log("ok", "Conversa validada DOM + API", `${focused.name} · ${focused.conversationId.slice(0, 8)}`);
  if (participantTabId != null) {
    chrome.tabs.sendMessage(
      participantTabId,
      { type: "DEV_FOCUS_COMMITTED", conversationId: focused.conversationId },
      { frameId: 0 }
    ).catch(() => {});
  }
  const focusedIdentity = conversationCustomerIdentity(detail);
  const focusedPrimaryClient = genesysPrimaryClientPayload(focusedIdentity, focused.name);
  const focusedUpserted = await deliverConversationUpsertToOnion({
    convId: focused.conversationId,
    syncGeneration: focusedState.syncGeneration,
    ...(focusedIdentity.communicationId ? { communicationId: focusedIdentity.communicationId } : {}),
    canal: "genesys",
    genesysMediaType: "message",
    conversationType: "message",
    status: "open",
    cliente: focusedPrimaryClient,
    abertoEm: focusedIdentity.openedAt,
    inactivityTimeout: focusedIdentity.inactivityTimeout,
    environment: "dev"
  }, "Conversa focada sem confirmação do Onion");
  if (!focusedUpserted) {
    focusedState.upserted = false;
    focusedState.forceSnapshot = true;
    ensureSocket().catch(() => {});
    scheduleNotificationSync(focused.conversationId, 1000);
    return;
  }
  focusedState.primaryClientSignature = JSON.stringify(focusedPrimaryClient);
  if (focusedIdentity.communicationId) {
    await rememberCommunicationId(
      focused.conversationId,
      focusedIdentity.communicationId,
      "focus-validation"
    ).catch(() => {});
  }
  backfillConversationFromGenesys(focused.conversationId, focused.generation, detail);
}
function handleMessages(message) {
  const id = String(message.conversationId || "");
  if (!focused.conversationId || id !== focused.conversationId || !focused.name) { log("drop", "Lote descartado", "foco ou nome divergente"); return; }
  const state = conversationState(id);
  if (state.generation !== focused.generation) { log("drop", "Lote descartado", "geração antiga"); return; }
  const incoming = Array.isArray(message.messages) ? message.messages : [];
  syncConversationDocument(id, incoming);
  if (!state.backfilled) {
    state.backfilled = true;
    incoming.forEach((item) => state.messageIds.add(String(item.id)));
    queueReliableSnapshot(id, incoming, focused.name).catch((error) => {
      log("error", "Falha ao enfileirar snapshot DOM", error?.message || "erro");
    });
    return;
  }
  for (const item of incoming) {
    const messageId = String(item?.id || "");
    if (!messageId || state.messageIds.has(messageId)) continue;
    state.messageIds.add(messageId);
    queueReliableDelta({
      convId: id,
      mensagem: item,
      participantName: focused.name,
      environment: "dev"
    }).catch((error) => log("error", "Falha ao persistir delta DOM", error?.message || "erro"));
  }
}

async function cleanupClosedConversationState() {
  const now = Date.now();
  const removable = [...conversations.entries()]
    .filter(([, state]) => (
      state?.closed === true
      && now - Number(state.closedAt || state.createdAt || 0) >= CLOSED_STATE_RETENTION_MS
    ))
    .sort((left, right) => Number(left[1].closedAt || 0) - Number(right[1].closedAt || 0));
  if (conversations.size > 500) {
    const overflow = conversations.size - 500;
    const known = new Set(removable.map(([id]) => id));
    for (const entry of [...conversations.entries()]
      .filter(([id, state]) => state?.closed === true && !known.has(id))
      .sort((left, right) => Number(left[1].closedAt || left[1].createdAt || 0) - Number(right[1].closedAt || right[1].createdAt || 0))
      .slice(0, overflow)) {
      removable.push(entry);
    }
  }
  for (const [conversationId] of removable) {
    conversations.delete(conversationId);
    communicationIdByConversation.delete(conversationId);
    gadgetFrameByConversation.delete(conversationId);
    closureSuspicions.delete(conversationId);
    manualReloadAt.delete(conversationId);
    observationDivergenceLogAt.delete(conversationId);
    inactiveNotificationLogAt.delete(conversationId);
    notificationSnapshots.delete(conversationId);
    clearTimeout(notificationTimers.get(conversationId));
    notificationTimers.delete(conversationId);
    pendingConversationSyncs.delete(conversationId);
    quarantinedNotificationIds.delete(conversationId);
  }
  if (removable.length) {
    const stored = await chrome.storage.session.get(COMMUNICATIONS_KEY);
    const bindings = stored[COMMUNICATIONS_KEY] || {};
    for (const [conversationId] of removable) delete bindings[conversationId];
    await chrome.storage.session.set({ [COMMUNICATIONS_KEY]: bindings });
  }
}

log("info", "Service worker Onion carregado", `build ${EXTENSION_BUILD}`);
startupStorageRepair = migrateLegacyOutboxesToSession()
  .then(() => recoverOutboxStorageQuota())
  .catch((error) => {
  log("error", "Falha ao reparar armazenamento na partida", error?.message || "erro");
  });

chrome.alarms.create("onion-dev-keepalive", { periodInMinutes: 0.5 });
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name !== "onion-dev-keepalive") return;
  ensureSocket()
    .then(async () => {
      flushQueue();
      await Promise.all([
        flushReliableOutbox(),
        flushReliableCloseOutbox(),
        flushReliableDeltaOutbox(),
        cleanupClosedConversationState()
      ]);
      schedulePeriodicAuthoritativeRosterAudit();
    })
    .catch(() => {});
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "DEV_NETWORK_OBSERVATION_CONFIG_REQUEST") {
    settings()
      .then((cfg) => sendResponse({ ok: true, enabled: cfg.observeNetwork !== false }))
      .catch((error) => sendResponse({ ok: false, enabled: false, error: error.message }));
    return true;
  }
  if (message.type === "DEV_NETWORK_OBSERVATION_HEALTH") {
    observationMetrics.installed = message.installed === true;
    observationMetrics.schemaVersion = Number(message.schemaVersion || 0);
    observationMetrics.installedAt = Number(message.observedAt || Date.now());
    sendResponse({ ok: true });
    return;
  }
  if (message.type === "DEV_NETWORK_OBSERVATION") {
    let trustedSender = false;
    try {
      trustedSender = new URL(String(sender.url || "")).hostname === "apps.sae1.pure.cloud";
    } catch (_) {}
    if (!trustedSender || Number(message.schemaVersion || 0) !== 1) {
      sendResponse({ ok: false, error: "observacao_de_rede_invalida" });
      return;
    }
    observeConversationNetwork(message);
    Promise.all([
      processPassiveConversationDiscovery(message),
      processPassiveMessageDeltas(message)
    ])
      .catch((error) => {
        log("error", "Falha no fluxo passivo Genesys", error?.message || "erro");
      });
    sendResponse({ ok: true, observationOnly: true });
    return;
  }
  if (message.type === "DEV_REGISTER_GADGET_FRAME") {
    if (sender.tab?.id != null && sender.frameId != null) {
      registeredGadgetFrames.add(gadgetFrameKey(sender.tab.id, sender.frameId));
      log("info", "Interface de mensagem Genesys detectada", `frame ${sender.frameId}`);
    }
    sendResponse({ ok: true });
    return;
  }
  if (message.type === "DEV_CONVERSATION_NOTIFICATION") {
    const conversationId = String(message.conversationId || "");
    if (!UUID_RE.test(conversationId)) {
      sendResponse({ ok: false, error: "conversationId_invalido" });
      return;
    }
    let trustedSender = false;
    try {
      trustedSender = new URL(String(sender.url || "")).hostname === "apps.sae1.pure.cloud";
    } catch (_) {}
    if (!trustedSender) {
      sendResponse({ ok: false, error: "notification_origem_invalida" });
      return;
    }
    if (message.conversation && Number(message.schemaVersion || 0) >= 2) {
      const snapshot = rememberNotificationSnapshot(message.conversation, message.observedAt);
      if (!snapshot || snapshot.conversationId !== conversationId) {
        sendResponse({ ok: false, error: "notification_snapshot_invalido" });
        return;
      }
    }
    scheduleNotificationSync(conversationId);
    sendResponse({ ok: true, targeted: notificationSnapshots.has(conversationId) });
    return;
  }
  if (message.type === "DEV_COMMUNICATION_CANDIDATE") {
    const conversationId = String(message.conversationId || "");
    const communicationId = String(message.communicationId || "");
    if (!UUID_RE.test(conversationId) || !UUID_RE.test(communicationId)) {
      sendResponse({ ok: false, error: "vinculo_de_comunicacao_invalido" });
      return;
    }
    rememberCommunicationId(
      conversationId,
      communicationId,
      message.reason || "genesys-web"
    ).then((changed) => {
      if (changed) {
        log("ok", "CommunicationId capturado do Genesys", `${conversationId.slice(0, 8)} · ${communicationId.slice(0, 8)}`);
      }
      sendResponse({ ok: true });
    }).catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }
  if (message.type === "DEV_PARTICIPANT") {
    if (sender.tab?.id != null) participantTabId = sender.tab.id;
    const name = validParticipantName(message.name);
    if (name !== focused.name) {
      focused = { conversationId: "", name, generation: focused.generation + 1, at: Date.now() };
      log("info", "Participante mudou", name || "sem nome");
      commitPendingFocus();
    }
    if (name && !focused.conversationId) resolveConversationByParticipant(name, focused.generation);
    sendResponse({ ok: true }); return;
  }
  if (message.type === "DEV_FOCUS_CANDIDATE") {
    const candidate = String(message.conversationId || "");
    const senderIsGadget = String(sender.url || "").includes("messaging-gadget")
      || registeredGadgetFrames.has(gadgetFrameKey(sender.tab?.id, sender.frameId));
    if (candidate && senderIsGadget && sender.tab?.id != null && sender.frameId != null) {
      bindConversationToGadgetFrame(candidate, sender.tab.id, sender.frameId);
    }
    log("info", "conversationId detectado", `${candidate.slice(0, 8)} · ${message.reason || "sem origem"}`);
    if (candidate && candidate !== focused.conversationId) {
      pendingFocus = { conversationId: candidate, at: Date.now() };
      // Com foco existente, espera a mudança do nome no DOM. Isso impede associar
      // o conversationId novo ao nome que ainda está visível da conversa anterior.
      if (!focused.conversationId) commitPendingFocus();
      if (!focused.conversationId && !focused.name) log("warn", "Aguardando nome do participante", candidate.slice(0, 8));
      else if (focused.conversationId !== candidate) log("warn", "Aguardando confirmação da troca no DOM", candidate.slice(0, 8));
    }
    sendResponse({ ok: true }); return;
  }
  if (message.type === "DEV_MESSAGES") { handleMessages(message); sendResponse({ ok: true }); return; }
  if (message.type === "DEV_CARD_ROSTER") {
    const roster = {
      count: Math.max(0, Number(message.count) || 0),
      names: Array.isArray(message.names) ? message.names : [],
      conversationIds: Array.isArray(message.conversationIds) ? message.conversationIds : [],
      allowClose: message.allowClose === true
    };
    const rosterIds = new Set(
      roster.conversationIds
        .map((id) => String(id || ""))
        .filter((id) => UUID_RE.test(id))
    );
    latestDomRoster = {
      ids: rosterIds,
      count: roster.count,
      complete: roster.allowClose && rosterIds.size === roster.count,
      at: Date.now()
    };
    if (deliveryRosterGuard.blocking) {
      for (const conversationId of rosterIds) {
        deliveryRosterGuard.activeIds.add(conversationId);
      }
    }
    scheduleRosterReconcile(roster);
    sendResponse({ ok: true });
    return;
  }
  if (message.type === "DEV_CARD_REMOVED") {
    const conversationId = String(message.conversationId || "");
    if (conversationId) {
      if (!closureSuspicions.has(conversationId)) closureSuspicions.set(conversationId, Date.now());
      log("warn", "Card removido; aguardando confirmação na API", conversationId.slice(0, 8));
      setTimeout(() => scheduleRosterReconcile({
        count: 0, names: [], conversationIds: [], allowClose: true
      }), 5000);
      if (focused.conversationId === conversationId) {
        focused = { conversationId: "", name: "", generation: focused.generation + 1, at: Date.now() };
      }
      if (pendingFocus.conversationId === conversationId) pendingFocus = { conversationId: "", at: 0 };
    }
    sendResponse({ ok: true });
    return;
  }
  if (message.type === "DEV_LOGIN") {
    (async () => {
      const cfg = await settings();
      const baseUrl = safeBaseUrl(message.baseUrl || cfg.baseUrl);
      const response = await fetch(`${baseUrl}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username: String(message.username || "").trim(), password: String(message.password || "") }) });
      const body = await response.json().catch(() => ({}));
      if (!response.ok || !body.token) throw new Error(body.error || `Onion HTTP ${response.status}`);
      await chrome.storage.local.set({ [AUTH_KEY]: { token: body.token, user: body.user || null, savedAt: Date.now() }, [SETTINGS_KEY]: { ...cfg, baseUrl } });
      if (cfg.enabled) await ensureSocket();
      sendResponse({ ok: true, user: body.user || null });
    })().catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }
  if (message.type === "IXC_OPERATOR_SEARCH") {
    searchIxcOperators(message.term)
      .then((matches) => sendResponse({ ok: true, matches }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }
  if (message.type === "IXC_OPERATOR_SELECT") {
    (async () => {
      const techId = String(message.techId || "").replace(/\D/g, "");
      const techName = String(message.techName || "").trim();
      if (!techId || !techName) throw new Error("colaborador_invalido");
      const stored = await chrome.storage.local.get(IXC_USER_CONFIG_KEY);
      await chrome.storage.local.set({
        [IXC_USER_CONFIG_KEY]: { ...(stored[IXC_USER_CONFIG_KEY] || {}), techId, techName }
      });
      sendResponse({ ok: true, operator: await getIxcOperator() });
    })().catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }
  if (message.type === "DEV_LOGOUT") { chrome.storage.local.remove(AUTH_KEY).then(() => { disconnect("logout"); sendResponse({ ok: true }); }); return true; }
  if (message.type === "DEV_SAVE_SETTINGS") {
    (async () => {
      const current = await settings();
      const baseUrl = safeBaseUrl(message.baseUrl);
      const next = {
        ...current,
        enabled: !!message.enabled,
        baseUrl,
        observeNetwork: message.observeNetwork === undefined
          ? current.observeNetwork !== false
          : message.observeNetwork !== false,
        passiveRoster: message.passiveRoster === undefined
          ? current.passiveRoster !== false
          : message.passiveRoster !== false,
        passiveMessageDeltas: message.passiveMessageDeltas === undefined
          ? current.passiveMessageDeltas !== false
          : message.passiveMessageDeltas !== false,
        passiveConversationDiscovery: message.passiveConversationDiscovery === undefined
          ? current.passiveConversationDiscovery !== false
          : message.passiveConversationDiscovery !== false,
        apiGovernor: message.apiGovernor === undefined
          ? current.apiGovernor !== false
          : message.apiGovernor !== false
      };
      await chrome.storage.local.set({ [SETTINGS_KEY]: next });
      broadcastObservationConfig(next.observeNetwork);
      if (next.enabled) await ensureSocket(); else disconnect("disabled");
      sendResponse({ ok: true });
    })().catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }
  if (message.type === "DEV_STATUS") {
    Promise.all([
      settings(),
      auth(),
      getIxcOperator(),
      loadAllOutboxes(),
      outboxStorage().getBytesInUse(null)
    ]).then(([cfg, credentials, ixcOperator, storedOutboxes, storageBytes]) => {
      const snapshotQueue = Object.keys(storedOutboxes[SYNC_OUTBOX_KEY] || {}).length;
      const closeQueue = Object.keys(storedOutboxes[CLOSE_OUTBOX_KEY] || {}).length;
      const deltaQueue = Object.keys(storedOutboxes[DELTA_OUTBOX_KEY] || {}).length;
      sendResponse({
        build: EXTENSION_BUILD,
        ...cfg,
        authenticated: !!credentials?.token,
        user: credentials?.user || null,
        connected: !!socket?.connected,
        queue: queue.length + snapshotQueue + closeQueue + deltaQueue,
        volatileQueue: queue.length,
        snapshotQueue,
        closeQueue,
        deltaQueue,
        storageBytes: Number(storageBytes || 0),
        focused,
        logs,
        ixcOperator,
        deliveryRoster: {
          blocking: deliveryRosterGuard.blocking,
          authoritative: deliveryRosterGuard.authoritative,
          activeCount: deliveryRosterGuard.activeIds.size,
          confirmedAt: deliveryRosterGuard.confirmedAt,
          source: deliveryRosterGuard.source
        },
        networkObservation: networkObservationStatus(),
        genesysApi: genesysApiStatus()
      });
    });
    return true;
  }
});
