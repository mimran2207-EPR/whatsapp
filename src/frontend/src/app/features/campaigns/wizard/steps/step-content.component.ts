import { ChangeDetectionStrategy, Component, computed, DestroyRef, ElementRef, inject, viewChild } from '@angular/core';
import { formatNumber } from '../../../../core/format';
import { TextFieldComponent } from '../../../../ui/text-field/text-field.component';
import { WizardStore } from '../wizard.store';
import { insertToken, previewParts } from './preview';

/** S12 — מה: SMS text, field chips, live segment counter (server preflight), masked preview, defaults for missing fields. */
@Component({
  selector: 'app-step-content',
  imports: [TextFieldComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './step-content.component.html',
  styleUrl: './step-content.component.css',
})
export class StepContentComponent {
  protected readonly s = inject(WizardStore);
  protected readonly fmt = formatNumber;
  private readonly textarea = viewChild<ElementRef<HTMLTextAreaElement>>('editor');
  private timer: ReturnType<typeof setTimeout> | null = null;

  /** First VALID row of the server's import sample (already masked by the server). */
  protected readonly recipient = computed(() => this.s.summary()?.sample.find((r) => r.state === 'VALID') ?? null);

  protected readonly parts = computed(() => {
    const r = this.recipient();
    const name = this.s.mapping().nameColumn;
    const values: Record<string, string | null> = name && r ? { [name]: r.name } : {};
    return previewParts(this.s.content(), values, this.s.defaults(), this.s.fieldColumns());
  });

  constructor() {
    inject(DestroyRef).onDestroy(() => this.flush());
    if (this.s.content().trim()) void this.s.refreshPreflight();
  }

  protected onInput(ev: Event): void {
    this.s.content.set((ev.target as HTMLTextAreaElement).value);
    this.schedule();
  }

  protected defaultFor(field: string): string {
    return Object.hasOwn(this.s.defaults(), field) ? this.s.defaults()[field] : '';
  }

  protected onDefault(field: string, ev: Event): void {
    const v = (ev.target as HTMLInputElement).value;
    this.s.defaults.update((d) => ({ ...d, [field]: v }));
    this.schedule();
  }

  protected insert(field: string): void {
    const el = this.textarea()?.nativeElement;
    const text = this.s.content();
    const start = el?.selectionStart ?? text.length;
    const end = el?.selectionEnd ?? text.length;
    const r = insertToken(text, start, end, field);
    this.s.content.set(r.text);
    if (el) {
      el.value = r.text;
      el.focus();
      el.setSelectionRange(r.caret, r.caret);
    }
    this.schedule();
  }

  /** Debounced autosave + preflight while typing, so the segment counter follows the text. */
  private schedule(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.s.refreshPreflight();
    }, 800);
  }

  private flush(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }
}
