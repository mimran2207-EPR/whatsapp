import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { TextFieldComponent } from './text-field.component';

@Component({
  imports: [TextFieldComponent],
  template: `<rc-text-field label="שם המשלוח" helper="שם פנימי" [error]="error()"><input /></rc-text-field>`,
})
class Host {
  error = signal<string | null>(null);
}

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
