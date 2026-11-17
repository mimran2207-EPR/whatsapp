import { ChangeDetectionStrategy, Component, computed, DestroyRef, effect, inject, input, signal, untracked } from '@angular/core';
import { RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { ApiClient, TrackingView } from '../../../core/api.client';
import { apiError } from '../../../core/error-messages';
import { asDisplayStatus, formatNumber, formatRate, formatTime } from '../../../core/format';
import { ThrottledAnnouncer, VisibilityPoller } from '../../../core/visibility-poller';
import { BannerComponent } from '../../../ui/banner/banner.component';
import { KpiCardComponent } from '../../../ui/kpi-card/kpi-card.component';
import { StatusBadgeComponent } from '../../../ui/status-badge/status-badge.component';

/** Delivery-axis segments of the stacked bar, in display order. Labels are fixed copy; counts come from the server. */
export const DELIVERY_SEGMENTS = [
  { key: 'delivered', label: 'נמסרו' },
  { key: 'sentOrNotReported', label: 'טרם התקבל אישור מסירה.' },
  { key: 'unknown', label: 'לא ידוע' },
  { key: 'failed', label: 'נכשלו' },
] as const;

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
  protected readonly announcement = signal('');

  protected readonly segments = DELIVERY_SEGMENTS;
  protected readonly fmt = formatNumber;
  protected readonly status = asDisplayStatus;
  private readonly announcer = new ThrottledAnnouncer(30_000);
  private poller: VisibilityPoller | null = null;

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
    this.poller = new VisibilityPoller(() => this.refresh(id), 5000);
    this.poller.start();
  }

  private async refresh(id: string): Promise<void> {
    try {
      const v = await firstValueFrom(this.api.tracking(id));
      this.view.set(v);
      this.error.set(null);
      const said = this.announcer.offer(
        `${v.bannerHe} נמסרו ${formatNumber(v.delivery.delivered)}, נכשלו ${formatNumber(v.delivery.failed)}, לא ידוע ${formatNumber(v.delivery.unknown)}.`,
      );
      if (said) this.announcement.set(said);
    } catch (e) {
      this.error.set(apiError(e).messageHe);
      throw e;
    }
  }

  protected count(key: (typeof DELIVERY_SEGMENTS)[number]['key']): number {
    return this.view()?.delivery[key] ?? 0;
  }
}
