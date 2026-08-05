// Roda em apps.sae1.pure.cloud (mundo isolado). Lê o token de sessão do Genesys
// (localStorage.pc_auth e variantes) e grava no storage da extensão p/ o background.
// Mesma origem, sessão do próprio agente — sem credencial embutida.
//
// IMPORTANTE: ao deslogar do Genesys o pc_auth some. A extensão DEVE apagar a
// cópia em chrome.storage.local — senão o background continua “logado” com JWT
// órfão até o exp (às vezes horas).

(() => {
  if (window.__genesysTokenLoaded) return;
  window.__genesysTokenLoaded = true;

  const KEY = "genesys_token";
  const AUTH_KEYS = ["pc_auth", "purecloud_auth", "genesys_auth", "auth"];
  let _lastHadToken = null; // null | true | false — evita spam de clear

  function pickAccessToken(obj, depth) {
    if (!obj || depth > 5) return null;
    if (typeof obj === "string" && obj.length > 20 && obj.split(".").length >= 2) {
      // parece JWT
      return obj;
    }
    if (typeof obj !== "object") return null;
    const direct =
      obj.access_token
      || obj.accessToken
      || obj.token
      || (obj.auth && (obj.auth.access_token || obj.auth.accessToken));
    if (typeof direct === "string" && direct.length > 20) return direct;

    for (const k of ["authenticated", "secure", "auth", "data", "token", "oauth", "session"]) {
      if (obj[k]) {
        const t = pickAccessToken(obj[k], depth + 1);
        if (t) return t;
      }
    }
    return null;
  }

  function pickExpiry(obj) {
    if (!obj || typeof obj !== "object") return 0;
    const a = obj.authenticated || obj.secure || obj.auth || obj;
    const raw =
      a.token_expiry_time_millis
      || a.tokenExpiryTimeMillis
      || a.expires_at
      || a.expiresAt
      || a.exp
      || 0;
    let n = Number(raw) || 0;
    // se veio em segundos (epoch ~1e9), vira ms
    if (n > 1e9 && n < 1e12) n = n * 1000;
    return n;
  }

  function readFromStorage() {
    for (const k of AUTH_KEYS) {
      try {
        const raw = localStorage.getItem(k);
        if (!raw) continue;
        let j;
        try {
          j = JSON.parse(raw);
        } catch {
          // valor puro JWT
          if (typeof raw === "string" && raw.length > 40) {
            return { token: raw, exp: 0, source: k };
          }
          continue;
        }
        const token = pickAccessToken(j, 0);
        if (token) {
          return { token, exp: pickExpiry(j), source: k };
        }
      } catch (_) {}
    }
    return null;
  }

  function saveToken(info) {
    if (!info || !info.token) return;
    chrome.storage.local.set({
      [KEY]: {
        token: info.token,
        exp: Number(info.exp) || 0,
        at: Date.now(),
        source: info.source || "pc_auth",
      },
    }).catch(() => {});
  }

  /** Genesys sem pc_auth = deslogado → remove cópia na extensão + avisa SW. */
  function clearToken(reason) {
    chrome.storage.local.remove(KEY).catch(() => {});
    try {
      chrome.runtime.sendMessage({
        type: "GENESYS_TOKEN_CLEARED",
        reason: reason || "logout",
      }).catch(() => {});
    } catch (_) {}
  }

  function readToken() {
    const info = readFromStorage();
    if (info && info.token) {
      saveToken(info);
      if (_lastHadToken !== true) {
        _lastHadToken = true;
      }
      return info;
    }
    // Sem token no Genesys: limpa cache da extensão (só 1× por transição)
    if (_lastHadToken !== false) {
      _lastHadToken = false;
      clearToken("pc_auth_ausente");
    }
    return null;
  }

  // exposição p/ background pedir refresh sob demanda
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg && msg.type === "GENESYS_TOKEN_REFRESH") {
      const info = readToken();
      sendResponse({
        ok: !!info,
        hasToken: !!(info && info.token),
        exp: info && info.exp || 0,
        source: info && info.source || null,
        cleared: !info,
      });
      return true;
    }
  });

  readToken();

  // Outra aba mudou localStorage (logout/login). Na MESMA aba o evento "storage"
  // NÃO dispara — por isso o poll abaixo é essencial.
  window.addEventListener("storage", (e) => {
    if (!e.key || AUTH_KEYS.includes(e.key)) {
      // e.newValue null = chave removida no logout
      if (e.key && e.newValue == null) {
        _lastHadToken = false;
        clearToken("storage_removed:" + e.key);
        return;
      }
      readToken();
    }
  });

  // Poll: mesma aba + Genesys às vezes limpa auth sem evento
  setInterval(readToken, 8000);

  // Logout via URL de login / redirect pós-signout
  try {
    const path = String(location.pathname || "").toLowerCase();
    const href = String(location.href || "").toLowerCase();
    if (
      /login|logout|signout|signed-out|sign-out|auth\/#?\/?login/i.test(path + href)
      && !readFromStorage()
    ) {
      clearToken("login_page");
    }
  } catch (_) {}
})();
