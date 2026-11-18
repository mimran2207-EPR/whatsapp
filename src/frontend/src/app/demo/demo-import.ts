import { byTag, colIndex, decodeText, readEntry, xml, zipEntries } from '../core/sheet-headers';

/* DEMO ONLY. Client-side port of the server's SpreadsheetReader / ImportValidator / PhoneNormalizer / masks, so the
   in-browser fake backend can produce honest import counts for the visitor's own file. The file never leaves the browser. */

export interface Sheet {
  headers: string[];
  rows: (string | null)[][];
  /** True 1-based spreadsheet row of each entry in `rows` (blank rows are skipped but counted). */
  rowNumbers: number[];
}

export interface ValidatedRow {
  row: number;
  id: string;
  name: string | null;
  phoneRaw: string | null;
  phoneNormalized: string | null;
  vars: Record<string, string | null>;
  state: 'VALID' | 'INVALID';
  codes: string[];
}

export interface Mapping {
  idColumn: string;
  nameColumn: string | null;
  phoneColumn: string;
  variableColumns: string[];
}

/* ---------- masks (PhoneMask / IdentityMask) ---------- */

export function maskPhone(phone: string | null | undefined): string {
  let digits = (phone ?? '').replace(/[^0-9]/g, '');
  if (digits.startsWith('972')) digits = '0' + digits.slice(3);
  return digits.length >= 5 ? `${digits.slice(0, 3)}-***-**${digits.slice(-2)}` : '***';
}

export function maskId(id: string | null | undefined): string {
  const s = (id ?? '').trim();
  const shown = s.length <= 4 ? 0 : Math.min(4, Math.floor((s.length - 1) / 2));
  return shown > 0 ? '*****' + s.slice(-shown) : '*****';
}

/** First word and the initial of the second ("רונית כ."). */
export function maskName(name: string | null | undefined): string | null {
  if (name === null || name === undefined || name.trim() === '') return name ?? null;
  const parts = name.split(' ').filter(Boolean);
  return parts.length === 1 ? parts[0] : `${parts[0]} ${parts[1][0]}.`;
}

/* ---------- phone normalisation ---------- */

export function normalizePhone(raw: string | null): { normalized: string | null; issue: string | null } {
  const trimmed = (raw ?? '').replace(/[\s‎‏‪-‮⁦-⁩ ]/g, '');
  if (trimmed.length === 0) return { normalized: null, issue: 'Empty' };
  if (/^\d(\.\d+)?E\+\d+$/i.test(trimmed)) return { normalized: null, issue: 'ScientificNotation' };
  let compact = trimmed.replace(/[-()]/g, '');
  if (compact.startsWith('+')) compact = compact.slice(1);
  if (!/^[0-9]+$/.test(compact)) return { normalized: null, issue: 'NonDigits' };
  let national: string;
  if (compact.startsWith('972')) {
    let rest = compact.slice(3);
    if (rest.startsWith('0')) rest = rest.slice(1);
    national = '0' + rest;
  } else if (compact.length === 9 && compact[0] === '5') return { normalized: null, issue: 'LostLeadingZero' };
  else if (compact.length === 9 && compact[0] === '0') return { normalized: null, issue: 'NotMobile' };
  else national = compact;
  if (national.length !== 10) return { normalized: null, issue: 'InvalidLength' };
  if (!national.startsWith('05')) return { normalized: null, issue: 'NotMobile' };
  return { normalized: '+972' + national.slice(1), issue: null };
}

/* ---------- reading ---------- */

export async function readSheet(file: File): Promise<Sheet> {
  const buf = new Uint8Array(await file.arrayBuffer());
  const name = file.name.toLowerCase();
  if (name.endsWith('.csv')) return csvSheet(decodeText(buf));
  if (name.endsWith('.xlsx')) return xlsxSheet(buf);
  throw new Error('UNSUPPORTED_FILE');
}

export function parseCsv(text: string): string[][] {
  const records: string[][] = [];
  let record: string[] = [];
  let field = '';
  let quoted = false;
  const endRecord = () => {
    record.push(field);
    field = '';
    records.push(record);
    record = [];
  };
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
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
      record.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      endRecord();
    } else field += ch;
  }
  if (field !== '' || record.length > 0) endRecord();
  return records;
}

function toSheet(records: { n: number; cells: string[] }[]): Sheet {
  const nonBlank = records.filter((r) => r.cells.some((c) => c.trim() !== ''));
  if (nonBlank.length === 0) throw new Error('UNREADABLE_FILE');
  const [head, ...body] = nonBlank;
  return {
    headers: head.cells.map((h) => h.trim()),
    rows: body.map((r) => r.cells.map((c) => (c === '' ? null : c))),
    rowNumbers: body.map((r) => r.n),
  };
}

export function csvSheet(text: string): Sheet {
  return toSheet(parseCsv(text).map((cells, i) => ({ n: i + 1, cells })));
}

async function xlsxSheet(buf: Uint8Array): Promise<Sheet> {
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
  const records: { n: number; cells: string[] }[] = [];
  let seq = 0;
  for (const row of byTag(ws, 'row')) {
    seq++;
    const n = Number(row.getAttribute('r')) || seq;
    const cells: string[] = [];
    for (const c of byTag(row, 'c')) {
      const t = c.getAttribute('t');
      let v: string;
      if (t === 's') v = shared[Number(byTag(c, 'v')[0]?.textContent ?? -1)] ?? '';
      else if (t === 'inlineStr') v = byTag(c, 't').map((x) => x.textContent ?? '').join('');
      else v = byTag(c, 'v')[0]?.textContent ?? '';
      cells[Math.max(0, colIndex(c.getAttribute('r') ?? '') - 1)] = v.trim();
    }
    for (let i = 0; i < cells.length; i++) cells[i] ??= '';
    records.push({ n, cells });
  }
  return toSheet(records);
}

/* ---------- validation (ImportValidator) ---------- */

export function validateRows(sheet: Sheet, map: Mapping): ValidatedRow[] {
  const col = (name: string): number => {
    const i = sheet.headers.indexOf(name);
    if (i < 0) throw new Error('MAPPING_COLUMN_NOT_FOUND');
    return i;
  };
  const idCol = col(map.idColumn);
  const phoneCol = col(map.phoneColumn);
  const nameCol = map.nameColumn ? col(map.nameColumn) : null;
  const varCols = map.variableColumns.map((v) => ({ name: v, index: col(v) }));
  const cell = (row: (string | null)[], i: number): string | null => (i < row.length ? row[i] : null);

  const seen = new Set<string>();
  return sheet.rows.map((row, n) => {
    const id = (cell(row, idCol) ?? '').trim();
    const name = nameCol === null ? null : cell(row, nameCol);
    const phoneRaw = cell(row, phoneCol);
    const phone = normalizePhone(phoneRaw);
    const vars: Record<string, string | null> = {};
    for (const v of varCols) vars[v.name] = cell(row, v.index);

    const codes: string[] = [];
    if (phone.issue) codes.push(phone.issue);
    const mapped = [id, name, phoneRaw, ...Object.values(vars)];
    if (mapped.some((v) => v !== null && v.trimStart().startsWith('='))) codes.push('FORMULA_VALUE');
    if (id.length === 0) codes.push('MISSING_ID');
    if (/^\d(\.\d+)?E\+\d+$/i.test(id)) codes.push('ID_SCIENTIFIC');
    if (id.length > 0) {
      if (seen.has(id)) codes.push('DUPLICATE_ID');
      seen.add(id);
    }
    return { row: sheet.rowNumbers[n], id, name, phoneRaw, phoneNormalized: phone.normalized, vars, state: codes.length === 0 ? 'VALID' : 'INVALID', codes };
  });
}
