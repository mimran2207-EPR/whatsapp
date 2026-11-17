# מערכת תקשורת רב־ערוצית לתושבים

- אפיון: [RESIDENT_COMMUNICATION_SPEC.md](RESIDENT_COMMUNICATION_SPEC.md)
- עיצוב: [docs/superpowers/specs](docs/superpowers/specs)
- החלטות: [docs/adr](docs/adr)

## הרצה

    dotnet test src/backend/ResidentComms.slnx
    node --test tools/catalog/build-catalog.test.mjs

בדיקות המסד דורשות SQL Server מקומי. מחרוזת חיבור ברירת מחדל:
`Server=localhost;Integrated Security=true;TrustServerCertificate=true`.
אפשר לשנות דרך משתנה הסביבה `RESIDENTCOMMS_SQL`.

## הרצת M1 מקומית

הזרימה המלאה של M1: ייבוא Excel/CSV, אשף SMS, בדיקה לפני שליחה, אישור, תור עמיד, ספק מדומה, אירועים ומסך מעקב.

**הכול Sandbox (מדומה) ובנתונים סינתטיים בלבד.** אין ספק SMS אמיתי, אין נתוני תושבים אמיתיים, והממשק מסמן זאת ב-"Sandbox (מדומה)".

### דרישות מוקדמות

- SQL Server מקומי על `localhost` עם אימות Windows (נוצר בו המסד `whatsapp`; המערכת לא נוגעת בשום מסד אחר)
- .NET 10 SDK
- Node 24
- `sqlcmd` (נדרש רק לבדיקות ה-e2e)

### סודות (פעם אחת)

מפתחות החתימה אינם בקוד ואינם ב-repo. מגדירים אותם ב-user-secrets, עם ערכים אקראיים משלכם (32 תווים לפחות):

    dotnet user-secrets set "Auth:DevSigningKey" "<מחרוזת אקראית>" --project src/backend/ResidentComms.Api
    dotnet user-secrets set "Providers:MockSms:SigningKey" "<מחרוזת אקראית>" --project src/backend/ResidentComms.Api
    dotnet user-secrets set "Providers:MockSms:SigningKey" "<אותו ערך כמו ב-Api>" --project src/backend/ResidentComms.Worker

ערך `Providers:MockSms:SigningKey` חייב להיות זהה ב-Api וב-Worker.

### הפעלה

    ./scripts/dev-up.ps1

הסקריפט בודק שהסודות קיימים (ואם לא, מדפיס את הפקודות), מריץ את `DbMigrator` על המסד `whatsapp` עם `--seed-dev`, ואז מפעיל את ה-API על `http://localhost:5080`, את ה-Worker ואת הממשק (`npm start`) על `http://localhost:4200`. כניסה מדומה: דנה (יוצרת משלוחים) ומאיר (מאשר). Ctrl+C עוצר את הכול.

### בדיקות

    dotnet test src/backend/ResidentComms.slnx
    cd src/frontend
    npm ci                              # פעם אחת (ובכל שינוי ב-package-lock.json)
    npm test && npm run build
    npx playwright install chromium     # פעם אחת, לבדיקות ה-e2e
    npm run e2e

דרישות ל-e2e: `npm ci` ו-`npx playwright install chromium` ב-`src/frontend`, ו-`sqlcmd` ב-PATH (נבדק לפני שנוצר משהו; בלעדיו ההרצה נעצרת בלי ליצור מסד).

בדיקת ה-e2e (Playwright) מפעילה בעצמה API, Worker (ספק מדומה דטרמיניסטי) ו-`ng serve` מול מסד זמני `ResidentComms_Test_<guid>`, מייצרת מפתחות חתימה אקראיים לכל הרצה, מוחקת את המסד בסיומה (וגם אם ההכנה נכשלה באמצע) ועוצרת את כל התהליכים. טעינת התצורה (`playwright test --list`) אינה יוצרת דבר. היא אינה חלק מ-`npm test`.

### פריסה

`wrangler.jsonc` ממשיך להגיש את דף ה-placeholder מ-`./public` עד להחלטה על אירוח ה-API (ADR נפרד, P8).
