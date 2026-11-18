import { insertToken, previewParts } from './preview';

describe('previewParts', () => {
  it('fills known values, then defaults, and marks the rest as missing', () => {
    expect(previewParts('שלום {שם הורה}, עבור {שם ילד} ב{גן}.', { 'שם הורה': 'ד*** ל***' }, { 'שם ילד': 'ילדכם' })).toEqual([
      { text: 'שלום ', kind: 'text' },
      { text: 'ד*** ל***', kind: 'value' },
      { text: ', עבור ', kind: 'text' },
      { text: 'ילדכם', kind: 'default' },
      { text: ' ב', kind: 'text' },
      { text: '[גן]', kind: 'missing' },
      { text: '.', kind: 'text' },
    ]);
  });

  it('shows a mapped column without a sample value as a field placeholder, not as missing', () => {
    expect(previewParts('{גן}{x}', {}, {}, ['גן'])).toEqual([
      { text: '[גן]', kind: 'field' },
      { text: '[x]', kind: 'missing' },
    ]);
  });

  it('treats an empty default as no default', () => {
    expect(previewParts('{א}', {}, { א: '' })).toEqual([{ text: '[א]', kind: 'missing' }]);
  });
});

describe('insertToken', () => {
  it('inserts the field token at the caret', () => {
    expect(insertToken('שלום !', 5, 5, 'שם')).toEqual({ text: 'שלום {שם}!', caret: 9 });
  });

  it('replaces a selection', () => {
    expect(insertToken('אבג', 0, 3, 'x')).toEqual({ text: '{x}', caret: 3 });
  });
});
