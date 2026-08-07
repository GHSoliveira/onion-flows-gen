const $ = (id) => document.getElementById(id);
const enabled = $("enabled");
const observeNetwork = $("observe-network");
const passiveRoster = $("passive-roster");
const passiveDeltas = $("passive-deltas");
const passiveDiscovery = $("passive-discovery");
const apiGovernor = $("api-governor");
const baseUrl = $("base-url");
const loginArea = $("login-area");
const session = $("session");
const bootLoader = $("boot-loader");
const bootStartedAt = Date.now();
let saving = false;
let bootDismissScheduled = false;

function dismissBootLoader() {
  if (bootDismissScheduled) return;
  bootDismissScheduled = true;
  const delay = Math.max(0, 650 - (Date.now() - bootStartedAt));
  window.setTimeout(() => bootLoader?.classList.add("is-hidden"), delay);
}

$("advanced-toggle").addEventListener("click", () => {
  const panel = $("advanced-settings");
  const open = panel.hidden;
  panel.hidden = !open;
  $("advanced-toggle").classList.toggle("active", open);
  $("advanced-toggle").setAttribute("aria-expanded", String(open));
  $("advanced-toggle").setAttribute(
    "aria-label",
    open ? "Fechar configurações técnicas" : "Abrir configurações técnicas"
  );
});

async function send(message) { return chrome.runtime.sendMessage(message); }
function renderLogs(logs = []) {
  $("logs").replaceChildren(...logs.map((item) => {
    const row = document.createElement("div"); row.className = `log ${item.level}`;
    row.textContent = `${new Date(item.at).toLocaleTimeString("pt-BR")} · ${item.message}`;
    if (item.detail) { const small = document.createElement("small"); small.textContent = item.detail; row.appendChild(small); }
    return row;
  }));
}
async function refresh() {
  if (saving) return;
  try {
    const state = await send({ type: "DEV_STATUS" });
    enabled.checked = !!state.enabled;
    observeNetwork.checked = state.observeNetwork !== false;
    passiveRoster.checked = state.passiveRoster !== false;
    passiveDeltas.checked = state.passiveMessageDeltas !== false;
    passiveDiscovery.checked = state.passiveConversationDiscovery !== false;
    apiGovernor.checked = state.apiGovernor !== false;
    baseUrl.value = state.baseUrl || "http://127.0.0.1:3101";
    loginArea.hidden = !!state.authenticated; session.hidden = !state.authenticated;
    $("user").textContent = `Login: ${state.user?.name || state.user?.username || "autenticado"}`;
    $("dot").className = state.connected ? "on" : "";
    const buildLabel = state.build ? ` · build ${state.build}` : "";
    $("status").textContent = state.connected
      ? `Conectado · fila ${state.queue}${buildLabel}`
      : state.enabled
        ? `Desconectado / reconectando${buildLabel}`
        : `Espelhamento desativado${buildLabel}`;
    $("focus").textContent = state.focused?.conversationId ? `${state.focused.name} · ${state.focused.conversationId.slice(0, 8)}` : "Nenhuma conversa validada";
    const observation = state.networkObservation || {};
    const genesysApi = state.genesysApi || {};
    const governorDetail = genesysApi.queued
      ? ` · API fila ${genesysApi.queued}`
      : genesysApi.backoffUntil > Date.now()
        ? " · API em espera"
        : "";
    const storageDetail = Number.isFinite(Number(state.storageBytes))
      ? ` · storage ${(Number(state.storageBytes) / (1024 * 1024)).toFixed(1)} MB`
      : "";
    $("network-observation").textContent = observation.installed
      ? `Observador passivo · ${observation.responses || 0} respostas · WS ${observation.notificationFrames || 0}/${observation.notificationTargetedSyncs || 0} · ${observation.trackedConversations || 0} vistas · ${observation.passiveConversationsCreated || 0} clientes · ${observation.passiveMessagesApplied || 0} deltas · API ${genesysApi.callsLastMinute || 0}/30${governorDetail}${storageDetail}`
      : "Observador passivo ainda não detectado";
    $("operator-name").textContent = state.ixcOperator?.techName || "Não configurado";
    $("operator-id").textContent = state.ixcOperator?.techId ? `#${state.ixcOperator.techId}` : "—";
    renderLogs(state.logs);
  } catch (error) {
    $("dot").className = "";
    $("status").textContent = "Companion indisponível";
    $("focus").textContent = error?.message || "Não foi possível consultar o serviço da extensão";
  } finally {
    dismissBootLoader();
  }
}
enabled.addEventListener("change", async () => { saving = true; try { const result = await send({ type: "DEV_SAVE_SETTINGS", enabled: enabled.checked, baseUrl: baseUrl.value }); if (!result?.ok) alert(result?.error || "Falha ao salvar"); } finally { saving = false; await refresh(); } });
observeNetwork.addEventListener("change", async () => { saving = true; try { const result = await send({ type: "DEV_SAVE_SETTINGS", enabled: enabled.checked, baseUrl: baseUrl.value, observeNetwork: observeNetwork.checked }); if (!result?.ok) alert(result?.error || "Falha ao salvar observação"); } finally { saving = false; await refresh(); } });
passiveRoster.addEventListener("change", async () => { saving = true; try { await send({ type: "DEV_SAVE_SETTINGS", enabled: enabled.checked, baseUrl: baseUrl.value, passiveRoster: passiveRoster.checked }); } finally { saving = false; await refresh(); } });
passiveDeltas.addEventListener("change", async () => { saving = true; try { await send({ type: "DEV_SAVE_SETTINGS", enabled: enabled.checked, baseUrl: baseUrl.value, passiveMessageDeltas: passiveDeltas.checked }); } finally { saving = false; await refresh(); } });
passiveDiscovery.addEventListener("change", async () => { saving = true; try { await send({ type: "DEV_SAVE_SETTINGS", enabled: enabled.checked, baseUrl: baseUrl.value, passiveConversationDiscovery: passiveDiscovery.checked }); } finally { saving = false; await refresh(); } });
apiGovernor.addEventListener("change", async () => { saving = true; try { await send({ type: "DEV_SAVE_SETTINGS", enabled: enabled.checked, baseUrl: baseUrl.value, apiGovernor: apiGovernor.checked }); } finally { saving = false; await refresh(); } });
baseUrl.addEventListener("change", async () => { saving = true; try { const result = await send({ type: "DEV_SAVE_SETTINGS", enabled: enabled.checked, baseUrl: baseUrl.value }); if (!result?.ok) alert(result?.error || "Servidor inválido"); } finally { saving = false; await refresh(); } });
$("login").addEventListener("click", async () => {
  const button = $("login");
  button.disabled = true;
  button.textContent = "Conectando…";
  try {
    const result = await send({ type: "DEV_LOGIN", username: $("username").value, password: $("password").value, baseUrl: baseUrl.value });
    if (!result?.ok) alert(result?.error || "Falha no login");
    $("password").value = "";
    await refresh();
  } finally {
    button.disabled = false;
    button.textContent = "Entrar no Onion";
  }
});
$("logout").addEventListener("click", async () => { await send({ type: "DEV_LOGOUT" }); refresh(); });
async function selectIxcOperator(operator) {
  const result = await send({ type: "IXC_OPERATOR_SELECT", techId: operator.id, techName: operator.name });
  if (!result?.ok) {
    $("operator-search-status").textContent = result?.error || "Falha ao salvar colaborador";
    return;
  }
  $("operator-results").replaceChildren();
  $("operator-search-status").textContent = `Salvo: ${operator.name}`;
  await refresh();
}
async function searchIxcOperator() {
  const term = $("operator-search").value.trim();
  if (term.length < 3) {
    $("operator-search-status").textContent = "Digite ao menos 3 letras.";
    return;
  }
  $("operator-search-status").textContent = "Buscando no IXC...";
  $("operator-results").replaceChildren();
  const result = await send({ type: "IXC_OPERATOR_SEARCH", term });
  if (!result?.ok) {
    $("operator-search-status").textContent = result?.error || "Falha na busca";
    return;
  }
  const matches = Array.isArray(result.matches) ? result.matches : [];
  $("operator-search-status").textContent = matches.length
    ? `${matches.length} encontrado(s). Selecione seu nome:`
    : "Nenhum colaborador ativo encontrado.";
  $("operator-results").replaceChildren(...matches.slice(0, 20).map((operator) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "operator-result";
    button.textContent = `${operator.name} (#${operator.id})`;
    button.addEventListener("click", () => selectIxcOperator(operator));
    return button;
  }));
}
$("operator-search-btn").addEventListener("click", searchIxcOperator);
$("operator-search").addEventListener("keydown", (event) => {
  if (event.key === "Enter") searchIxcOperator();
});
refresh(); setInterval(refresh, 1500);
