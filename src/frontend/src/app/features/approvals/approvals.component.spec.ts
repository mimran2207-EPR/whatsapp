import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting, TestRequest } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { ApprovalListItem, ApprovedListItem, CampaignDetail } from '../../core/api.client';
import { idempotencyInterceptor } from '../../core/idempotency.interceptor';
import { ApprovalsComponent } from './approvals.component';

const item: ApprovalListItem = {
  campaignId: 'c1',
  name: 'הזנה — נובמבר',
  purpose: 'SERVICE',
  submittedBy: 'dana',
  channel: 'SMS',
  recipients: 1250,
  packageHash: 'abcdef0123456789',
};

const approved: ApprovedListItem = {
  campaignId: 'c1',
  name: 'הזנה — נובמבר',
  purpose: 'SERVICE',
  submittedBy: 'dana',
  channel: 'SMS',
  recipients: 1250,
  approvedBy: 'meir',
  approvedAt: '2026-11-17T10:00:00Z',
};

const detail: CampaignDetail = {
  campaignId: 'c1',
  name: 'הזנה — נובמבר',
  purpose: 'SERVICE',
  state: 'SUBMITTED',
  createdBy: 'dana',
  revisionId: 'r1',
  revisionNo: 1,
  channel: 'SMS',
  contentText: 'שלום {שם הורה}',
  fieldDefaults: {},
  scheduledAt: null,
  audience: null,
  preview: { recipientName: 'דנה כ.', recipientPhone: '052-***-**67', text: 'שלום דנה כ.', missingFields: [] },
};

describe('ApprovalsComponent', () => {
  let ctrl: HttpTestingController;

  async function setup(pending: ApprovalListItem[] = [item], ready: ApprovedListItem[] = []) {
    TestBed.configureTestingModule({
      providers: [provideRouter([]), provideHttpClient(withInterceptors([idempotencyInterceptor])), provideHttpClientTesting()],
    });
    ctrl = TestBed.inject(HttpTestingController);
    const f = TestBed.createComponent(ApprovalsComponent);
    f.componentRef.setInput('campaign', 'c1');
    f.detectChanges();
    await flushLists(f, pending, ready);
    const d = ctrl.match('/v1/campaigns/c1');
    d.forEach((r) => r.flush(detail));
    await f.whenStable();
    f.detectChanges();
    return f;
  }

  async function flushLists(f: { whenStable(): Promise<unknown>; detectChanges(): void }, pending: ApprovalListItem[], ready: ApprovedListItem[]) {
    ctrl.expectOne('/v1/approvals').flush(pending);
    ctrl.expectOne('/v1/approvals/approved').flush(ready);
    await f.whenStable();
    f.detectChanges();
  }

  const primary = (el: HTMLElement) => el.querySelector<HTMLButtonElement>('.actions rc-button button')!;
  const fail = (r: TestRequest, status: number, code: string) => r.flush({ code }, { status, statusText: 'x' });

  afterEach(() => ctrl.verify());

  it('labels the primary button exactly "אישור ושליחת {N} הודעות"', async () => {
    const f = await setup();
    expect(primary(f.nativeElement).textContent!.trim()).toBe('אישור ושליחת 1,250 הודעות');
  });

  it('shows the server-rendered preview of the exact text being approved', async () => {
    const f = await setup();
    expect(f.nativeElement.querySelector('.bubble')!.textContent).toContain('שלום דנה כ.');
    expect(f.nativeElement.textContent).toContain('052-***-**67');
  });

  it('approves with the package hash, then releases, then opens tracking', async () => {
    const f = await setup();
    const nav = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    primary(f.nativeElement).click();
    const approve = ctrl.expectOne('/v1/campaigns/c1/approve');
    expect(approve.request.body).toEqual({ packageHash: 'abcdef0123456789' });
    approve.flush({ approvalId: 'a1' });
    await f.whenStable();
    ctrl.expectOne('/v1/campaigns/c1/release').flush({ messagesCreated: 1250, suppressed: 0, environment: 'sandbox-mock' }, { status: 202, statusText: 'Accepted' });
    await f.whenStable();
    expect(nav).toHaveBeenCalledWith(['/campaigns', 'c1', 'tracking']);
  });

  it('after approve succeeded and release was refused, the campaign is in the release queue and "שליחה" calls release only, with a new key', async () => {
    const f = await setup();
    primary(f.nativeElement).click();
    ctrl.expectOne('/v1/campaigns/c1/approve').flush({ approvalId: 'a1' });
    await f.whenStable();
    const r1 = ctrl.expectOne('/v1/campaigns/c1/release');
    const key1 = r1.request.headers.get('Idempotency-Key');
    fail(r1, 422, 'OUTSIDE_SEND_WINDOW');
    await f.whenStable();
    await flushLists(f, [], [approved]); // the inbox reloads: now APPROVED, not SUBMITTED
    expect(f.nativeElement.textContent).toContain('מחוץ לחלון השעות — תזמנו לשעה מותרת');
    expect(f.nativeElement.textContent).toContain('אושרו וממתינים לשליחה');
    expect(primary(f.nativeElement).textContent!.trim()).toBe('שליחת 1,250 הודעות');

    primary(f.nativeElement).click();
    ctrl.expectNone('/v1/campaigns/c1/approve');
    const r2 = ctrl.expectOne('/v1/campaigns/c1/release');
    expect(r2.request.headers.get('Idempotency-Key')).not.toBe(key1); // a definite 4xx ended that action
    fail(r2, 422, 'OUTSIDE_SEND_WINDOW');
    await f.whenStable();
    await flushLists(f, [], [approved]);
  });

  it('reuses the key only when the release got no response (network error)', async () => {
    const f = await setup([], [approved]);
    const nav = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    primary(f.nativeElement).click();
    const r1 = ctrl.expectOne('/v1/campaigns/c1/release');
    const key1 = r1.request.headers.get('Idempotency-Key');
    r1.error(new ProgressEvent('error'), { status: 0 });
    await f.whenStable();
    f.detectChanges();
    expect(f.nativeElement.textContent).toContain('אין חיבור לשרת');

    primary(f.nativeElement).click();
    const r2 = ctrl.expectOne('/v1/campaigns/c1/release');
    expect(r2.request.headers.get('Idempotency-Key')).toBe(key1);
    r2.flush({ messagesCreated: 1, suppressed: 0, environment: 'sandbox-mock' }, { status: 202, statusText: 'Accepted' });
    await f.whenStable();
    expect(nav).toHaveBeenCalledWith(['/campaigns', 'c1', 'tracking']);
  });

  it('maps STALE_REVISION and reloads the inbox', async () => {
    const f = await setup();
    primary(f.nativeElement).click();
    fail(ctrl.expectOne('/v1/campaigns/c1/approve'), 409, 'STALE_REVISION');
    await f.whenStable();
    f.detectChanges();
    expect(f.nativeElement.textContent).toContain('המשלוח השתנה מאז ההגשה — נדרשת בדיקה מחדש');
    await flushLists(f, [], []);
  });
});
