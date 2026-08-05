import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

test('preferências locais sobrevivem a nova leitura e descartam campos não permitidos', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'onion-preferences-'));
  const file = path.join(root, 'config.json');
  process.env.ONION_PREFERENCES_PATH = file;
  try {
    const service = await import(`../src/services/localPreferences.js?test=${Date.now()}`);
    await service.saveLocalPreferences({
      tenantId: 'tenant_sandbox',
      userId: 'agent_1',
      preferences: {
        name: 'Agente Local',
        theme: 'dark',
        appearance: { themeAccentColor: '#2563eb', piiCliente: 'não salvar' },
        sort: { enabled: true, mode: 'agent_wait', direction: 'asc' }
      }
    });
    const restored = await service.getLocalPreferences({ tenantId: 'tenant_sandbox', userId: 'agent_1' });
    assert.equal(restored.name, 'Agente Local');
    assert.equal(restored.theme, 'dark');
    assert.equal(restored.appearance.themeAccentColor, '#2563eb');
    assert.equal(restored.appearance.piiCliente, undefined);
    assert.deepEqual(restored.sort, { enabled: true, mode: 'agent_wait', direction: 'asc' });
    assert.doesNotMatch(await readFile(file, 'utf8'), /piiCliente|não salvar/);
  } finally {
    delete process.env.ONION_PREFERENCES_PATH;
    await rm(root, { recursive: true, force: true });
  }
});
