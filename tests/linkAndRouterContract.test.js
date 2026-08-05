import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const load = (relativePath) => readFile(new URL(relativePath, import.meta.url), 'utf8');

test('link textual permanece texto e nao entra no handler de documento', async () => {
  const security = await load('../src/services/chatSecurity.js');
  const content = await load('../client/src/components/ChatMessageContent.jsx');
  assert.match(security, /\(tokenMediaType \? extractFirstMediaUrl\(text\) : ''\)/);
  assert.doesNotMatch(security, /\|\| extractFirstMediaUrl\(text\)/);
  assert.match(content, /\(tokenType \? extractFirstUrl\(textValue\) : ''\)/);
  assert.doesNotMatch(content, /\|\| message\?\.url/);
  assert.doesNotMatch(content, /\|\| message\?\.meta\?\.url/);
});

test('teste do roteador inclui a porta 8080', async () => {
  const routes = await load('../src/routes/chats.js');
  assert.match(routes, /ROUTER_WEB_PORTS\s*=\s*\[[^\]]*8080[^\]]*\]/);
});
