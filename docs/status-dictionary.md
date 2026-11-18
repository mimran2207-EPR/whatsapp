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
- הסתירה דביקה: היא נשמרת ב-`Message.delivery_conflict`. הקורא מעביר `currentlyConflicting: message.delivery_conflict`, התוצאה נשארת "לא ידוע" עם דגל סתירה, ורק התאמה מפורשת (reconciliation) מנקה אותה. איכות מידע מאוחרת (Late/Partial) לעולם אינה מנקה אותה, כי הדגל נפרד מ-DataQuality.

התווית היא עזר תצוגה בלבד. מדדים נספרים לפי הצירים, והמונים של צירים שונים עשויים לחפוף (סעיף 21.3).

## החלטות גזירה מפורשות

- DataQuality לעולם אינו משנה את תווית התצוגה; הוא מוצג בנפרד (תג/הסבר).
- צירים סותרים: Failed (מסירה) ו-Rejected (העברה) גוברים על Delivered/Read/Opened; האירועים הגולמיים נשמרים וציר האיכות מסמן את הסתירה.
- ביטול אחרי העברה לספק מוצג לפי מצב הספק, כי הודעה שהספק קיבל אינה ניתנת להבטחת ביטול (סעיף 4).
- InProgress מוצג כ"בתור" (המשתמש אינו צריך להבחין בין ממתין בתור לבין בעיבוד).

## Delivery buckets (campaign list and tracking summary)

Both the campaign list counts and the tracking summary use one SQL expression (`MessageBuckets` in `ResidentComms.Infrastructure`), in the same precedence as the deriver above:

1. delivery `FAILED` or hand-off `REJECTED` -> failed
2. delivery `DELIVERED` -> delivered
3. delivery `SENT_PER_PROVIDER` -> sent (tracking: `sentOrNotReported`)
4. delivery `UNKNOWN` or hand-off `UNKNOWN` (e.g. a timeout after send) -> unknown
5. otherwise -> not reported (tracking: `sentOrNotReported`)

Tracking `dataAsOf` is the time of the latest provider event received for the campaign (the current time when none has arrived yet).

## Separation of duties

The "above N recipients, not the same person" approval rule is checked against the campaign creator, everyone who edited the current revision, and whoever submitted it (`CampaignRevisionActor`, migration V006). A new revision (edit after submit, reopen) copies the EDIT actors of the revision it was built from, because it carries that content; SUBMIT actors are not copied (a resubmission is a new act). So anyone who ever shaped the text stays a contributor for the rest of the campaign.

## Adapter failures

Only `ProviderNotReachedException` (the request provably never left) is a retryable LOCAL_FAILURE. Any other adapter exception, including a timeout after send, is AMBIGUOUS (hand-off UNKNOWN) and is never resent automatically.
