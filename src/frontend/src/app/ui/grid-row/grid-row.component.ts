import { booleanAttribute, ChangeDetectionStrategy, Component, input } from '@angular/core';
import { IconComponent } from '../icon/icon.component';

export type Density = 'comfortable' | 'compact';

/**
 * Data row visual (Figma 8:252). Cells are projected; in RTL the first cell sits on the right (start) edge.
 * It carries no grid/table ARIA itself: the feature's table or grid container owns the semantics.
 * Selection is shown by colour plus a check icon and a "נבחר" text, so it is not colour-only.
 */
@Component({
  selector: 'rc-grid-row',
  imports: [IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="row" [attr.data-density]="density()" [class.row--selected]="selected()">
      <ng-content />
      @if (selected()) {
        <span class="row__selected">
          <rc-icon name="check" [size]="16" />
          <span class="visually-hidden">נבחר</span>
        </span>
      }
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
    .row__selected {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      margin-inline-start: auto;
      inline-size: 24px;
      block-size: 24px;
      flex: none;
      border-radius: var(--radius-full);
      background: var(--color-bg-brand);
      color: var(--color-text-on-action);
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
export class GridRowComponent {
  readonly density = input<Density>('comfortable');
  readonly selected = input(false, { transform: booleanAttribute });
}
