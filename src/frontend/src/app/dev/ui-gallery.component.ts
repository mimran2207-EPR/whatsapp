import { ChangeDetectionStrategy, Component } from '@angular/core';
import { AppShellComponent } from '../ui/app-shell/app-shell.component';
import { BannerComponent } from '../ui/banner/banner.component';
import { ButtonComponent } from '../ui/button/button.component';
import { ChannelChipComponent } from '../ui/channel-chip/channel-chip.component';
import { FileDropzoneComponent } from '../ui/file-dropzone/file-dropzone.component';
import { GridRowComponent } from '../ui/grid-row/grid-row.component';
import { IconComponent } from '../ui/icon/icon.component';
import { ICON_PATHS, IconName } from '../ui/icon/icon-paths';
import { KpiCardComponent } from '../ui/kpi-card/kpi-card.component';
import { PreflightItemComponent } from '../ui/preflight-item/preflight-item.component';
import { DISPLAY_STATUSES, STATUS_LABEL_HE } from '../ui/status';
import { StatusBadgeComponent } from '../ui/status-badge/status-badge.component';
import { StepItemComponent } from '../ui/step-item/step-item.component';
import { TextFieldComponent } from '../ui/text-field/text-field.component';

/** Development-only gallery (/__ui): every component in every variant, for comparison with Figma "02 Components". */
@Component({
  selector: 'rc-ui-gallery',
  imports: [
    AppShellComponent,
    BannerComponent,
    ButtonComponent,
    ChannelChipComponent,
    FileDropzoneComponent,
    GridRowComponent,
    IconComponent,
    KpiCardComponent,
    PreflightItemComponent,
    StatusBadgeComponent,
    StepItemComponent,
    TextFieldComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './ui-gallery.component.html',
  styleUrl: './ui-gallery.component.css',
})
export class UiGalleryComponent {
  protected readonly statuses = DISPLAY_STATUSES;
  protected readonly labels = STATUS_LABEL_HE;
  protected readonly icons = Object.keys(ICON_PATHS) as IconName[];
  protected readonly variants = ['primary', 'secondary', 'ghost', 'danger'] as const;
  protected readonly steps = [
    { state: 'done', label: 'מי', hint: '3,180 נמענים' },
    { state: 'current', label: 'מה', hint: 'תוכן' },
    { state: 'pending', label: 'מסמכים', hint: '' },
    { state: 'blocked', label: 'בדיקה', hint: '2 חסמים' },
    { state: 'invalidated', label: 'אישור', hint: 'בוטל' },
    { state: 'skipped', label: 'תזמון', hint: '' },
  ] as const;
}
