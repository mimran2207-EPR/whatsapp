import { ChangeDetectionStrategy, Component, input, output, signal } from '@angular/core';
import { ButtonComponent } from '../button/button.component';
import { IconComponent } from '../icon/icon.component';

/** File drop zone (Figma 11:190). Dragging is optional: the "בחרו קובץ" button is the keyboard alternative. */
@Component({
  selector: 'rc-file-dropzone',
  imports: [ButtonComponent, IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div
      class="dropzone"
      [class.dropzone--dragging]="dragging()"
      [class.dropzone--error]="!!error()"
      (dragover)="onDragOver($event)"
      (dragleave)="dragging.set(false)"
      (drop)="onDrop($event)"
    >
      <span class="dropzone__icon"><rc-icon name="upload" [size]="28" /></span>
      <p class="dropzone__title">{{ title() }}</p>
      <p class="dropzone__hint">{{ hint() }}</p>
      <rc-button variant="secondary" (click)="picker.click()">בחרו קובץ</rc-button>
      <input #picker type="file" hidden [accept]="accept()" (change)="onPick(picker)" />
      @if (error()) {
        <p class="dropzone__error" role="alert">{{ error() }}</p>
      }
    </div>
  `,
  styles: `
    :host {
      display: block;
    }
    .dropzone {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 10px;
      padding-block: 36px;
      padding-inline: var(--space-24);
      border: 1.5px dashed var(--color-border-brand);
      border-radius: var(--radius-2xl);
      background: var(--color-bg-surface);
      font-family: var(--font-family);
      text-align: center;
    }
    .dropzone--dragging {
      background: var(--color-bg-subtle);
      border-style: solid;
    }
    .dropzone--error {
      border-color: var(--color-status-danger-fg);
    }
    .dropzone__icon {
      display: inline-flex;
      padding: 14px;
      border-radius: var(--radius-lg);
      background: var(--color-bg-subtle);
      color: var(--color-icon-brand);
    }
    .dropzone__title {
      margin: 0;
      font-weight: 700;
      font-size: 18px;
      line-height: 24px;
      color: var(--color-text-primary);
    }
    .dropzone__hint {
      margin: 0;
      font-size: 14px;
      line-height: 20px;
      color: var(--color-text-secondary);
    }
    .dropzone__error {
      margin: 0;
      font-weight: 500;
      font-size: 14px;
      line-height: 20px;
      color: var(--color-status-danger-fg);
    }
  `,
})
export class FileDropzoneComponent {
  readonly accept = input('.xlsx,.csv');
  /** Client-side size limit (bytes). The server enforces its own limit too. */
  readonly maxBytes = input(25 * 1024 * 1024);
  readonly title = input('גררו קובץ לכאן או בחרו קובץ');
  readonly hint = input('XLSX או CSV · עד 25MB · מאקרו ונוסחאות לא מורצים');
  readonly file = output<File>();

  protected readonly dragging = signal(false);
  protected readonly error = signal<string | null>(null);

  protected onDragOver(ev: DragEvent): void {
    ev.preventDefault();
    this.dragging.set(true);
  }

  protected onDrop(ev: Event): void {
    ev.preventDefault();
    this.dragging.set(false);
    const files = (ev as DragEvent).dataTransfer?.files;
    if (files && files.length > 0) this.accept_(files[0]);
  }

  protected onPick(picker: HTMLInputElement): void {
    const f = picker.files?.[0];
    if (f) this.accept_(f);
    picker.value = '';
  }

  private accept_(f: File): void {
    const allowed = this.accept()
      .split(',')
      .map((x) => x.trim().toLowerCase())
      .filter(Boolean);
    const name = f.name.toLowerCase();
    if (allowed.length > 0 && !allowed.some((ext) => name.endsWith(ext))) {
      this.error.set(`סוג הקובץ אינו נתמך. אפשר להעלות: ${allowed.join(', ')}`);
      return;
    }
    if (f.size > this.maxBytes()) {
      const mb = Math.round((this.maxBytes() / (1024 * 1024)) * 10) / 10;
      this.error.set(`הקובץ גדול מדי. הגודל המרבי: ${mb}MB`);
      return;
    }
    this.error.set(null);
    this.file.emit(f);
  }
}
