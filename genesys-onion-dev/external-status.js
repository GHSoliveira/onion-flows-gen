/* global chrome */

// Integração global de problemas externos.
// Tokens/cookies ficam somente na extensão; o Onion recebe apenas os resultados do cruzamento.
(() => {
  const NOCVIEW_URL = "https://nocview.zaaz.com.br/registro-os/em-andamento";
  const GRAFANA_URL = "https://grafana2.zaaz.com.br/api/datasources/2/resources/zabbix-api";
  const NOCVIEW_TOKEN_KEY = "nocview_token";
  const GRAFANA_CACHE_KEY = "onion_grafana_alerts_cache";
  const RATE_STATE_KEY = "onion_external_status_rate_state";
  const CACHE_TTL_MS = 2 * 60 * 1000;
  const MIN_ATTEMPT_INTERVAL_MS = 30 * 1000;
  const BASE_BACKOFF_MS = 60 * 1000;
  const MAX_BACKOFF_MS = 15 * 60 * 1000;
  const REQUEST_TIMEOUT_MS = 12000;

  const GRAFANA_BODY = {
    datasourceId: 2,
    method: "trigger.get",
    params: {
      output: "extend",
      selectHosts: ["host", "name"],
      selectItems: ["key_", "name", "lastvalue"],
      filter: { value: 1 },
      monitored: true,
      expandDescription: true
    }
  };

  const state = {
    loaded: false,
    nocview: { data: null, at: 0, lastAttemptAt: 0, backoffUntil: 0, failures: 0, error: "", source: "api" },
    grafana: { data: null, at: 0, lastAttemptAt: 0, backoffUntil: 0, failures: 0, error: "", source: "tab" }
  };
  let nocviewInFlight = null;
  let grafanaInFlight = null;

  const now = () => Date.now();
  const asArray = (value) => Array.isArray(value) ? value : null;
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  async function withTimeout(promise, timeoutMs = REQUEST_TIMEOUT_MS) {
    let timer;
    try {
      return await Promise.race([
        promise,
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error("external_status_timeout")), timeoutMs);
        })
      ]);
    } finally {
      clearTimeout(timer);
    }
  }

  function parseRetryAfter(value) {
    const raw = String(value || "").trim();
    if (!raw) return 0;
    const seconds = Number(raw);
    if (Number.isFinite(seconds) && seconds >= 0) return Math.ceil(seconds * 1000);
    const date = new Date(raw).getTime();
    return Number.isFinite(date) ? Math.max(0, date - now()) : 0;
  }

  function backoffMs(failures, retryAfter) {
    if (retryAfter > 0) return Math.min(MAX_BACKOFF_MS, Math.max(BASE_BACKOFF_MS, retryAfter));
    return Math.min(MAX_BACKOFF_MS, BASE_BACKOFF_MS * (2 ** Math.max(0, failures - 1)));
  }

  async function loadState() {
    if (state.loaded) return;
    state.loaded = true;
    try {
      const stored = await chrome.storage.local.get([RATE_STATE_KEY, GRAFANA_CACHE_KEY]);
      const rate = stored[RATE_STATE_KEY] || {};
      for (const source of ["nocview", "grafana"]) {
        const incoming = rate[source] || {};
        state[source].lastAttemptAt = Number(incoming.lastAttemptAt || 0);
        state[source].backoffUntil = Number(incoming.backoffUntil || 0);
        state[source].failures = Number(incoming.failures || 0);
        state[source].error = String(incoming.error || "");
      }
      const grafanaCache = stored[GRAFANA_CACHE_KEY];
      if (grafanaCache && Array.isArray(grafanaCache.data)) {
        state.grafana.data = grafanaCache.data;
        state.grafana.at = Number(grafanaCache.at || 0);
        state.grafana.source = String(grafanaCache.source || "tab");
      }
    } catch (_) {
      // Cache é auxiliar; falha de storage não interrompe o atendimento.
    }
  }

  async function persistRateState() {
    try {
      await chrome.storage.local.set({
        [RATE_STATE_KEY]: {
          nocview: {
            lastAttemptAt: state.nocview.lastAttemptAt,
            backoffUntil: state.nocview.backoffUntil,
            failures: state.nocview.failures,
            error: state.nocview.error
          },
          grafana: {
            lastAttemptAt: state.grafana.lastAttemptAt,
            backoffUntil: state.grafana.backoffUntil,
            failures: state.grafana.failures,
            error: state.grafana.error
          }
        }
      });
    } catch (_) {}
  }

  function sourceResult(source, { throttled = false } = {}) {
    const current = state[source];
    const data = asArray(current.data);
    const ageMs = current.at ? Math.max(0, now() - current.at) : null;
    return {
      data,
      meta: {
        available: Boolean(data),
        status: throttled
          ? "rate_limited"
          : (data ? (ageMs <= CACHE_TTL_MS ? "ok" : "stale") : (current.error || "unavailable")),
        count: data ? data.length : 0,
        checkedAt: current.at ? new Date(current.at).toISOString() : null,
        cached: Boolean(data),
        stale: Boolean(data && ageMs > CACHE_TTL_MS),
        retryAt: current.backoffUntil > now() ? new Date(current.backoffUntil).toISOString() : null,
        source: current.source,
        error: current.error || null
      }
    };
  }

  function mayAttempt(source, force) {
    const current = state[source];
    const timestamp = now();
    // O clique manual pode confirmar uma sessão renovada após F5/login.
    // Um 429 real continua bloqueado e nunca é furado pelo botão.
    const manualAuthRetry = force === true && current.error === "not_authenticated";
    if (current.backoffUntil > timestamp && !manualAuthRetry) return { ok: false, throttled: true };
    if (timestamp - current.lastAttemptAt < MIN_ATTEMPT_INTERVAL_MS && !manualAuthRetry) {
      return { ok: false, throttled: force };
    }
    if (!force && Array.isArray(current.data) && timestamp - current.at <= CACHE_TTL_MS) {
      return { ok: false, throttled: false };
    }
    if (manualAuthRetry) {
      current.backoffUntil = 0;
      current.lastAttemptAt = 0;
      void persistRateState();
    }
    return { ok: true, throttled: false };
  }

  function markAttempt(source) {
    state[source].lastAttemptAt = now();
    void persistRateState();
  }

  function markSuccess(source, data, sourceName) {
    const current = state[source];
    current.data = data;
    current.at = now();
    current.failures = 0;
    current.backoffUntil = 0;
    current.error = "";
    current.source = sourceName || current.source;
    void persistRateState();
  }

  function markFailure(source, { status = 0, retryAfter = 0, error = "" } = {}) {
    const current = state[source];
    current.failures += 1;
    current.error = status === 401 || status === 403
      ? "not_authenticated"
      : (status === 429 ? "rate_limited" : (error || (status ? `http_${status}` : "unavailable")));
    if (status === 429 || status >= 500 || !status) {
      current.backoffUntil = now() + backoffMs(current.failures, retryAfter);
    } else if (status === 401 || status === 403) {
      current.backoffUntil = now() + BASE_BACKOFF_MS;
    }
    void persistRateState();
  }

  async function getNocviewToken() {
    try {
      const stored = await chrome.storage.local.get(NOCVIEW_TOKEN_KEY);
      const record = stored[NOCVIEW_TOKEN_KEY];
      if (!record?.token) return null;
      if (record.exp && now() / 1000 >= Number(record.exp) - 30) return null;
      return String(record.token);
    } catch (_) {
      return null;
    }
  }

  async function fetchNocview({ force = false } = {}) {
    await loadState();
    const permission = mayAttempt("nocview", force);
    if (!permission.ok) return sourceResult("nocview", permission);
    if (nocviewInFlight) return nocviewInFlight;

    nocviewInFlight = (async () => {
      markAttempt("nocview");
      try {
        const token = await getNocviewToken();
        const headers = { Accept: "application/json" };
        if (token) headers.Authorization = `Bearer ${token}`;
        const response = await withTimeout(fetch(NOCVIEW_URL, {
          method: "GET",
          credentials: "include",
          headers
        }));
        if (!response.ok) {
          markFailure("nocview", {
            status: response.status,
            retryAfter: parseRetryAfter(response.headers.get("retry-after"))
          });
          return sourceResult("nocview", { throttled: response.status === 429 });
        }
        const data = await response.json();
        if (!Array.isArray(data)) {
          markFailure("nocview", { error: "invalid_response" });
          return sourceResult("nocview");
        }
        markSuccess("nocview", data, "api");
        return sourceResult("nocview");
      } catch (error) {
        markFailure("nocview", { error: String(error?.message || error || "unavailable") });
        return sourceResult("nocview");
      } finally {
        nocviewInFlight = null;
      }
    })();
    return nocviewInFlight;
  }

  function parseGrafanaTriggers(result) {
    const output = [];
    const triggers = result && typeof result === "object" ? Object.values(result) : [];
    for (const trigger of triggers) {
      if (!trigger || String(trigger.value) !== "1" || String(trigger.state) !== "0") continue;
      const host = trigger.hosts?.[0]?.host;
      const description = String(trigger.description || "");
      if (!host || !/queda massiva/i.test(description)) continue;
      let pon = null;
      for (const item of (trigger.items || [])) {
        const match = String(item?.key_ || "").match(/\[(\d+)\.(\d+)\]/);
        if (match) { pon = `${match[1]}/${match[2]}`; break; }
      }
      if (!pon) {
        const match = String(trigger.comments || "").match(/SLOT\/PON\s*:\s*(\d+)\s*\/\s*(\d+)/i);
        if (match) pon = `${match[1]}/${match[2]}`;
      }
      if (!pon) {
        const match = description.match(/GPON\s+\d+\/(\d+)\/(\d+)/i) || description.match(/PON\s+(\d+)\/(\d+)/i);
        if (match) pon = `${match[1]}/${match[2]}`;
      }
      const percentMatch = String(trigger.opdata || "").match(/\((\d+)\s*%\)/)
        || description.match(/(\d+(?:\.\d+)?)\s*%/);
      output.push({
        triggerId: String(trigger.triggerid || ""),
        olt: String(host),
        pon,
        description,
        percent: percentMatch ? percentMatch[1] : null,
        lastchange: trigger.lastchange ? Number(trigger.lastchange) * 1000 : null
      });
    }
    return output;
  }

  async function requestGrafanaTab() {
    const tabs = await chrome.tabs.query({ url: "https://grafana2.zaaz.com.br/*" });
    if (!tabs.length) return { ok: false, status: 0, error: "grafana_tab_not_open" };
    for (const tab of tabs) {
      if (!tab?.id) continue;
      try {
        const response = await withTimeout(chrome.tabs.sendMessage(tab.id, { type: "ONION_GRAFANA_FETCH" }));
        if (response?.ok) return { ...response, source: "tab" };
        if (response?.status === 429) return response;
      } catch (_) {
        // Tenta outra aba antes do fallback do service worker.
      }
    }
    return { ok: false, status: 0, error: "grafana_tab_unavailable" };
  }

  async function requestGrafanaBackground() {
    try {
      const response = await withTimeout(fetch(GRAFANA_URL, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json", "x-grafana-org-id": "1" },
        body: JSON.stringify(GRAFANA_BODY)
      }));
      if (!response.ok) {
        return {
          ok: false,
          status: response.status,
          retryAfter: response.headers.get("retry-after") || "",
          error: `grafana_http_${response.status}`
        };
      }
      const data = await response.json();
      return { ok: true, result: data?.result || {}, source: "background" };
    } catch (error) {
      return { ok: false, status: 0, error: String(error?.message || error || "grafana_unavailable") };
    }
  }

  async function fetchGrafana({ force = false } = {}) {
    await loadState();
    const permission = mayAttempt("grafana", force);
    if (!permission.ok) return sourceResult("grafana", permission);
    if (grafanaInFlight) return grafanaInFlight;

    grafanaInFlight = (async () => {
      markAttempt("grafana");
      try {
        let response = await requestGrafanaTab();
        if (!response.ok && response.status !== 429) response = await requestGrafanaBackground();
        if (!response.ok) {
          markFailure("grafana", {
            status: Number(response.status || 0),
            retryAfter: parseRetryAfter(response.retryAfter),
            error: response.error
          });
          return sourceResult("grafana", { throttled: Number(response.status) === 429 });
        }
        const alerts = parseGrafanaTriggers(response.result);
        markSuccess("grafana", alerts, response.source || "tab");
        try {
          await chrome.storage.local.set({
            [GRAFANA_CACHE_KEY]: { at: state.grafana.at, data: alerts, source: state.grafana.source }
          });
        } catch (_) {}
        return sourceResult("grafana");
      } finally {
        grafanaInFlight = null;
      }
    })();
    return grafanaInFlight;
  }

  function parseBRDateTime(value) {
    const match = String(value || "").trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?)?/);
    if (!match) return null;
    const date = new Date(Number(match[3]), Number(match[2]) - 1, Number(match[1]), Number(match[4] || 0), Number(match[5] || 0), Number(match[6] || 0));
    return Number.isNaN(date.getTime()) ? null : date;
  }

  const normalizeOlt = (value) => String(value || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  const sameNetworkHost = (left, right) => {
    const normalizedLeft = normalizeOlt(left);
    const normalizedRight = normalizeOlt(right);
    return Boolean(normalizedLeft && normalizedRight && normalizedLeft === normalizedRight);
  };
  const clientPon = (login) => String(login?.ponId || login?.diagnostic?.ponId || "").trim().replace(/\s+/g, "");
  const parsePorts = (value) => String(value || "").split(/[,;]+/).map((part) => part.trim().replace(/\s+/g, "")).filter(Boolean);

  function comparePon(clientValue, affectedValue) {
    const client = String(clientValue || "").split("/").filter(Boolean);
    const affected = String(affectedValue || "").split("/").filter(Boolean);
    if (!client.length || !affected.length) return null;
    if (client.slice(-affected.length).join("/") === affected.join("/")) return "inside";
    if (client.length >= 2 && affected.length >= 2
      && client[client.length - 2] === affected[affected.length - 2]
      && client[client.length - 1] !== affected[affected.length - 1]) return "chassis";
    return null;
  }

  function cityMatches(clientCity, affectedCities) {
    const city = String(clientCity || "").toUpperCase().trim();
    if (!city || !affectedCities) return false;
    return String(affectedCities).toUpperCase().split(/[,;/\n]+/).map((part) => part.trim())
      .some((part) => part && (part.includes(city) || city.includes(part)));
  }

  function radioPopMatches(popValue, hostValue) {
    return sameNetworkHost(popValue, hostValue);
  }

  function matchNocview(login, orders) {
    if (!Array.isArray(orders) || !orders.length) return null;
    const oltName = normalizeOlt(login?.oltName);
    const pon = clientPon(login);
    const city = String(login?.city || login?.cidade || "").trim();
    const outageAt = !login?.online && login?.lastAccess ? parseBRDateTime(login.lastAccess) : null;
    const rank = { inside: 2, olt: 1 };
    let best = null;

    for (const order of orders) {
      const startedAt = order?.inicio_evento ? new Date(order.inicio_evento) : null;
      const withinMargin = outageAt && startedAt && !Number.isNaN(startedAt.getTime())
        ? Math.abs(outageAt.getTime() - startedAt.getTime()) <= 30 * 60 * 1000
        : null;
      let candidate = null;
      if (order?.host_radio && !order?.host_gpon) {
        const pop = String(login?.oltName || "").trim();
        if (!radioPopMatches(pop, order.host_radio)) continue;
        const cityMatch = cityMatches(city, order.cidades_afetadas);
        const level = withinMargin === true || cityMatch ? "inside" : "olt";
        candidate = {
          level,
          osId: order.id || null,
          type: order.tipo || null,
          problem: order.problema || null,
          hostRadio: order.host_radio,
          pop,
          timeMatch: withinMargin,
          cityMatch,
          startedAt: order.inicio_evento || null,
          outageAt: outageAt ? outageAt.toISOString() : null,
          owner: order.responsavel || null,
          forecast: order.previsao || null,
          affectedClients: order.clientes_afetados || null
        };
      } else {
        const host = normalizeOlt(order?.host_gpon);
        if (!host || !oltName || host !== oltName) continue;
        let ponHit = false;
        let sameChassis = false;
        for (const affectedPon of parsePorts(order.portas_afetadas)) {
          const relation = comparePon(pon, affectedPon);
          if (relation === "inside") { ponHit = true; break; }
          if (relation === "chassis") sameChassis = true;
        }
        candidate = {
          level: ponHit ? "inside" : "olt",
          osId: order.id || null,
          type: order.tipo || null,
          problem: order.problema || null,
          hostGpon: order.host_gpon,
          affectedPorts: order.portas_afetadas || null,
          clientPon: pon || null,
          sameChassis,
          startedAt: order.inicio_evento || null,
          outageAt: outageAt ? outageAt.toISOString() : null,
          timeMatch: withinMargin,
          owner: order.responsavel || null,
          forecast: order.previsao || null,
          affectedClients: order.clientes_afetados || null
        };
      }
      if (candidate && (!best || rank[candidate.level] > rank[best.level])) best = candidate;
    }
    return best;
  }

  function matchGrafana(login, alerts) {
    if (!Array.isArray(alerts) || !alerts.length) return null;
    const oltName = normalizeOlt(login?.oltName);
    if (!oltName) return null;
    const pon = clientPon(login);
    const rank = { inside: 2, olt: 1 };
    let best = null;
    for (const alert of alerts) {
      const host = normalizeOlt(alert?.olt);
      if (!host || host !== oltName) continue;
      const relation = comparePon(pon, alert.pon);
      const candidate = {
        level: relation === "inside" ? "inside" : "olt",
        triggerId: alert.triggerId || null,
        olt: alert.olt,
        pon: alert.pon || null,
        clientPon: pon || null,
        sameChassis: relation === "chassis",
        percent: alert.percent || null,
        description: alert.description || null,
        lastChange: alert.lastchange || null
      };
      if (!best || rank[candidate.level] > rank[best.level]) best = candidate;
    }
    return best;
  }

  async function enrichLogins(logins, { force = false } = {}) {
    const safeLogins = Array.isArray(logins) ? logins : [];
    const [nocview, grafana] = await Promise.all([
      fetchNocview({ force }),
      fetchGrafana({ force })
    ]);
    return {
      logins: safeLogins.map((login) => ({
        ...login,
        massiva: nocview.meta.available ? matchNocview(login, nocview.data) : null,
        nocviewChecked: nocview.meta.available,
        grafana: grafana.meta.available ? matchGrafana(login, grafana.data) : null,
        grafanaChecked: grafana.meta.available
      })),
      externalStatus: {
        checkedAt: new Date().toISOString(),
        nocview: nocview.meta,
        grafana: grafana.meta
      }
    };
  }

  self.OnionExternalStatus = Object.freeze({
    enrichLogins,
    fetchNocview,
    fetchGrafana,
    parseGrafanaTriggers,
    matchNocview,
    matchGrafana,
    sameNetworkHost,
    constants: Object.freeze({ CACHE_TTL_MS, MIN_ATTEMPT_INTERVAL_MS, MAX_BACKOFF_MS })
  });
})();
