import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { ApprovalListItem } from '../../core/api.client';
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

describe('ApprovalsComponent', () => {
  let ctrl: HttpTestingController;

  async function setup() {
    TestBed.configureTestingModule({
      providers: [provideRouter([]), provideHttpClient(withInterceptors([idempotencyInterceptor])), provideHttpClientTesting()],
    });
    ctrl = TestBed.inject(HttpTestingController);
    const f = TestBed.createComponent(ApprovalsComponent);
    f.componentRef.setInput('campaign', 'c1');
    f.detectChanges();
    ctrl.expectOne('/v1/approvals').flush([item]);
    await f.whenStable();
    f.detectChanges();
    return f;
  }

  const primary = (el: HTMLElement) => el.querySelector<HTMLButtonElement>('.actions rc-button button')!;

  afterEach(() => ctrl.verify());

  it('labels the primary button exactly "אישור ושליחת {N} הודעות"', async () => {
    const f = await setup();
    expect(primary(f.nativeElement).textContent!.trim()).toBe('אישור ושליחת 1,250 הודעות');
  });

  it('approves with the package hash, then releases, then opens tracking', async () => {
    const f = await setup();
    const nav = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    primary(f.nativeElement).click();
    const approve = ctrl.expectOne('/v1/campaigns/c1/approve');
    expect(approve.request.body).toEqual({ packageHash: 'abcdef0123456789' });
    approve.flush({ approvalId: 'a1' });
    await f.whenStable();
    const release = ctrl.expectOne('/v1/campaigns/c1/release');
    release.flush({ messagesCreated: 1250, suppressed: 0, environment: 'sandbox-mock' }, { status: 202, statusText: 'Accepted' });
    await f.whenStable();
    expect(nav).toHaveBeenCalledWith(['/campaigns', 'c1', 'tracking']);
  });

  it('shows the Hebrew message for a server error and retries only the release with the same key', async () => {
    const f = await setup();
    primary(f.nativeElement).click();
    ctrl.expectOne('/v1/campaigns/c1/approve').flush({ approvalId: 'a1' });
    await f.whenStable();
    const r1 = ctrl.expectOne('/v1/campaigns/c1/release');
    const key = r1.request.headers.get('Idempotency-Key');
    r1.flush({ code: 'OUTSIDE_SEND_WINDOW' }, { status: 422, statusText: 'Unprocessable' });
    await f.whenStable();
    f.detectChanges();
    expect(f.nativeElement.textContent).toContain('מחוץ לחלון השעות — תזמנו לשעה מותרת');

    primary(f.nativeElement).click();
    ctrl.expectNone('/v1/campaigns/c1/approve');
    const r2 = ctrl.expectOne('/v1/campaigns/c1/release');
    expect(r2.request.headers.get('Idempotency-Key')).toBe(key);
    r2.flush({ code: 'OUTSIDE_SEND_WINDOW' }, { status: 422, statusText: 'Unprocessable' });
    await f.whenStable();
  });

  it('maps STALE_REVISION and reloads the inbox', async () => {
    const f = await setup();
    primary(f.nativeElement).click();
    ctrl.expectOne('/v1/campaigns/c1/approve').flush({ code: 'STALE_REVISION' }, { status: 409, statusText: 'Conflict' });
    await f.whenStable();
    f.detectChanges();
    expect(f.nativeElement.textContent).toContain('המשלוח השתנה מאז ההגשה — נדרשת בדיקה מחדש');
    ctrl.expectOne('/v1/approvals').flush([]);
  });
});
