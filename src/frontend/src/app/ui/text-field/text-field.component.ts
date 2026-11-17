import {
  AfterViewChecked,
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  inject,
  input,
  ViewEncapsulation,
} from '@angular/core';

let nextId = 0;

/**
 * Labelled field (Figma 8:292) around a projected native control:
 *   <rc-text-field label="שם המשלוח" helper="..." [error]="err"><input /></rc-text-field>
 * Wires id/for, aria-describedby (error, else helper) and aria-invalid on the projected control.
 */
@Component({
  selector: 'rc-text-field',
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
  template: `
    <div class="rc-tf" [class.rc-tf--error]="!!error()">
      <label class="rc-tf__label" [attr.for]="controlId">{{ label() }}</label>
      <div class="rc-tf__box"><ng-content /></div>
      @if (error()) {
        <span class="rc-tf__error" [id]="errorId">{{ error() }}</span>
      } @else if (helper()) {
        <span class="rc-tf__helper" [id]="helperId">{{ helper() }}</span>
      }
    </div>
  `,
  styles: `
    rc-text-field {
      display: block;
    }
    .rc-tf {
      display: flex;
      flex-direction: column;
      gap: 6px;
      font-family: var(--font-family);
    }
    .rc-tf__label {
      font-weight: 500;
      font-size: 12px;
      line-height: 16px;
      color: var(--color-text-secondary);
    }
    .rc-tf__box > input,
    .rc-tf__box > textarea,
    .rc-tf__box > select {
      box-sizing: border-box;
      inline-size: 100%;
      min-block-size: var(--control-height);
      padding-inline: var(--space-16);
      border: 1px solid var(--color-border-default);
      border-radius: var(--radius-md);
      background: var(--color-bg-surface);
      color: var(--color-text-primary);
      font-family: inherit;
      font-size: 14px;
      line-height: 20px;
    }
    .rc-tf__box > textarea {
      padding-block: var(--space-12);
    }
    .rc-tf__box > :focus-visible {
      outline: none;
      border-color: var(--color-border-focus);
      box-shadow: 0 0 0 1px var(--color-border-focus);
    }
    .rc-tf--error .rc-tf__box > * {
      border-color: var(--color-status-danger-fg);
    }
    .rc-tf__box > :disabled {
      background: var(--color-bg-muted);
      color: var(--color-text-disabled);
    }
    .rc-tf__helper,
    .rc-tf__error {
      font-weight: 500;
      font-size: 12px;
      line-height: 16px;
      color: var(--color-text-tertiary);
    }
    .rc-tf__error {
      color: var(--color-status-danger-fg);
    }
  `,
})
export class TextFieldComponent implements AfterViewChecked {
  readonly label = input('');
  readonly helper = input<string | null>(null);
  readonly error = input<string | null>(null);

  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly uid = nextId++;
  protected controlId = `rc-tf-${this.uid}`;
  protected readonly errorId = `rc-tf-${this.uid}-error`;
  protected readonly helperId = `rc-tf-${this.uid}-helper`;

  ngAfterViewChecked(): void {
    const control = this.host.nativeElement.querySelector<HTMLElement>('.rc-tf__box > input, .rc-tf__box > textarea, .rc-tf__box > select');
    const label = this.host.nativeElement.querySelector<HTMLLabelElement>('.rc-tf__label');
    if (!control || !label) return;
    if (control.id) this.controlId = control.id;
    else control.id = this.controlId;
    label.htmlFor = control.id;

    const describedBy = this.error() ? this.errorId : this.helper() ? this.helperId : null;
    if (describedBy) control.setAttribute('aria-describedby', describedBy);
    else control.removeAttribute('aria-describedby');
    if (this.error()) control.setAttribute('aria-invalid', 'true');
    else control.removeAttribute('aria-invalid');
  }
}
