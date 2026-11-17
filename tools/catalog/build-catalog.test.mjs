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

test('value_origin keeps both profile columns', () => {
  const pol = catalog.fields.find(f => f.technical_name === 'channel_permission_state');
  assert.equal(pol.value_origin, 'מנוע כללים ומדיניות · מחושב לפי כלל בעל גרסה');
});

test('committed JSON matches a fresh build', () => {
  const committed = readFileSync(new URL('../../docs/catalog/field-catalog.v1.json', import.meta.url), 'utf8');
  assert.equal(committed, JSON.stringify(catalog, null, 2) + '\n');
});

test('per-grain source row counts match §12', () => {
  const rowsByGrain = {};
  const seen = new Set();
  for (const f of catalog.fields) {
    const k = `${f.grain}|${f.row_id}`;
    if (seen.has(k)) continue;
    seen.add(k);
    rowsByGrain[f.grain] = (rowsByGrain[f.grain] || 0) + 1;
  }
  assert.deepEqual(rowsByGrain, {
    'Campaign 360': 84,
    'Message 360': 95,
    'Recipient Delivery Detail': 8,
    'Send Attempts': 13,
    'Message Events': 14,
    'Template Lifecycle': 14,
    'Document Delivery': 17,
    'Import & Audience Audit': 17,
  });
});
