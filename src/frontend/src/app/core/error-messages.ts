import { HttpErrorResponse } from '@angular/common/http';

const GENERIC = 'הפעולה נכשלה. נסו שוב או פנו לתמיכה.';
const NETWORK = 'אין חיבור לשרת. אפשר לנסות שוב — הפעולה לא תבוצע פעמיים.';

/** Server error code → Hebrew message. The four approval/release texts are verbatim from the plan (Task 9). */
const MESSAGES: Record<string, string> = {
  SELF_APPROVAL_ABOVE_THRESHOLD: 'לא ניתן לאשר משלוח שיצרת מעל 1,000 נמענים',
  STALE_REVISION: 'המשלוח השתנה מאז ההגשה — נדרשת בדיקה מחדש',
  APPROVAL_INVALID: 'האישור אינו תקף לגרסה הנוכחית',
  OUTSIDE_SEND_WINDOW: 'מחוץ לחלון השעות — תזמנו לשעה מותרת',
  NOT_APPROVER: 'אין לך הרשאת אישור למשלוח זה',
  FORBIDDEN_ROLE: 'אין לך הרשאה לפעולה זו',
  FORBIDDEN_DEPARTMENT: 'המשלוח שייך למחלקה אחרת',
  ALREADY_RELEASED: 'המשלוח כבר שוחרר לשליחה',
  INVALID_STATE: 'מצב המשלוח אינו מאפשר את הפעולה',
  PREFLIGHT_BLOCKED: 'יש חסמים בבדיקה — יש לתקן לפני הגשה',
  DRAFT_INCOMPLETE: 'הטיוטה חסרה קהל, ערוץ או תוכן',
  CHANNEL_NOT_SUPPORTED: 'הערוץ אינו נתמך בשלב זה',
  AUDIENCE_NOT_FOUND: 'הקהל לא נמצא',
  NOT_FOUND: 'המשלוח לא נמצא',
  VALIDATION_FAILED: 'חלק מהשדות חסרים או אינם תקינים',
  FILE_TOO_LARGE: 'הקובץ גדול מדי',
  FILE_TOO_LARGE_UNCOMPRESSED: 'הקובץ גדול מדי לאחר פריסה',
  UNSUPPORTED_FILE: 'סוג הקובץ אינו נתמך. אפשר להעלות XLSX או CSV',
  UNREADABLE_FILE: 'לא ניתן לקרוא את הקובץ',
  TOO_MANY_ROWS: 'בקובץ יש יותר שורות מהמותר',
  TOO_MANY_COLUMNS: 'בקובץ יש יותר עמודות מהמותר',
  MAPPING_COLUMN_NOT_FOUND: 'עמודה שנבחרה במיפוי לא נמצאה בקובץ',
  IDEMPOTENCY_CONFLICT: 'הפעולה כבר נשלחה עם נתונים אחרים. רעננו את הדף ונסו שוב',
  IDEMPOTENCY_IN_PROGRESS: 'הפעולה עדיין מתבצעת. המתינו רגע ובדקו שוב',
  IDEMPOTENCY_KEY_REQUIRED: GENERIC,
  UNKNOWN_DEV_USER: 'המשתמש אינו מוכר',
};

export function errorMessageHe(code: string | null | undefined): string {
  return (code && MESSAGES[code]) || GENERIC;
}

export interface ApiError {
  status: number;
  /** The server's `code`, or null when there is none (network failure, non-JSON body). Never invented. */
  code: string | null;
  messageHe: string;
  body: unknown;
}

export function apiError(err: unknown): ApiError {
  if (err instanceof HttpErrorResponse) {
    const body: unknown = err.error;
    const code = body && typeof body === 'object' && typeof (body as { code?: unknown }).code === 'string' ? (body as { code: string }).code : null;
    return { status: err.status, code, messageHe: err.status === 0 ? NETWORK : errorMessageHe(code), body: body ?? null };
  }
  return { status: 0, code: null, messageHe: GENERIC, body: null };
}
