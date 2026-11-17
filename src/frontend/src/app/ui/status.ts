import { IconName } from './icon/icon-paths';

/** The 13 display statuses (docs/status-dictionary.md). The server derives them; the client only renders. */
export const DISPLAY_STATUSES = [
  'RejectedBeforeSend',
  'Pending',
  'Queued',
  'HandedOff',
  'AcceptedByProvider',
  'SentPerProvider',
  'Delivered',
  'Read',
  'Opened',
  'Failed',
  'Rejected',
  'Canceled',
  'Unknown',
] as const;

export type DisplayStatus = (typeof DISPLAY_STATUSES)[number];

export type StatusGroup = 'neutral' | 'progress' | 'success' | 'info' | 'danger' | 'unknown';

/** Visual group per status, as drawn in Figma "02 Components" › StatusBadge (6:63). */
export const STATUS_GROUP: Record<DisplayStatus, StatusGroup> = {
  RejectedBeforeSend: 'danger',
  Pending: 'neutral',
  Queued: 'neutral',
  HandedOff: 'progress',
  AcceptedByProvider: 'progress',
  SentPerProvider: 'progress',
  Delivered: 'success',
  Read: 'info',
  Opened: 'info',
  Failed: 'danger',
  Rejected: 'danger',
  Canceled: 'neutral',
  Unknown: 'unknown',
};

export const STATUS_ICON: Record<DisplayStatus, IconName> = {
  RejectedBeforeSend: 'minus-circle',
  Pending: 'clock',
  Queued: 'list',
  HandedOff: 'arrow-out',
  AcceptedByProvider: 'inbox',
  SentPerProvider: 'send',
  Delivered: 'double-check',
  Read: 'eye',
  Opened: 'mail-open',
  Failed: 'x',
  Rejected: 'ban',
  Canceled: 'pause',
  Unknown: 'help-circle',
};

/** Fallback Hebrew labels (same text as DisplayStatusLabels.He on the server). Prefer the label the API returns. */
export const STATUS_LABEL_HE: Record<DisplayStatus, string> = {
  RejectedBeforeSend: 'נפסל לפני שליחה',
  Pending: 'ממתין',
  Queued: 'בתור',
  HandedOff: 'הועבר לספק',
  AcceptedByProvider: 'התקבל אצל הספק',
  SentPerProvider: 'נשלח לפי הספק',
  Delivered: 'נמסר',
  Read: 'נקרא',
  Opened: 'נפתח',
  Failed: 'נכשל',
  Rejected: 'נדחה',
  Canceled: 'בוטל',
  Unknown: 'לא ידוע',
};
