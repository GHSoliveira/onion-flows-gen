import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { summarizeIxcOsAlerts } from '../client/src/utils/ixcOsAlerts.js';

test('resume OS agendadas e assuntos distintos sem duplicar assunto', () => {
  const alerts = summarizeIxcOsAlerts({
    osList: [
      { osId: '10', status: 'Agendada', subject: 'FTTH - RETIRADA' },
      { osId: '11', status: 'AGENDADO', subject: 'FTTH - RETIRADA' },
      { osId: '12', status: 'Agendada', subject: 'VISITA TÉCNICA' },
    ],
  });

  assert.equal(alerts.scheduled.count, 3);
  assert.deepEqual(alerts.scheduled.subjects, ['FTTH - RETIRADA', 'VISITA TÉCNICA']);
});

test('alerta PRÉ considera somente OS ainda abertas cujo assunto começa com PRÉ', () => {
  const alerts = summarizeIxcOsAlerts({
    osList: [
      { osId: '20', status: 'Aberta', subject: 'PRÉ - O.S SEM ACESSO' },
      { osId: '21', status: 'Finalizada', subject: 'PRÉ - O.S LENTIDÃO' },
      { osId: '22', status: 'Aberta', subject: 'PREVENTIVA DE REDE' },
      { osId: '23', status: 'Cancelada', subject: 'PRÉ O.S LOS' },
    ],
  });

  assert.equal(alerts.openPre.count, 1);
  assert.deepEqual(alerts.openPre.subjects, ['PRÉ - O.S SEM ACESSO']);
});

test('cards e header usam o mesmo resumo IXC em cache', async () => {
  const workspace = await readFile(
    new URL('../client/src/pages/AgentWorkspace.jsx', import.meta.url),
    'utf8'
  );

  assert.match(workspace, /<IxcOsAlertBadges details=\{ixcOrderDetails\} \/>/);
  assert.match(workspace, /<IxcOsAlertBadges details=\{selectedHeaderIxc\} compact \/>/);
  assert.match(workspace, /PRÉ OS em aberto/);
});
