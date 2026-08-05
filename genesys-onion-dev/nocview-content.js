/* global chrome */

(() => {
  if (window.__onionNocviewContentLoaded) return;
  window.__onionNocviewContentLoaded = true;
  const STORAGE_KEY = "nocview_token";
  const JWT_RE = /eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/;
  let lastSaved = "";

  function payload(token) {
    try {
      const base64 = token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
      return JSON.parse(decodeURIComponent(escape(atob(base64))));
    } catch (_) {
      return null;
    }
  }

  async function save(token) {
    if (!token || token === lastSaved) return;
    const decoded = payload(token);
    if (!decoded?.exp || Date.now() / 1000 >= Number(decoded.exp)) return;
    lastSaved = token;
    await chrome.storage.local.set({ [STORAGE_KEY]: { token, exp: Number(decoded.exp) } });
  }

  window.addEventListener("message", (event) => {
    if (event.source === window && event.data?.__onion_nocview_token) {
      void save(event.data.__onion_nocview_token);
    }
  });

  function scanStorage() {
    try {
      for (const storage of [window.localStorage, window.sessionStorage]) {
        for (let index = 0; index < storage.length; index += 1) {
          const match = String(storage.getItem(storage.key(index)) || "").match(JWT_RE);
          if (match) void save(match[0]);
        }
      }
    } catch (_) {}
  }
  scanStorage();
  window.setInterval(scanStorage, 60 * 1000); // somente storage local; não chama API
})();
