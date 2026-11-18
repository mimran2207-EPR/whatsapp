import { beforeEach, describe, expect, it } from 'vitest';
import { DemoBackend, DEMO_MARKER, makeDemoToken, STATE_KEY, DEMO_USERS } from './demo-backend';
import { csvSheet, maskId, maskName, maskPhone, normalizePhone, validateRows } from './demo-import';

function memoryStorage() {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
    map: m,
  };
}

const tokenFor = (id: string, now: number) => makeDemoToken(DEMO_USERS.find((u) => u.id === id)!, now);

describe('DemoBackend (in-browser fake API)', () => {
  let t: number;
  let storage: ReturnType<typeof memoryStorage>;
  let api: DemoBackend;
  const call = (as: string, method: string, path: string, body?: unknown, file?: File) =>
    api.handle({ method, path, token: tokenFor(as, t), body, file });

  beforeEach(() => {
    t = Date.UTC(2026, 10, 18, 9, 0, 0);
    storage = memoryStorage();
    api = new DemoBackend({ now: () => t, storage });
  });

  const csv = (rows: string[]) => new File([rows.join('\n')], 'נמענים-דמו.csv', { type: 'text/csv' });
  const MAPPING = { idColumn: 'ת.ז', nameColumn: 'שם', phoneColumn: 'טלפון', variableColumns: ['כיתה'] };
  const SMALL = csv(['ת.ז,שם,טלפון,כיתה', '1001,דנה כהן,0521110001,א1', '1002,רונית לוי,0521110002,א2', '1003,יעל בר,0521110003,א1', '1004,אורי גל,12,א3']);

  /** dana creates + imports + saves content + submits a campaign; returns its id and package hash. */
  async function danaSubmits(name = 'בדיקה', content = 'שלום {שם}, כיתה {כיתה}') {
    const created = await call('dana', 'POST', '/v1/campaigns', { name, purpose: 'SERVICE' });
    expect(created.status).toBe(201);
    const id = (created.body as { campaignId: string }).campaignId;
    const imp = await call('dana', 'POST', '/v1/import-jobs', MAPPING, SMALL);
    expect(imp.status).toBe(201);
    const av = (imp.body as { audienceVersionId: string }).audienceVersionId;
    expect((await call('dana', 'PATCH', `/v1/campaigns/${id}/draft`, { audienceVersionId: av, channel: 'SMS', contentText: content })).status).toBe(200);
    const sub = await call('dana', 'POST', `/v1/campaigns/${id}/submit`, {});
    expect(sub.status).toBe(200);
    return { id, hash: (sub.body as { packageHash: string }).packageHash };
  }

  it('contains the unique demo marker (used to prove the real build has none)', () => {
    expect(DEMO_MARKER).toBe('RC_DEMO_FAKE_BACKEND_a91f');
  });

  it('serves dev users and an unsigned-looking token the client can read', async () => {
    const users = await api.handle({ method: 'GET', path: '/v1/dev/users', token: null });
    expect((users.body as { id: string }[]).map((u) => u.id)).toEqual(['dana', 'meir', 'rina']);
    const login = await api.handle({ method: 'POST', path: '/v1/dev/login', token: null, body: { userId: 'meir' } });
    const token = (login.body as { token: string }).token;
    expect(token.split('.')).toHaveLength(3);
    expect(token.endsWith('.demo-unsigned')).toBe(true);
    expect(JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))).role).toBe('approver');
    expect((await api.handle({ method: 'POST', path: '/v1/dev/login', token: null, body: { userId: 'nobody' } })).status).toBe(404);
    expect((await api.handle({ method: 'GET', path: '/v1/campaigns', token: null })).status).toBe(401);
  });

  it('seeds 2 released campaigns and one submitted campaign waiting for approval that meir sees at once', async () => {
    const list = (await call('meir', 'GET', '/v1/campaigns')).body as { name: string; state: string }[];
    expect(list.filter((c) => c.state === 'RELEASED')).toHaveLength(2);
    const waiting = (await call('meir', 'GET', '/v1/approvals')).body as { name: string; recipients: number; submittedBy: string; packageHash: string }[];
    expect(waiting).toHaveLength(1);
    expect(waiting[0]).toMatchObject({ name: 'טיול שנתי — אישור הורים', recipients: 6, submittedBy: 'dana' });
    expect(waiting[0].packageHash).toMatch(/^[0-9a-f]{64}$/);
    // the creator and the analyst have no approval inbox
    expect(((await call('dana', 'GET', '/v1/approvals')).body as unknown[]).length).toBe(0);
    expect(((await call('rina', 'GET', '/v1/approvals')).body as unknown[]).length).toBe(0);
  });

  it('shows the server-rendered, masked preview of the waiting campaign', async () => {
    const id = ((await call('meir', 'GET', '/v1/approvals')).body as { campaignId: string }[])[0].campaignId;
    const d = (await call('meir', 'GET', `/v1/campaigns/${id}`)).body as { state: string; preview: { recipientName: string; recipientPhone: string; text: string } };
    expect(d.state).toBe('SUBMITTED');
    expect(d.preview.recipientName).toBe('דנה כ.');
    expect(d.preview.recipientPhone).toBe('052-***-**11');
    expect(d.preview.text).toContain('שלום דנה כ.');
  });

  it('dana creates and submits; meir approves and releases; counters come from the server', async () => {
    const { id, hash } = await danaSubmits();
    const queue = (await call('meir', 'GET', '/v1/approvals')).body as { campaignId: string; recipients: number }[];
    expect(queue.find((q) => q.campaignId === id)?.recipients).toBe(3);

    expect((await call('dana', 'POST', `/v1/campaigns/${id}/approve`, { packageHash: hash })).body).toEqual({ code: 'NOT_APPROVER' });
    const approved = await call('meir', 'POST', `/v1/campaigns/${id}/approve`, { packageHash: hash });
    expect(approved.status).toBe(200);
    expect(((await call('meir', 'GET', '/v1/approvals/approved')).body as { campaignId: string }[]).map((x) => x.campaignId)).toContain(id);
    const rel = await call('meir', 'POST', `/v1/campaigns/${id}/release`, {});
    expect(rel.status).toBe(202);
    expect(rel.body).toEqual({ messagesCreated: 3, suppressed: 0, environment: 'sandbox-mock' });
    expect(((await call('meir', 'POST', `/v1/campaigns/${id}/release`, {})).body as { code: string }).code).toBe('ALREADY_RELEASED');
  });

  it('blocks approving your own campaign above the threshold with the real error code (and allows it at or below)', async () => {
    api = new DemoBackend({ now: () => t, storage: memoryStorage(), selfApprovalMax: 2 });
    // meir authors a 3-recipient campaign: above the (lowered) threshold of 2
    const created = await call('meir', 'POST', '/v1/campaigns', { name: 'שלי', purpose: 'SERVICE' });
    const id = (created.body as { campaignId: string }).campaignId;
    const av = ((await call('meir', 'POST', '/v1/import-jobs', MAPPING, SMALL)).body as { audienceVersionId: string }).audienceVersionId;
    await call('meir', 'PATCH', `/v1/campaigns/${id}/draft`, { audienceVersionId: av, channel: 'SMS', contentText: 'שלום {שם}' });
    const hash = ((await call('meir', 'POST', `/v1/campaigns/${id}/submit`, {})).body as { packageHash: string }).packageHash;
    expect(((await call('meir', 'GET', '/v1/approvals')).body as { campaignId: string }[]).some((x) => x.campaignId === id)).toBe(false);
    const r = await call('meir', 'POST', `/v1/campaigns/${id}/approve`, { packageHash: hash });
    expect(r).toEqual({ status: 403, body: { code: 'SELF_APPROVAL_ABOVE_THRESHOLD' } });

    // below the threshold it is allowed
    api = new DemoBackend({ now: () => t, storage: memoryStorage(), selfApprovalMax: 1000 });
    const c2 = ((await call('meir', 'POST', '/v1/campaigns', { name: 'קטן', purpose: 'SERVICE' })).body as { campaignId: string }).campaignId;
    const av2 = ((await call('meir', 'POST', '/v1/import-jobs', MAPPING, SMALL)).body as { audienceVersionId: string }).audienceVersionId;
    await call('meir', 'PATCH', `/v1/campaigns/${c2}/draft`, { audienceVersionId: av2, channel: 'SMS', contentText: 'שלום {שם}' });
    const h2 = ((await call('meir', 'POST', `/v1/campaigns/${c2}/submit`, {})).body as { packageHash: string }).packageHash;
    expect((await call('meir', 'POST', `/v1/campaigns/${c2}/approve`, { packageHash: h2 })).status).toBe(200);
  });

  it('an edit invalidates the approval; releasing then fails until resubmitted and re-approved', async () => {
    const { id, hash } = await danaSubmits();
    await call('meir', 'POST', `/v1/campaigns/${id}/approve`, { packageHash: hash });
    const edit = await call('dana', 'PATCH', `/v1/campaigns/${id}/draft`, { contentText: 'שלום {שם}, הודעה מעודכנת' });
    expect(edit.body).toMatchObject({ approvalInvalidated: true });
    expect(((await call('meir', 'GET', '/v1/approvals/approved')).body as unknown[]).length).toBe(0);
    const rel = await call('meir', 'POST', `/v1/campaigns/${id}/release`, {});
    expect(rel.status).toBe(409);
    // the old package hash is stale after resubmitting a changed draft
    const sub = await call('dana', 'POST', `/v1/campaigns/${id}/submit`, {});
    const newHash = (sub.body as { packageHash: string }).packageHash;
    expect(newHash).not.toBe(hash);
    expect(((await call('meir', 'POST', `/v1/campaigns/${id}/approve`, { packageHash: hash })).body as { code: string }).code).toBe('STALE_REVISION');
    expect((await call('meir', 'POST', `/v1/campaigns/${id}/approve`, { packageHash: newHash })).status).toBe(200);
    expect((await call('meir', 'POST', `/v1/campaigns/${id}/release`, {})).status).toBe(202);
  });

  it('reopen withdraws a submission back to a draft on a new revision', async () => {
    const { id } = await danaSubmits();
    const r = await call('dana', 'POST', `/v1/campaigns/${id}/reopen`, {});
    expect(r.status).toBe(200);
    expect(((await call('dana', 'GET', `/v1/campaigns/${id}`)).body as { state: string; revisionNo: number }).revisionNo).toBe(2);
    expect(((await call('meir', 'GET', '/v1/approvals')).body as { campaignId: string }[]).some((x) => x.campaignId === id)).toBe(false);
  });

  it('enforces roles and validation like the real endpoints', async () => {
    expect(((await call('rina', 'POST', '/v1/campaigns', { name: 'x', purpose: 'SERVICE' })).body as { code: string }).code).toBe('FORBIDDEN_ROLE');
    expect((await call('dana', 'POST', '/v1/campaigns', { name: '  ', purpose: 'SERVICE' })).status).toBe(400);
    expect((await call('dana', 'POST', '/v1/campaigns', { name: 'x', purpose: 'NOPE' })).status).toBe(400);
    const { id } = await danaSubmits();
    expect(((await call('dana', 'POST', `/v1/campaigns/${id}/release`, {})).body as { code: string }).code).toBe('FORBIDDEN_ROLE');
    expect((await call('rina', 'GET', `/v1/campaigns/${id}/tracking`)).status).toBe(200);
    expect(((await call('dana', 'POST', `/v1/campaigns/${id}/submit`, {})).body as { code: string }).code).toBe('INVALID_STATE');
  });

  it('release produces progressing tracking: accepted, sent, delivered, one timeout, one rejection', async () => {
    const created = await call('dana', 'POST', '/v1/campaigns', { name: 'מעקב', purpose: 'SERVICE' });
    const id = (created.body as { campaignId: string }).campaignId;
    const rows = ['ת.ז,שם,טלפון,כיתה'];
    for (let i = 1; i <= 8; i++) rows.push(`20${i},הורה ${i},05211100${String(i).padStart(2, '0')},א`);
    const av = ((await call('dana', 'POST', '/v1/import-jobs', MAPPING, csv(rows))).body as { audienceVersionId: string }).audienceVersionId;
    await call('dana', 'PATCH', `/v1/campaigns/${id}/draft`, { audienceVersionId: av, channel: 'SMS', contentText: 'שלום {שם}' });
    const hash = ((await call('dana', 'POST', `/v1/campaigns/${id}/submit`, {})).body as { packageHash: string }).packageHash;
    await call('meir', 'POST', `/v1/campaigns/${id}/approve`, { packageHash: hash });
    await call('meir', 'POST', `/v1/campaigns/${id}/release`, {});
    const track = async () => (await call('dana', 'GET', `/v1/campaigns/${id}/tracking`)).body as any;

    const t0 = await track();
    expect(t0.messages).toBe(8);
    expect(t0.handoff.notHandedOff).toBe(8);
    expect(t0.delivery.delivered).toBe(0);
    expect(t0.environment).toBe('sandbox-mock');
    expect(t0.bannerHe).toBe('0 הודעות התקבלו אצל הספק. תוצאות המסירה ממשיכות להתעדכן.');
    expect(t0.kpis.find((k: any) => k.key === 'operationalDeliveryRate').value).toBeNull();

    t += 9_000;
    const mid = await track();
    expect(mid.handoff.accepted).toBeGreaterThan(0);
    expect(mid.delivery.delivered).toBeLessThan(7);
    expect(mid.delivery.delivered + mid.delivery.sentOrNotReported + mid.delivery.unknown + mid.delivery.failed).toBe(8);
    expect(mid.bannerHe).toBe(`${mid.handoff.accepted} הודעות התקבלו אצל הספק. תוצאות המסירה ממשיכות להתעדכן.`);
    expect(new Date(mid.dataAsOf).getTime()).toBeGreaterThan(Date.UTC(2026, 10, 18, 9, 0, 0));

    t += 25_000;
    const end = await track();
    expect(end.delivery).toEqual({ delivered: 6, sentOrNotReported: 0, unknown: 1, failed: 1 });
    expect(end.handoff).toEqual({ accepted: 6, rejected: 1, unknown: 1, notHandedOff: 0 });
    expect(end.kpis.find((k: any) => k.key === 'operationalDeliveryRate')).toEqual({ key: 'operationalDeliveryRate', value: 0.75, numerator: 6, denominator: 8 });
    expect(end.exceptions.map((e: any) => [e.displayStatus, e.displayLabelHe])).toEqual([['Rejected', 'נדחה'], ['Unknown', 'לא ידוע']]);
    expect(end.exceptions[0].recipientMasked).toMatch(/^052-\*\*\*-\*\*\d\d$/);

    const list = ((await call('dana', 'GET', '/v1/campaigns')).body as { campaignId: string; counts: Record<string, number> }[]).find((c) => c.campaignId === id)!;
    expect(list.counts).toEqual({ accepted: 6, delivered: 6, unknown: 1, failed: 1 });
  });

  it('the seeded released campaigns report final counts', async () => {
    const list = (await call('meir', 'GET', '/v1/campaigns')).body as { name: string; counts: Record<string, number>; recipients: number }[];
    const vacc = list.find((c) => c.name.startsWith('תזכורת חיסונים'))!;
    expect(vacc.counts).toMatchObject({ delivered: 39, unknown: 1, failed: 0 });
    const asm = list.find((c) => c.name.startsWith('שינוי מועד'))!;
    expect(asm.counts).toMatchObject({ delivered: 24, unknown: 0, failed: 1 });
  });

  it('import parses the CSV: counts, masked sample, error rows and codes', async () => {
    const r = (await call('dana', 'POST', '/v1/import-jobs', MAPPING, SMALL)).body as any;
    expect(r).toMatchObject({ rowCount: 4, validCount: 3, invalidCount: 1, codes: { InvalidLength: 1 } });
    expect(r.sample[0]).toMatchObject({ row: 2, name: 'דנה כ.', phone: '052-***-**01', state: 'VALID' });
    expect(r.sample[3]).toMatchObject({ row: 5, state: 'INVALID', codes: ['InvalidLength'] });
    expect(JSON.stringify(r)).not.toContain('0521110001');
    const errors = (await call('dana', 'GET', `/v1/import-jobs/${r.importRunId}/errors`)).body;
    expect(errors).toEqual([{ row: 5, sourceRecipientId: '*****', codes: ['InvalidLength'] }]);
    expect(((await call('dana', 'POST', '/v1/import-jobs', { ...MAPPING, phoneColumn: 'nope' }, SMALL)).body as { code: string }).code).toBe('MAPPING_COLUMN_NOT_FOUND');
    expect(((await call('dana', 'POST', '/v1/import-jobs', MAPPING, new File(['x'], 'a.pdf'))).body as { code: string }).code).toBe('UNSUPPORTED_FILE');
  });

  it('import falls back to a canned 6-row result when the file cannot be parsed', async () => {
    const broken = new File([new Uint8Array([0x50, 0x4b, 0x03, 0x04, 1, 2, 3])], 'שבור.xlsx');
    const r = await call('dana', 'POST', '/v1/import-jobs', MAPPING, broken);
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ rowCount: 6, validCount: 5, invalidCount: 1 });
    expect((r.body as { sample: unknown[] }).sample).toHaveLength(5);
  });

  it('preflight blocks a missing field and submit answers PREFLIGHT_BLOCKED with the findings', async () => {
    const id = ((await call('dana', 'POST', '/v1/campaigns', { name: 'חסר', purpose: 'SERVICE' })).body as { campaignId: string }).campaignId;
    const av = ((await call('dana', 'POST', '/v1/import-jobs', MAPPING, SMALL)).body as { audienceVersionId: string }).audienceVersionId;
    await call('dana', 'PATCH', `/v1/campaigns/${id}/draft`, { audienceVersionId: av, channel: 'SMS', contentText: 'שלום {שם}, {סכום} ש"ח' });
    const pf = (await call('dana', 'POST', `/v1/campaigns/${id}/preflight`, {})).body as { findings: { code: string; severity: string }[]; segmentsPerMessage: number; encoding: string };
    expect(pf.findings.map((f) => f.code)).toEqual(['MISSING_FIELD', 'COST_ESTIMATE_ONLY']);
    expect(pf.encoding).toBe('UCS-2');
    const sub = await call('dana', 'POST', `/v1/campaigns/${id}/submit`, {});
    expect(sub.status).toBe(422);
    expect((sub.body as { code: string }).code).toBe('PREFLIGHT_BLOCKED');
    await call('dana', 'PATCH', `/v1/campaigns/${id}/draft`, { fieldDefaults: { 'סכום': '45' } });
    expect((await call('dana', 'POST', `/v1/campaigns/${id}/submit`, {})).status).toBe(200);
  });

  it('keeps state in sessionStorage (survives a reload of the page) and reset reseeds', async () => {
    const { id } = await danaSubmits('נשמר');
    expect(storage.map.has(STATE_KEY)).toBe(true);
    const reloaded = new DemoBackend({ now: () => t, storage });
    const names = ((await reloaded.handle({ method: 'GET', path: '/v1/campaigns', token: tokenFor('dana', t) })).body as { campaignId: string; name: string }[]).map((c) => c.name);
    expect(names).toContain('נשמר');

    api.reset();
    const after = (await call('dana', 'GET', '/v1/campaigns')).body as { campaignId: string }[];
    expect(after).toHaveLength(3);
    expect(after.some((c) => c.campaignId === id)).toBe(false);
    expect(((await call('meir', 'GET', '/v1/approvals')).body as unknown[]).length).toBe(1);
  });
});

describe('demo import helpers (ports of the server rules)', () => {
  it('masks like the server', () => {
    expect(maskPhone('+972521234567')).toBe('052-***-**67');
    expect(maskPhone('0521234567')).toBe('052-***-**67');
    expect(maskPhone('12')).toBe('***');
    expect(maskId('301000123')).toBe('*****0123');
    expect(maskId('1001')).toBe('*****');
    expect(maskName('רונית כהן לוי')).toBe('רונית כ.');
    expect(maskName('דנה')).toBe('דנה');
  });

  it('normalizes Israeli mobiles and never restores lost digits', () => {
    expect(normalizePhone('052-111-0001')).toEqual({ normalized: '+972521110001', issue: null });
    expect(normalizePhone('+972 (0) 52 111 0001').normalized).toBe('+972521110001');
    expect(normalizePhone('521110001').issue).toBe('LostLeadingZero');
    expect(normalizePhone('0221110001').issue).toBe('NotMobile');
    expect(normalizePhone('').issue).toBe('Empty');
    expect(normalizePhone('5.2E+9').issue).toBe('ScientificNotation');
    expect(normalizePhone('05211x0001').issue).toBe('NonDigits');
  });

  it('validates rows: duplicates, missing ids, formulas', () => {
    const sheet = csvSheet('id,name,phone\n1,א ב,0521110001\n1,ג ד,0521110002\n,ה ו,0521110003\n4,ז ח,=A1');
    const rows = validateRows(sheet, { idColumn: 'id', nameColumn: 'name', phoneColumn: 'phone', variableColumns: [] });
    expect(rows.map((r) => r.codes)).toEqual([[], ['DUPLICATE_ID'], ['MISSING_ID'], ['NonDigits', 'FORMULA_VALUE']]);
  });
});
