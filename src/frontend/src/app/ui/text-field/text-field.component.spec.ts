import { ChangeDetectorRef, Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { TextFieldComponent } from './text-field.component';

@Component({
  imports: [TextFieldComponent],
  template: `<rc-text-field label="שם המשלוח" helper="שם פנימי" [error]="error()"><input /></rc-text-field>`,
})
class Host {
  error = signal<string | null>(null);
}

@Component({
  imports: [TextFieldComponent],
  template: `<rc-text-field label="שם" helper="עזרה"><input id="name" /></rc-text-field>`,
})
class OwnIdHost {}

@Component({
  imports: [TextFieldComponent],
  template: `<rc-text-field label="א" helper="עזרה א"><input /></rc-text-field>
    <rc-text-field label="ב" helper="עזרה ב"><input /></rc-text-field>`,
})
class TwoHost {}

describe('TextField (fix round 1)', () => {
  it('keeps the projected input id without NG0100 and points the label at it', () => {
    const f = TestBed.createComponent(OwnIdHost);
    expect(() => {
      f.detectChanges();
      // Force the OnPush field to be re-checked by the dev-mode no-changes pass.
      f.debugElement.query(By.directive(TextFieldComponent)).injector.get(ChangeDetectorRef).markForCheck();
      f.checkNoChanges();
    }).not.toThrow();
    const label: HTMLLabelElement = f.nativeElement.querySelector('label');
    expect(f.nativeElement.querySelector('input').id).toBe('name');
    expect(label.getAttribute('for')).toBe('name');
  });

  it('announces the error through a live region that exists before the error appears', () => {
    const f = TestBed.createComponent(Host);
    f.detectChanges();
    const live: HTMLElement = f.nativeElement.querySelector('.rc-tf__error');
    expect(live).not.toBeNull();
    expect(live.getAttribute('aria-live')).toBe('polite');
    expect(live.textContent!.trim()).toBe('');
    const input: HTMLInputElement = f.nativeElement.querySelector('input');
    expect(input.getAttribute('aria-describedby')).not.toBe(live.id);

    f.componentInstance.error.set('שדה חובה');
    f.detectChanges();
    expect(f.nativeElement.querySelector('.rc-tf__error')).toBe(live);
    expect(live.textContent).toContain('שדה חובה');
    expect(input.getAttribute('aria-describedby')).toBe(live.id);
  });

  it('gives two instances distinct ids', () => {
    const f = TestBed.createComponent(TwoHost);
    f.detectChanges();
    const [a, b] = [...f.nativeElement.querySelectorAll('input')] as HTMLInputElement[];
    expect(a.id).not.toBe(b.id);
    expect(a.getAttribute('aria-describedby')).not.toBe(b.getAttribute('aria-describedby'));
  });
});

describe('TextField', () => {
  it('links the label and the error to the projected input', () => {
    const f = TestBed.createComponent(Host);
    f.componentInstance.error.set('שדה חובה');
    f.detectChanges();
    document.body.appendChild(f.nativeElement);
    const input: HTMLInputElement = f.nativeElement.querySelector('input');
    const label: HTMLLabelElement = f.nativeElement.querySelector('label');
    expect(input.id).not.toBe('');
    expect(label.htmlFor).toBe(input.id);
    expect(input.getAttribute('aria-invalid')).toBe('true');
    const described = input
      .getAttribute('aria-describedby')!
      .split(' ')
      .map((id) => document.getElementById(id)?.textContent ?? '');
    expect(described.join(' ')).toContain('שדה חובה');
    f.nativeElement.remove();
  });

  it('describes the input with the helper when there is no error', () => {
    const f = TestBed.createComponent(Host);
    f.detectChanges();
    document.body.appendChild(f.nativeElement);
    const input: HTMLInputElement = f.nativeElement.querySelector('input');
    expect(input.hasAttribute('aria-invalid')).toBe(false);
    expect(document.getElementById(input.getAttribute('aria-describedby')!)?.textContent).toContain('שם פנימי');
    f.nativeElement.remove();
  });
});
