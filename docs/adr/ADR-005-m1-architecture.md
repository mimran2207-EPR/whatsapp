# ADR-005 — ארכיטקטורת M1

- מצב: התקבל, 17.11.2026
- החלטות: מסד `whatsapp` על SQL Server המקומי · Dapper מעל מיגרציות T-SQL · Outbox בטבלה + BackgroundService · כניסת פיתוח מדומה (JWT מקומי) מאחורי ITokenIssuer/ICurrentUser · ISmsAdapter עם MockSmsAdapter · רכיבי Angular משלנו מ-tokens.json + Angular CDK.
- נדחה: EF Core (כפילות מקור אמת לסכימה), RabbitMQ/Service Bus ב-M1 (תשתית נוספת ללא צורך), ספריית UI (פוגעת בנאמנות ל-Muni וב-RTL).
- פתוח: אירוח API (סוף M1), IdentityService מול OIDC (ADR-003).
