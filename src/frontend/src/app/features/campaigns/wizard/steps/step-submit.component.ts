import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { formatDateTime, formatIls, formatNumber, purposeLabel } from '../../../../core/format';
import { BannerComponent } from '../../../../ui/banner/banner.component';
import { TextFieldComponent } from '../../../../ui/text-field/text-field.component';
import { WizardStore } from '../wizard.store';

/** S15 — אישור ושליחה: binding summary in plain language, schedule, note to the approver. */
@Component({
  selector: 'app-step-submit',
  imports: [BannerComponent, TextFieldComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="stack">
      <h2 id="wizard-step-heading" tabindex="-1" class="t-h2-20 section-title">סיכום מחייב והגשה לאישור</h2>

      @if (s.submittedHash(); as hash) {
        <rc-banner kind="success" [message]="'המשלוח הוגש לאישור. חבילת אישור ' + hash.slice(0, 12) + '…'" />
      }

      <p class="binding t-body-lg-16">{{ binding() }}</p>

      <fieldset class="schedule" [disabled]="s.locked()">
        <legend class="t-body-14-medium">מועד השליחה</legend>
        <label class="opt">
          <input type="radio" name="when" value="now" [checked]="s.scheduleMode() === 'now'" (change)="mode('now')" />
          מיד לאחר האישור
        </label>
        <label class="opt">
          <input type="radio" name="when" value="at" [checked]="s.scheduleMode() === 'at'" (change)="mode('at')" />
          במועד מתוזמן
        </label>
        @if (s.scheduleMode() === 'at') {
          <rc-text-field label="תאריך ושעה" helper="השליחה מתבצעת רק בחלון השעות המותר">
            <input type="datetime-local" [value]="s.scheduleAt()" (change)="at($event)" />
          </rc-text-field>
        }
      </fieldset>

      <rc-text-field label="הערה למאשר (לא חובה)">
        <textarea rows="3" maxlength="500" [value]="s.note()" [disabled]="s.locked()" (input)="note($event)"></textarea>
      </rc-text-field>
    </div>
  `,
  styles: `
    .binding {
      margin: 0;
      padding: var(--space-16);
      border-inline-start: 4px solid var(--color-border-brand);
      border-radius: var(--radius-md);
      background: var(--color-bg-subtle);
      color: var(--color-text-primary);
    }
    .schedule {
      display: flex;
      flex-direction: column;
      gap: var(--space-8);
      margin: 0;
      padding: 0;
      border: 0;
    }
    .opt {
      display: inline-flex;
      align-items: center;
      gap: var(--space-8);
    }
  `,
})
export class StepSubmitComponent {
  protected readonly s = inject(WizardStore);

  protected readonly binding = computed(() => {
    const p = this.s.preflight();
    const when0 = this.s.scheduleMode() === 'at' && this.s.scheduleAt() ? `במועד ${formatDateTime(new Date(this.s.scheduleAt()).toISOString())}` : 'מיד לאחר האישור';
    const n = this.s.serverEligible();
    if (!p && this.s.locked() && n !== null)
      return `המשלוח "${this.s.name()}" (${purposeLabel(this.s.purpose())}) הוגש לאישור: SMS ל-${formatNumber(n)} נמענים, ${when0}. עריכה תבטל את ההגשה.`;
    if (!p) return 'הסיכום יוצג לאחר בדיקה תקינה.';
    const when =
      this.s.scheduleMode() === 'at' && this.s.scheduleAt() ? `במועד ${formatDateTime(new Date(this.s.scheduleAt()).toISOString())}` : 'מיד לאחר האישור';
    return (
      `המשלוח "${this.s.name()}" (${purposeLabel(this.s.purpose())}) יישלח ב-SMS ל-${formatNumber(p.eligibleRecipients)} נמענים ` +
      `מהקובץ "${this.s.fileName() ?? ''}", ${when}. כל הודעה היא ${formatNumber(p.segmentsPerMessage)} מקטעים (${p.encoding}); ` +
      `עלות משוערת ${formatIls(p.estimatedCost.min)}–${formatIls(p.estimatedCost.max)} (הערכה בלבד). ` +
      `האישור נקשר לגרסה הזו בדיוק: כל שינוי אחרי ההגשה יבטל אותו.`
    );
  });

  protected mode(m: 'now' | 'at'): void {
    this.s.scheduleMode.set(m);
    if (m === 'at') return;
    void this.s.refreshPreflight();
  }

  protected at(ev: Event): void {
    this.s.scheduleAt.set((ev.target as HTMLInputElement).value);
    void this.s.refreshPreflight();
  }

  protected note(ev: Event): void {
    this.s.note.set((ev.target as HTMLTextAreaElement).value);
  }
}
