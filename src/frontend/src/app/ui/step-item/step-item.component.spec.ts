import { TestBed } from '@angular/core/testing';
import { StepItemComponent } from './step-item.component';

describe('StepItem', () => {
  it('marks the current step with aria-current="step"', () => {
    const f = TestBed.createComponent(StepItemComponent);
    f.componentRef.setInput('state', 'current');
    f.componentRef.setInput('index', 3);
    f.componentRef.setInput('label', 'מה');
    f.detectChanges();
    const el: HTMLElement = f.nativeElement.querySelector('.step');
    expect(el.getAttribute('aria-current')).toBe('step');
    expect(el.textContent).toContain('3');
    expect(el.textContent).toContain('מה');
  });

  it('does not set aria-current on other states and shows an icon for done/blocked/invalidated', () => {
    for (const state of ['done', 'blocked', 'invalidated'] as const) {
      const f = TestBed.createComponent(StepItemComponent);
      f.componentRef.setInput('state', state);
      f.componentRef.setInput('index', 1);
      f.componentRef.setInput('label', 'מי');
      f.detectChanges();
      const el: HTMLElement = f.nativeElement.querySelector('.step');
      expect(el.hasAttribute('aria-current')).toBe(false);
      expect(el.classList).toContain(`step--${state}`);
      expect(el.querySelector('svg')).not.toBeNull();
    }
  });
});
