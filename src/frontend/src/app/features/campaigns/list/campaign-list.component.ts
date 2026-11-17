import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ApiClient, CampaignListItem } from '../../../core/api.client';
import { AuthService } from '../../../core/auth.service';
import { apiError } from '../../../core/error-messages';
import { asChannel, formatNumber, formatTime, purposeLabel, stateLabel } from '../../../core/format';
import { ButtonComponent } from '../../../ui/button/button.component';
import { ChannelChipComponent } from '../../../ui/channel-chip/channel-chip.component';
import { GridRowComponent } from '../../../ui/grid-row/grid-row.component';

/** S02 — campaigns list. Counts are the server's per-axis counters, shown with their "נכון ל-" time. */
@Component({
  selector: 'app-campaign-list',
  imports: [RouterLink, ButtonComponent, ChannelChipComponent, GridRowComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="page">
      <div class="page-head">
        <h1 class="t-h1-24">משלוחים</h1>
        <div class="page-head__actions">
          <a class="link-btn" routerLink="/campaigns/new">משלוח חדש</a>
          <rc-button variant="secondary" (click)="load()">רענון</rc-button>
        </div>
      </div>

      @if (error()) {
        <p class="error-text" role="alert">{{ error() }}</p>
      }

      @if (rows() === null) {
        <p class="muted" role="status">טוען משלוחים…</p>
      } @else if (rows()!.length === 0) {
        <p class="empty">עדיין אין משלוחים. <a class="link-btn" routerLink="/campaigns/new">צרו משלוח ראשון</a></p>
      } @else {
        <div class="data-table" role="table" aria-label="רשימת משלוחים">
          <div class="data-table__head" role="row">
            <span class="cell cell--wide" role="columnheader">שם המשלוח</span>
            <span class="cell" role="columnheader">מטרה</span>
            <span class="cell" role="columnheader">ערוץ</span>
            <span class="cell" role="columnheader">מצב</span>
            <span class="cell cell--wide" role="columnheader">מונים לפי ציר</span>
          </div>
          @for (c of rows(); track c.campaignId) {
            <rc-grid-row role="row">
              <span class="cell cell--wide" role="cell">
                @if (link(c); as l) {
                  <a class="link-btn" [routerLink]="l" [queryParams]="linkQuery(c)">{{ c.name }}</a>
                } @else {
                  {{ c.name }}
                }
                <span class="muted num"> · {{ fmt(c.recipients) }} נמענים</span>
              </span>
              <span class="cell" role="cell">{{ purpose(c.purpose) }}</span>
              <span class="cell" role="cell">
                @if (channel(c.channel); as ch) {
                  <rc-channel-chip [channel]="ch" />
                } @else {
                  <span class="muted">טרם נבחר</span>
                }
              </span>
              <span class="cell" role="cell">{{ state(c.state) }}</span>
              <span class="cell cell--wide" role="cell">
                <dl class="counts">
                  <div><dt>התקבלו אצל הספק</dt><dd>{{ fmt(c.counts.accepted) }}</dd></div>
                  <div><dt>נמסרו</dt><dd>{{ fmt(c.counts.delivered) }}</dd></div>
                  <div><dt>לא ידוע</dt><dd>{{ fmt(c.counts.unknown) }}</dd></div>
                  <div><dt>נכשלו</dt><dd>{{ fmt(c.counts.failed) }}</dd></div>
                </dl>
                <span class="muted num">נכון ל-{{ time(c.dataAsOf) }}</span>
              </span>
            </rc-grid-row>
          }
        </div>
      }
    </div>
  `,
})
export class CampaignListComponent {
  private readonly api = inject(ApiClient);
  private readonly auth = inject(AuthService);
  protected readonly rows = signal<CampaignListItem[] | null>(null);
  protected readonly error = signal<string | null>(null);

  protected readonly fmt = formatNumber;
  protected readonly time = formatTime;
  protected readonly purpose = purposeLabel;
  protected readonly state = stateLabel;
  protected readonly channel = asChannel;

  constructor() {
    this.load();
  }

  load(): void {
    this.error.set(null);
    this.api.listCampaigns().subscribe({
      next: (r) => this.rows.set(r),
      error: (e: unknown) => {
        this.error.set(apiError(e).messageHe);
        if (this.rows() === null) this.rows.set([]);
      },
    });
  }

  protected link(c: CampaignListItem): string[] | null {
    if (c.state === 'RELEASED') return ['/campaigns', c.campaignId, 'tracking'];
    if (c.state === 'DRAFT') return ['/campaigns', c.campaignId, 'edit'];
    // Waiting for approval or for release: the approvals screen (approver) handles both.
    if ((c.state === 'SUBMITTED' || c.state === 'APPROVED') && this.auth.user()?.role === 'approver') return ['/approvals'];
    return null;
  }

  protected linkQuery(c: CampaignListItem): Record<string, string> | null {
    return c.state === 'SUBMITTED' || c.state === 'APPROVED' ? { campaign: c.campaignId } : null;
  }
}
