/** Import validation codes (ImportValidator / PhoneIssue on the server) → Hebrew. Unknown codes are shown as-is. */
export const IMPORT_CODE_HE: Record<string, string> = {
  Empty: 'טלפון חסר',
  ScientificNotation: 'טלפון בכתיב מדעי (לא משוחזר)',
  LostLeadingZero: 'אפס מוביל חסר בטלפון (לא משוחזר)',
  InvalidLength: 'אורך טלפון שגוי',
  NotMobile: 'הטלפון אינו נייד',
  NonDigits: 'תווים לא חוקיים בטלפון',
  FORMULA_VALUE: 'נוסחה בתא (לא הורצה)',
  MISSING_ID: 'מזהה חסר',
  ID_SCIENTIFIC: 'מזהה בכתיב מדעי',
  DUPLICATE_ID: 'מזהה כפול',
};

export const importCodeHe = (code: string): string => IMPORT_CODE_HE[code] ?? code;
