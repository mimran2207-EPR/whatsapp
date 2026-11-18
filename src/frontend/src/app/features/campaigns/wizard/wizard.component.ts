import { afterNextRender, ChangeDetectionStrategy, Component, computed, effect, ElementRef, inject, Injector, input, signal, untracked } from '@angular/core';
import { Location } from '@angular/common';
import { Router, RouterLink } from '@angular/router';
import { formatNumber, formatTime } from '../../../core/format';
import { BannerComponent } from '../../../ui/banner/banner.component';
import { ButtonComponent } from '../../../ui/button/button.component';
import { StepItemComponent } from '../../../ui/step-item/step-item.component';
import { StepAudienceComponent } from './steps/step-audience.component';
import { StepChannelComponent } from './steps/step-channel.component';
import { StepContentComponent } from './steps/step-content.component';
import { StepPreflightComponent } from './steps/step-preflight.component';
import { StepSubmitComponent } from './steps/step-submit.component';
import { WizardSummaryComponent } from './wizard-summary.component';
import { DOCUMENTS_STEP, PREFLIGHT_STEP, STEPS, SUBMIT_STEP, WizardStore } from './wizard.store';

/** S10–S15 — SMS campaign wizard: stepper, one primary action per step, sticky summary, autosave on step change. */
@Component({
  selector: 'app-wizard',
  imports: [
    RouterLink,
    BannerComponent,
    ButtonComponent,
    StepItemComponent,
    StepAudienceComponent,
    StepChannelComponent,
    StepContentComponent,
    StepPreflightComponent,
    StepSubmitComponent,
    WizardSummaryComponent,
  ],
  providers: [WizardStore],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './wizard.component.html',
  styleUrl: './wizard.component.css',
})
export class WizardComponent {
  /** Route param on /campaigns/:id/edit (component input binding). */
  readonly id = input<string | undefined>();

  protected readonly s = inject(WizardStore);
  private readonly location = inject(Location);
  private readonly router = inject(Router);
  protected readonly steps = STEPS;
  protected readonly DOCUMENTS_STEP = DOCUMENTS_STEP;
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly injector = inject(Injector);

  /** Polite announcement of the current step after a step change (screen readers). */
  protected readonly stepAnnouncement = signal('');
  /** Second click needed to edit a submitted campaign. */
  protected readonly confirmEdit = signal(false);

  protected readonly savedText = computed(() => {
    const t = this.s.savedAt();
    return t ? `נשמר אוטומטית · ${formatTime(t)}` : null;
  });

  protected readonly primary = computed<{ label: string; disabled: boolean; reason: string | null }>(() => {
    const s = this.s;
    switch (s.step()) {
      case 0:
        return s.summary()
          ? { label: 'המשך לבחירת ערוץ', disabled: s.busy(), reason: null }
          : {
              label: 'ייבוא הקובץ',
              disabled: !s.canImport(),
              reason: s.canImport() ? null : 'יש למלא שם משלוח, לבחור קובץ ולמפות ת.ז וטלפון',
            };
      case 1:
        return { label: 'המשך לכתיבת התוכן', disabled: false, reason: null };
      case 2:
        return { label: 'המשך לבדיקה', disabled: !s.content().trim(), reason: s.content().trim() ? null : 'יש לכתוב את תוכן ההודעה' };
      case PREFLIGHT_STEP: {
        const blocked = s.blockers().length > 0;
        const pending = s.preflightPending() || !s.preflight();
        return {
          label: 'המשך לאישור ושליחה',
          disabled: blocked || pending,
          reason: blocked ? 'יש לתקן את החסמים לפני ההמשך' : pending ? 'הבדיקה עדיין רצה' : null,
        };
      }
      default: {
        if (s.locked()) return { label: 'הוגש לאישור', disabled: true, reason: 'המשלוח כבר הוגש לאישור' };
        const n = s.preflight()?.eligibleRecipients;
        const ready = n !== undefined && !s.busy() && !s.submittedHash() && s.blockers().length === 0;
        return {
          label: n === undefined ? 'הגשה לאישור' : `הגשה לאישור · ${formatNumber(n)} הודעות`,
          disabled: !ready,
          reason: ready ? null : s.submittedHash() ? 'המשלוח כבר הוגש לאישור' : 'נדרשת בדיקה תקינה לפני הגשה',
        };
      }
    }
  });

  constructor() {
    effect(() => {
      const id = this.id();
      if (id) untracked(() => this.s.resume(id));
    });

    // On a step change (not on first render): announce it and move focus to the new step heading, so keyboard and
    // screen-reader users land at the top of the new step instead of on <body> when the old content is destroyed.
    let previous: number | null = null;
    effect(() => {
      const step = this.s.step();
      const restored = untracked(() => this.s.restoredStep());
      if (previous === null || previous === step || restored === step) {
        if (restored === step) untracked(() => this.s.restoredStep.set(null));
        previous = step;
        return;
      }
      previous = step;
      untracked(() => {
        this.stepAnnouncement.set(`שלב ${step + 1} מתוך ${STEPS.length}: ${STEPS[step].label}`);
        afterNextRender(() => this.host.nativeElement.querySelector<HTMLElement>('#wizard-step-heading')?.focus(), { injector: this.injector });
      });
    });
  }

  protected openTracking(): void {
    const id = this.s.campaignId();
    if (id) void this.router.navigate(['/campaigns', id, 'tracking']);
  }

  protected async startEdit(): Promise<void> {
    if (!this.confirmEdit()) {
      this.confirmEdit.set(true);
      return;
    }
    // The server withdraws the submission first; on refusal the draft stays locked and the error is shown.
    const ok = await this.s.unlockForEdit();
    this.confirmEdit.set(false);
    if (ok) {
      this.stepAnnouncement.set('ההגשה בוטלה. אפשר לערוך.');
    }
  }

  protected canVisit(i: number): boolean {
    return i !== DOCUMENTS_STEP && i <= this.s.maxStep() && !this.s.busy();
  }

  protected visit(i: number): void {
    if (this.canVisit(i) && i !== this.s.step()) void this.s.goTo(i);
  }

  protected back(): void {
    void this.s.goTo(this.s.step() - 1);
  }

  protected async next(): Promise<void> {
    const s = this.s;
    const step = s.step();
    if (step === 0 && !s.summary()) {
      const wasNew = !s.campaignId();
      if ((await s.runImport()) && wasNew && s.campaignId()) {
        // Keep the draft addressable (a reload resumes it) without re-creating this component.
        this.location.replaceState(`/campaigns/${s.campaignId()}/edit`);
      }
      return;
    }
    if (step === SUBMIT_STEP) {
      await s.submit();
      return;
    }
    await s.goTo(step + 1);
  }
}
