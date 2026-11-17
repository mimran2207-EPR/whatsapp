# ADR-004 — הרכבת מפתח Idempotency להודעה

- מצב: התקבל, 17.11.2026
- הקשר: סעיף 15 באפיון מגדיר מפתח Idempotency להודעה: משלוח + נמען + ערוץ + שלב. UQ_Message_Logical כולל גם campaign_revision_id, ו-campaign_recipient_id משתנה בכל Snapshot, ולכן אינו מזהה "אותו אדם" בין גרסאות.
- החלטה: `idempotency_key = SHA-256 hex של "tenant_id|campaign_id|approved_identity_key|channel|channel_sequence_no"` (מחרוזות קנוניות, GUID באותיות קטנות). המפתח אינו כולל revision, ולכן אישור מחדש של משלוח אינו יוצר משלוח שני לאותו אדם באותו ערוץ ושלב. משלוח חוזר מכוון הוא משלוח־בן (campaign_id חדש).
- השלכות: UQ_Message_Idempotency (tenant_id, idempotency_key) הוא המחסום בפועל מפני שליחה כפולה בין גרסאות; UQ_Message_Logical מונע כפילות בתוך גרסה. המימוש בשלב 1.
