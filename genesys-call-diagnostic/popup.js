const actionButton = document.getElementById("action");
const statusLabel = document.getElementById("status-label");
const statusDot = document.getElementById("status-dot");
const eventCount = document.getElementById("event-count");
const elapsed = document.getElementById("elapsed");
const messageBox = document.getElementById("message");
let currentTab = null;
let currentStatus = null;
let busy = false;

function formatElapsed(startedAt, endedAt = 0) {
  if (!startedAt) return "00:00";
  const total = Math.max(0, Math.floor(((endedAt || Date.now()) - startedAt) / 1000));
  const minutes = String(Math.floor(total / 60)).padStart(2, "0");
  const seconds = String(total % 60).padStart(2, "0");
  return `${minutes}:${seconds}`;
}

function validGenesysTab(tab) {
  try { return new URL(String(tab?.url || "")).hostname === "apps.sae1.pure.cloud"; }
  catch (_) { return false; }
}

function setMessage(text, error = false) {
  messageBox.textContent = text;
  messageBox.classList.toggle("error", error);
}

function render() {
  const status = currentStatus || {};
  eventCount.textContent = String(status.eventCount || 0);
  elapsed.textContent = formatElapsed(status.startedAt, status.endedAt);
  statusDot.className = "dot";
  actionButton.className = "";
  if (!currentTab || !validGenesysTab(currentTab)) {
    statusLabel.textContent = "Genesys não está aberto";
    actionButton.textContent = "Abra a aba do Genesys";
    actionButton.disabled = true;
    setMessage("Selecione uma aba em apps.sae1.pure.cloud e abra novamente esta extensão.", true);
    return;
  }
  if (status.active) {
    statusLabel.textContent = "Capturando";
    statusDot.classList.add("active");
    actionButton.textContent = busy ? "Gerando relatório…" : "Finalizar e baixar relatório";
    actionButton.classList.add("stop");
    actionButton.disabled = busy;
    setMessage("Reproduza o problema de chat ou ligação e finalize. Não feche nem atualize esta aba antes do download.");
    return;
  }
  if (status.exists) {
    statusLabel.textContent = status.expired ? "Captura expirada" : "Relatório anterior concluído";
    statusDot.classList.add("done");
    actionButton.textContent = busy ? "Iniciando…" : "Iniciar nova captura";
    actionButton.disabled = busy;
    setMessage(status.truncated
      ? "O limite seguro foi atingido; o relatório anterior sinalizou eventos descartados."
      : "Pronto para substituir a captura anterior e registrar uma nova sincronização.");
    return;
  }
  statusLabel.textContent = "Pronto";
  actionButton.textContent = busy ? "Iniciando…" : "Iniciar captura";
  actionButton.disabled = busy;
  setMessage("Clique antes do chat ou ligação entrar. A captura acompanha os eventos até você finalizar.");
}

async function refreshStatus() {
  if (!currentTab?.id) return;
  const response = await chrome.runtime.sendMessage({
    type: "CALL_DIAG_STATUS",
    tabId: currentTab.id
  });
  if (!response?.ok) throw new Error(response?.error || "status_indisponivel");
  currentStatus = response.status;
  render();
}

function downloadReport(fileName, reportJson) {
  const blob = new Blob([reportJson], { type: "application/json;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

async function handleAction() {
  if (busy || !currentTab?.id) return;
  busy = true;
  render();
  try {
    if (currentStatus?.active) {
      const response = await chrome.runtime.sendMessage({
        type: "CALL_DIAG_STOP",
        tabId: currentTab.id
      });
      if (!response?.ok || !response.reportJson) throw new Error(response?.error || "relatorio_indisponivel");
      downloadReport(response.fileName, response.reportJson);
      currentStatus = response.status;
      setMessage("Relatório baixado. Envie o arquivo JSON inteiro para análise.");
    } else {
      const response = await chrome.runtime.sendMessage({
        type: "CALL_DIAG_START",
        tabId: currentTab.id,
        tabUrl: currentTab.url
      });
      if (!response?.ok) throw new Error(response?.error || "captura_nao_iniciada");
      currentStatus = response.status;
    }
  } catch (error) {
    setMessage(`Falha: ${error.message}`, true);
  } finally {
    busy = false;
    render();
  }
}

actionButton.addEventListener("click", handleAction);

(async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  currentTab = tab || null;
  if (validGenesysTab(currentTab)) await refreshStatus();
  else render();
})().catch((error) => {
  setMessage(`Falha ao iniciar: ${error.message}`, true);
  render();
});

setInterval(() => {
  if (currentStatus?.active) refreshStatus().catch(() => {});
  else render();
}, 1000);
