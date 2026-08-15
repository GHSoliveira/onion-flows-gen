import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('atualização local exige companion, autenticação e origem loopback', async () => {
  const route = await readFile(new URL('../src/routes/system.js', import.meta.url), 'utf8');
  assert.match(route, /companionMode/);
  assert.match(route, /isLoopbackRequest/);
  assert.match(route, /\/local-update'/);
  assert.match(route, /authenticate,[\s\S]*?authorize\(\['AGENT', 'ADMIN', 'MANAGER', 'SUPER_ADMIN'\]\)/);
  assert.match(route, /path\.join\(repositoryRoot, 'ATUALIZAR\.bat'\)/);
  assert.match(route, /spawn\(process\.env\.ComSpec \|\| 'cmd\.exe'/);
  assert.match(route, /\['\/d', '\/c', command\]/);
  assert.doesNotMatch(route, /\['\/d', '\/s', '\/c', command\]/);
  assert.match(route, /windowsHide: true/);
  assert.match(route, /error: state === 'failed'/);
});

test('botão atualiza, abre Onion e recarrega Onion, Genesys e a extensão', async () => {
  const [popup, popupScript, background, updater, shortcut, starter, server, ignore] = await Promise.all([
    readFile(new URL('../genesys-onion-dev/popup.html', import.meta.url), 'utf8'),
    readFile(new URL('../genesys-onion-dev/popup.js', import.meta.url), 'utf8'),
    readFile(new URL('../genesys-onion-dev/background.js', import.meta.url), 'utf8'),
    readFile(new URL('../ATUALIZAR.bat', import.meta.url), 'utf8'),
    readFile(new URL('../SINCRONIZAR-ONION.bat', import.meta.url), 'utf8'),
    readFile(new URL('../scripts/start-sandbox.ps1', import.meta.url), 'utf8'),
    readFile(new URL('../index.js', import.meta.url), 'utf8'),
    readFile(new URL('../.gitignore', import.meta.url), 'utf8'),
  ]);
  assert.match(popup, /id="update-all"/);
  assert.match(popup, /Sincronizar e reparar/);
  assert.match(popupScript, /type: "DEV_LOCAL_UPDATE"/);
  assert.match(background, /openOrFocusOnion/);
  assert.match(background, /reloadOnionAndGenesysTabs/);
  assert.match(background, /chrome\.tabs\.reload\(tab\.id, \{ bypassCache: true \}\)/);
  assert.match(background, /setTimeout\(\(\) => chrome\.runtime\.reload\(\), 1500\)/);
  assert.match(updater, /--auto/);
  assert.match(updater, /success\^\|%UPDATE_REQUEST_ID%/);
  // Mesmo sem commit novo, repara dependências, reconstrói e reinicia.
  assert.doesNotMatch(updater, /O OnionFlows ja esta atualizado\.[\s\S]{0,80}goto :sucesso/);
  assert.match(updater, /npm ls --depth=0/);
  assert.match(updater, /call "%~dp0START\.bat"/);
  assert.match(shortcut, /ATUALIZAR\.bat" --local/);
  assert.ok(
    starter.indexOf("$frontendBuild = Start-Process") < starter.indexOf("'stop-sandbox.ps1'") ,
    'o frontend deve compilar antes de encerrar o runtime atual'
  );
  // Somente o comando explícito pode recarregar abas/extensão. Divergência
  // de versão nunca dispara um ciclo automático no keepalive.
  assert.doesNotMatch(server, /extensionVersion/);
  assert.doesNotMatch(background, /reconcileInstalledExtensionVersion/);
  assert.doesNotMatch(background, /chrome\.runtime\.getManifest\(\)\?\.version/);
  assert.match(ignore, /sandbox\/update-status\.txt/);
});
