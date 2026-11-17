import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

export type KpiKind = 'count' | 'rate' | 'unknown';

const NUMBER = new Intl.NumberFormat('he-IL');

/** KPI card (Figma 8:171). Values come from the server; a null value is "לא ניתן לחישוב", never zero. */
@Component({
  selector: 'rc-kpi-card',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div [class]="'kpi kpi--' + kind()">
      <span class="kpi__title">{{ title() }}</span>
      @if (display(); as v) {
        <span class="kpi__value t-kpi-32"><bdi>{{ v }}</bdi></span>
      } @else {
        <span class="kpi__value kpi__value--na">לא ניתן לחישוב</span>
      }
      @if (definition()) {
        <span class="kpi__definition">{{ definition() }}</span>
      }
      @if (dataAsOf()) {
        <span class="kpi__asof">נכון ל-<bdi>{{ dataAsOf() }}</bdi></span>
      }
    </div>
  `,
  styles: `
    :host {
      display: block;
    }
    .kpi {
      display: flex;
      flex-direction: column;
      gap: 6px;
      box-sizing: border-box;
      block-size: 100%;
      padding: 20px;
      border: 1px solid var(--color-border-default);
      border-radius: var(--radius-xl);
      background: var(--color-bg-surface);
      box-shadow: var(--shadow-card);
      font-family: var(--font-family);
    }
    .kpi--unknown {
      border: 1px dashed var(--color-status-unknown-border);
    }
    .kpi__title {
      font-weight: 500;
      font-size: 12px;
      line-height: 16px;
      color: var(--color-text-secondary);
    }
    .kpi__value {
      font-weight: 700;
      font-size: 32px;
      line-height: 40px;
      font-variant-numeric: tabular-nums;
      color: var(--color-text-primary);
    }
    .kpi--rate .kpi__value { color: var(--color-text-brand); }
    .kpi--unknown .kpi__value { color: var(--color-status-unknown-fg); }
    .kpi__value--na {
      font-size: 18px;
      line-height: 40px;
      color: var(--color-text-secondary);
    }
    .kpi__definition {
      font-weight: 500;
      font-size: 12px;
      line-height: 16px;
      color: var(--color-text-tertiary);
    }
    .kpi__asof {
      font-weight: 700;
      font-size: 11px;
      line-height: 14px;
      color: var(--color-text-link);
      font-variant-numeric: tabular-nums;
    }
  `,
})
export class KpiCardComponent {
  readonly kind = input<KpiKind>('count');
  readonly title = input('');
  readonly value = input<string | number | null>(null);
  readonly definition = input<string | null>(null);
  readonly dataAsOf = input<string | null>(null);

  protected readonly display = computed(() => {
    const v = this.value();
    if (v === null || v === undefined || v === '') return null;
    return typeof v === 'number' ? NUMBER.format(v) : v;
  });
}
