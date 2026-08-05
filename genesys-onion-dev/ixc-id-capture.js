(() => {
  if (window.__onionIxcIdCaptureLoaded) return;
  window.__onionIxcIdCaptureLoaded = true;

  const CONFIG_KEY = "ixcUserConfig";
  const GRID_URL = "https://sistema.zaaztelecom.com.br/aplicativo/funcionarios/action/action.php?action=grid&relation=false&advanced_search=false";
  const STOP_WORDS = new Set(["de", "da", "do", "das", "dos", "e"]);
  let done = false;
  let capturing = false;

  function findUserId() {
    const counts = {};
    try {
      for (let index = 0; index < localStorage.length; index += 1) {
        const key = localStorage.key(index) || "";
        const match = key.match(/^service:(\d+):/) || key.match(/_user_(\d+)\b/) || key.match(/user_(\d+)$/);
        if (match) counts[match[1]] = (counts[match[1]] || 0) + 1;
      }
    } catch {}
    return Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0] || null;
  }

  function findAgentName() {
    const domName = String(document.querySelector(".menu-user-name span")?.textContent || "").trim();
    if (domName) return domName;
    try {
      for (let index = 0; index < localStorage.length; index += 1) {
        const value = localStorage.getItem(localStorage.key(index)) || "";
        const email = value.match(/[a-z0-9._%+-]+@zaaztelecom\.com\.br/i)?.[0];
        if (email) return email.split("@")[0].split(/[._-]+/).join(" ");
      }
    } catch {}
    return "";
  }

  function nameTokens(name) {
    return String(name || "").toLowerCase().split(/\s+/)
      .filter((token) => token.length > 2 && !STOP_WORDS.has(token));
  }

  async function findUniqueActiveTech(tokens) {
    const gridParam = {};
    tokens.forEach((token, index) => {
      gridParam[String(index)] = {
        TB: "funcionarios.funcionario", display: "Colaborador",
        OP: "L", P: token.toUpperCase(), C: "AND", G: "_funcionarios.funcionario"
      };
    });
    const response = await fetch(GRID_URL, {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        action: "grid", relation: "false", advanced_search: "false",
        page: "1", rp: "50", sortname: "funcionarios.funcionario", sortorder: "asc",
        query: "", qtype: "funcionarios.funcionario", oper: "L",
        grid_param: JSON.stringify(gridParam), grid_param2: "false", display: "Colaborador"
      }).toString()
    });
    if (!response.ok) return null;
    const data = await response.json();
    const matches = (Array.isArray(data?.rows) ? data.rows : []).filter((row) => {
      const name = String(row?.cell?.[1] || "").toLowerCase();
      const active = /^sim$/i.test(String(row?.cell?.[2] || "").trim());
      return active && tokens.every((token) => name.includes(token));
    });
    return matches.length === 1
      ? { id: String(matches[0].id), name: String(matches[0]?.cell?.[1] || "") }
      : null;
  }

  async function capture() {
    if (capturing || done) return;
    capturing = true;
    try {
      const tokens = nameTokens(findAgentName());
      const stored = await chrome.storage.local.get(CONFIG_KEY);
      const config = stored[CONFIG_KEY] || {};
      const userId = findUserId();
      let changed = false;
      if (userId && config.userId !== userId) {
        config.userId = userId;
        changed = true;
      }
      const currentMatches = config.techId && config.techName && tokens.length
        && tokens.every((token) => String(config.techName).toLowerCase().includes(token));
      if (currentMatches) done = true;
      if (!currentMatches && tokens.length) {
        const tech = await findUniqueActiveTech(tokens);
        if (tech) {
          config.techId = tech.id;
          config.techName = tech.name;
          changed = true;
          done = true;
        }
      }
      if (changed) await chrome.storage.local.set({ [CONFIG_KEY]: config });
    } catch {} finally {
      capturing = false;
    }
  }

  capture();
  const observer = new MutationObserver(() => {
    if (done) {
      observer.disconnect();
    } else if (document.querySelector(".menu-user-name span")) {
      capture();
    }
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });
})();
