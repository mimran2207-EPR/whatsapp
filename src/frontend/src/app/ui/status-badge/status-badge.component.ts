import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { IconComponent } from '../icon/icon.component';
import { DisplayStatus, STATUS_GROUP, STATUS_ICON, STATUS_LABEL_HE } from '../status';

/** Display status badge (Figma 6:63): always colour + icon + text. Unknown gets a dashed outline. */
@Component({
  selector: 'rc-status-badge',
  imports: [IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <span [class]="'badge badge--' + group()">
      <rc-icon [name]="icon()" [size]="16" />
      <span class="badge__text">{{ text() }}</span>
    </span>
  `,
  styles: `
    :host {
      display: inline-flex;
    }
    .badge {
      display: inline-flex;
      align-items: center;
      gap: var(--space-4);
      padding-block: 4px;
      padding-inline: 10px;
      border-radius: var(--radius-full);
      font-family: var(--font-family);
      font-weight: 500;
      font-size: 12px;
      line-height: 16px;
      white-space: nowrap;
    }
    .badge--neutral { background: var(--color-status-neutral-bg); color: var(--color-status-neutral-fg); }
    .badge--progress { background: var(--color-status-progress-bg); color: var(--color-status-progress-fg); }
    .badge--success { background: var(--color-status-success-bg); color: var(--color-status-success-fg); }
    .badge--info { background: var(--color-status-info-bg); color: var(--color-status-info-fg); }
    .badge--danger { background: var(--color-status-danger-bg); color: var(--color-status-danger-fg); }
    .badge--unknown {
      background: var(--color-status-unknown-bg);
      color: var(--color-status-unknown-fg);
      border: 1.5px dashed var(--color-status-unknown-border);
    }
  `,
})
export class StatusBadgeComponent {
  readonly status = input.required<DisplayStatus>();
  /** Label as returned by the API. Falls back to the dictionary text. */
  readonly label = input<string | null>(null);

  protected readonly group = computed(() => STATUS_GROUP[this.status()]);
  protected readonly icon = computed(() => STATUS_ICON[this.status()]);
  protected readonly text = computed(() => this.label() || STATUS_LABEL_HE[this.status()]);
}
