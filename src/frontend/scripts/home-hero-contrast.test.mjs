import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const luminance = (hex) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a, b) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

test('home hero: white text meets 4.5:1 on both gradient stops (any text size)', () => {
  const css = readFileSync(new URL('../src/app/features/home/home.component.css', import.meta.url), 'utf8');
  const tokens = readFileSync(new URL('../src/styles/tokens.css', import.meta.url), 'utf8');
  const text = /--color-text-on-brand:\s*(#[0-9a-fA-F]{6})/.exec(tokens)?.[1];
  assert.ok(text, 'token --color-text-on-brand not found');
  for (const prop of ['--home-banner-from', '--home-banner-to']) {
    const stop = new RegExp(prop + ':\\s*(#[0-9a-fA-F]{6})').exec(css)?.[1];
    assert.ok(stop, `${prop} not found`);
    const ratio = contrast(text, stop);
    assert.ok(ratio >= 4.5, `${prop} ${stop} vs ${text} is ${ratio.toFixed(2)}:1, needs 4.5:1`);
  }
});
