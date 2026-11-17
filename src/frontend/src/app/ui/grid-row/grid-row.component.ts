import { booleanAttribute, ChangeDetectionStrategy, Component, input } from '@angular/core';

export type Density = 'comfortable' | 'compact';

/** Data grid row (Figma 8:252). Cells are projected; in RTL the first cell sits on the right (start) edge. */
@Component({
  selector: 'rc-grid-row',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div
      class="row"
      role="row"
      [attr.data-density]="density()"
      [attr.aria-selected]="selected()"
      [class.row--selected]="selected()"
    >
      <ng-content />
    </div>
  `,
  styles: `
    :host {
      display: block;
    }
    .row {
      display: flex;
      align-items: center;
      gap: var(--space-24);
      box-sizing: border-box;
      min-block-size: var(--row-height);
      padding-block: var(--row-padding-y);
      padding-inline: var(--row-padding-x);
      border: 1px solid transparent;
      border-radius: var(--radius-xl);
      background: var(--color-bg-surface);
      box-shadow: var(--shadow-card);
      font-family: var(--font-family);
      font-size: 14px;
      line-height: 20px;
      color: var(--color-text-body);
    }
    .row--selected {
      background: var(--color-bg-subtle);
      border-color: var(--color-border-brand);
    }
    .row[data-density='compact'] {
      gap: var(--space-16);
      border-radius: 0;
      border-color: transparent;
      border-block-end-color: var(--color-border-default);
      box-shadow: none;
    }
    .row[data-density='compact'].row--selected {
      background: var(--color-bg-subtle);
    }
  `,
})
export class GridRowComponent {
  readonly density = input<Density>('comfortable');
  readonly selected = input(false, { transform: booleanAttribute });
}
