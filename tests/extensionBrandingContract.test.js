import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const load = (relativePath) => readFile(new URL(relativePath, import.meta.url), 'utf8');

test('extensao usa identidade Onion Companion e assets oficiais', async () => {
  const manifest = JSON.parse(await load('../genesys-onion-dev/manifest.json'));
  const popup = await load('../genesys-onion-dev/popup.html');
  const css = await load('../genesys-onion-dev/popup.css');

  assert.equal(manifest.name, 'Onion Companion');
  assert.equal(manifest.action.default_title, 'Onion Companion');
  assert.equal(manifest.version, '0.1.25');
  assert.equal(manifest.icons['128'], 'assets/onion-favicon.png');
  assert.match(popup, /assets\/onion-logo\.png/);
  assert.match(popup, /id="boot-loader"/);
  assert.match(css, /--accent:\s*#2563eb/);
  assert.match(css, /onion-petal-major\.png/);
});

test('loader do popup encerra mesmo quando o status falha', async () => {
  const popupJs = await load('../genesys-onion-dev/popup.js');
  assert.match(popupJs, /function dismissBootLoader\(\)/);
  assert.match(popupJs, /finally\s*\{\s*dismissBootLoader\(\)/);
  assert.match(popupJs, /button\.textContent = "Conectando…"/);
});
