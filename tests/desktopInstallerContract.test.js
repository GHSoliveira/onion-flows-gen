import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('instalador Windows prepara requisitos e clona com seguranca no Desktop', async () => {
  const installer = await readFile(new URL('../INSTALAR-ONION-DESKTOP.bat', import.meta.url), 'utf8');

  assert.match(installer, /--check/);
  assert.match(installer, /\[Environment\]::GetFolderPath\('Desktop'\)/);
  assert.match(installer, /winget install --id Git\.Git --exact/);
  assert.match(installer, /winget install --id OpenJS\.NodeJS\.LTS --exact/);
  assert.match(installer, /https:\/\/github\.com\/GHSoliveira\/onion-flows-gen\.git/);
  assert.match(installer, /git clone --branch main --single-branch/);
  assert.match(installer, /if exist "%TARGET_DIR%"/);
  assert.match(installer, /Nenhum arquivo existente foi alterado/);
  assert.match(installer, /call npm ci --no-audit --no-fund/);
  assert.match(installer, /call npm -v/);
  assert.match(installer, /pushd "client"/);
  assert.match(installer, /scripts\\ensure-sandbox-env\.ps1/);
  assert.match(installer, /scripts\\start-sandbox\.ps1/);
  assert.match(installer, /scripts\\open-browser-extension-setup\.ps1/);
  assert.doesNotMatch(installer, /(?:rmdir|rd|del)\s+\/s/i);
});

test('preparador abre o navegador ativo sem tentar automatizar a interface protegida', async () => {
  const helper = await readFile(new URL('../scripts/open-browser-extension-setup.ps1', import.meta.url), 'utf8');

  assert.match(helper, /genesys-onion-dev/);
  assert.match(helper, /Set-Clipboard -Value \$extensionPath/);
  assert.match(helper, /Get-Process -Name \$definition\.Process/);
  assert.match(helper, /brave:\/\/extensions\//);
  assert.match(helper, /chrome:\/\/extensions\//);
  assert.match(helper, /edge:\/\/extensions\//);
  assert.match(helper, /http:\/\/127\.0\.0\.1:3101/);
  assert.doesNotMatch(helper, /SendKeys|Stop-Process|taskkill/i);
});
