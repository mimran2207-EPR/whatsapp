/**
 * Reads the header row of an uploaded file in the browser, only to offer the column-mapping selects (S10).
 * The server re-reads and validates the whole file; nothing here decides validity. Formulas are not evaluated.
 */
export async function readHeaders(file: File): Promise<string[]> {
  const buf = new Uint8Array(await file.arrayBuffer());
  const name = file.name.toLowerCase();
  if (name.endsWith('.csv')) return csvHeaders(decodeText(buf));
  if (name.endsWith('.xlsx')) return xlsxHeaders(buf);
  throw new Error('UNSUPPORTED_FILE');
}

/** UTF-8 (with or without BOM), else windows-1255 — the same order the server tries. */
export function decodeText(buf: Uint8Array): string {
  try {
    return new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(buf);
  } catch {
    return new TextDecoder('windows-1255').decode(buf);
  }
}

/** First non-empty CSV record (RFC 4180 quoting), trimmed. */
export function csvHeaders(text: string): string[] {
  const fields: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') {
      fields.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      fields.push(field);
      if (fields.some((f) => f.trim() !== '')) return clean(fields);
      fields.length = 0;
      field = '';
    } else field += ch;
  }
  fields.push(field);
  return clean(fields);
}

function clean(fields: string[]): string[] {
  return fields.map((f) => f.trim()).filter((f) => f !== '');
}

/* ---------- XLSX: just enough zip + SpreadsheetML to read row 1 of the first visible sheet ---------- */

interface ZipEntry {
  method: number;
  compressedSize: number;
  localOffset: number;
}

function zipEntries(buf: Uint8Array): Map<string, ZipEntry> {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
    if (dv.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('UNREADABLE_FILE');
  const count = dv.getUint16(eocd + 10, true);
  let p = dv.getUint32(eocd + 16, true);
  const out = new Map<string, ZipEntry>();
  const utf8 = new TextDecoder();
  for (let n = 0; n < count; n++) {
    if (dv.getUint32(p, true) !== 0x02014b50) throw new Error('UNREADABLE_FILE');
    const method = dv.getUint16(p + 10, true);
    const compressedSize = dv.getUint32(p + 20, true);
    const nameLen = dv.getUint16(p + 28, true);
    const extraLen = dv.getUint16(p + 30, true);
    const commentLen = dv.getUint16(p + 32, true);
    const localOffset = dv.getUint32(p + 42, true);
    out.set(utf8.decode(buf.subarray(p + 46, p + 46 + nameLen)), { method, compressedSize, localOffset });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

async function readEntry(buf: Uint8Array, entries: Map<string, ZipEntry>, path: string): Promise<string | null> {
  const e = entries.get(path);
  if (!e) return null;
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const start = e.localOffset + 30 + dv.getUint16(e.localOffset + 26, true) + dv.getUint16(e.localOffset + 28, true);
  const data = buf.slice(start, start + e.compressedSize);
  if (e.method === 0) return new TextDecoder().decode(data);
  if (e.method !== 8 || typeof DecompressionStream === 'undefined') throw new Error('UNREADABLE_FILE');
  const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Response(stream).text();
}

function xml(text: string): Document {
  return new DOMParser().parseFromString(text, 'application/xml');
}

function byTag(node: Document | Element, tag: string): Element[] {
  return Array.from(node.getElementsByTagNameNS('*', tag));
}

function colIndex(ref: string): number {
  let n = 0;
  for (const ch of ref.replace(/\d+$/, '')) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n;
}

async function xlsxHeaders(buf: Uint8Array): Promise<string[]> {
  const entries = zipEntries(buf);
  const wb = xml((await readEntry(buf, entries, 'xl/workbook.xml')) ?? '');
  const rels = xml((await readEntry(buf, entries, 'xl/_rels/workbook.xml.rels')) ?? '<r/>');
  const sheets = byTag(wb, 'sheet');
  const sheet = sheets.find((s) => !s.getAttribute('state') || s.getAttribute('state') === 'visible') ?? sheets[0];
  if (!sheet) throw new Error('UNREADABLE_FILE');
  const rid = Array.from(sheet.attributes).find((a) => a.localName === 'id')?.value;
  const target = byTag(rels, 'Relationship').find((r) => r.getAttribute('Id') === rid)?.getAttribute('Target') ?? 'worksheets/sheet1.xml';
  const path = target.startsWith('/') ? target.slice(1) : `xl/${target.replace(/^\.\//, '')}`;

  const shared: string[] = [];
  const sst = await readEntry(buf, entries, 'xl/sharedStrings.xml');
  if (sst) for (const si of byTag(xml(sst), 'si')) shared.push(byTag(si, 't').map((t) => t.textContent ?? '').join(''));

  const ws = xml((await readEntry(buf, entries, path)) ?? '');
  for (const row of byTag(ws, 'row')) {
    const cells: [number, string][] = [];
    for (const c of byTag(row, 'c')) {
      const t = c.getAttribute('t');
      let v: string;
      if (t === 's') v = shared[Number(byTag(c, 'v')[0]?.textContent ?? -1)] ?? '';
      else if (t === 'inlineStr') v = byTag(c, 't').map((x) => x.textContent ?? '').join('');
      else v = byTag(c, 'v')[0]?.textContent ?? '';
      cells.push([colIndex(c.getAttribute('r') ?? ''), v.trim()]);
    }
    const values = cells.sort((a, b) => a[0] - b[0]).map(([, v]) => v);
    if (values.some((v) => v !== '')) return values.filter((v) => v !== '');
  }
  return [];
}
