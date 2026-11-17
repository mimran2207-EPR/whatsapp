import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { Purpose } from '../../../../core/api.client';
import { formatNumber, PURPOSE_LABEL } from '../../../../core/format';
import { FileDropzoneComponent } from '../../../../ui/file-dropzone/file-dropzone.component';
import { TextFieldComponent } from '../../../../ui/text-field/text-field.component';
import { WizardStore } from '../wizard.store';
import { importCodeHe } from './import-codes';

/** S10 — למי: campaign name and purpose, file upload, column mapping, then the server's import counts. */
@Component({
  selector: 'app-step-audience',
  imports: [FileDropzoneComponent, TextFieldComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './step-audience.component.html',
  styleUrl: './step-audience.component.css',
})
export class StepAudienceComponent {
  protected readonly s = inject(WizardStore);
  protected readonly fmt = formatNumber;
  protected readonly codeHe = importCodeHe;
  protected readonly purposes = Object.entries(PURPOSE_LABEL) as [Purpose, string][];

  protected readonly codes = computed(() => Object.entries(this.s.summary()?.codes ?? {}).sort((a, b) => b[1] - a[1]));
  protected readonly locked = computed(() => !!this.s.campaignId());

  protected onName(ev: Event): void {
    this.s.name.set((ev.target as HTMLInputElement).value);
  }

  protected onPurpose(ev: Event): void {
    this.s.purpose.set((ev.target as HTMLSelectElement).value as Purpose);
  }

  protected onMap(field: 'idColumn' | 'phoneColumn' | 'nameColumn', ev: Event): void {
    const v = (ev.target as HTMLSelectElement).value;
    this.s.setMapping(field === 'nameColumn' ? { nameColumn: v || null } : { [field]: v });
  }

  protected onVariable(col: string, ev: Event): void {
    this.s.toggleVariable(col, (ev.target as HTMLInputElement).checked);
  }

  protected replaceFile(): void {
    this.s.summary.set(null);
    this.s.file.set(null);
    this.s.headers.set([]);
  }
}
