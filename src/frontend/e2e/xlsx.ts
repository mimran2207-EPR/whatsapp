import { crc32 } from 'node:zlib';

/**
 * Builds a minimal XLSX (stored, uncompressed zip + SpreadsheetML with inline strings) from rows of text cells.
 * No dependency and no binary file in the repo. Every cell is TEXT, so phones and IDs keep their leading zeros.
 * Synthetic data only.
 */
export function buildXlsx(sheetName: string, rows: string[][]): Buffer {
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const col = (i: number) => String.fromCharCode(65 + i);
  const sheetRows = rows
    .map(
      (r, ri) =>
        `<row r="${ri + 1}">${r.map((v, ci) => `<c r="${col(ci)}${ri + 1}" t="inlineStr"><is><t>${esc(v)}</t></is></c>`).join('')}</row>`,
    )
    .join('');
  const head = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
  const files: [string, string][] = [
    [
      '[Content_Types].xml',
      `${head}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>`,
    ],
    [
      '_rels/.rels',
      `${head}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    ],
    [
      'xl/workbook.xml',
      `${head}<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${esc(sheetName)}" sheetId="1" r:id="rId1"/></sheets></workbook>`,
    ],
    [
      'xl/_rels/workbook.xml.rels',
      `${head}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`,
    ],
    [
      'xl/worksheets/sheet1.xml',
      `${head}<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${sheetRows}</sheetData></worksheet>`,
    ],
  ];

  const local: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const [name, text] of files) {
    const nameBuf = Buffer.from(name, 'utf8');
    const data = Buffer.from(text, 'utf8');
    const crc = crc32(data);
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0);
    lh.writeUInt16LE(20, 4); // version needed
    lh.writeUInt16LE(0x0800, 6); // UTF-8 names
    lh.writeUInt16LE(0, 8); // stored
    lh.writeUInt32LE(crc, 14);
    lh.writeUInt32LE(data.length, 18);
    lh.writeUInt32LE(data.length, 22);
    lh.writeUInt16LE(nameBuf.length, 26);
    local.push(lh, nameBuf, data);

    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0);
    ch.writeUInt16LE(20, 4);
    ch.writeUInt16LE(20, 6);
    ch.writeUInt16LE(0x0800, 8);
    ch.writeUInt32LE(crc, 16);
    ch.writeUInt32LE(data.length, 20);
    ch.writeUInt32LE(data.length, 24);
    ch.writeUInt16LE(nameBuf.length, 28);
    ch.writeUInt32LE(offset, 42);
    central.push(ch, nameBuf);
    offset += lh.length + nameBuf.length + data.length;
  }
  const centralBuf = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(centralBuf.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, centralBuf, end]);
}

export const HEADERS = ['ת.ז', 'שם הורה', 'טל נייד הורה', 'שם ילד', 'גן'];

/** 12 synthetic rows: 10 valid, 2 invalid (a malformed phone and a missing phone). */
export function m1Fixture(): Buffer {
  const rows: string[][] = [HEADERS];
  const parents = ['דנה כהן', 'רונית לוי', 'יעל בר', 'אורי גל', 'משה פרץ', 'נועה שגב', 'איתן רז', 'מיכל דן', 'שרית נר', 'עומר חן'];
  parents.forEach((p, i) => rows.push([`30100${String(i + 1).padStart(4, '0')}`, p, `05211100${String(i + 1).padStart(2, '0')}`, `ילד ${i + 1}`, i % 2 ? 'תפוח' : 'דובדבן']));
  rows.push(['301000011', 'ליאור אבן', '123', 'ילד 11', 'תפוח']); // invalid phone
  rows.push(['301000012', 'גל טל', '', 'ילד 12', 'דובדבן']); // missing phone
  return buildXlsx('נובמבר', rows);
}
