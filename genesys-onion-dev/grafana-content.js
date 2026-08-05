/* global chrome */

// Executa o fetch no mesmo domínio para reaproveitar exclusivamente a sessão do agente.
// Não possui polling: o service worker centraliza cache, deduplicação e backoff.
(() => {
  if (window.__onionGrafanaContentLoaded) return;
  window.__onionGrafanaContentLoaded = true;
  const URL = "https://grafana2.zaaz.com.br/api/datasources/2/resources/zabbix-api";
  const BODY = {
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
  let inFlight = null;

  async function fetchAlerts() {
    if (inFlight) return inFlight;
    inFlight = (async () => {
      try {
        const response = await fetch(URL, {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json", "x-grafana-org-id": "1" },
          body: JSON.stringify(BODY)
        });
        if (!response.ok) {
          return {
            ok: false,
            status: response.status,
            retryAfter: response.headers.get("retry-after") || "",
            error: `grafana_http_${response.status}`
          };
        }
        const data = await response.json();
        return { ok: true, result: data?.result || {} };
      } catch (error) {
        return { ok: false, status: 0, error: String(error?.message || error || "grafana_unavailable") };
      } finally {
        inFlight = null;
      }
    })();
    return inFlight;
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type !== "ONION_GRAFANA_FETCH") return false;
    fetchAlerts().then(sendResponse).catch((error) => sendResponse({
      ok: false,
      status: 0,
      error: String(error?.message || error || "grafana_unavailable")
    }));
    return true;
  });
})();
