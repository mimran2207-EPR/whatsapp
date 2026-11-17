import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildCatalog, KEYS } from './build-catalog.mjs';

const spec = readFileSync(new URL('../../RESIDENT_COMMUNICATION_SPEC.md', import.meta.url), 'utf8');
const catalog = buildCatalog(spec);

test('reads all 262 source rows of §12', () => {
  assert.equal(catalog.sourceRowCount, 262);
});

test('every field has exactly the 16 properties of §21.5 plus row_id', () => {
  assert.equal(KEYS.length, 16);
  for (const f of catalog.fields) assert.deepEqual(Object.keys(f).sort(), [...KEYS, 'row_id'].sort());
});

test('rows with several technical names are split', () => {
  const i10 = catalog.fields.filter(f => f.row_id === 'I10').map(f => f.technical_name);
  assert.deepEqual(i10, ['phone_raw', 'phone_normalized']);
  const i15 = catalog.fields.filter(f => f.row_id === 'I15');
  assert.deepEqual(i15.map(f => f.data_type), ['id', 'int']);
});

test('grain + technical_name is unique', () => {
  const keys = catalog.fields.map(f => `${f.grain}|${f.technical_name}`);
  assert.equal(new Set(keys).size, keys.length);
});

test('profile and access are expanded', () => {
  const m17 = catalog.fields.find(f => f.technical_name === 'destination_value');
  assert.equal(m17.grain, 'Message 360');
  assert.equal(m17.source_profile, 'SRC');
  assert.equal(m17.sensitivity, 'אישי');
  assert.equal(m17.priority, 'required');
});
