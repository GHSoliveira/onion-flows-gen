import test from 'node:test';
import assert from 'node:assert/strict';
import { findIxcSectorSuggestion, IXC_SECTOR_OPTIONS } from '../client/src/utils/ixcSectorCatalog.js';

test('catálogo de setores preserva código e nome usados pela extensão antiga', () => {
  assert.deepEqual(IXC_SECTOR_OPTIONS.find(([code]) => code === '63'), ['63', 'TÉCNICO - AVARÉ']);
  assert.deepEqual(IXC_SECTOR_OPTIONS.find(([code]) => code === '4629'), undefined);
});

test('sugere setor pela cidade ignorando acentos', () => {
  assert.deepEqual(findIxcSectorSuggestion('Cambé'), { code: '159', title: 'TÉCNICO - CAMBÉ' });
  assert.deepEqual(findIxcSectorSuggestion('Cornélio Procópio'), { code: '215', title: 'TÉCNICO - CORNÉLIO PROCÓPIO' });
});

test('respeita exceções por filial da extensão antiga', () => {
  assert.deepEqual(findIxcSectorSuggestion('Itaí', '102'), { code: '63', title: 'TÉCNICO - AVARÉ' });
  assert.deepEqual(findIxcSectorSuggestion('Itapeva', '3003'), { code: '283', title: 'TÉCNICO - OURO FINO' });
});

test('não inventa setor para cidade desconhecida', () => {
  assert.equal(findIxcSectorSuggestion('Cidade sem regra'), null);
});
