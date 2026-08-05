import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const load = (relativePath) => readFile(new URL(relativePath, import.meta.url), 'utf8');

test('integração externa usa cache global, single-flight e backoff persistente para 429', async () => {
  const source = await load('../external-status.js');
  assert.match(source, /const CACHE_TTL_MS = 2 \* 60 \* 1000/);
  assert.match(source, /const MIN_ATTEMPT_INTERVAL_MS = 30 \* 1000/);
  assert.match(source, /let nocviewInFlight = null/);
  assert.match(source, /let grafanaInFlight = null/);
  assert.match(source, /response\.status === 429/);
  assert.match(source, /response\.headers\.get\("retry-after"\)/);
  assert.match(source, /MAX_BACKOFF_MS/);
  assert.match(source, /RATE_STATE_KEY/);
  assert.match(source, /manualAuthRetry/);
  assert.match(source, /current\.error === "not_authenticated"/);
  assert.match(source, /status === 429/);
});

test('cruzamento diferencia OLT inteira de PON realmente afetada', async () => {
  const source = await load('../external-status.js');
  const context = {
    self: {},
    chrome: {},
    console,
    fetch: async () => { throw new Error('fetch não esperado'); },
    setTimeout,
    clearTimeout,
    Date,
    Promise,
    Object,
    Array,
    String,
    Number,
    Boolean,
    JSON,
    RegExp,
    Math
  };
  vm.runInNewContext(source, context);
  const service = context.self.OnionExternalStatus;
  const affected = service.matchGrafana(
    { oltName: 'ZAAZ_OUF_PSA_DC_OLT_ZTE_001', ponId: '1/2/12' },
    [{ triggerId: 't1', olt: 'ZAAZ.OUF.PSA.DC.OLT-ZTE-001', pon: '2/12' }]
  );
  const otherPon = service.matchGrafana(
    { oltName: 'ZAAZ_OUF_PSA_DC_OLT_ZTE_001', ponId: '1/2/11' },
    [{ triggerId: 't1', olt: 'ZAAZ.OUF.PSA.DC.OLT-ZTE-001', pon: '2/12' }]
  );
  assert.equal(affected.level, 'inside');
  assert.equal(otherPon.level, 'olt');
  assert.equal(otherPon.sameChassis, true);
});

test('host de rede exige identificador completo e só tolera variação de separadores', async () => {
  const source = await load('../external-status.js');
  const context = {
    self: {}, chrome: { runtime: { onMessage: { addListener() {} } } }, console,
    fetch: async () => { throw new Error('fetch não esperado'); },
    setTimeout, clearTimeout, Date, Promise, Object, Array, String, Number, Boolean, JSON, RegExp, Math
  };
  vm.runInNewContext(source, context);
  const service = context.self.OnionExternalStatus;

  assert.equal(
    service.sameNetworkHost('GRE_BRAS_LONDRINA_LDNST_CF_1', 'GRE.BRAS-LONDRINA_LDNST-CF.1'),
    true
  );
  assert.equal(
    service.sameNetworkHost('GRE_BRAS_LONDRINA_LDNST_CF_1', 'GRE_BRAS_LONDRINA_LDNST_CF_1_EXTRA'),
    false
  );
  assert.equal(
    service.sameNetworkHost('ZAAZ_GRE_CAMBE_CMBARM-P-1_OLT_ZY_001', 'ZAAZ.GRE.CAMBE.CMBARM_P_1.OLT.ZY.001'),
    true
  );
  assert.equal(
    service.sameNetworkHost('ZAAZ_GRE_CAMBE_CMBARM-P-1_OLT_ZY_001', 'PREFIX_ZAAZ_GRE_CAMBE_CMBARM-P-1_OLT_ZY_001'),
    false
  );

  const exactGrafana = service.matchGrafana(
    { oltName: 'ZAAZ_GRE_CAMBE_CMBARM-P-1_OLT_ZY_001', ponId: '1/2/12' },
    [{ triggerId: 't1', olt: 'ZAAZ.GRE.CAMBE.CMBARM_P_1.OLT.ZY.001', pon: '2/12' }]
  );
  const extraGrafana = service.matchGrafana(
    { oltName: 'ZAAZ_GRE_CAMBE_CMBARM-P-1_OLT_ZY_001', ponId: '1/2/12' },
    [{ triggerId: 't2', olt: 'ZAAZ_GRE_CAMBE_CMBARM-P-1_OLT_ZY_001_EXTRA', pon: '2/12' }]
  );
  assert.equal(exactGrafana?.level, 'inside');
  assert.equal(extraGrafana, null);
});

test('Grafana só consulta sob comando do service worker e não cria polling por aba', async () => {
  const source = await load('../grafana-content.js');
  assert.match(source, /ONION_GRAFANA_FETCH/);
  assert.doesNotMatch(source, /setInterval\s*\(/);
});

test('OLT primária do Genesys alimenta o mesmo cruzamento sem consulta IXC', async () => {
  const source = await load('../background.js');
  assert.match(source, /async function syncGenesysExternalStatus/);
  assert.match(source, /source: "genesys"/);
  assert.match(source, /externalNetwork/);
  assert.match(source, /OnionExternalStatus\.enrichLogins\(\[technicalLogin\], \{ force: false \}\)/);
  assert.match(source, /Rede comparada pela OLT do Genesys/);
});

test('manifest mantém tokens fora do Onion e injeta capturadores somente nos domínios necessários', async () => {
  const manifest = JSON.parse(await load('../manifest.json'));
  assert.ok(manifest.host_permissions.includes('https://nocview.zaaz.com.br/*'));
  assert.ok(manifest.host_permissions.includes('https://grafana2.zaaz.com.br/*'));
  assert.ok(manifest.content_scripts.some((entry) => entry.matches.includes('https://nocview.zaaz.com.br/*') && entry.world === 'MAIN'));
  assert.ok(manifest.content_scripts.some((entry) => entry.matches.includes('https://grafana2.zaaz.com.br/*')));
});
