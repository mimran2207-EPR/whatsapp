import { ChangeDetectionStrategy, Component, computed, DestroyRef, effect, inject, input, signal, untracked } from '@angular/core';
import { RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { ApiClient, TrackingView } from '../../../core/api.client';
import { apiError } from '../../../core/error-messages';
import { asDisplayStatus, formatNumber, formatRate, formatTime } from '../../../core/format';
import { ThrottledAnnouncer, VisibilityPoller } from '../../../core/visibility-poller';
import { BannerComponent, BannerKind } from '../../../ui/banner/banner.component';
import { KpiCardComponent } from '../../../ui/kpi-card/kpi-card.component';
import { StatusBadgeComponent } from '../../../ui/status-badge/status-badge.component';

/** Delivery-axis segments of the stacked bar, in display order. Labels are fixed copy; counts come from the server. */
export const DELIVERY_SEGMENTS = [
  { key: 'delivered', label: 'נמסרו' },
  { key: 'sentOrNotReported', label: 'טרם התקבל אישור מסירה.' },
  { key: 'unknown', label: 'לא ידוע' },
  { key: 'failed', label: 'נכשלו' },
] as const;

/**
 * Banner severity from the server's counts only (the client never computes a status of its own, it just picks a tone
 * for the server's sentence): nothing accepted and something rejected → danger; anything unknown → unknown; any
 * rejection or failure → warning; accepted with nothing contradicting → success; otherwise info.
 */
export function bannerKind(v: TrackingView): BannerKind {
  const { accepted, rejected, unknown } = v.handoff;
  if (accepted === 0 && rejected > 0) return 'danger';
  if (unknown > 0 || v.delivery.unknown > 0) return 'unknown';
  if (rejected > 0 || v.delivery.failed > 0) return 'warning';
  return accepted > 0 ? 'success' : 'info';
}

/** True when every message has a final outcome (delivered or failed), so polling again cannot change anything. */
export function isAllTerminal(v: TrackingView): boolean {
  return v.messages > 0 && v.handoff.notHandedOff === 0 && v.delivery.delivered + v.delivery.failed === v.messages;
}

/** S17 — tracking. Polls every 5s while visible; everything shown is the server's read model, verbatim. */
@Component({
  selector: 'app-tracking',
  imports: [RouterLink, BannerComponent, KpiCardComponent, StatusBadgeComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './tracking.component.html',
  styleUrls: ['./tracking.component.css', './tracking-table.component.css'],
})
export class TrackingComponent {
  readonly id = input.required<string>();

  private readonly api = inject(ApiClient);
  protected readonly view = signal<TrackingView | null>(null);
  protected readonly error = signal<string | null>(null);
  /** Permanent failure (not found / forbidden): polling has stopped. */
  protected readonly fatal = signal<string | null>(null);
  protected readonly announcement = signal('');
  /** False once polling has stopped (permanent error, or every message is final). */
  protected readonly polling = signal(true);

  protected readonly segments = DELIVERY_SEGMENTS;
  protected readonly fmt = formatNumber;
  protected readonly status = asDisplayStatus;
  private readonly announcer = new ThrottledAnnouncer(30_000);
  private poller: VisibilityPoller | null = null;

  protected readonly bannerKind = computed(() => {
    const v = this.view();
    return v ? bannerKind(v) : 'info';
  });

  protected readonly asOf = computed(() => formatTime(this.view()?.dataAsOf));

  protected readonly kpi = computed(() => {
    const v = this.view();
    const k = (key: string) => v?.kpis.find((x) => x.key === key) ?? null;
    return { accepted: k('accepted'), rate: k('operationalDeliveryRate') };
  });

  protected readonly rateText = computed(() => formatRate(this.kpi().rate?.value ?? null));

  constructor() {
    effect(() => {
      const id = this.id();
      untracked(() => this.start(id));
    });
    inject(DestroyRef).onDestroy(() => this.poller?.stop());
  }

  private start(id: string): void {
    this.poller?.stop();
    this.view.set(null);
    this.fatal.set(null);
    this.polling.set(true);
    this.poller = new VisibilityPoller(() => this.refresh(id), 5000);
    this.poller.start();
  }

  private async refresh(id: string): Promise<void> {
    try {
      const v = await firstValueFrom(this.api.tracking(id));
      this.view.set(v);
      this.error.set(null);
      if (isAllTerminal(v)) {
        this.poller?.stop();
        this.polling.set(false);
      }
      const said = this.announcer.offer(
        `${v.bannerHe} נמסרו ${formatNumber(v.delivery.delivered)}, נכשלו ${formatNumber(v.delivery.failed)}, לא ידוע ${formatNumber(v.delivery.unknown)}.`,
      );
      if (said) this.announcement.set(said);
    } catch (e) {
      const err = apiError(e);
      if (err.status === 404 || err.status === 403) {
        // Will not get better by asking again every 5s: stop and say so.
        this.poller?.stop();
        this.polling.set(false);
        this.fatal.set(err.messageHe);
        this.error.set(null);
        return;
      }
      this.error.set(err.messageHe); // transient (network, 5xx): keep polling
      throw e;
    }
  }

  protected count(key: (typeof DELIVERY_SEGMENTS)[number]['key']): number {
    return this.view()?.delivery[key] ?? 0;
  }
}
