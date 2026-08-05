// Captura apenas o Bearer que a própria interface do NocView usa.
// O valor permanece no armazenamento local da extensão e nunca é enviado ao Onion.
(() => {
  if (window.__onionNocviewInjectLoaded) return;
  window.__onionNocviewInjectLoaded = true;

  const report = (token) => {
    if (token && token.length >= 20) window.postMessage({ __onion_nocview_token: token }, "*");
  };
  const bearer = (value) => {
    const match = String(value || "").match(/Bearer\s+([A-Za-z0-9._-]+)/i);
    if (match) return match[1];
    const jwt = String(value || "").match(/^eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
    return jwt ? jwt[0] : null;
  };
  const authorizationFrom = (headers) => {
    try {
      if (!headers) return null;
      if (headers instanceof Headers) return headers.get("authorization");
      if (Array.isArray(headers)) {
        return headers.find(([key]) => String(key).toLowerCase() === "authorization")?.[1] || null;
      }
      for (const key in headers) if (key.toLowerCase() === "authorization") return headers[key];
    } catch (_) {}
    return null;
  };

  const originalFetch = window.fetch;
  if (originalFetch) {
    window.fetch = function (input, init) {
      try {
        let auth = authorizationFrom(init?.headers);
        if (!auth && input instanceof Request) auth = input.headers.get("authorization");
        report(bearer(auth));
      } catch (_) {}
      return originalFetch.apply(this, arguments);
    };
  }

  const originalSetRequestHeader = XMLHttpRequest.prototype.setRequestHeader;
  XMLHttpRequest.prototype.setRequestHeader = function (key, value) {
    try {
      if (String(key).toLowerCase() === "authorization") report(bearer(value));
    } catch (_) {}
    return originalSetRequestHeader.apply(this, arguments);
  };
})();
