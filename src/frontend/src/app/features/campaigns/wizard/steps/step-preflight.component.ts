import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { Finding } from '../../../../core/api.client';
import { formatIls, formatNumber } from '../../../../core/format';
import { ButtonComponent } from '../../../../ui/button/button.component';
import { PreflightItemComponent } from '../../../../ui/preflight-item/preflight-item.component';
import { PREFLIGHT_STEP, stepIndexFor, WizardStore } from '../wizard.store';

/** S14 — בדיקה: the server's preflight findings. "תקן" goes back to the step the finding belongs to. */
@Component({
  selector: 'app-step-preflight',
  imports: [ButtonComponent, PreflightItemComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="stack">
      <div class="page-head">
        <h2 id="wizard-step-heading" tabindex="-1" class="t-h2-20 section-title">בדיקה לפני הגשה</h2>
        <rc-button class="page-head__actions" variant="secondary" [disabled]="s.preflightPending() || s.locked()" (click)="s.refreshPreflight()">
          בדיקה חוזרת
        </rc-button>
      </div>

      @if (s.preflightPending() && !s.preflight()) {
        <p class="muted" role="status">מריץ בדיקה…</p>
      } @else if (s.preflight(); as p) {
        <p class="muted num">
          {{ fmt(p.eligibleRecipients) }} נמענים כשירים · {{ fmt(p.segmentsPerMessage) }} מקטעים להודעה ·
          עלות משוערת <bdi>{{ ils(p.estimatedCost.min) }} – {{ ils(p.estimatedCost.max) }}</bdi>
        </p>
        <ul class="findings">
          @for (f of p.findings; track f.code) {
            <li>
              <rc-preflight-item
                [kind]="f.severity === 'BLOCKER' ? 'blocker' : 'warning'"
                [title]="f.messageHe"
                [meta]="'שלב: ' + f.step"
                [actionLabel]="fixable(f) ? 'תקן' : null"
                (action)="fix(f)"
              />
            </li>
          }
          @if (s.blockers().length === 0) {
            <li><rc-preflight-item kind="passed" title="לא נמצאו חסמים — אפשר להמשיך להגשה" /></li>
          }
        </ul>
      } @else if (s.locked()) {
        <p class="muted">המשלוח נעול לעריכה; הבדיקה רצה מחדש לאחר אישור עריכה.</p>
      } @else {
        <p class="muted">הבדיקה תרוץ כשהקהל, הערוץ והתוכן יהיו מלאים.</p>
      }
    </div>
  `,
  styles: `
    .findings {
      display: flex;
      flex-direction: column;
      gap: var(--space-8);
      margin: 0;
      padding: 0;
      list-style: none;
    }
    p {
      margin: 0;
    }
  `,
})
export class StepPreflightComponent {
  protected readonly s = inject(WizardStore);
  protected readonly fmt = formatNumber;
  protected readonly ils = formatIls;

  protected fixable(f: Finding): boolean {
    const i = stepIndexFor(f.step);
    return i >= 0 && i !== PREFLIGHT_STEP;
  }

  protected fix(f: Finding): void {
    const i = stepIndexFor(f.step);
    if (i >= 0) void this.s.goTo(i);
  }
}
