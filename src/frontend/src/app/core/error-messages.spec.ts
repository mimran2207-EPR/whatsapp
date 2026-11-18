import { HttpErrorResponse } from '@angular/common/http';
import { apiError, errorMessageHe } from './error-messages';

describe('errorMessageHe', () => {
  it.each([
    ['SELF_APPROVAL_ABOVE_THRESHOLD', 'לא ניתן לאשר משלוח שיצרת מעל 1,000 נמענים'],
    ['STALE_REVISION', 'המשלוח השתנה מאז ההגשה — נדרשת בדיקה מחדש'],
    ['APPROVAL_INVALID', 'האישור אינו תקף לגרסה הנוכחית'],
    ['OUTSIDE_SEND_WINDOW', 'מחוץ לחלון השעות — תזמנו לשעה מותרת'],
  ])('maps %s verbatim', (code, text) => {
    expect(errorMessageHe(code)).toBe(text);
  });

  it('falls back to a generic Hebrew message for an unknown code', () => {
    expect(errorMessageHe('SOMETHING_NEW')).toBe('הפעולה נכשלה. נסו שוב או פנו לתמיכה.');
    expect(errorMessageHe(null)).toBe('הפעולה נכשלה. נסו שוב או פנו לתמיכה.');
  });
});

describe('apiError', () => {
  it('reads the server code from the response body', () => {
    const e = apiError(new HttpErrorResponse({ status: 409, error: { code: 'STALE_REVISION' } }));
    expect(e).toEqual({ status: 409, code: 'STALE_REVISION', messageHe: 'המשלוח השתנה מאז ההגשה — נדרשת בדיקה מחדש', body: { code: 'STALE_REVISION' } });
  });

  it('reports a network failure (status 0) without inventing a code', () => {
    const e = apiError(new HttpErrorResponse({ status: 0 }));
    expect(e.code).toBeNull();
    expect(e.messageHe).toBe('אין חיבור לשרת. אפשר לנסות שוב — הפעולה לא תבוצע פעמיים.');
  });
});
