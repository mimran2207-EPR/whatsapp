# Figma Blueprint

- קובץ: [מערכת תקשורת לתושבים — Blueprint](https://www.figma.com/design/kMXnkQFbLav7YIm9NdVvA5) (file key `kMXnkQFbLav7YIm9NdVvA5`)
- מקור השראה: קובץ "חינוך", מסך DashboardLayout — `AAeujWMg573IfqGDCYfZsY` / node `535:11252` (ADR-002)
- עמודים: 00 Readme & Decisions · 01 Foundations · 02 Components · 03 Patterns · 04 App Shell · 05 Campaign Journey · 06 Audiences & Import · 07 Templates · 08 PDF Studio · 09 Data 360 & Analytics · 10 Operations · 11 Admin · 12 Prototypes · 13 Accessibility & RTL · 14 Handoff

## ערכי Muni שנשלפו (מקור: node 535:11252)

| שם | ערך | מקור |
| --- | --- | --- |
| גופן | Rubik — Regular / Medium / Bold | כל הטקסטים במסך |
| צבע פעולה | `#07BED1` | משתנה "main color", פריט ניווט פעיל 535:11470 |
| מותג כהה | `#058C9A` · `#13737D` | אייקונים, גרדיאנט באנר 535:11253 |
| טקסט ראשי | `#002538` · `#091832` | כותרות |
| טקסט משני | `#686868` · `#7F8A9E` | תוויות |
| קישור / אייקון | `#007DB3` | אייקונים וקלט עוזר 535:11448 |
| רקע עמוד | גרדיאנט `#F7FAFC` ← `#F2F4FA` | 535:11252 |
| משטח / גבול | `#FFFFFF` / `#E1EFF6` | סרגל 535:11467, כרטיסים |
| משטח עדין | `#EFF6F9` (80%) · `#EDF5F8` | פריטי עוזר 535:11546, כפתור "עוד פרטים" 535:11317 |
| כרטיסי פסטל | ירוק `#E4FAF5`/`#D8F0EA` · סגול `#EEEBFE`/`#E7E4F6` · כתום `#FEEDE1`/`#F6E6DA` · ורוד `#FDE5EC`/`#F8DEE6` | 535:11262 / 11271 / 11280 / 11292 |
| רדיוסים | 8 · 14 · 16 · 20 · 24 · full | כפתורים, כרטיסים, סרגל |
| צל כרטיס | `#0B838E` 5%, y8, blur 30 | רוב הכרטיסים |
| צל כפתור מותג | `#07BED1` 25%, y4 blur6 s-1 + y2 blur4 s-2 | 535:11470 |
| רוחב סרגל | 258px | 535:11467 |

## Tokens בקובץ

- **Primitives** (44, מוסתרים): brand, ink, neutral, green/purple/orange/pink (ערוצים), status-blue, status-green, navy, red, amber, warn.
- **Color** (49, מצב Light): bg, text, border, icon, channel/{whatsapp,sms,email}, status/{neutral,progress,success,info,danger,unknown,warning}.
- **Dimension** (16, מצבים Comfortable / Compact): space 4–32, radius sm–full, density row/control.
- **Text styles** (13, Rubik): Display/40 … Data/KPI 32. ספרות טבלאיות — בקוד `font-variant-numeric: tabular-nums`.
- **Effect styles** (6): Elevation/Card, Card Hover, Overlay, Modal, Brand Button, Focus/Ring.

מיפוי ערוצים לצבעי פסטל של Muni: WhatsApp ירוק, SMS סגול, Email כתום. ורוד שמור כאקסנט. צבעי סטטוס הם סט נפרד.
