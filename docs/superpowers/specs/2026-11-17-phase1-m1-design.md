# תוספת עיצוב — שלב 1 · אבן דרך M1 (מסלול אנכי)

| פריט | ערך |
| --- | --- |
| תאריך | 17 בנובמבר 2026 |
| בסיס | [מסמך העיצוב](2026-11-17-resident-messaging-design.md) · [אפיון](../../../RESIDENT_COMMUNICATION_SPEC.md) §4, §5, §8, §9, §15, §16, §19, §21 |
| קיים | שלב 0: Domain (צירים, DeliveryMerge, CampaignCounter), סכימה V001–V002, קטלוג שדות · Blueprint בפיגמה |
| מצב | אושר בשיחה |

## 1. פיצול שלב 1

| אבן דרך | מה עובד בסופה |
| --- | --- |
| **M1 — מסלול אנכי** (מסמך זה) | Excel → SMS (ספק מדומה) → Preflight → אישור → תור → אירועים → מעקב |
| M2 — ערוצים ותבניות | WhatsApp ו-Email (מדומים), תבניות בעלות גרסה, מחזור חיים פנימי, אומדן עלות |
| M3 — נתונים ובקרה | Campaign 360 / Message 360, בורר עמודות, תצוגות, מגירה, ייצוא, Audit, בירור Timeout |
| M4 — מסמכים | PDF זורם מוגבל, התאמה דטרמיניסטית, קישור מאובטח |
| M5 — AI דטרמיניסטי 1–6 | הצעת מיפוי, קהל חריג, כפילות משלוח, סימולציה, מילון שגיאות, קבלת שליחה |

M2–M5 יתוכננו אחרי ש-M1 עובד.

## 2. החלטות M1

| # | נושא | החלטה |
| --- | --- | --- |
| P1 | מסד נתונים | מסד חדש `whatsapp` על SQL Server המקומי (`localhost`, אותו שרת של `GlnGviaBiuv`). לא נוגעים במסדים קיימים |
| P2 | אירוח API | מקומי ב-M1. החלטת אירוח (Azure / on-prem) — ADR בסוף M1 |
| P3 | הזדהות | כניסת פיתוח מדומה: משתמשים סינתטיים עם תפקיד ורשות → JWT מקומי. מאחורי `ITokenIssuer`/`ICurrentUser` כדי להחליף ב-IdentityService או OIDC בלי לשנות הרשאות |
| P4 | רכיבי UI | ספריית רכיבים משלנו ב-Angular מ-`src/frontend/design/tokens.json` (ייצוא מפיגמה) + Angular CDK לנגישות |
| P5 | גישה לנתונים | Dapper מעל מיגרציות T-SQL (הסכימה היא מקור האמת) |
| P6 | תור | Outbox בטבלת SQL Server באותה טרנזקציה + `BackgroundService`. בלי תשתית נוספת |
| P7 | ספק | `ISmsAdapter` + `MockSmsAdapter` עם תמהיל תוצאות מוגדר ואירועים מושהים; מסומן "Sandbox (מדומה)" |
| P8 | פריסה | Angular נבנה ל-`src/frontend/dist`; פריסה ל-Cloudflare רק אחרי החלטת אירוח API, כדי שהאתר החי לא יפנה ל-localhost |

## 3. Backend

```text
src/backend/
  ResidentComms.Domain/          קיים + Import (נרמול טלפון, תיקוף), Preflight, ApprovalPackage
  ResidentComms.Infrastructure/  Dapper, Outbox, קוראי XLSX/CSV, מאגרי נתונים
  ResidentComms.Api/             ASP.NET Core Minimal APIs (/v1), כניסה מדומה, Idempotency
  ResidentComms.Worker/          Dispatcher, MockSmsAdapter, עיבוד אירועים
  tools/ResidentComms.DbMigrator/ יצירת המסד והרצת db/migrations
```

### זרימת M1 בשרת

1. `POST /v1/import-jobs` (multipart) → ImportRun + AudienceVersion + AudienceMember. ערכים כמחרוזות, ערך מקור ומנורמל בנפרד, אפסים שאבדו וכתיב מדעי מסומנים, נוסחאות לא מורצות.
2. `POST /v1/campaigns` → Campaign (טיוטה) + Revision 1. `PATCH /v1/campaigns/{id}/draft` → קהל, ערוץ SMS, תוכן עם שדות אישיים.
3. `POST /v1/campaigns/{id}/preflight` → חסמים (אין נמענים כשירים · שדה דינמי חסר · משלוח כפול בחלון 7 ימים) ואזהרות (שינוי חריג בקהל · מחוץ לחלון שעות · עלות משוערת).
4. `POST .../submit` → חבילת אישור עם Hash קנוני (קהל + תוכן + ערוצים + תזמון + גרסת מדיניות).
5. `POST .../approve` → בדיקת הרשאה, סף (מעל 1,000 — לא עצמי), Hash תואם ל-Revision הנוכחית. כל שינוי מהותי ב-PATCH יוצר Revision חדשה ומבטל אישור.
6. `POST .../release` → בדיקה מחדש (אישור תקף, הסרות, חלון שעות) → AudienceSnapshot + CampaignRecipient + Message + OutboxMessage בטרנזקציה אחת.
7. Worker → `ISmsAdapter` → SendAttempt. Timeout אחרי יציאת בקשה → handoff `Unknown`, ללא ניסיון חוזר אוטומטי.
8. `POST /v1/provider-events/mock-sms` (חתימת HMAC מדומה) → MessageEvent (ניכוי כפילות) → `DeliveryMerge` (כולל `delivery_conflict`).
9. `GET /v1/campaigns/{id}/tracking` → מונים לפי צירים, KPI עם מונה/מכנה, `data_as_of`, הודעות עם חריג.

כל פקודה יוצרת/מבצעת דורשת `Idempotency-Key`; `tenant_id` נגזר מהטוקן בלבד.

## 4. Frontend

```text
src/frontend/
  design/tokens.json        ייצוא מפיגמה (מקור אמת)
  scripts/build-tokens.mjs  → src/styles/tokens.css (משתני CSS)
  src/app/ui/               Button, StatusBadge, ChannelChip, StepItem, PreflightItem, KpiCard,
                            GridRow, Banner, TextField, FileDropzone, AppShell
  src/app/core/             ApiClient, AuthService (כניסה מדומה), guards, interceptor (Idempotency-Key)
  src/app/features/         login, home (S01), campaigns (S02, S10–S15 SMS, S17), approvals (S30)
```

- Angular עדכני יציב, Standalone, Signals, `dir="rtl"`, Logical Properties בלבד, Rubik, `tabular-nums`.
- הלקוח לא מחשב סטטוסים — מציג את התווית והמונים מהשרת.
- `ng serve` עם Proxy ל-API המקומי.

## 5. בדיקות ותנאי סיום

- Domain/Infrastructure: xUnit; בדיקות מסד במסד בדיקה זמני לכל ריצה (כמו שלב 0).
- API: WebApplicationFactory מול מסד בדיקה.
- Frontend: בדיקות יחידה לרכיבים ושירותים; Playwright לזרימה המלאה.
- "ספר אמת": מסך המעקב תואם לתרחיש מבוקר.

**M1 גמור כאשר:** הזרימה עובדת מקומית מול מסד `whatsapp` עם ספק מדומה המסומן במסך; כל חסימות הבטיחות נאכפות בשרת; כל הבדיקות עוברות; README מתאר הרצה מקומית.
