import { TestBed } from '@angular/core/testing';
import { BannerComponent } from './banner.component';

describe('Banner', () => {
  it('uses role="alert" for danger', () => {
    const f = TestBed.createComponent(BannerComponent);
    f.componentRef.setInput('kind', 'danger');
    f.componentRef.setInput('message', 'שיעור כשלים חריג');
    f.detectChanges();
    const el: HTMLElement = f.nativeElement.querySelector('.banner');
    expect(el.getAttribute('role')).toBe('alert');
    expect(el.textContent).toContain('שיעור כשלים חריג');
    expect(el.querySelector('svg')).not.toBeNull();
  });

  it('uses role="status" for the other kinds', () => {
    for (const kind of ['info', 'warning', 'unknown', 'success'] as const) {
      const f = TestBed.createComponent(BannerComponent);
      f.componentRef.setInput('kind', kind);
      f.componentRef.setInput('message', 'x');
      f.detectChanges();
      const el: HTMLElement = f.nativeElement.querySelector('.banner');
      expect(el.getAttribute('role')).toBe('status');
      expect(el.classList).toContain(`banner--${kind}`);
    }
  });
});
