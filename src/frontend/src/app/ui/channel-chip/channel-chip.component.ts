import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { IconComponent } from '../icon/icon.component';
import { IconName } from '../icon/icon-paths';

export type Channel = 'SMS' | 'WHATSAPP' | 'EMAIL';

const CHANNELS: Record<Channel, { label: string; icon: IconName; cls: string }> = {
  SMS: { label: 'SMS', icon: 'sms', cls: 'sms' },
  WHATSAPP: { label: 'WhatsApp', icon: 'whatsapp', cls: 'whatsapp' },
  EMAIL: { label: 'Email', icon: 'mail', cls: 'email' },
};

/** Channel identity chip (Figma 6:79). Not a status. */
@Component({
  selector: 'rc-channel-chip',
  imports: [IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <span [class]="'chip chip--' + meta().cls">
      <rc-icon [name]="meta().icon" [size]="18" />
      <bdi lang="en">{{ meta().label }}</bdi>
    </span>
  `,
  styles: `
    :host {
      display: inline-flex;
    }
    .chip {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding-block: 6px;
      padding-inline: 12px;
      border: 1px solid;
      border-radius: var(--radius-full);
      font-family: var(--font-family);
      font-weight: 700;
      font-size: 14px;
      line-height: 20px;
      white-space: nowrap;
    }
    .chip--sms { background: var(--color-channel-sms-bg); border-color: var(--color-channel-sms-border); color: var(--color-channel-sms-fg); }
    .chip--whatsapp { background: var(--color-channel-whatsapp-bg); border-color: var(--color-channel-whatsapp-border); color: var(--color-channel-whatsapp-fg); }
    .chip--email { background: var(--color-channel-email-bg); border-color: var(--color-channel-email-border); color: var(--color-channel-email-fg); }
  `,
})
export class ChannelChipComponent {
  readonly channel = input.required<Channel>();
  protected readonly meta = computed(() => CHANNELS[this.channel()]);
}
