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

`wrangler.jsonc` מגיש את `./public`, שמכיל כעת את הדמו החזיתי (ראו "דמו באתר החי" למטה), עד להחלטה על אירוח ה-API (ADR נפרד, P8). ה-build האמיתי אינו מוגש משם.

## דמו באתר החי

האתר הציבורי (Cloudflare, `wrangler.jsonc` → `./public`) מגיש **דמו חזיתי בלבד** של אפליקציית ה-Angular של M1: אותם מסכים, אותו אשף, אישור ומעקב, אבל **בלי שרת**. כל קריאות ה-`/v1` נענות בתוך הדפדפן על ידי API מדומה (`src/frontend/src/app/demo`) עם נתונים סינתטיים בלבד: דנה (יוצרת), מאיר (מאשר) ורינה (צפייה), שני משלוחים ששוחררו ומשלוח אחד ממתין לאישור ("טיול שנתי — אישור הורים").

- **סימון:** פס קבוע "דמו — נתונים מדומים, אין שרת אמיתי" בכל מסך (כולל כניסה), סיומת "· דמו" בכותרת הדף, והתג הקיים "Sandbox (מדומה)". כפתור "איפוס דמו" מוחק את מצב הלשונית וטוען מחדש את נתוני הדוגמה.
- **מצב:** בזיכרון וב-`sessionStorage` של הלשונית בלבד (נעלם בסגירתה). קבצי CSV/XLSX שמעלים נקראים בדפדפן ואינם נשלחים לשום מקום; נשמרות רק מסכות (שם ראשון וראשי תיבות, טלפון ממוסך).
- **הכללים נשמרים:** תפקידים, אישור שנקשר לחבילה ומתבטל בעריכה, חסימת אישור עצמי מעל 1,000 נמענים (`SELF_APPROVAL_ABOVE_THRESHOLD`), בדיקה לפני הגשה. הפרשים מהשרת האמיתי: חלון השעות תמיד פתוח, `Idempotency-Key` לא נבדק, והתקדמות ההודעות (התקבל, נשלח, נמסר, אחת "לא ידוע" ואחת נדחתה) מחושבת מזמן השחרור (כ-25 שניות) ולכן ממשיכה גם אחרי רענון. כל המספרים והתוויות מגיעים מה-API המדומה, לא מחושבים בלקוח.
- **ה-build האמיתי נקי:** הקוד המדומה נטען רק מ-`src/main.demo.ts` (קונפיגורציית `demo` ב-`angular.json`); `npm run build` לא כולל אותו.

לייצור מחדש של התוכן ב-`public/` (הפלט נשמר ב-repo בכוונה):

    cd src/frontend
    npm ci
    npm run demo:publish      # בונה עם --configuration demo (base href "/", בלי sourcemaps) ומחליף את public/
    npm run e2e:demo          # בדיקת Playwright מול ה-build המדומה (בלי שרת ובלי מסד); לא חלק מ-npm test

לבדיקה מקומית של התוצאה: `node scripts/serve-static.mjs ../../public 4291` (שרת סטטי עם fallback ל-SPA, כמו `not_found_handling` ב-Cloudflare).
