import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { ImportSummary, PreflightReport } from '../../../core/api.client';
import { idempotencyInterceptor } from '../../../core/idempotency.interceptor';
import { PREFLIGHT_STEP, WizardStore } from './wizard.store';

const summary: ImportSummary = {
  importRunId: 'r1',
  audienceId: 'a1',
  audienceVersionId: 'v1',
  rowCount: 3,
  validCount: 2,
  invalidCount: 1,
  codes: { LostLeadingZero: 1 },
  sample: [{ row: 2, sourceRecipientId: '0****9', name: 'ד*** ל***', phone: '050-***-**12', state: 'VALID', codes: [] }],
};

const preflight: PreflightReport = {
  findings: [{ code: 'COST_ESTIMATE_ONLY', severity: 'WARNING', messageHe: 'העלות המוצגת היא הערכה בלבד', step: 'איך' }],
  eligibleRecipients: 2,
  segmentsPerMessage: 1,
  encoding: 'UCS2',
  estimatedCost: { min: 0.1, max: 0.24, currency: 'ILS', isEstimate: true },
};

const tick = () => new Promise((r) => setTimeout(r, 0));

describe('WizardStore', () => {
  let s: WizardStore;
  let ctrl: HttpTestingController;

  beforeEach(() => {
    sessionStorage.clear();
    TestBed.configureTestingModule({
      providers: [WizardStore, provideHttpClient(withInterceptors([idempotencyInterceptor])), provideHttpClientTesting()],
    });
    s = TestBed.inject(WizardStore);
    ctrl = TestBed.inject(HttpTestingController);
  });

  afterEach(() => ctrl.verify());

  async function imported(): Promise<void> {
    s.name.set('הזנה — נובמבר');
    s.file.set(new File(['ת.ז,טלפון\n1,050'], 'a.csv'));
    s.mapping.set({ idColumn: 'ת.ז', nameColumn: null, phoneColumn: 'טלפון', variableColumns: [] });
    const done = s.runImport();
    await tick();
    ctrl.expectOne('/v1/campaigns').flush({ campaignId: 'c1', revisionId: 'rev1' });
    await tick();
    const imp = ctrl.expectOne('/v1/import-jobs');
    expect(imp.request.body instanceof FormData).toBe(true);
    imp.flush(summary);
    await tick();
    const patch = ctrl.expectOne('/v1/campaigns/c1/draft');
    expect(patch.request.body).toEqual({ audienceVersionId: 'v1', channel: 'SMS', fieldDefaults: {} });
    patch.flush({ revisionId: 'rev1', approvalInvalidated: false });
    expect(await done).toBe(true);
  }

  it('creates the campaign, imports, and saves the audience to the draft', async () => {
    await imported();
    expect(s.campaignId()).toBe('c1');
    expect(s.summary()).toEqual(summary);
    expect(s.savedAt()).not.toBeNull();
  });

  it('ignores a second click while the import is running', async () => {
    s.name.set('x');
    s.file.set(new File(['a'], 'a.csv'));
    s.mapping.set({ idColumn: 'a', nameColumn: null, phoneColumn: 'b', variableColumns: [] });
    const first = s.runImport();
    expect(await s.runImport()).toBe(false);
    await tick();
    ctrl.expectOne('/v1/campaigns').flush({}, { status: 500, statusText: 'x' });
    expect(await first).toBe(false);
  });

  it('autosaves on step change only when something changed', async () => {
    await imported();
    await s.goTo(1);
    ctrl.expectNone('/v1/campaigns/c1/draft');
    expect(s.step()).toBe(1);
    s.content.set('שלום');
    const go = s.goTo(2);
    await tick();
    ctrl.expectOne('/v1/campaigns/c1/draft').flush({ revisionId: 'rev1', approvalInvalidated: false });
    await go;
    expect(s.step()).toBe(2);
  });

  it('passes over the documents step', async () => {
    await imported();
    s.step.set(2);
    s.content.set('שלום');
    const go = s.goTo(3);
    await tick();
    ctrl.expectOne('/v1/campaigns/c1/draft').flush({ revisionId: 'rev1', approvalInvalidated: false });
    await go;
    expect(s.step()).toBe(PREFLIGHT_STEP);
    await tick();
    ctrl.expectOne('/v1/campaigns/c1/preflight').flush(preflight);
    await tick();
    expect(s.preflight()).toEqual(preflight);
    expect(s.stepStates()[3]).toBe('skipped');
  });

  it('uses a new PATCH key after a definite error, and the same key only after a network failure', async () => {
    await imported();
    s.content.set('שלום');
    const p1 = s.saveDraft();
    await tick();
    const r1 = ctrl.expectOne('/v1/campaigns/c1/draft');
    const k1 = r1.request.headers.get('Idempotency-Key');
    r1.error(new ProgressEvent('error'), { status: 0 });
    await expect(p1).rejects.toBeTruthy();

    const p2 = s.saveDraft();
    await tick();
    const r2 = ctrl.expectOne('/v1/campaigns/c1/draft');
    expect(r2.request.headers.get('Idempotency-Key')).toBe(k1);
    r2.flush({ code: 'VALIDATION_FAILED' }, { status: 400, statusText: 'x' });
    await expect(p2).rejects.toBeTruthy();

    const p3 = s.saveDraft();
    await tick();
    const r3 = ctrl.expectOne('/v1/campaigns/c1/draft');
    expect(r3.request.headers.get('Idempotency-Key')).not.toBe(k1);
    r3.flush({ revisionId: 'rev1', approvalInvalidated: false });
    await p3;
  });

  it('uses a new submit key after a definite refusal', async () => {
    await imported();
    s.content.set('שלום');
    s.preflight.set(preflight);
    const a = s.submit();
    await tick();
    ctrl.expectOne('/v1/campaigns/c1/draft').flush({ revisionId: 'rev1', approvalInvalidated: false });
    await tick();
    const r1 = ctrl.expectOne('/v1/campaigns/c1/submit');
    const k1 = r1.request.headers.get('Idempotency-Key');
    r1.flush({ code: 'INVALID_STATE' }, { status: 409, statusText: 'x' });
    await a;
    const b = s.submit();
    await tick();
    const r2 = ctrl.expectOne('/v1/campaigns/c1/submit');
    expect(r2.request.headers.get('Idempotency-Key')).not.toBe(k1);
    r2.flush({ packageHash: 'h' });
    await b;
  });

  it('ignores a preflight response that arrives after a newer one', async () => {
    await imported();
    s.content.set('א');
    const first = s.refreshPreflight();
    await tick();
    ctrl.expectOne('/v1/campaigns/c1/draft').flush({ revisionId: 'rev1', approvalInvalidated: false });
    await tick();
    const old = ctrl.expectOne('/v1/campaigns/c1/preflight');

    s.content.set('אב');
    const second = s.refreshPreflight();
    await tick();
    ctrl.expectOne('/v1/campaigns/c1/draft').flush({ revisionId: 'rev1', approvalInvalidated: false });
    await tick();
    const fresh = ctrl.expectOne('/v1/campaigns/c1/preflight');
    fresh.flush({ ...preflight, segmentsPerMessage: 2 });
    await second;
    old.flush({ ...preflight, segmentsPerMessage: 1 }); // stale: for the older text
    await first;
    expect(s.preflight()?.segmentsPerMessage).toBe(2);
    expect(s.preflightPending()).toBe(false);
  });

  it('is read-only after submit: no PATCH or preflight until editing is confirmed', async () => {
    await imported();
    s.content.set('שלום');
    s.preflight.set(preflight);
    const done = s.submit();
    await tick();
    ctrl.expectOne('/v1/campaigns/c1/draft').flush({ revisionId: 'rev1', approvalInvalidated: false });
    await tick();
    ctrl.expectOne('/v1/campaigns/c1/submit').flush({ packageHash: 'h' });
    await done;
    expect(s.locked()).toBe(true);

    s.content.set('שינוי');
    await s.saveDraft();
    await s.refreshPreflight();
    await s.goTo(2);
    ctrl.expectNone('/v1/campaigns/c1/draft');
    ctrl.expectNone('/v1/campaigns/c1/preflight');
    expect(s.step()).toBe(2); // viewing is allowed

    const unlock = s.unlockForEdit();
    await tick();
    ctrl.expectOne('/v1/campaigns/c1/reopen').flush({ revisionId: 'rev2', approvalInvalidated: true }); // withdrawn on the server
    expect(await unlock).toBe(true);
    expect(s.locked()).toBe(false);
    expect(s.serverState()).toBe('DRAFT');
    expect(s.approvalInvalidated()).toBe(true);
    const save = s.saveDraft();
    await tick();
    ctrl.expectOne('/v1/campaigns/c1/draft').flush({ revisionId: 'rev2', approvalInvalidated: false });
    await save;
  });

  async function submitted(): Promise<void> {
    await imported();
    s.content.set('שלום');
    s.preflight.set(preflight);
    const done = s.submit();
    await tick();
    ctrl.expectOne('/v1/campaigns/c1/draft').flush({ revisionId: 'rev1', approvalInvalidated: false });
    await tick();
    ctrl.expectOne('/v1/campaigns/c1/submit').flush({ packageHash: 'h1' });
    await done;
  }

  it('"עריכה" then submitting again without any change works: editing really withdrew the submission', async () => {
    await submitted();
    const unlock = s.unlockForEdit();
    await tick();
    ctrl.expectOne('/v1/campaigns/c1/reopen').flush({ revisionId: 'rev2', approvalInvalidated: false });
    await unlock;

    const again = s.submit();
    await tick();
    ctrl.expectNone('/v1/campaigns/c1/draft'); // nothing changed: no PATCH, and none is needed
    ctrl.expectOne('/v1/campaigns/c1/submit').flush({ packageHash: 'h2' });
    expect(await again).toBe(true);
    expect(s.submittedHash()).toBe('h2');
    expect(s.locked()).toBe(true);
  });

  it('stays locked and shows the error when the server refuses to reopen', async () => {
    await submitted();
    const unlock = s.unlockForEdit();
    await tick();
    ctrl.expectOne('/v1/campaigns/c1/reopen').flush({ code: 'ALREADY_RELEASED' }, { status: 409, statusText: 'x' });
    expect(await unlock).toBe(false);
    expect(s.locked()).toBe(true);
    expect(s.error()?.messageHe).toBe('המשלוח כבר שוחרר לשליחה');
  });

  it('reuses the reopen key only after a failure with no response', async () => {
    await submitted();
    const a = s.unlockForEdit();
    await tick();
    const r1 = ctrl.expectOne('/v1/campaigns/c1/reopen');
    const k1 = r1.request.headers.get('Idempotency-Key');
    r1.error(new ProgressEvent('error'), { status: 0 });
    await a;
    const b = s.unlockForEdit();
    await tick();
    const r2 = ctrl.expectOne('/v1/campaigns/c1/reopen');
    expect(r2.request.headers.get('Idempotency-Key')).toBe(k1);
    r2.flush({ code: 'INVALID_STATE' }, { status: 409, statusText: 'x' });
    await b;
    const c = s.unlockForEdit();
    await tick();
    const r3 = ctrl.expectOne('/v1/campaigns/c1/reopen');
    expect(r3.request.headers.get('Idempotency-Key')).not.toBe(k1); // a definite 409 ended that action
    r3.flush({ revisionId: 'rev2', approvalInvalidated: false });
    await c;
  });

  it('an in-flight preflight response is dropped when a later call returns early because the content was emptied', async () => {
    await imported();
    s.content.set('א');
    const first = s.refreshPreflight();
    await tick();
    ctrl.expectOne('/v1/campaigns/c1/draft').flush({ revisionId: 'rev1', approvalInvalidated: false });
    await tick();
    const old = ctrl.expectOne('/v1/campaigns/c1/preflight');
    s.content.set('');
    await s.refreshPreflight(); // early return (empty content)
    old.flush(preflight);
    await first;
    expect(s.preflight()).toBeNull();
    expect(s.preflightPending()).toBe(false);
  });

  it('an in-flight preflight response is dropped when a later call returns early because the draft is locked', async () => {
    await imported();
    s.content.set('א');
    const first = s.refreshPreflight();
    await tick();
    ctrl.expectOne('/v1/campaigns/c1/draft').flush({ revisionId: 'rev1', approvalInvalidated: false });
    await tick();
    const old = ctrl.expectOne('/v1/campaigns/c1/preflight');
    s.locked.set(true);
    await s.refreshPreflight(); // early return (locked)
    old.flush(preflight);
    await first;
    expect(s.preflight()).toBeNull();
    expect(s.preflightPending()).toBe(false);
  });

  it('resumes a draft from the server (another browser) and locks a submitted one', async () => {
    s.resume('c9');
    ctrl.expectOne('/v1/campaigns/c9').flush({
      campaignId: 'c9',
      name: 'משלוח קיים',
      purpose: 'OPERATIONAL',
      state: 'SUBMITTED',
      createdBy: 'dana',
      revisionId: 'r3',
      revisionNo: 3,
      channel: 'SMS',
      contentText: 'שלום {שם הורה}',
      fieldDefaults: { 'שם ילד': 'ילדכם' },
      scheduledAt: '2026-11-18T09:30:00Z',
      audience: {
        audienceVersionId: 'v9',
        importRunId: 'r9',
        fileName: 'x.csv',
        rowCount: 4,
        validCount: 3,
        invalidCount: 1,
        eligibleRecipients: 3,
        fieldNames: ['גן', 'שם הורה', 'שם ילד'],
      },
      preview: { recipientName: 'דנה כ.', recipientPhone: '052-***-**67', text: 'שלום דנה כ.', missingFields: [] },
    });
    await tick();
    expect(s.name()).toBe('משלוח קיים');
    expect(s.content()).toBe('שלום {שם הורה}');
    expect(s.defaults()).toEqual({ 'שם ילד': 'ילדכם' });
    expect(s.summary()?.audienceVersionId).toBe('v9');
    expect(s.fieldColumns()).toEqual(['גן', 'שם הורה', 'שם ילד']);
    expect(s.scheduleMode()).toBe('at');
    expect(s.serverPreview()?.text).toBe('שלום דנה כ.');
    expect(s.locked()).toBe(true);
    expect(s.maxStep()).toBe(5);
  });

  it('goes back to the preflight step when submit is blocked', async () => {
    await imported();
    s.content.set('שלום {שם ילד}');
    s.preflight.set(preflight);
    s.step.set(5);
    const done = s.submit();
    await tick();
    ctrl.expectOne('/v1/campaigns/c1/draft').flush({ revisionId: 'rev1', approvalInvalidated: false });
    await tick();
    const blocker = { code: 'MISSING_FIELD', severity: 'BLOCKER', messageHe: 'שדה דינמי חסר: "שם ילד" ב-1 נמענים', step: 'מה' };
    ctrl.expectOne('/v1/campaigns/c1/submit').flush({ code: 'PREFLIGHT_BLOCKED', findings: [blocker] }, { status: 422, statusText: 'x' });
    expect(await done).toBe(false);
    expect(s.step()).toBe(PREFLIGHT_STEP);
    expect(s.blockers()).toEqual([blocker]);
    expect(s.error()?.messageHe).toBe('יש חסמים בבדיקה — יש לתקן לפני הגשה');
    expect(s.stepStates()[2]).toBe('blocked');
  });
});
