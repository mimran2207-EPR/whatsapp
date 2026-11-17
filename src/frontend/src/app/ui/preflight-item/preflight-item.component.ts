import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { IconComponent } from '../icon/icon.component';
import { IconName } from '../icon/icon-paths';

export type PreflightKind = 'blocker' | 'warning' | 'passed';

const KIND_ICON: Record<PreflightKind, IconName> = {
  blocker: 'alert-circle',
  warning: 'alert-triangle',
  passed: 'check',
};

const KIND_TEXT: Record<PreflightKind, string> = {
  blocker: 'חסם',
  warning: 'אזהרה',
  passed: 'תקין',
};

/** Preflight row (Figma 7:216). Blocker stops release; warning needs acknowledgement; the action links back to the step. */
@Component({
  selector: 'rc-preflight-item',
  imports: [IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div [class]="'pf pf--' + kind()">
      <rc-icon class="pf__icon" [name]="icon()" [size]="20" />
      <div class="pf__text">
        <span class="pf__title"><span class="visually-hidden">{{ kindText() }}: </span>{{ title() }}</span>
        @if (meta()) {
          <span class="pf__meta">{{ meta() }}</span>
        }
      </div>
      @if (actionLabel()) {
        <button type="button" class="pf__action" (click)="action.emit()">
          {{ actionLabel() }} <span aria-hidden="true">←</span>
        </button>
      }
    </div>
  `,
  styles: `
    :host {
      display: block;
    }
    .pf {
      display: flex;
      align-items: center;
      gap: var(--space-12);
      padding-block: var(--space-12);
      padding-inline: var(--space-16);
      border-radius: var(--radius-lg);
      font-family: var(--font-family);
    }
    .pf--blocker { background: var(--color-status-danger-bg); color: var(--color-status-danger-fg); }
    .pf--warning { background: var(--color-status-warning-bg); color: var(--color-status-warning-fg); }
    .pf--passed { background: var(--color-status-success-bg); color: var(--color-status-success-fg); }
    .pf__text {
      display: flex;
      flex: 1;
      flex-direction: column;
      gap: 2px;
      min-inline-size: 0;
    }
    .pf__title {
      font-weight: 500;
      font-size: 14px;
      line-height: 20px;
    }
    .pf__meta {
      font-weight: 500;
      font-size: 12px;
      line-height: 16px;
      color: var(--color-text-secondary);
    }
    .pf__action {
      padding: var(--space-4) var(--space-8);
      border: 0;
      border-radius: var(--radius-sm);
      background: transparent;
      color: var(--color-text-link);
      font: inherit;
      font-weight: 700;
      font-size: 14px;
      line-height: 20px;
      white-space: nowrap;
      cursor: pointer;
    }
    .pf__action:hover {
      text-decoration: underline;
    }
    .pf__action:focus-visible {
      outline: none;
      box-shadow: var(--shadow-focus-ring);
    }
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
export class PreflightItemComponent {
  readonly kind = input<PreflightKind>('blocker');
  readonly title = input('');
  readonly meta = input<string | null>(null);
  readonly actionLabel = input<string | null>(null);
  readonly action = output<void>();

  protected readonly icon = computed(() => KIND_ICON[this.kind()]);
  protected readonly kindText = computed(() => KIND_TEXT[this.kind()]);
}
