import { DISPLAY_STATUSES, DisplayStatus } from '../ui/status';
import { Channel } from '../ui/channel-chip/channel-chip.component';

/* Display formatting only. Values and statuses come from the server; nothing here derives a status or a count. */

const NUM = new Intl.NumberFormat('he-IL');
const ILS = new Intl.NumberFormat('he-IL', { style: 'currency', currency: 'ILS', maximumFractionDigits: 2 });
const PCT = new Intl.NumberFormat('he-IL', { style: 'percent', maximumFractionDigits: 1 });
const TIME = new Intl.DateTimeFormat('he-IL', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
const DATETIME = new Intl.DateTimeFormat('he-IL', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });

export const formatNumber = (n: number): string => NUM.format(n);
export const formatIls = (n: number): string => ILS.format(n);
/** Rate as returned by the server (0–1). null stays null: the KPI card shows "לא ניתן לחישוב". */
export const formatRate = (v: number | null): string | null => (v === null || v === undefined ? null : PCT.format(v));

export function formatTime(iso: string | Date | null | undefined): string {
  if (!iso) return 'לא ידוע';
  const d = typeof iso === 'string' ? new Date(iso) : iso;
  return Number.isNaN(d.getTime()) ? 'לא ידוע' : TIME.format(d);
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return 'לא ידוע';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? 'לא ידוע' : DATETIME.format(d);
}

export const PURPOSE_LABEL: Record<string, string> = {
  SERVICE: 'שירות',
  OPERATIONAL: 'תפעולי',
  PUBLIC_INFO: 'מידע לציבור',
  EMERGENCY: 'חירום',
  PROMOTIONAL: 'קידום',
};

/** Campaign lifecycle state codes (server) → Hebrew label. An unmapped code is shown as-is. */
export const STATE_LABEL: Record<string, string> = {
  DRAFT: 'טיוטה',
  SUBMITTED: 'ממתין לאישור',
  APPROVED: 'אושר',
  RELEASED: 'שוחרר לשליחה',
};

export const purposeLabel = (code: string): string => PURPOSE_LABEL[code] ?? code;
export const stateLabel = (code: string): string => STATE_LABEL[code] ?? code;

export function asChannel(c: string | null | undefined): Channel | null {
  return c === 'SMS' || c === 'WHATSAPP' || c === 'EMAIL' ? c : null;
}

/** Server display status → badge key. An unrecognised value renders as Unknown (with the server's own label). */
export function asDisplayStatus(s: string): DisplayStatus {
  return (DISPLAY_STATUSES as readonly string[]).includes(s) ? (s as DisplayStatus) : 'Unknown';
}
