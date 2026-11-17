import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ButtonComponent } from './button.component';

describe('Button', () => {
  it('exposes disabled reason to assistive tech and stays focusable (aria-disabled)', () => {
    const f = TestBed.createComponent(ButtonComponent);
    f.componentRef.setInput('disabled', true);
    f.componentRef.setInput('disabledReason', 'המשלוח אושר');
    f.detectChanges();
    document.body.appendChild(f.nativeElement);
    const btn: HTMLButtonElement = f.nativeElement.querySelector('button');
    expect(btn.disabled).toBe(false);
    expect(btn.getAttribute('aria-disabled')).toBe('true');
    expect(document.getElementById(btn.getAttribute('aria-describedby')!)?.textContent).toContain('המשלוח אושר');
    f.nativeElement.remove();
  });

  it('blocks clicks while aria-disabled', () => {
    let clicks = 0;
    @Component({
      imports: [ButtonComponent],
      template: `<rc-button [disabled]="true" disabledReason="נעול" (click)="hit()">שליחה</rc-button>`,
    })
    class Host {
      hit() {
        clicks++;
      }
    }
    const f = TestBed.createComponent(Host);
    f.detectChanges();
    (f.nativeElement.querySelector('button') as HTMLButtonElement).click();
    expect(clicks).toBe(0);
  });

  it('uses native disabled when there is no reason', () => {
    const f = TestBed.createComponent(ButtonComponent);
    f.componentRef.setInput('disabled', true);
    f.detectChanges();
    const btn: HTMLButtonElement = f.nativeElement.querySelector('button');
    expect(btn.disabled).toBe(true);
    expect(btn.hasAttribute('aria-disabled')).toBe(false);
    expect(btn.hasAttribute('aria-describedby')).toBe(false);
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

  it('gives two instances distinct reason ids', () => {
    @Component({
      imports: [ButtonComponent],
      template: `<rc-button [disabled]="true" disabledReason="א">1</rc-button>
        <rc-button [disabled]="true" disabledReason="ב">2</rc-button>`,
    })
    class Host {}
    const f = TestBed.createComponent(Host);
    f.detectChanges();
    const [a, b] = [...f.nativeElement.querySelectorAll('button')] as HTMLButtonElement[];
    expect(a.getAttribute('aria-describedby')).toBeTruthy();
    expect(a.getAttribute('aria-describedby')).not.toBe(b.getAttribute('aria-describedby'));
  });
});
