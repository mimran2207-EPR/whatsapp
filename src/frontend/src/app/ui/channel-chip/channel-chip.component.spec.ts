import { TestBed } from '@angular/core/testing';
import { ChannelChipComponent } from './channel-chip.component';

const CASES = [
  ['SMS', 'SMS', 'chip--sms'],
  ['WHATSAPP', 'WhatsApp', 'chip--whatsapp'],
  ['EMAIL', 'Email', 'chip--email'],
] as const;

describe('ChannelChip', () => {
  for (const [channel, text, cls] of CASES) {
    it(`renders ${channel} with icon and label`, () => {
      const f = TestBed.createComponent(ChannelChipComponent);
      f.componentRef.setInput('channel', channel);
      f.detectChanges();
      const el: HTMLElement = f.nativeElement.querySelector('.chip');
      expect(el.classList).toContain(cls);
      expect(el.textContent).toContain(text);
      expect(el.querySelector('svg')).not.toBeNull();
    });
  }
});
