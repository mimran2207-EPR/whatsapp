export interface PreviewPart {
  text: string;
  kind: 'text' | 'value' | 'default' | 'field' | 'missing';
}

/**
 * Splits a template into parts for the S12 preview. Same token syntax as the server's TemplateRenderer ({field}),
 * but display only: the server renders the real messages and reports missing fields in its preflight.
 * A mapped file column whose per-recipient value is not in the (masked) sample shows as "[field]" (kind 'field');
 * a token that is not a mapped column at all is 'missing' and highlighted, since no recipient can fill it.
 */
export function previewParts(template: string, values: Record<string, string | null | undefined>, defaults: Record<string, string>,
  knownFields: readonly string[] = [],
): PreviewPart[] {
  const parts: PreviewPart[] = [];
  const re = /\{([^{}]+)\}/g;
  let last = 0;
  for (let m = re.exec(template); m; m = re.exec(template)) {
    if (m.index > last) parts.push({ text: template.slice(last, m.index), kind: 'text' });
    const key = m[1];
    const v = values[key];
    if (v) parts.push({ text: v, kind: 'value' });
    else if (Object.hasOwn(defaults, key) && defaults[key] !== '') parts.push({ text: defaults[key], kind: 'default' });
    else parts.push({ text: `[${key}]`, kind: knownFields.includes(key) ? 'field' : 'missing' });
    last = m.index + m[0].length;
  }
  if (last < template.length) parts.push({ text: template.slice(last), kind: 'text' });
  return parts;
}

/** Inserts `{field}` at the caret (or replaces the selection) and returns the new text and caret position. */
export function insertToken(text: string, start: number, end: number, field: string): { text: string; caret: number } {
  const token = `{${field}}`;
  return { text: text.slice(0, start) + token + text.slice(end), caret: start + token.length };
}
