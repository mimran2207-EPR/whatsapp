import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { ImportSummary, PreflightReport } from '../../../core/api.client';
import { idempotencyInterceptor } from '../../../core/idempotency.interceptor';
import { WizardComponent } from './wizard.component';
import { WizardStore } from './wizard.store';

const summary: ImportSummary = {
  importRunId: 'r1',
  audienceId: 'a1',
  audienceVersionId: 'v1',
  rowCount: 3,
  validCount: 2,
  invalidCount: 1,
  codes: {},
  sample: [{ row: 2, sourceRecipientId: '0****9', name: 'ד*** ל***', phone: '050-***-**12', state: 'VALID', codes: [] }],
};

const blocked: PreflightReport = {
  findings: [{ code: 'MISSING_FIELD', severity: 'BLOCKER', messageHe: 'שדה דינמי חסר', step: 'מה' }],
  eligibleRecipients: 2,
  segmentsPerMessage: 1,
  encoding: 'UCS2',
  estimatedCost: { min: 0.1, max: 0.2, currency: 'ILS', isEstimate: true },
};

const tick = () => new Promise((r) => setTimeout(r, 0));

describe('WizardComponent focus management', () => {
  let f: ComponentFixture<WizardComponent>;
  let s: WizardStore;
  let ctrl: HttpTestingController;

  beforeEach(() => {
    sessionStorage.clear();
    TestBed.configureTestingModule({
      providers: [provideRouter([]), provideHttpClient(withInterceptors([idempotencyInterceptor])), provideHttpClientTesting()],
    });
    ctrl = TestBed.inject(HttpTestingController);
    f = TestBed.createComponent(WizardComponent);
    document.body.appendChild(f.nativeElement);
    s = f.debugElement.injector.get(WizardStore);
    s.campaignId.set('c1');
    s.name.set('בדיקה');
    s.summary.set(summary);
    s.mapping.set({ idColumn: 'ת.ז', nameColumn: null, phoneColumn: 'טל', variableColumns: ['שם ילד'] });
    s.content.set('שלום {שם ילד}');
    s.maxStep.set(5);
    f.detectChanges();
  });

  afterEach(() => {
    f.nativeElement.remove();
    f.destroy();
  });

  async function settle(): Promise<void> {
    for (let i = 0; i < 4; i++) {
      ctrl.match('/v1/campaigns/c1/draft').forEach((r) => r.flush({ revisionId: 'rev1', approvalInvalidated: false }));
      ctrl.match('/v1/campaigns/c1/preflight').forEach((r) => r.flush(blocked));
      await tick();
      f.detectChanges();
      await f.whenStable();
    }
  }

  it('moves focus to the new step heading and announces the step on step change', async () => {
    (f.nativeElement.querySelector('.actions__primary button') as HTMLButtonElement).click(); // step 1 → 2 (איך)
    await settle();
    const active = document.activeElement as HTMLElement;
    expect(active.id).toBe('wizard-step-heading');
    expect(active.textContent).toContain('איך שולחים?');
    expect(f.nativeElement.querySelector('.step-announce')!.textContent).toContain('שלב 2 מתוך 6: איך');
  });

  it('does not move focus when a resume (not the user) sets the step', async () => {
    (document.activeElement as HTMLElement | null)?.blur();
    s.restoredStep.set(1);
    s.step.set(1);
    f.detectChanges();
    await settle();
    expect(document.activeElement).toBe(document.body);
  });

  it('"תקן" lands focus on the target step heading, not on <body>', async () => {
    s.step.set(4);
    s.preflight.set(blocked);
    f.detectChanges();
    await f.whenStable();
    (f.nativeElement.querySelector('.pf--blocker button') as HTMLButtonElement).click();
    await settle();
    const active = document.activeElement as HTMLElement;
    expect(active).not.toBe(document.body);
    expect(active.id).toBe('wizard-step-heading');
    expect(active.textContent).toContain('מה כותבים?');
  });
});
