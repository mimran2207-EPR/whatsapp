import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { formatIls, formatNumber } from '../../../core/format';
import { ChannelChipComponent } from '../../../ui/channel-chip/channel-chip.component';
import { WizardStore } from './wizard.store';

/** Sticky wizard summary (spec §4): audience, channel, segments, estimated cost, and the blockers box. Server values only. */
@Component({
  selector: 'app-wizard-summary',
  imports: [ChannelChipComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <aside class="card sum" aria-labelledby="sum-title">
      <h2 id="sum-title" class="t-h3-18 section-title">סיכום המשלוח</h2>
      <dl class="sum__list">
        <div>
          <dt>קהל</dt>
          <dd>
            @if (s.summary(); as imp) {
              <span class="num">{{ fmt(s.preflight()?.eligibleRecipients ?? imp.validCount) }}</span> נמענים כשירים
              <span class="sum__meta">{{ s.fileName() }} · <span class="num">{{ fmt(imp.rowCount) }}</span> שורות</span>
            } @else {
              <span class="sum__meta">טרם נבחר</span>
            }
          </dd>
        </div>
        <div>
          <dt>ערוץ</dt>
          <dd>
            @if (s.summary()) {
              <rc-channel-chip channel="SMS" />
            } @else {
              <span class="sum__meta">טרם נבחר</span>
            }
          </dd>
        </div>
        <div>
          <dt>מקטעים להודעה</dt>
          <dd>
            @if (s.preflight(); as p) {
              <span class="num">{{ fmt(p.segmentsPerMessage) }}</span> <span class="sum__meta">({{ p.encoding }})</span>
            } @else {
              <span class="sum__meta">טרם חושב</span>
            }
          </dd>
        </div>
        <div>
          <dt>עלות משוערת</dt>
          <dd>
            @if (s.preflight(); as p) {
              <bdi class="num">{{ ils(p.estimatedCost.min) }} – {{ ils(p.estimatedCost.max) }}</bdi>
              <span class="sum__meta">הערכה בלבד</span>
            } @else {
              <span class="sum__meta">טרם חושב</span>
            }
          </dd>
        </div>
      </dl>

      <div class="sum__blockers" [class.sum__blockers--on]="s.blockers().length > 0">
        <h3 class="t-body-14-medium sum__btitle">חסימות</h3>
        @if (!s.preflight()) {
          <p class="sum__meta">טרם נבדק</p>
        } @else if (s.blockers().length === 0) {
          <p class="sum__meta">אין חסימות ידועות</p>
        } @else {
          <ul>
            @for (b of s.blockers(); track b.code) {
              <li>{{ b.messageHe }}</li>
            }
          </ul>
        }
      </div>
    </aside>
  `,
  styles: `
    .sum {
      display: flex;
      flex-direction: column;
      gap: var(--space-16);
    }
    .sum__list {
      display: flex;
      flex-direction: column;
      gap: var(--space-12);
      margin: 0;
    }
    .sum__list dt {
      color: var(--color-text-secondary);
      font-size: 12px;
      line-height: 16px;
    }
    .sum__list dd {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: var(--space-4);
      margin: 0;
      font-weight: 500;
      color: var(--color-text-primary);
    }
    .sum__meta {
      margin: 0;
      font-weight: 400;
      font-size: 12px;
      color: var(--color-text-secondary);
    }
    .sum__blockers {
      padding: var(--space-12);
      border-radius: var(--radius-lg);
      background: var(--color-bg-muted);
    }
    .sum__blockers--on {
      background: var(--color-status-danger-bg);
      color: var(--color-status-danger-fg);
    }
    .sum__btitle {
      margin: 0 0 var(--space-4);
    }
    .sum__blockers ul {
      margin: 0;
      padding-inline-start: var(--space-16);
    }
  `,
})
export class WizardSummaryComponent {
  protected readonly s = inject(WizardStore);
  protected readonly fmt = formatNumber;
  protected readonly ils = formatIls;
}
