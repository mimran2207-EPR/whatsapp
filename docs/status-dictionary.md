# מילון סטטוסים

מקור: סעיף 9 באפיון. מימוש: `src/backend/ResidentComms.Domain/Status/`.

## חמשת הצירים

| ציר | ערכים (Enum) |
| --- | --- |
| תהליך פנימי — ProcessingState | RejectedBeforeSend · Pending · Queued · InProgress · Canceled |
| העברה לספק — HandoffState | NotHandedOff · HandedOff · Accepted · Rejected · Unknown |
| מסירה — DeliveryState | NotReported · SentPerProvider · Delivered · Failed · Unknown |
| אינטראקציה — InteractionFlags | ReadAt · OpenedAt · ClickedAt · RepliedAt · OptedOutAt |
| איכות מידע — DataQuality | Current · Partial · Late · Conflicting · Unsupported |

## גזירת התווית (סדר העדיפות הוא החוזה)

1. RejectedBeforeSend בציר התהליך ← **נפסל לפני שליחה**
2. Canceled לפני העברה לספק ← **בוטל**
3. Delivery = Failed ← **נכשל**
4. Handoff = Rejected ← **נדחה**
5. ReadAt קיים ← **נקרא**
6. OpenedAt קיים ← **נפתח**
7. Delivery = Delivered ← **נמסר**
8. Delivery = SentPerProvider ← **נשלח לפי הספק**
9. Delivery = Unknown או Handoff = Unknown ← **לא ידוע**
10. Handoff = Accepted ← **התקבל אצל הספק**
11. Handoff = HandedOff ← **הועבר לספק**
12. Queued / InProgress ← **בתור**
13. אחרת ← **ממתין**

הערה: ביטול אחרי העברה לספק מוצג לפי מצב הספק, כי אין הבטחה לבטל הודעה שהספק קיבל (סעיף 4).

## מיזוג מצב מסירה (DeliveryMerge)

- "נשלח" שמגיע אחרי "נמסר" אינו מוריד מצב.
- "לא ידוע" אינו דורס תוצאה מוכרעת; תוצאה מוכרעת מחליפה "לא ידוע".
- "נמסר" מול "נכשל" ← "לא ידוע" + דגל סתירה. הקורא מסמן DataQuality = Conflicting ושומר את כל האירועים הגולמיים.
- אירוע כפול אינו משנה מצב.
- הסתירה דביקה: כאשר DataQuality של ההודעה הוא Conflicting, הקורא מעביר `currentlyConflicting: true`, התוצאה נשארת "לא ידוע" עם דגל סתירה, ורק התאמה מפורשת (reconciliation) מנקה אותה.

התווית היא עזר תצוגה בלבד. מדדים נספרים לפי הצירים, והמונים של צירים שונים עשויים לחפוף (סעיף 21.3).

## החלטות גזירה מפורשות

- DataQuality לעולם אינו משנה את תווית התצוגה; הוא מוצג בנפרד (תג/הסבר).
- צירים סותרים: Failed (מסירה) ו-Rejected (העברה) גוברים על Delivered/Read/Opened; האירועים הגולמיים נשמרים וציר האיכות מסמן את הסתירה.
- ביטול אחרי העברה לספק מוצג לפי מצב הספק, כי הודעה שהספק קיבל אינה ניתנת להבטחת ביטול (סעיף 4).
- InProgress מוצג כ"בתור" (המשתמש אינו צריך להבחין בין ממתין בתור לבין בעיבוד).
