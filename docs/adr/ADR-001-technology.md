# ADR-001 — טכנולוגיה

- מצב: התקבל, 17.11.2026
- הקשר: האפיון אינו בוחר טכנולוגיה (הנחיה 2).
- החלטה: Angular ל-Frontend, C# / ASP.NET Core (.NET 10) ל-Backend, SQL Server למסד. מיגרציות כ-T-SQL גולמי ב-`db/migrations`.
- נימוק: בחירת המשתמש, תואם לצוות ולתשתית הרשויות (SQL Server on-prem).
- השלכות: חוזי נתונים נכתבים ל-SQL Server. בדיקות אינטגרציה רצות מול SQL Server מקומי.
