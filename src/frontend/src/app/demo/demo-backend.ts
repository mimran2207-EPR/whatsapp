import { maskId, maskName, maskPhone, Mapping, readSheet, validateRows } from './demo-import';

/**
 * DEMO ONLY: an in-browser fake of the /v1 API (RC_DEMO_FAKE_BACKEND_a91f).
 *
 * It reproduces the contract and the rules the UI depends on (src/backend/ResidentComms.Api/Endpoints/*.cs): roles, the
 * campaign lifecycle DRAFT -> SUBMITTED -> APPROVED -> RELEASED, package hash binding, approval invalidated on edit, self-approval
 * above the threshold, preflight findings, the server-side tracking read model (counters, bannerHe, display labels, dataAsOf).
 * The client never computes a status: every number and label below comes from here, exactly as from the real API.
 *
 * Deliberate differences from the real server (it is a demo): the send window is always open, Idempotency-Key is ignored,
 * state lives in memory + sessionStorage (one tab), and message progress is a pure function of the release time (no timers),
 * so it keeps moving across reloads. Synthetic data only; an uploaded file is parsed in the browser and never sent anywhere.
 */

export const DEMO_MARKER = 'RC_DEMO_FAKE_BACKEND_a91f';
export const STATE_KEY = 'rc.demo.state.v1';

const TENANT_ID = '11111111-1111-1111-1111-111111111111';
const DEPARTMENT = 'EDU';
const SELF_APPROVAL_MAX = 1000;
const MAX_CONTENT = 2000;
const MAX_ROWS = 20_000;
const MAX_COLUMNS = 50;
const MAX_FILE_BYTES = 10 * 1024 * 1024;
const PURPOSES = ['SERVICE', 'OPERATIONAL', 'PUBLIC_INFO', 'EMERGENCY', 'PROMOTIONAL'];

type Role = 'creator' | 'approver' | 'analyst';
interface DemoUser {
  id: string;
  name: string;
  role: Role;
}
export const DEMO_USERS: readonly DemoUser[] = [
  { id: 'dana', name: 'דנה לוי', role: 'creator' },
  { id: 'meir', name: 'מאיר ברק', role: 'approver' },
  { id: 'rina', name: 'רינה כהן', role: 'analyst' },
];

export interface Reply {
  status: number;
  body: unknown;
}
export interface Call {
  method: string;
  path: string;
  /** Bearer token, or null. */
  token: string | null;
  body?: unknown;
  /** Multipart upload (POST /v1/import-jobs). */
  file?: File | null;
}

interface Audience {
  audienceVersionId: string;
  importRunId: string;
  fileName: string | null;
  rowCount: number;
  validCount: number;
  invalidCount: number;
  fieldNames: string[];
  /** Masked phone of each eligible (valid) recipient, in row order. Raw numbers are never kept. */
  phones: string[];
  firstName: string | null;
  firstVars: Record<string, string | null> | null;
  /** Variable column -> number of eligible recipients whose cell is empty. */
  blank: Record<string, number>;
  errors: { row: number; sourceRecipientId: string; codes: string[] }[];
}

interface ReleasePlan {
  at: number;
  count: number;
  unknown: number;
  rejected: number;
}

interface Campaign {
  id: string;
  name: string;
  purpose: string;
  state: 'DRAFT' | 'SUBMITTED' | 'APPROVED' | 'RELEASED';
  createdBy: string;
  createdAt: number;
  updatedAt: number;
  revisionId: string;
  revisionNo: number;
  /** Everyone who edited or submitted the current revision (plus createdBy): the self-approval contributors. */
  actors: string[];
  channel: string | null;
  contentText: string | null;
  fieldDefaults: Record<string, string>;
  scheduledAt: string | null;
  audienceVersionId: string | null;
  packageHash: string | null;
  approval: { id: string; by: string; at: number; invalidated: boolean } | null;
  release: ReleasePlan | null;
}

interface State {
  campaigns: Campaign[];
  audiences: Record<string, Audience>;
}

export interface DemoOptions {
  now?: () => number;
  storage?: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | null;
  selfApprovalMax?: number;
}

const ERROR_STATUS: Record<string, number> = {
  NOT_FOUND: 404,
  FORBIDDEN_ROLE: 403,
  FORBIDDEN_DEPARTMENT: 403,
  NOT_APPROVER: 403,
  SELF_APPROVAL_ABOVE_THRESHOLD: 403,
  STALE_REVISION: 409,
  APPROVAL_INVALID: 409,
  ALREADY_RELEASED: 409,
  INVALID_STATE: 409,
  VALIDATION_FAILED: 400,
  FILE_TOO_LARGE: 413,
};
const err = (code: string, details?: Record<string, unknown>): Reply => ({ status: ERROR_STATUS[code] ?? 422, body: { code, ...details } });
const ok = (body: unknown, status = 200): Reply => ({ status, body });

function uuid(): string {
  const c = globalThis.crypto;
  if (c?.randomUUID) return c.randomUUID();
  const h = () => Math.floor(Math.random() * 0x10000).toString(16).padStart(4, '0');
  return `${h()}${h()}-${h()}-4${h().slice(1)}-a${h().slice(1)}-${h()}${h()}${h()}`;
}

/** 64 hex chars, deterministic (stands in for the server's SHA-256 package hash; not a security primitive). */
function hash64(text: string): string {
  let out = '';
  for (let round = 0; round < 8; round++) {
    let h1 = 0xdeadbeef ^ round;
    let h2 = 0x41c6ce57 ^ round;
    for (let i = 0; i < text.length; i++) {
      const ch = text.charCodeAt(i);
      h1 = Math.imul(h1 ^ ch, 2654435761);
      h2 = Math.imul(h2 ^ ch, 1597334677);
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    out += (h1 >>> 0).toString(16).padStart(8, '0');
  }
  return out;
}

const b64url = (s: string): string => btoa(String.fromCharCode(...new TextEncoder().encode(s))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

/** Unsigned, JWT-shaped demo token (header.payload.signature) that the client's guard can read. It authenticates nothing real. */
export function makeDemoToken(user: DemoUser, now: number): string {
  const payload = { sub: user.id, name: user.name, role: user.role, exp: Math.floor(now / 1000) + 8 * 3600, demo: true };
  return `${b64url('{"alg":"none","typ":"JWT"}')}.${b64url(JSON.stringify(payload))}.demo-unsigned`;
}

function userFromToken(token: string | null, now: number): DemoUser | null {
  if (!token) return null;
  try {
    const part = token.split('.')[1];
    const b64 = part.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(part.length / 4) * 4, '=');
    const p = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)))) as { sub?: string; exp?: number };
    if (typeof p.exp === 'number' && p.exp * 1000 <= now) return null;
    return DEMO_USERS.find((u) => u.id === p.sub) ?? null;
  } catch {
    return null;
  }
}

/* ---------- templates, segments, masks ---------- */

const TOKEN = /\{([^{}]+)\}/g;

function templateFields(text: string): string[] {
  return Array.from(new Set(Array.from(text.matchAll(TOKEN), (m) => m[1])));
}

function render(template: string, values: Record<string, string | null>, defaults: Record<string, string>): string {
  return template.replace(TOKEN, (_, key: string) => {
    const v = values[key];
    if (v !== undefined && v !== null && v !== '') return v;
    return defaults[key] ?? '';
  });
}

function smsSegments(text: string): { encoding: string; segments: number } {
  const gsm = /^[\x20-\x7e\n\r]*$/.test(text);
  const [single, multi] = gsm ? [160, 153] : [70, 67];
  const len = text.length;
  return { encoding: gsm ? 'GSM-7' : 'UCS-2', segments: len === 0 ? 0 : len <= single ? 1 : Math.ceil(len / multi) };
}

const normalizeSpace = (s: string): string => s.trim().replace(/\s+/g, ' ');

/* ---------- message progress: a pure function of (campaign, elapsed time) ---------- */

const jitter = (i: number, k: number): number => ((Math.imul(i + 1, 2654435761) ^ Math.imul(k + 7, 1597334677)) >>> 0) / 0x100000000;

interface MsgPlan {
  kind: 'ok' | 'unknown' | 'rejected';
  accept: number;
  sent: number;
  deliver: number;
  /** When a timeout / rejection becomes known. */
  event: number;
}

/** Messages 0..n-1: the last `unknown` ones time out, the `rejected` ones before them are rejected, the rest are accepted, sent, delivered (~28 s in all). */
function planMessage(i: number, rel: ReleasePlan): MsgPlan {
  const n = rel.count;
  const accept = 800 + (i / Math.max(1, n)) * 7000 + jitter(i, 1) * 1500;
  const sent = accept + 3000 + jitter(i, 2) * 4000;
  const deliver = sent + 4000 + jitter(i, 3) * 8000;
  const fromEnd = n - 1 - i;
  if (fromEnd < rel.unknown) return { kind: 'unknown', accept, sent, deliver, event: 11_000 + jitter(i, 4) * 3000 };
  if (fromEnd < rel.unknown + rel.rejected) return { kind: 'rejected', accept, sent, deliver, event: 5000 + jitter(i, 5) * 2000 };
  return { kind: 'ok', accept, sent, deliver, event: 0 };
}

interface Progress {
  total: number;
  accepted: number;
  rejected: number;
  hUnknown: number;
  notHandedOff: number;
  delivered: number;
  sentOrNotReported: number;
  dUnknown: number;
  failed: number;
  /** Elapsed ms of the latest provider event so far; null when none yet. */
  lastEvent: number | null;
  exceptions: { index: number; kind: 'unknown' | 'rejected' }[];
}

function progress(rel: ReleasePlan | null, now: number): Progress {
  const p: Progress = { total: rel?.count ?? 0, accepted: 0, rejected: 0, hUnknown: 0, notHandedOff: 0, delivered: 0, sentOrNotReported: 0, dUnknown: 0, failed: 0, lastEvent: null, exceptions: [] };
  if (!rel) return p;
  const e = Math.max(0, now - rel.at);
  const seen = (t: number) => (p.lastEvent = Math.max(p.lastEvent ?? 0, t));
  for (let i = 0; i < rel.count; i++) {
    const m = planMessage(i, rel);
    if (m.kind === 'ok') {
      if (e >= m.accept) {
        p.accepted++;
        seen(m.accept);
      } else p.notHandedOff++;
      if (e >= m.sent) seen(m.sent);
      if (e >= m.deliver) {
        p.delivered++;
        seen(m.deliver);
      } else p.sentOrNotReported++;
    } else if (e >= m.event) {
      seen(m.event);
      if (m.kind === 'unknown') {
        p.hUnknown++;
        p.dUnknown++;
      } else {
        p.rejected++;
        p.failed++;
      }
      p.exceptions.push({ index: i, kind: m.kind });
    } else {
      p.notHandedOff++;
      p.sentOrNotReported++;
    }
  }
  return p;
}

/* ---------- seed ---------- */

function fakePhones(n: number, prefix: string, start: number): string[] {
  return Array.from({ length: n }, (_, i) => `${prefix}-***-**${String((start + i * 7) % 100).padStart(2, '0')}`);
}

function seedAudience(id: string, importRunId: string, file: string, n: number, fields: string[], firstName: string, firstVars: Record<string, string | null>): Audience {
  return {
    audienceVersionId: id,
    importRunId,
    fileName: file,
    rowCount: n,
    validCount: n,
    invalidCount: 0,
    fieldNames: fields,
    phones: fakePhones(n, '052', 11),
    firstName,
    firstVars,
    blank: {},
    errors: [],
  };
}

function baseCampaign(c: Partial<Campaign> & Pick<Campaign, 'id' | 'name' | 'purpose' | 'state' | 'createdAt'>): Campaign {
  return {
    createdBy: 'dana',
    updatedAt: c.createdAt,
    revisionId: uuid(),
    revisionNo: 1,
    actors: ['dana'],
    channel: 'SMS',
    contentText: null,
    fieldDefaults: {},
    scheduledAt: null,
    audienceVersionId: null,
    packageHash: null,
    approval: null,
    release: null,
    ...c,
  };
}

function withHash(c: Campaign): Campaign {
  return { ...c, packageHash: packageHash(c) };
}

function packageHash(c: Campaign): string {
  const defaults = Object.entries(c.fieldDefaults).sort(([a], [b]) => (a < b ? -1 : 1));
  return hash64(JSON.stringify([c.audienceVersionId, c.channel, c.contentText, defaults, c.scheduledAt, 'policy-demo-1']));
}

export function seedState(now: number): State {
  const H = 3600_000;
  const a1 = seedAudience('a0000001-0000-4000-8000-000000000001', 'b0000001-0000-4000-8000-000000000001', 'חיסונים-כיתות-א-דמו.csv', 40, ['שם'], 'רונית כ.', { שם: 'רונית כ.' });
  const a2 = seedAudience('a0000002-0000-4000-8000-000000000002', 'b0000002-0000-4000-8000-000000000002', 'אסיפת-הורים-דמו.csv', 25, ['שם'], 'יעל ל.', { שם: 'יעל ל.' });
  const a3 = seedAudience('a0000003-0000-4000-8000-000000000003', 'b0000003-0000-4000-8000-000000000003', 'טיול-שנתי-דמו.csv', 6, ['כיתה', 'שם'], 'דנה כ.', { שם: 'דנה כ.', כיתה: 'ה2' });
  a3.phones = ['052-***-**11', '052-***-**18', '054-***-**25', '054-***-**32', '050-***-**47', '053-***-**54'];

  const released1 = baseCampaign({
    id: 'c0000001-0000-4000-8000-000000000001',
    name: 'תזכורת חיסונים — כיתות א׳',
    purpose: 'SERVICE',
    state: 'RELEASED',
    createdAt: now - 27 * H,
    contentText: 'שלום {שם}, תזכורת: חיסוני כיתה א׳ יתקיימו ביום ראשון בשעה 09:00 בחדר האחות. נא להחזיר אישור הורים חתום.',
    audienceVersionId: a1.audienceVersionId,
    release: { at: now - 26 * H, count: a1.phones.length, unknown: 1, rejected: 0 },
  });
  const released2 = baseCampaign({
    id: 'c0000002-0000-4000-8000-000000000002',
    name: 'שינוי מועד אסיפת הורים',
    purpose: 'OPERATIONAL',
    state: 'RELEASED',
    createdAt: now - 4 * H,
    contentText: 'שלום {שם}, אסיפת ההורים נדחתה ליום שלישי בשעה 18:30 באולם בית הספר.',
    audienceVersionId: a2.audienceVersionId,
    release: { at: now - 3 * H, count: a2.phones.length, unknown: 0, rejected: 1 },
  });
  const waiting = baseCampaign({
    id: 'c0000003-0000-4000-8000-000000000003',
    name: 'טיול שנתי — אישור הורים',
    purpose: 'SERVICE',
    state: 'SUBMITTED',
    createdAt: now - 50 * 60_000,
    updatedAt: now - 40 * 60_000,
    contentText: 'שלום {שם}, הטיול השנתי של כיתה {כיתה} יוצא ביום חמישי בשעה 07:30 מבית הספר. נא לאשר השתתפות עד יום שלישי.',
    audienceVersionId: a3.audienceVersionId,
  });
  const fix = (c: Campaign) => withHash(c);
  return {
    campaigns: [fix(waiting), fix(released2), fix(released1)].map((c) =>
      c.state === 'RELEASED' ? { ...c, approval: { id: uuid(), by: 'meir', at: c.createdAt + 20 * 60_000, invalidated: false } } : c,
    ),
    audiences: { [a1.audienceVersionId]: a1, [a2.audienceVersionId]: a2, [a3.audienceVersionId]: a3 },
  };
}

/* ---------- the fake server ---------- */

export class DemoBackend {
  private readonly now: () => number;
  private readonly storage: DemoOptions['storage'];
  private readonly selfMax: number;
  private state: State;

  constructor(opts: DemoOptions = {}) {
    this.now = opts.now ?? Date.now;
    this.selfMax = opts.selfApprovalMax ?? SELF_APPROVAL_MAX;
    if (opts.storage === undefined) {
      try {
        this.storage = globalThis.sessionStorage;
      } catch {
        this.storage = null;
      }
    } else this.storage = opts.storage;
    this.state = this.load() ?? this.seed();
  }

  /** "איפוס דמו": drop everything and reseed. */
  reset(): void {
    try {
      this.storage?.removeItem(STATE_KEY);
    } catch {
      /* ignore */
    }
    this.state = this.seed();
  }

  private seed(): State {
    const s = seedState(this.now());
    this.state = s;
    this.save();
    return s;
  }

  private load(): State | null {
    try {
      const raw = this.storage?.getItem(STATE_KEY);
      const s = raw ? (JSON.parse(raw) as State) : null;
      return s && Array.isArray(s.campaigns) && s.audiences ? s : null;
    } catch {
      return null;
    }
  }

  private save(): void {
    try {
      this.storage?.setItem(STATE_KEY, JSON.stringify(this.state));
    } catch {
      /* quota or blocked storage: the demo keeps working from memory */
    }
  }

  async handle(call: Call): Promise<Reply> {
    const method = call.method.toUpperCase();
    const path = call.path.split('?')[0].replace(/\/+$/, '');
    const reply = await this.route(method, path, call);
    if (method !== 'GET') this.save();
    return reply;
  }

  private async route(method: string, path: string, call: Call): Promise<Reply> {
    if (path === '/v1/dev/users' && method === 'GET') return ok(DEMO_USERS.map((u) => ({ id: u.id, name: u.name, role: u.role, tenantId: TENANT_ID, departmentId: DEPARTMENT })));
    if (path === '/v1/dev/login' && method === 'POST') {
      const user = DEMO_USERS.find((u) => u.id === (call.body as { userId?: string } | null)?.userId);
      return user ? ok({ token: makeDemoToken(user, this.now()) }) : { status: 404, body: { code: 'UNKNOWN_DEV_USER' } };
    }
    const user = userFromToken(call.token, this.now());
    if (!user) return { status: 401, body: { code: 'UNAUTHORIZED' } };

    const canAuthor = user.role === 'creator' || user.role === 'approver';
    const canApprove = user.role === 'approver';
    let m: RegExpMatchArray | null;

    if (path === '/v1/campaigns' && method === 'GET') return ok(this.state.campaigns.map((c) => this.listItem(c)));
    if (path === '/v1/campaigns' && method === 'POST') return canAuthor ? this.create(user, call.body) : err('FORBIDDEN_ROLE');
    if (path === '/v1/approvals' && method === 'GET') return ok(canApprove ? this.approvals(user) : []);
    if (path === '/v1/approvals/approved' && method === 'GET') return ok(canApprove ? this.approved() : []);
    if (path === '/v1/import-jobs' && method === 'POST') return canAuthor ? this.importJob(call) : err('FORBIDDEN_ROLE');
    if ((m = path.match(/^\/v1\/import-jobs\/([^/]+)\/errors$/)) && method === 'GET') {
      if (!canAuthor) return err('FORBIDDEN_ROLE');
      const a = Object.values(this.state.audiences).find((x) => x.importRunId === m![1]);
      return a ? ok(a.errors) : err('NOT_FOUND');
    }
    if ((m = path.match(/^\/v1\/campaigns\/([^/]+)(?:\/([a-z]+))?$/))) {
      const c = this.state.campaigns.find((x) => x.id === decodeURIComponent(m![1]));
      const action = m[2] ?? '';
      if (action === '' && method === 'GET') return c ? ok(this.detail(c)) : err('NOT_FOUND');
      if (action === 'tracking' && method === 'GET') return c ? ok(this.tracking(c)) : err('NOT_FOUND');
      if (action === 'draft' && method === 'PATCH') return !canAuthor ? err('FORBIDDEN_ROLE') : c ? this.patch(c, user, call.body) : err('NOT_FOUND');
      if (action === 'reopen' && method === 'POST') return !canAuthor ? err('FORBIDDEN_ROLE') : c ? this.reopen(c, user) : err('NOT_FOUND');
      if (action === 'preflight' && method === 'POST') return !canAuthor ? err('FORBIDDEN_ROLE') : c ? this.preflightReply(c) : err('NOT_FOUND');
      if (action === 'submit' && method === 'POST') return !canAuthor ? err('FORBIDDEN_ROLE') : c ? this.submit(c, user) : err('NOT_FOUND');
      if (action === 'approve' && method === 'POST') return !canApprove ? err('NOT_APPROVER') : c ? this.approve(c, user, call.body) : err('NOT_FOUND');
      if (action === 'release' && method === 'POST') return !canApprove ? err('FORBIDDEN_ROLE') : c ? this.releaseCampaign(c) : err('NOT_FOUND');
    }
    return { status: 404, body: { code: 'NOT_FOUND' } };
  }

  /* ----- read models ----- */

  private audienceOf(c: Campaign): Audience | null {
    return c.audienceVersionId ? (this.state.audiences[c.audienceVersionId] ?? null) : null;
  }

  private listItem(c: Campaign) {
    const a = this.audienceOf(c);
    const p = progress(c.release, this.now());
    return {
      campaignId: c.id,
      name: c.name,
      purpose: c.purpose,
      state: c.state,
      channel: c.channel,
      recipients: c.release ? c.release.count : (a?.validCount ?? 0),
      counts: { accepted: p.accepted, delivered: p.delivered, unknown: p.dUnknown, failed: p.failed },
      dataAsOf: new Date(this.now()).toISOString(),
    };
  }

  private approvals(user: DemoUser) {
    return this.state.campaigns
      .filter((c) => c.state === 'SUBMITTED')
      .filter((c) => !(c.actors.includes(user.id) && this.eligible(c) > this.selfMax))
      .map((c) => ({
        campaignId: c.id,
        name: c.name,
        purpose: c.purpose,
        submittedBy: c.createdBy,
        channel: c.channel,
        recipients: this.eligible(c),
        packageHash: c.packageHash ?? '',
      }));
  }

  private approved() {
    return this.state.campaigns
      .filter((c) => c.state === 'APPROVED' && c.approval && !c.approval.invalidated)
      .map((c) => ({
        campaignId: c.id,
        name: c.name,
        purpose: c.purpose,
        submittedBy: c.createdBy,
        channel: c.channel,
        recipients: this.eligible(c),
        approvedBy: c.approval!.by,
        approvedAt: new Date(c.approval!.at).toISOString(),
      }));
  }

  private eligible(c: Campaign): number {
    return this.audienceOf(c)?.phones.length ?? 0;
  }

  private detail(c: Campaign) {
    const a = this.audienceOf(c);
    let preview: { recipientName: string | null; recipientPhone: string; text: string; missingFields: string[] } | null = null;
    if (a && c.contentText?.trim() && a.phones.length > 0) {
      const masked = a.firstName;
      const values = a.firstVars ?? {};
      const text = render(c.contentText, values, c.fieldDefaults);
      const missing = templateFields(c.contentText).filter((f) => (values[f] === undefined || values[f] === null || values[f] === '') && c.fieldDefaults[f] === undefined);
      preview = { recipientName: masked, recipientPhone: a.phones[0], text, missingFields: missing };
    }
    return {
      campaignId: c.id,
      name: c.name,
      purpose: c.purpose,
      state: c.state,
      createdBy: c.createdBy,
      revisionId: c.revisionId,
      revisionNo: c.revisionNo,
      channel: c.channel,
      contentText: c.contentText,
      fieldDefaults: c.fieldDefaults,
      scheduledAt: c.scheduledAt,
      audience: a
        ? {
            audienceVersionId: a.audienceVersionId,
            importRunId: a.importRunId,
            fileName: a.fileName,
            rowCount: a.rowCount,
            validCount: a.validCount,
            invalidCount: a.invalidCount,
            eligibleRecipients: a.phones.length,
            fieldNames: a.fieldNames,
          }
        : null,
      preview,
    };
  }

  private tracking(c: Campaign) {
    const now = this.now();
    const p = progress(c.release, now);
    const handedOff = p.total - p.notHandedOff;
    const label = { unknown: 'לא ידוע', rejected: 'נדחה' };
    const status = { unknown: 'Unknown', rejected: 'Rejected' };
    const phones = this.audienceOf(c)?.phones ?? [];
    return {
      environment: 'sandbox-mock',
      dataAsOf: new Date(c.release && p.lastEvent !== null ? c.release.at + p.lastEvent : now).toISOString(),
      messages: p.total,
      delivery: { delivered: p.delivered, sentOrNotReported: p.sentOrNotReported, unknown: p.dUnknown, failed: p.failed },
      handoff: { accepted: p.accepted, rejected: p.rejected, unknown: p.hUnknown, notHandedOff: p.notHandedOff },
      kpis: [
        { key: 'accepted', value: p.accepted, numerator: p.accepted, denominator: p.total },
        { key: 'operationalDeliveryRate', value: handedOff === 0 ? null : Math.round((p.delivered / handedOff) * 10000) / 10000, numerator: p.delivered, denominator: handedOff },
      ],
      bannerHe: `${p.accepted} הודעות התקבלו אצל הספק. תוצאות המסירה ממשיכות להתעדכן.`,
      exceptions: p.exceptions.slice(0, 50).map((x) => ({
        messageId: `${c.id.slice(0, 24)}${x.index.toString(16).padStart(12, '0')}`,
        recipientMasked: phones[x.index] ?? '***',
        displayStatus: status[x.kind],
        displayLabelHe: label[x.kind],
        lastAttempt: x.kind === 'unknown' ? 'ניסיון 1 · Timeout' : 'ניסיון 1 · Rejected (INVALID_DESTINATION)',
        nextActionHe: x.kind === 'unknown' ? 'בירור' : 'בדיקת סיבת הדחייה',
      })),
    };
  }

  /* ----- commands ----- */

  private touch(c: Campaign): void {
    c.updatedAt = this.now();
  }

  private create(user: DemoUser, body: unknown): Reply {
    const b = (body ?? {}) as { name?: unknown; purpose?: unknown };
    const name = typeof b.name === 'string' ? b.name.trim() : '';
    if (!name || name.length > 200 || typeof b.purpose !== 'string' || !PURPOSES.includes(b.purpose)) return err('VALIDATION_FAILED');
    const now = this.now();
    const c = baseCampaign({ id: uuid(), name, purpose: b.purpose, state: 'DRAFT', createdAt: now, createdBy: user.id, actors: [user.id], channel: null });
    this.state.campaigns.unshift(c);
    return ok({ campaignId: c.id, revisionId: c.revisionId }, 201);
  }

  private newRevision(c: Campaign, user: DemoUser): boolean {
    c.revisionId = uuid();
    c.revisionNo += 1;
    const invalidated = !!c.approval && !c.approval.invalidated;
    if (c.approval) c.approval = { ...c.approval, invalidated: true };
    c.packageHash = null;
    if (!c.actors.includes(user.id)) c.actors.push(user.id);
    return invalidated;
  }

  private patch(c: Campaign, user: DemoUser, body: unknown): Reply {
    if (!body || typeof body !== 'object' || Array.isArray(body)) return err('VALIDATION_FAILED');
    const p = body as { audienceVersionId?: string | null; channel?: string | null; contentText?: string | null; fieldDefaults?: Record<string, string> | null; scheduledAt?: string | null };
    if (p.channel != null && p.channel !== 'SMS') return err('CHANNEL_NOT_SUPPORTED');
    if (p.contentText != null && (typeof p.contentText !== 'string' || !p.contentText.trim() || p.contentText.length > MAX_CONTENT)) return err('VALIDATION_FAILED');
    if (p.fieldDefaults && Object.keys(p.fieldDefaults).length > 50) return err('VALIDATION_FAILED');
    if (c.state === 'RELEASED') return err('ALREADY_RELEASED');
    if (p.audienceVersionId && !this.state.audiences[p.audienceVersionId]) return err('AUDIENCE_NOT_FOUND');

    const audience = p.audienceVersionId ?? c.audienceVersionId;
    const channel = p.channel ?? c.channel;
    const content = p.contentText ?? c.contentText;
    const defaults = p.fieldDefaults ?? c.fieldDefaults;
    let scheduled = c.scheduledAt;
    if ('scheduledAt' in p) scheduled = p.scheduledAt ? new Date(p.scheduledAt).toISOString() : null;

    const key = (d: Record<string, string>) => JSON.stringify(Object.entries(d).sort(([a], [b]) => (a < b ? -1 : 1)));
    const changed = audience !== c.audienceVersionId || channel !== c.channel || content !== c.contentText || key(defaults) !== key(c.fieldDefaults) || scheduled !== c.scheduledAt;
    if (!changed) return ok({ revisionId: c.revisionId, approvalInvalidated: false });

    let invalidated = false;
    if (c.state !== 'DRAFT') invalidated = this.newRevision(c, user);
    else if (!c.actors.includes(user.id)) c.actors.push(user.id);
    Object.assign(c, { audienceVersionId: audience, channel, contentText: content, fieldDefaults: { ...defaults }, scheduledAt: scheduled, state: 'DRAFT' });
    this.touch(c);
    return ok({ revisionId: c.revisionId, approvalInvalidated: invalidated });
  }

  private reopen(c: Campaign, user: DemoUser): Reply {
    if (c.state === 'RELEASED') return err('ALREADY_RELEASED');
    if (c.state === 'DRAFT') return ok({ revisionId: c.revisionId, approvalInvalidated: false });
    const invalidated = this.newRevision(c, user);
    c.state = 'DRAFT';
    this.touch(c);
    return ok({ revisionId: c.revisionId, approvalInvalidated: invalidated });
  }

  private findings(c: Campaign) {
    const a = this.audienceOf(c)!;
    const eligible = a.phones.length;
    const findings: { code: string; severity: 'BLOCKER' | 'WARNING'; messageHe: string; step: string }[] = [];
    if (eligible <= 0) findings.push({ code: 'NO_ELIGIBLE', severity: 'BLOCKER', messageHe: 'אין נמענים זכאים לשליחה', step: 'למי' });
    const missing: string[] = [];
    let affected = 0;
    for (const f of templateFields(c.contentText ?? '')) {
      if (c.fieldDefaults[f] !== undefined && c.fieldDefaults[f] !== '') continue;
      const n = a.fieldNames.includes(f) ? (a.blank[f] ?? 0) : eligible;
      if (n > 0) {
        missing.push(f);
        affected = Math.max(affected, n);
      }
    }
    if (missing.length > 0) findings.push({ code: 'MISSING_FIELD', severity: 'BLOCKER', messageHe: `שדה דינמי חסר: "${missing.join(', ')}" ב-${affected} נמענים`, step: 'מה' });
    findings.push({ code: 'COST_ESTIMATE_ONLY', severity: 'WARNING', messageHe: 'העלות המוצגת היא הערכה בלבד', step: 'איך' });
    return { findings, eligible, blocked: findings.some((f) => f.severity === 'BLOCKER') };
  }

  private incomplete(c: Campaign): boolean {
    return !c.audienceVersionId || !c.channel || !c.contentText?.trim();
  }

  private preflightReply(c: Campaign): Reply {
    if (this.incomplete(c)) return err('DRAFT_INCOMPLETE');
    const { findings, eligible } = this.findings(c);
    const { encoding, segments } = smsSegments(c.contentText!);
    const round = (n: number) => Math.round(n * 100) / 100;
    return ok({
      findings,
      eligibleRecipients: eligible,
      segmentsPerMessage: segments,
      encoding,
      estimatedCost: { min: round(eligible * segments * 0.08), max: round(eligible * segments * 0.12), currency: 'ILS', isEstimate: true },
    });
  }

  private submit(c: Campaign, user: DemoUser): Reply {
    if (c.state !== 'DRAFT') return err(c.state === 'RELEASED' ? 'ALREADY_RELEASED' : 'INVALID_STATE');
    if (this.incomplete(c)) return err('DRAFT_INCOMPLETE');
    const f = this.findings(c);
    if (f.blocked) return err('PREFLIGHT_BLOCKED', { findings: f.findings });
    c.packageHash = packageHash(c);
    if (!c.actors.includes(user.id)) c.actors.push(user.id);
    c.state = 'SUBMITTED';
    this.touch(c);
    return ok({ packageHash: c.packageHash });
  }

  private approve(c: Campaign, user: DemoUser, body: unknown): Reply {
    const hash = (body as { packageHash?: unknown } | null)?.packageHash;
    if (typeof hash !== 'string' || !hash.trim()) return err('VALIDATION_FAILED');
    if (c.state === 'RELEASED') return err('ALREADY_RELEASED');
    if (c.state !== 'SUBMITTED') return err('INVALID_STATE');
    if (this.incomplete(c)) return err('INVALID_STATE');
    if (hash !== packageHash(c)) return err('STALE_REVISION');
    const contributors = new Set([...c.actors, c.createdBy]);
    if (contributors.has(user.id) && this.eligible(c) > this.selfMax) return err('SELF_APPROVAL_ABOVE_THRESHOLD');
    c.approval = { id: uuid(), by: user.id, at: this.now(), invalidated: false };
    c.state = 'APPROVED';
    this.touch(c);
    return ok({ approvalId: c.approval.id });
  }

  private releaseCampaign(c: Campaign): Reply {
    if (c.state === 'RELEASED') return err('ALREADY_RELEASED');
    if (this.incomplete(c) || !c.approval || c.approval.invalidated || c.packageHash !== packageHash(c)) return err('APPROVAL_INVALID');
    if (c.state !== 'APPROVED') return err('INVALID_STATE');
    if (c.scheduledAt && new Date(c.scheduledAt).getTime() > this.now()) return err('SCHEDULING_NOT_SUPPORTED_M1');
    // The send window is always open in the demo (the real server answers OUTSIDE_SEND_WINDOW here).
    const n = this.eligible(c);
    if (n === 0) return err('NO_ELIGIBLE_RECIPIENTS');
    c.release = { at: this.now(), count: n, unknown: n >= 2 ? 1 : 0, rejected: n >= 3 ? 1 : 0 };
    c.state = 'RELEASED';
    this.touch(c);
    return ok({ messagesCreated: n, suppressed: 0, environment: 'sandbox-mock' }, 202);
  }

  /* ----- import ----- */

  private async importJob(call: Call): Promise<Reply> {
    const file = call.file;
    if (!file || file.size === 0) return err('VALIDATION_FAILED');
    if (file.size > MAX_FILE_BYTES) return err('FILE_TOO_LARGE');
    const raw = call.body as Partial<Mapping> | null;
    if (!raw || !raw.idColumn?.trim() || !raw.phoneColumn?.trim()) return err('VALIDATION_FAILED');
    const map: Mapping = { idColumn: raw.idColumn, nameColumn: raw.nameColumn?.trim() ? raw.nameColumn : null, phoneColumn: raw.phoneColumn, variableColumns: raw.variableColumns ?? [] };
    const ext = file.name.toLowerCase().split('.').pop();
    if (ext !== 'csv' && ext !== 'xlsx') return err('UNSUPPORTED_FILE');

    let a: Audience;
    let sample: unknown[];
    let codes: Record<string, number>;
    try {
      const sheet = await readSheet(file);
      if (sheet.headers.length > MAX_COLUMNS) return err('TOO_MANY_COLUMNS');
      if (sheet.rows.length > MAX_ROWS) return err('TOO_MANY_ROWS');
      let rows;
      try {
        rows = validateRows(sheet, map);
      } catch {
        return err('MAPPING_COLUMN_NOT_FOUND');
      }
      const valid = rows.filter((r) => r.state === 'VALID');
      const fieldNames = Array.from(new Set([...(map.nameColumn ? [map.nameColumn] : []), ...map.variableColumns])).sort();
      const blank: Record<string, number> = {};
      for (const f of fieldNames) blank[f] = valid.filter((r) => ((f === map.nameColumn ? r.name : r.vars[f]) ?? '').trim() === '').length;
      const first = valid[0];
      // The server masks the name wherever it appears in the rendered text: keep only the masked form of any value equal to it.
      const firstName = first ? maskName(first.name) : null;
      const nameKey = normalizeSpace(first?.name ?? '');
      const firstVars: Record<string, string | null> | null = first
        ? Object.fromEntries(
            Object.entries({ ...first.vars, ...(map.nameColumn ? { [map.nameColumn]: first.name } : {}) }).map(([k, v]) => [k, v !== null && nameKey !== '' && normalizeSpace(v) === nameKey ? firstName : v]),
          )
        : null;
      a = {
        audienceVersionId: uuid(),
        importRunId: uuid(),
        fileName: file.name.split(/[\\/]/).pop() ?? file.name,
        rowCount: rows.length,
        validCount: valid.length,
        invalidCount: rows.length - valid.length,
        fieldNames,
        phones: valid.map((r) => maskPhone(r.phoneNormalized)),
        firstName,
        firstVars,
        blank,
        errors: rows.filter((r) => r.state !== 'VALID').map((r) => ({ row: r.row, sourceRecipientId: maskId(r.id), codes: r.codes })),
      };
      codes = {};
      for (const r of rows) for (const c of r.codes) codes[c] = (codes[c] ?? 0) + 1;
      sample = rows.slice(0, 5).map((r) => ({ row: r.row, sourceRecipientId: maskId(r.id), name: maskName(r.name), phone: maskPhone(r.phoneNormalized ?? r.phoneRaw), state: r.state, codes: r.codes }));
    } catch (e) {
      if (e instanceof Error && e.message === 'UNSUPPORTED_FILE') return err('UNSUPPORTED_FILE');
      ({ audience: a, sample, codes } = this.cannedImport(file.name, map));
    }
    this.state.audiences[a.audienceVersionId] = a;
    return ok(
      { importRunId: a.importRunId, audienceId: uuid(), audienceVersionId: a.audienceVersionId, rowCount: a.rowCount, validCount: a.validCount, invalidCount: a.invalidCount, codes, sample },
      201,
    );
  }

  /** The file could not be read in the browser: a canned 6-row result so the demo flow can continue. */
  private cannedImport(fileName: string, map: Mapping) {
    const fieldNames = Array.from(new Set([...(map.nameColumn ? [map.nameColumn] : []), ...map.variableColumns])).sort();
    const names = ['דנה כהן', 'רונית לוי', 'יעל בר', 'אורי גל', 'משה פרץ', 'נועה שגב'];
    const phones = ['052-***-**11', '052-***-**12', '054-***-**14', '054-***-**15', '050-***-**16'];
    const audience: Audience = {
      audienceVersionId: uuid(),
      importRunId: uuid(),
      fileName,
      rowCount: 6,
      validCount: 5,
      invalidCount: 1,
      fieldNames,
      phones,
      firstName: maskName(names[0]),
      firstVars: Object.fromEntries(fieldNames.map((f) => [f, f === map.nameColumn ? maskName(names[0]) : 'דוגמה'])),
      blank: {},
      errors: [{ row: 4, sourceRecipientId: '*****', codes: ['InvalidLength'] }],
    };
    const sample = names.slice(0, 5).map((n, i) => ({
      row: i + 2,
      sourceRecipientId: maskId(`30100000${i + 1}`),
      name: maskName(n),
      phone: i === 2 ? '***' : phones[i > 2 ? i - 1 : i],
      state: i === 2 ? 'INVALID' : 'VALID',
      codes: i === 2 ? ['InvalidLength'] : [],
    }));
    return { audience, sample, codes: { InvalidLength: 1 } as Record<string, number> };
  }
}
