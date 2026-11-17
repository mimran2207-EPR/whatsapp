import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ButtonComponent } from './button.component';

describe('Button', () => {
  it('exposes disabled reason to assistive tech', () => {
    const f = TestBed.createComponent(ButtonComponent);
    f.componentRef.setInput('disabled', true);
    f.componentRef.setInput('disabledReason', 'המשלוח אושר');
    f.detectChanges();
    document.body.appendChild(f.nativeElement);
    const btn: HTMLButtonElement = f.nativeElement.querySelector('button');
    expect(btn.disabled).toBe(true);
    expect(document.getElementById(btn.getAttribute('aria-describedby')!)?.textContent).toContain('המשלוח אושר');
    f.nativeElement.remove();
  });

  it('applies the variant class and projects the label', () => {
    @Component({
      imports: [ButtonComponent],
      template: `<rc-button variant="danger">מחיקה</rc-button>`,
    })
    class Host {}
    const f = TestBed.createComponent(Host);
    f.detectChanges();
    const btn: HTMLButtonElement = f.nativeElement.querySelector('button');
    expect(btn.classList).toContain('btn--danger');
    expect(btn.textContent).toContain('מחיקה');
    expect(btn.hasAttribute('aria-describedby')).toBe(false);
  });

  it('defaults to the primary variant and type="button"', () => {
    const f = TestBed.createComponent(ButtonComponent);
    f.detectChanges();
    const btn: HTMLButtonElement = f.nativeElement.querySelector('button');
    expect(btn.classList).toContain('btn--primary');
    expect(btn.type).toBe('button');
  });
});
