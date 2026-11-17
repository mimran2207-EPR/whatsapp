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
