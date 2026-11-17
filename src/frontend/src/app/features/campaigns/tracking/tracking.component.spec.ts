import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { TrackingView } from '../../../core/api.client';
import { TrackingComponent } from './tracking.component';

const view: TrackingView = {
  environment: 'sandbox-mock',
  dataAsOf: '2026-11-17T10:15:00Z',
  messages: 5,
  delivery: { delivered: 2, sentOrNotReported: 1, unknown: 1, failed: 1 },
  handoff: { accepted: 4, rejected: 0, unknown: 1, notHandedOff: 0 },
  kpis: [
    { key: 'accepted', value: 4, numerator: 4, denominator: 5 },
    { key: 'operationalDeliveryRate', value: 0.4, numerator: 2, denominator: 5 },
  ],
  bannerHe: '4 הודעות התקבלו אצל הספק. תוצאות המסירה ממשיכות להתעדכן.',
  exceptions: [
    { messageId: 'm1', recipientMasked: '050-***-**12', displayStatus: 'Unknown', displayLabelHe: 'לא ידוע', lastAttempt: 'ניסיון 1 · Timeout', nextActionHe: 'בירור' },
    { messageId: 'm2', recipientMasked: '052-***-**34', displayStatus: 'SomethingNew', displayLabelHe: 'תווית שרת', lastAttempt: null, nextActionHe: 'בירור' },
  ],
};

describe('TrackingComponent', () => {
  let ctrl: HttpTestingController;

  beforeEach(() => {
    vi.useFakeTimers();
    TestBed.configureTestingModule({ providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()] });
    ctrl = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    vi.useRealTimers();
    ctrl.verify();
  });

  async function render() {
    const f = TestBed.createComponent(TrackingComponent);
    f.componentRef.setInput('id', 'c1');
    f.detectChanges();
    await vi.advanceTimersByTimeAsync(0);
    ctrl.expectOne('/v1/campaigns/c1/tracking').flush(view);
    await vi.advanceTimersByTimeAsync(0);
    f.detectChanges();
    return f;
  }

  it('shows the server banner verbatim, the sandbox label and server labels', async () => {
    const f = await render();
    const el: HTMLElement = f.nativeElement;
    expect(el.querySelector('rc-banner')!.textContent).toContain(view.bannerHe);
    expect(el.querySelector('.page-head')!.textContent).toContain('Sandbox (מדומה)');
    expect(el.textContent).toContain('טרם התקבל אישור מסירה.');
    const badges = el.querySelectorAll('rc-status-badge');
    expect(badges[0].textContent).toContain('לא ידוע');
    expect(badges[1].textContent).toContain('תווית שרת');
    expect(el.querySelector('tbody tr:nth-child(2) td:nth-child(3)')!.textContent).toContain('לא ידוע');
    f.destroy();
  });

  it('polls again after 5s', async () => {
    const f = await render();
    await vi.advanceTimersByTimeAsync(5000);
    ctrl.expectOne('/v1/campaigns/c1/tracking').flush(view);
    await vi.advanceTimersByTimeAsync(0);
    f.destroy();
  });

  it('announces a polite summary once, not on every poll', async () => {
    const f = await render();
    const live = () => f.nativeElement.querySelector('[aria-live="polite"]')!.textContent!.trim();
    expect(live()).toContain(view.bannerHe);
    await vi.advanceTimersByTimeAsync(5000);
    ctrl.expectOne('/v1/campaigns/c1/tracking').flush({ ...view, bannerHe: '5 הודעות התקבלו אצל הספק. תוצאות המסירה ממשיכות להתעדכן.' });
    await vi.advanceTimersByTimeAsync(0);
    f.detectChanges();
    expect(live()).toContain(view.bannerHe);
    f.destroy();
  });
});
