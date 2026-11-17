// Run with: node --test scripts/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const script = path.join(here, 'build-tokens.mjs');

function run() {
  const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'rc-tokens-')), 'tokens.css');
  execFileSync(process.execPath, [script, out]);
  return { out, css: fs.readFileSync(out, 'utf8') };
}

test('emits on-action and density variables', () => {
  const { css } = run();
  assert.match(css, /--color-text-on-action: #002538;/);
  assert.match(css, /\[data-density="compact"\]/);
  assert.match(css, /--row-height: 78px;/);
  assert.match(css, /--control-height: 44px;/);
  const compact = css.slice(css.indexOf('[data-density="compact"]'));
  assert.match(compact, /--row-height: 48px;/);
  assert.match(compact, /--control-height: 36px;/);
});

test('emits every color, spacing, radius, shadow and font family', () => {
  const { css } = run();
  const tokens = JSON.parse(fs.readFileSync(path.join(here, '..', 'design', 'tokens.json'), 'utf8'));
  for (const [k, v] of Object.entries(tokens.color)) {
    assert.ok(css.includes(`--color-${k.replaceAll('/', '-')}: ${v};`), `missing color ${k}`);
  }
  assert.match(css, /--space-16: 16px;/);
  assert.match(css, /--radius-full: 999px;/);
  assert.match(css, /--shadow-focus-ring: 0 0 0 2px #FFFFFF, 0 0 0 4px #07BED1;/);
  assert.match(css, /--font-family: "Rubik", system-ui, sans-serif;/);
});

test('emits a text utility class per style, tabular where flagged', () => {
  const { css } = run();
  assert.match(css, /\.t-body-14 \{[^}]*font-size: 14px;[^}]*\}/);
  assert.match(css, /\.t-kpi-32 \{[^}]*font-variant-numeric: tabular-nums;[^}]*\}/);
  assert.doesNotMatch(css.match(/\.t-body-14 \{[^}]*\}/)[0], /tabular-nums/);
});

test('is idempotent', () => {
  const a = run().css;
  const b = run().css;
  assert.equal(a, b);
});
