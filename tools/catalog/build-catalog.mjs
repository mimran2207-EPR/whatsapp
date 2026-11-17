// Builds the field catalog (spec §12, structure per §21.5) from the spec markdown.
// Usage: node tools/catalog/build-catalog.mjs  → writes docs/catalog/field-catalog.v1.json
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const KEYS = [
  'display_name_he', 'technical_name', 'description', 'data_type', 'priority', 'grain',
  'source_profile', 'value_origin', 'channels', 'availability_condition', 'missing_value_meaning',
  'sensitivity', 'view_permission', 'filter_policy', 'export_policy', 'calculation_or_notes',
];

// Copied from the §12 profile table.
const PROFILES = {
  SYS: ['מערכת או הזנת משתמש', 'כולם', 'הישות או השלב קיימים', 'טרם קרה / לא הוגדר'],
  SRC: ['Snapshot מקור הנתונים (ערך מנורמל בנפרד)', 'כולם', 'השדה מופה והותר', 'לא סופק / הושחר'],
  POL: ['מחושב לפי כלל בעל גרסה', 'כולם', 'בוצעה הערכה', 'טרם נבדק'],
  AGG: ['מחושב (נוסחה בהערה)', 'כולם', 'עובדות הבסיס זמינות', 'לא ניתן לחישוב (אינו אפס)'],
  PRV: ['ספק: API, Webhook, בירור', 'לפי תמיכת ספק', 'התקבל דיווח', 'לא דווח / לא נתמך / טרם התקבל'],
  WA: ['ספק WhatsApp', 'WhatsApp', 'התקבל אירוע נתמך', 'אין אירוע; לא הוכחה שלילית'],
  EM: ['ספק Email', 'Email', 'מעקב מותר ונתמך', 'לא נתמך / לא התקבל'],
  INT: ['קישורים עוקבים / הודעות נכנסות', 'ערוצים עם מעקב / קבלה', 'הופעל והתקבל אירוע משויך', 'אין אירוע / לא מופעל'],
  DOC: ['שירות מסמכים', 'כל ערוץ עם מסמך', 'הוגדר תהליך מסמך', 'לא נדרש / טרם הופק'],
  EST: ['מחושב ממחירון בעל גרסה', 'כולם', 'יחידות ומחיר ידועים', 'אין אומדן אמין'],
  BILL: ['נתוני חיוב ספק או הקצאה מסומנת', 'לפי ספק', 'התקבל חיוב שניתן לשייך', 'טרם דווח (אינו אפס)'],
};

// Copied from the §12 access table.
const ACCESS = {
  O: ['תפעולי', 'משתמש מורשה ברשות ובמחלקה', 'כן', 'בהרשאת ייצוא'],
  P: ['אישי', 'ממוסך כברירת מחדל; מלא בהרשאת PII', 'רק בהרשאת PII', 'הרשאת ייצוא אישי נפרדת'],
  S: ['רגיש / תוכן', 'הרשאת תוכן ייעודית, מתועדת', 'לא (או נתיב מאושר)', 'חסום כברירת מחדל'],
  A: ['טכני / מנהלי', 'תפעול טכני, ביקורת', 'כן', 'הרשאה טכנית'],
  F: ['כספי', 'הרשאת עלויות', 'כן', 'הרשאת ייצוא כספי'],
};

const PRIORITY = { 'ח': 'required', 'מ': 'recommended', 'ע': 'future' };
const MISSING_CODES = 'NOT_APPLICABLE, NOT_SUPPORTED, NOT_REPORTED, PENDING, REDACTED, PURGED, UNKNOWN';

export function buildCatalog(md) {
  const lines = md.split(/\r?\n/);
  const fields = [];
  let grain = null;
  let sourceRowCount = 0;

  for (const line of lines) {
    const h = line.match(/^### 12\.\d+\. (.+?) — /);
    if (h) { grain = h[1].trim(); continue; }
    if (/^## 13\./.test(line)) break;
    if (!grain) continue;

    const cells = line.split('|').slice(1, -1).map(c => c.trim());
    if (cells.length !== 7 || !/^[A-Z]\d{2}$/.test(cells[0])) continue;

    sourceRowCount++;
    const [rowId, names, type, profile, access, prio, note] = cells;
    const [he, tech] = names.split(' — ').map(s => s.trim());
    const techNames = tech.split(',').map(s => s.trim());
    const types = type.split('/').map(s => s.trim());
    const p = PROFILES[profile];
    const a = ACCESS[access];
    if (!p || !a || !PRIORITY[prio]) throw new Error(`Unknown profile/access/priority in row ${rowId}`);

    techNames.forEach((technical_name, i) => {
      fields.push({
        row_id: rowId,
        display_name_he: he,
        technical_name,
        description: note || he,
        data_type: types[Math.min(i, types.length - 1)],
        priority: PRIORITY[prio],
        grain,
        source_profile: profile,
        value_origin: p[0],
        channels: p[1],
        availability_condition: p[2],
        missing_value_meaning: `${p[3]} · ${MISSING_CODES}`,
        sensitivity: a[0],
        view_permission: a[1],
        filter_policy: a[2],
        export_policy: a[3],
        calculation_or_notes: note,
      });
    });
  }
  return { version: '1.0.0', sourceRowCount, fields };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const root = new URL('../../', import.meta.url);
  const catalog = buildCatalog(readFileSync(new URL('RESIDENT_COMMUNICATION_SPEC.md', root), 'utf8'));
  mkdirSync(new URL('docs/catalog/', root), { recursive: true });
  writeFileSync(new URL('docs/catalog/field-catalog.v1.json', root), JSON.stringify(catalog, null, 2) + '\n', 'utf8');
  console.log(`source rows: ${catalog.sourceRowCount}, fields: ${catalog.fields.length}`);
}
