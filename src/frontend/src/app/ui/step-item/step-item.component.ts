import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { IconComponent } from '../icon/icon.component';
import { IconName } from '../icon/icon-paths';

export type StepState = 'done' | 'current' | 'pending' | 'blocked' | 'invalidated' | 'skipped';

const STATE_ICON: Partial<Record<StepState, IconName>> = {
  done: 'check',
  blocked: 'alert-circle',
  invalidated: 'refresh',
};

const STATE_TEXT: Record<StepState, string> = {
  done: 'הושלם',
  current: 'שלב נוכחי',
  pending: 'טרם הושלם',
  blocked: 'חסום',
  invalidated: 'נדרשת בדיקה מחדש',
  skipped: 'דולג',
};

/** Wizard step (Figma 7:189). */
@Component({
  selector: 'rc-step-item',
  imports: [IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div [class]="'step step--' + state()" [attr.aria-current]="state() === 'current' ? 'step' : null">
      <span class="step__dot" aria-hidden="true">
        @if (icon(); as name) {
          <rc-icon [name]="name" [size]="18" />
        } @else {
          <span class="step__index">{{ index() }}</span>
        }
      </span>
      <span class="step__label">{{ label() }}</span>
      @if (hint()) {
        <span class="step__hint">{{ hint() }}</span>
      }
      <span class="visually-hidden">{{ hiddenText() }}</span>
    </div>
  `,
  styles: `
    :host {
      display: inline-flex;
    }
    .step {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: var(--space-8);
      padding-inline: var(--space-4);
      font-family: var(--font-family);
      color: var(--color-text-primary);
    }
    .step__dot {
      display: flex;
      align-items: center;
      justify-content: center;
      inline-size: 36px;
      block-size: 36px;
      box-sizing: border-box;
      border-radius: var(--radius-full);
      background: var(--color-bg-muted);
    }
    .step__index {
      font-weight: 700;
      font-size: 14px;
      line-height: 20px;
      font-variant-numeric: tabular-nums;
    }
    .step__label {
      font-weight: 700;
      font-size: 14px;
      line-height: 20px;
      white-space: nowrap;
    }
    .step__hint {
      font-weight: 500;
      font-size: 12px;
      line-height: 16px;
      white-space: nowrap;
    }
    .step--done .step__dot { background: var(--color-bg-brand); color: var(--color-text-on-action); }
    .step--current { color: var(--color-text-brand); }
    .step--current .step__dot { background: var(--color-bg-surface); border: 2px solid var(--color-border-brand); }
    .step--pending { color: var(--color-text-tertiary); }
    .step--skipped { color: var(--color-text-disabled); }
    .step--blocked { color: var(--color-status-danger-fg); }
    .step--blocked .step__dot { background: var(--color-status-danger-bg); }
    .step--invalidated { color: var(--color-status-warning-fg); }
    .step--invalidated .step__dot { background: var(--color-status-warning-bg); }
    .visually-hidden {
      position: absolute;
      inline-size: 1px;
      block-size: 1px;
      overflow: hidden;
      clip-path: inset(50%);
      white-space: nowrap;
    }
  `,
})
export class StepItemComponent {
  readonly state = input<StepState>('pending');
  readonly index = input<number | null>(null);
  readonly label = input('');
  readonly hint = input<string | null>(null);

  protected readonly icon = computed(() => STATE_ICON[this.state()] ?? null);
  protected readonly hiddenText = computed(() => {
    const i = this.index();
    const s = STATE_TEXT[this.state()];
    return i === null || i === undefined ? s : `שלב ${i}, ${s}`;
  });
}
