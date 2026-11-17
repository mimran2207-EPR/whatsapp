import { csvHeaders, decodeText, readHeaders } from './sheet-headers';

/** Minimal zip with STORED entries (CRC left 0: the reader does not check it). */
function storedZip(files: Record<string, string>): Uint8Array<ArrayBuffer> {
  const enc = new TextEncoder();
  const chunks: Uint8Array<ArrayBuffer>[] = [];
  const central: Uint8Array<ArrayBuffer>[] = [];
  let offset = 0;
  for (const [name, text] of Object.entries(files)) {
    const n = enc.encode(name);
    const d = enc.encode(text);
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint32(18, d.length, true);
    local.setUint32(22, d.length, true);
    local.setUint16(26, n.length, true);
    chunks.push(new Uint8Array(local.buffer), n, d);
    const c = new DataView(new ArrayBuffer(46));
    c.setUint32(0, 0x02014b50, true);
    c.setUint32(20, d.length, true);
    c.setUint32(24, d.length, true);
    c.setUint16(28, n.length, true);
    c.setUint32(42, offset, true);
    central.push(new Uint8Array(c.buffer), n);
    offset += 30 + n.length + d.length;
  }
  const cdSize = central.reduce((s, x) => s + x.length, 0);
  const eocd = new DataView(new ArrayBuffer(22));
  eocd.setUint32(0, 0x06054b50, true);
  eocd.setUint16(8, Object.keys(files).length, true);
  eocd.setUint16(10, Object.keys(files).length, true);
  eocd.setUint32(12, cdSize, true);
  eocd.setUint32(16, offset, true);
  const all = [...chunks, ...central, new Uint8Array(eocd.buffer)];
  const out = new Uint8Array(all.reduce((s, x) => s + x.length, 0));
  let p = 0;
  for (const x of all) {
    out.set(x, p);
    p += x.length;
  }
  return out;
}

describe('sheet headers', () => {
  it('reads the first non-empty CSV record, with quotes and Hebrew', () => {
    expect(csvHeaders('\r\nת.ז,"שם, הורה",טל נייד הורה,"גן ""א"""\r\n1,2,3,4')).toEqual(['ת.ז', 'שם, הורה', 'טל נייד הורה', 'גן "א"']);
  });

  it('decodes UTF-8 with BOM and falls back to windows-1255', () => {
    expect(decodeText(new Uint8Array([0xef, 0xbb, 0xbf, 0xd7, 0x90]))).toBe('א');
    expect(decodeText(new Uint8Array([0xe0]))).toBe('א');
  });

  it('reads CSV headers from a File', async () => {
    const f = new File(['ת.ז,טלפון\n1,050'], 'a.csv');
    expect(await readHeaders(f)).toEqual(['ת.ז', 'טלפון']);
  });

  it('reads row 1 of the first visible XLSX sheet (shared and inline strings, column order)', async () => {
    const files: Record<string, string> = {
      'xl/workbook.xml':
        '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>' +
        '<sheet name="h" sheetId="1" state="hidden" r:id="rId1"/><sheet name="v" sheetId="2" r:id="rId2"/></sheets></workbook>',
      'xl/_rels/workbook.xml.rels':
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Id="rId1" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Target="worksheets/sheet2.xml"/></Relationships>',
      'xl/sharedStrings.xml': '<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><si><t>ת.ז</t></si><si><t>טל נייד הורה</t></si></sst>',
      'xl/worksheets/sheet1.xml': '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>wrong</t></is></c></row></sheetData></worksheet>',
      'xl/worksheets/sheet2.xml':
        '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1">' +
        '<c r="C1" t="inlineStr"><is><t>גן</t></is></c><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row>' +
        '<row r="2"><c r="A2"><v>1</v></c></row></sheetData></worksheet>',
    };
    expect(await readHeaders(new File([storedZip(files)], 'a.xlsx'))).toEqual(['ת.ז', 'טל נייד הורה', 'גן']);
  });

  it('rejects other file types', async () => {
    await expect(readHeaders(new File(['x'], 'a.xls'))).rejects.toThrow('UNSUPPORTED_FILE');
  });
});
