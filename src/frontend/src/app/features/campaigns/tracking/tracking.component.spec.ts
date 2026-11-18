import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { TrackingView } from '../../../core/api.client';
import { bannerKind, isAllTerminal, TrackingComponent } from './tracking.component';

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

  it('stops polling on 404 and shows a banner', async () => {
    const f = TestBed.createComponent(TrackingComponent);
    f.componentRef.setInput('id', 'c1');
    f.detectChanges();
    await vi.advanceTimersByTimeAsync(0);
    ctrl.expectOne('/v1/campaigns/c1/tracking').flush({ code: 'NOT_FOUND' }, { status: 404, statusText: 'x' });
    await vi.advanceTimersByTimeAsync(0);
    f.detectChanges();
    expect(f.nativeElement.querySelector('rc-banner')!.textContent).toContain('המשלוח לא נמצא');
    await vi.advanceTimersByTimeAsync(20000);
    ctrl.expectNone('/v1/campaigns/c1/tracking');
    f.destroy();
  });

  it('keeps polling after a transient error', async () => {
    const f = TestBed.createComponent(TrackingComponent);
    f.componentRef.setInput('id', 'c1');
    f.detectChanges();
    await vi.advanceTimersByTimeAsync(0);
    ctrl.expectOne('/v1/campaigns/c1/tracking').flush({}, { status: 503, statusText: 'x' });
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

  it('banner tone follows the server counts: unknown > 0 is not success', async () => {
    const f = await render(); // handoff.unknown = 1
    expect(f.nativeElement.querySelector('rc-banner .banner')!.className).toContain('banner--unknown');
    expect(f.nativeElement.querySelector('.asof')!.textContent).toContain('מתעדכן כל 5 שניות');
    f.destroy();
  });

  describe('bannerKind', () => {
    const base: TrackingView = { ...view, delivery: { delivered: 5, sentOrNotReported: 0, unknown: 0, failed: 0 }, handoff: { accepted: 5, rejected: 0, unknown: 0, notHandedOff: 0 } };
    it('success only when accepted and nothing contradicts', () => {
      expect(bannerKind(base)).toBe('success');
      expect(bannerKind({ ...base, handoff: { ...base.handoff, rejected: 1 } })).toBe('warning');
      expect(bannerKind({ ...base, delivery: { ...base.delivery, failed: 1 } })).toBe('warning');
    });
    it('unknown wins over warning; everything rejected is danger; nothing handed off yet is info', () => {
      expect(bannerKind({ ...base, handoff: { ...base.handoff, unknown: 1, rejected: 1 } })).toBe('unknown');
      expect(bannerKind({ ...base, delivery: { ...base.delivery, unknown: 2 } })).toBe('unknown');
      expect(bannerKind({ ...base, handoff: { accepted: 0, rejected: 5, unknown: 0, notHandedOff: 0 } })).toBe('danger');
      expect(bannerKind({ ...base, handoff: { accepted: 0, rejected: 0, unknown: 0, notHandedOff: 5 } })).toBe('info');
    });
  });

  it('renders a success banner and stops polling (and drops the "every 5 seconds" text) when all messages are final', async () => {
    const final: TrackingView = {
      ...view,
      messages: 5,
      delivery: { delivered: 5, sentOrNotReported: 0, unknown: 0, failed: 0 },
      handoff: { accepted: 5, rejected: 0, unknown: 0, notHandedOff: 0 },
      exceptions: [],
    };
    expect(isAllTerminal(final)).toBe(true);
    expect(isAllTerminal(view)).toBe(false);
    const f = TestBed.createComponent(TrackingComponent);
    f.componentRef.setInput('id', 'c1');
    f.detectChanges();
    await vi.advanceTimersByTimeAsync(0);
    ctrl.expectOne('/v1/campaigns/c1/tracking').flush(final);
    await vi.advanceTimersByTimeAsync(0);
    f.detectChanges();
    expect(f.nativeElement.querySelector('rc-banner .banner')!.className).toContain('banner--success');
    expect(f.nativeElement.querySelector('.asof')!.textContent).not.toContain('מתעדכן');
    await vi.advanceTimersByTimeAsync(20000);
    ctrl.expectNone('/v1/campaigns/c1/tracking');
    f.destroy();
  });

  it('drops the "every 5 seconds" text after a fatal error', async () => {
    const f = TestBed.createComponent(TrackingComponent);
    f.componentRef.setInput('id', 'c1');
    f.detectChanges();
    await vi.advanceTimersByTimeAsync(0);
    ctrl.expectOne('/v1/campaigns/c1/tracking').flush({ code: 'NOT_FOUND' }, { status: 404, statusText: 'x' });
    await vi.advanceTimersByTimeAsync(0);
    f.detectChanges();
    expect(f.nativeElement.querySelector('.asof')!.textContent).not.toContain('מתעדכן');
    f.destroy();
  });
});
