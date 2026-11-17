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

## עמודים ומסכים

בסיס הקישורים: `https://www.figma.com/design/kMXnkQFbLav7YIm9NdVvA5?node-id=` + מזהה (נקודתיים → מקף).

| עמוד | תוכן | מזהים |
| --- | --- | --- |
| 00 Readme & Decisions | מטרה, מקורות, החלטות D1–D7, מקרא, אינדקס מקושר | `27-2` |
| 01 Foundations | Specimen: צבעים, טיפוגרפיה, ריווח, צללים, RTL | `3-2` |
| 02 Components | 34 רכיבים + 41 אייקונים (StatusBadge `6-63`, Button `6-144`, GridRow `8-252` …) | — |
| 03 Patterns | אשף `13-3` · עצירת יתרה `13-76` · השפעת שינוי `13-97` · מצב ריק `13-114` · Toast `13-125` | — |
| 04 App Shell | AppShell 1440 / 1280 / 1024 | `12-301` |
| 05 Campaign Journey | S01 `14-3`, `14-331` · S02 `14-481` · S10 `16-680` · S11 `16-902` · S12 `16-1135` · S13 `16-1353` · S14 `17-1310` · S15 `17-1560` · S16 `17-1772` · S17 `18-1816` · S30 `18-2149` | Flows 1, 3, 4 |
| 06 Audiences & Import | S20 `19-3` · S21 `19-274` · S22 `19-481` · S23 `19-707` | Flow 2 |
| 07 Templates | S60 `20-3` · תבנית `20-281` | — |
| 08 PDF Studio | S72 `21-3` · S70 `21-266` (שלב 2) · S71 `21-422` (שלב 2) | — |
| 09 Data 360 & Analytics | S40 `22-3` · S41+S50 `22-282` · S42 `22-716` · S43–S44 `23-842` · S51 `23-1033` · S90 `23-1190` (שלב 3) | Flow 5 |
| 10 Operations | דשבורד תפעולי | `24-3` |
| 11 Admin | S80 `25-3` · S81 `25-224` · S82 `25-444` | — |
| 12 Prototypes | מדריך 5 זרימות עם קישורים | `27-61` |
| 13 Accessibility & RTL | ניגודיות מחושבת, מקלדת, Grid, RTL | `28-2` |
| 14 Handoff | 10 כרטיסי חוזה מסירה | `29-2` |

## ממצאים פתוחים

- **ניגודיות (WCAG 2.2 AA, סף 4.5:1 לטקסט רגיל) — צבעי Muni שנכשלים:**

  | זוג | יחס |
  | --- | --- |
  | לבן על טורקיז ‎`#07BED1`‏ (כפתור ראשי, ניווט פעיל) | 2.26 |
  | לבן על ‎`#058C9A`‏ (Hover) · טקסט מותג ‎`#058C9A`‏ על לבן | 4.02 |
  | טקסט שלישוני ‎`#7F8A9E`‏ על לבן | 3.48 |
  | שבב / כרטיס WhatsApp ‎`#16B16E`‏ על ‎`#E4FAF5`‏ | 2.56 |
  | שבב / כרטיס Email ‎`#FE8315`‏ על ‎`#FEEDE1`‏ | 2.17 |
  | שבב SMS ‎`#815DFF`‏ על ‎`#EEEBFE`‏ | 3.63 |
  | אקסנט ורוד ‎`#FF4570`‏ על ‎`#FDE5EC`‏ | 2.78 |

  אפשרויות: (א) טקסט כהה ‎`#002538`‏ על הטורקיז — 7.03, שומר על מילוי Muni; (ב) לבן על ‎`#13737D`‏ — 5.56. לשבבים: ‎`#0B7A43`‏ (4.97) · ‎`#A84B00`‏ (5.02) · ‎`#5B3BD6`‏ (5.90); שלישוני ‎`#687385`‏ (4.79). כל המסכים מקושרים למשתנים — תיקון הוא עדכון Tokens, לא ציור מחדש. ממתין להחלטה (ADR-002 מול יעד AA בסעיף 17).
- צבעי הסטטוס שלנו עוברים (5.6–10.0). warn/700 הוכהה ל-‎`#9A5100`‏ (5.44) — היה 4.30.
- ביקורת צבעים: 0 צבעים לא מקושרים בעמודים 02–11 (כולל רכיבים ראשיים). חריג יחיד: גרדיאנטים (באנר, רקע עמוד) — משתני Figma אינם תומכים בגרדיאנט.
- רשתות גולשות (כרטיסי תבניות, KPI) מסודרות משמאל לימין בפיגמה; במימוש — RTL.
