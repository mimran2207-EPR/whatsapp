import { TestBed } from '@angular/core/testing';
import { StatusBadgeComponent } from './status-badge.component';
import { DISPLAY_STATUSES, STATUS_GROUP } from '../status';

describe('StatusBadge', () => {
  it('renders icon and Hebrew label for every status and marks unknown with a dashed outline', () => {
    const f = TestBed.createComponent(StatusBadgeComponent);
    f.componentRef.setInput('status', 'Unknown');
    f.componentRef.setInput('label', 'לא ידוע');
    f.detectChanges();
    const el: HTMLElement = f.nativeElement.querySelector('.badge');
    expect(el.textContent).toContain('לא ידוע');
    expect(el.querySelector('svg')).not.toBeNull();
    expect(el.classList).toContain('badge--unknown');
  });

  it('covers all 13 display statuses with an icon, text and the group class', () => {
    expect(DISPLAY_STATUSES.length).toBe(13);
    for (const status of DISPLAY_STATUSES) {
      const f = TestBed.createComponent(StatusBadgeComponent);
      f.componentRef.setInput('status', status);
      f.componentRef.setInput('label', `L-${status}`);
      f.detectChanges();
      const el: HTMLElement = f.nativeElement.querySelector('.badge');
      expect(el.querySelector('svg')).not.toBeNull();
      expect(el.textContent).toContain(`L-${status}`);
      expect(el.classList).toContain(`badge--${STATUS_GROUP[status]}`);
    }
  });

  it('falls back to the dictionary label when the server label is missing', () => {
    const f = TestBed.createComponent(StatusBadgeComponent);
    f.componentRef.setInput('status', 'AcceptedByProvider');
    f.detectChanges();
    expect(f.nativeElement.textContent).toContain('התקבל אצל הספק');
  });

  it('groups statuses as in Figma 02 Components', () => {
    expect(STATUS_GROUP.Failed).toBe('danger');
    expect(STATUS_GROUP.Rejected).toBe('danger');
    expect(STATUS_GROUP.RejectedBeforeSend).toBe('danger');
    expect(STATUS_GROUP.Pending).toBe('neutral');
    expect(STATUS_GROUP.Queued).toBe('neutral');
    expect(STATUS_GROUP.Canceled).toBe('neutral');
    expect(STATUS_GROUP.HandedOff).toBe('progress');
    expect(STATUS_GROUP.AcceptedByProvider).toBe('progress');
    expect(STATUS_GROUP.SentPerProvider).toBe('progress');
    expect(STATUS_GROUP.Delivered).toBe('success');
    expect(STATUS_GROUP.Read).toBe('info');
    expect(STATUS_GROUP.Opened).toBe('info');
    expect(STATUS_GROUP.Unknown).toBe('unknown');
  });
});
