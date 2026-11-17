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

מצב: שלב 0 — חוזי נתונים בלבד. אין Workers, ספקים או ממשק משתמש. כל הנתונים סינתטיים.
