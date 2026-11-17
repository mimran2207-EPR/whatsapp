import { booleanAttribute, ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';

let nextId = 0;

/** Muni button (Figma 6:144). A disabled button should say why: `disabledReason` is exposed via aria-describedby. */
@Component({
  selector: 'rc-button',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <button
      [type]="type()"
      [class]="'btn btn--' + variant()"
      [disabled]="disabled()"
      [attr.aria-describedby]="hasReason() ? reasonId : null"
    >
      <ng-content />
    </button>
    @if (hasReason()) {
      <span class="visually-hidden" [id]="reasonId">{{ disabledReason() }}</span>
    }
  `,
  styles: `
    :host {
      display: inline-flex;
    }
    .btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: var(--space-8);
      inline-size: 100%;
      block-size: var(--control-height);
      padding-inline: 20px;
      border: 1px solid transparent;
      border-radius: var(--radius-md);
      font-family: var(--font-family);
      font-weight: 700;
      font-size: 14px;
      line-height: 20px;
      white-space: nowrap;
      cursor: pointer;
    }
    .btn:focus-visible {
      outline: none;
      box-shadow: var(--shadow-focus-ring);
    }
    .btn--primary {
      background: var(--color-bg-brand);
      color: var(--color-text-on-action);
      box-shadow: var(--shadow-brand-button);
    }
    .btn--primary:hover:not(:disabled) {
      background: var(--color-bg-brand-hover);
    }
    .btn--secondary {
      background: var(--color-bg-muted);
      border-color: var(--color-border-default);
      color: var(--color-text-link);
    }
    .btn--secondary:hover:not(:disabled),
    .btn--ghost:hover:not(:disabled) {
      background: var(--color-bg-subtle);
    }
    .btn--ghost {
      background: transparent;
      color: var(--color-text-brand);
    }
    .btn--danger {
      background: var(--color-status-danger-bg);
      color: var(--color-status-danger-fg);
    }
    .btn--danger:hover:not(:disabled) {
      border-color: var(--color-status-danger-fg);
    }
    .btn:disabled {
      background: var(--color-bg-muted);
      border-color: transparent;
      box-shadow: none;
      color: var(--color-text-disabled);
      cursor: not-allowed;
    }
    .btn--ghost:disabled {
      background: transparent;
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
export class ButtonComponent {
  readonly variant = input<ButtonVariant>('primary');
  readonly type = input<'button' | 'submit' | 'reset'>('button');
  readonly disabled = input(false, { transform: booleanAttribute });
  readonly disabledReason = input<string | null>(null);

  protected readonly reasonId = `rc-btn-reason-${nextId++}`;
  protected readonly hasReason = computed(() => this.disabled() && !!this.disabledReason());
}
