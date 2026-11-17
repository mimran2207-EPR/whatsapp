import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { formatNumber } from '../../../../core/format';
import { IconComponent } from '../../../../ui/icon/icon.component';
import { IconName } from '../../../../ui/icon/icon-paths';
import { WizardStore } from '../wizard.store';

interface ChannelCard {
  key: 'SMS' | 'WHATSAPP' | 'EMAIL';
  label: string;
  icon: IconName;
  tone: 'sms' | 'whatsapp' | 'email';
  enabled: boolean;
}

/** S11 — איך: SMS only in M1. WhatsApp and Email are visible but disabled, tagged "M2". */
@Component({
  selector: 'app-step-channel',
  imports: [IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="stack">
      <h2 class="t-h2-20 section-title">איך שולחים?</h2>
      <div class="cards" role="radiogroup" aria-label="ערוץ שליחה">
        @for (c of cards; track c.key) {
          <div
            [class]="'ch ch--' + c.tone"
            [class.ch--off]="!c.enabled"
            role="radio"
            [attr.aria-checked]="c.enabled"
            [attr.aria-disabled]="!c.enabled"
            [attr.tabindex]="c.enabled ? 0 : -1"
          >
            <rc-icon [name]="c.icon" [size]="24" />
            <span class="ch__label"><bdi lang="en">{{ c.label }}</bdi></span>
            @if (c.enabled) {
              <span class="ch__meta">נבחר · <span class="num">{{ fmt(s.summary()?.validCount ?? 0) }}</span> נמענים עם טלפון תקין</span>
            } @else {
              <span class="ch__tag">M2</span>
              <span class="ch__meta">יתווסף בשלב M2</span>
            }
          </div>
        }
      </div>
    </div>
  `,
  styles: `
    .cards {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
      gap: var(--space-16);
    }
    .ch {
      position: relative;
      display: flex;
      flex-direction: column;
      gap: var(--space-8);
      padding: 20px;
      border: 2px solid;
      border-radius: var(--radius-xl);
    }
    .ch:focus-visible {
      outline: none;
      box-shadow: var(--shadow-focus-ring);
    }
    .ch--sms { background: var(--color-channel-sms-bg); border-color: var(--color-channel-sms-fg); color: var(--color-channel-sms-fg); }
    .ch--whatsapp { background: var(--color-channel-whatsapp-bg); border-color: var(--color-channel-whatsapp-border); color: var(--color-channel-whatsapp-fg); }
    .ch--email { background: var(--color-channel-email-bg); border-color: var(--color-channel-email-border); color: var(--color-channel-email-fg); }
    .ch--off {
      background: var(--color-bg-muted);
      border-color: var(--color-border-default);
      color: var(--color-text-disabled);
      cursor: not-allowed;
    }
    .ch__label {
      font-weight: 700;
      font-size: 16px;
      line-height: 24px;
    }
    .ch__meta {
      font-size: 12px;
      line-height: 16px;
      color: var(--color-text-secondary);
    }
    .ch__tag {
      position: absolute;
      inset-block-start: var(--space-12);
      inset-inline-end: var(--space-12);
      padding: 2px var(--space-8);
      border-radius: var(--radius-full);
      background: var(--color-status-neutral-bg);
      color: var(--color-status-neutral-fg);
      font-weight: 700;
      font-size: 11px;
      line-height: 14px;
    }
  `,
})
export class StepChannelComponent {
  protected readonly s = inject(WizardStore);
  protected readonly fmt = formatNumber;
  protected readonly cards: ChannelCard[] = [
    { key: 'SMS', label: 'SMS', icon: 'sms', tone: 'sms', enabled: true },
    { key: 'WHATSAPP', label: 'WhatsApp', icon: 'whatsapp', tone: 'whatsapp', enabled: false },
    { key: 'EMAIL', label: 'Email', icon: 'mail', tone: 'email', enabled: false },
  ];
}
