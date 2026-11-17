import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { IconComponent } from '../icon/icon.component';
import { IconName } from '../icon/icon-paths';

export type BannerKind = 'info' | 'warning' | 'danger' | 'unknown' | 'success';

const KIND_ICON: Record<BannerKind, IconName> = {
  info: 'alert-circle',
  warning: 'alert-triangle',
  danger: 'x',
  unknown: 'help-circle',
  success: 'check',
};

/** Inline banner (Figma 8:326). Danger interrupts (role=alert); the rest are polite (role=status). */
@Component({
  selector: 'rc-banner',
  imports: [IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div [class]="'banner banner--' + kind()" [attr.role]="kind() === 'danger' ? 'alert' : 'status'">
      <rc-icon [name]="icon()" [size]="20" />
      <p class="banner__message">{{ message() }}</p>
      @if (actionLabel()) {
        <button type="button" class="banner__action" (click)="action.emit()">
          {{ actionLabel() }} <span aria-hidden="true">←</span>
        </button>
      }
    </div>
  `,
  styles: `
    :host {
      display: block;
    }
    .banner {
      display: flex;
      align-items: center;
      gap: var(--space-12);
      padding-block: 14px;
      padding-inline: var(--space-16);
      border: 1.5px solid transparent;
      border-radius: var(--radius-lg);
      font-family: var(--font-family);
    }
    .banner--info { background: var(--color-status-info-bg); color: var(--color-status-info-fg); }
    .banner--warning { background: var(--color-status-warning-bg); color: var(--color-status-warning-fg); }
    .banner--danger { background: var(--color-status-danger-bg); color: var(--color-status-danger-fg); }
    .banner--success { background: var(--color-status-success-bg); color: var(--color-status-success-fg); }
    .banner--unknown {
      background: var(--color-status-unknown-bg);
      color: var(--color-status-unknown-fg);
      border-style: dashed;
      border-color: var(--color-status-unknown-border);
    }
    .banner__message {
      flex: 1;
      margin: 0;
      font-weight: 500;
      font-size: 14px;
      line-height: 20px;
    }
    .banner__action {
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
    .banner__action:hover {
      text-decoration: underline;
    }
    .banner__action:focus-visible {
      outline: none;
      box-shadow: var(--shadow-focus-ring);
    }
  `,
})
export class BannerComponent {
  readonly kind = input<BannerKind>('info');
  readonly message = input('');
  readonly actionLabel = input<string | null>(null);
  readonly action = output<void>();

  protected readonly icon = computed(() => KIND_ICON[this.kind()]);
}
