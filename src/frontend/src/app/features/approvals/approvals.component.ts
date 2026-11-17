import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { ApiClient, ApprovalListItem } from '../../core/api.client';
import { AuthService } from '../../core/auth.service';
import { apiError } from '../../core/error-messages';
import { asChannel, formatNumber, purposeLabel } from '../../core/format';
import { ActionKey } from '../../core/idempotency.interceptor';
import { ButtonComponent } from '../../ui/button/button.component';
import { ChannelChipComponent } from '../../ui/channel-chip/channel-chip.component';
import { GridRowComponent } from '../../ui/grid-row/grid-row.component';

/** S30 — approvals inbox. "אישור ושליחת {N} הודעות" = approve (bound to the package hash) then release. */
@Component({
  selector: 'app-approvals',
  imports: [ButtonComponent, ChannelChipComponent, GridRowComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './approvals.component.html',
  styleUrl: './approvals.component.css',
})
export class ApprovalsComponent {
  /** Optional preselection: /approvals?campaign=<id> (from the home task list). */
  readonly campaign = input<string | undefined>();

  private readonly api = inject(ApiClient);
  private readonly router = inject(Router);
  protected readonly auth = inject(AuthService);

  protected readonly items = signal<ApprovalListItem[] | null>(null);
  protected readonly picked = signal<string | null>(null);
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly listError = signal<string | null>(null);

  protected readonly fmt = formatNumber;
  protected readonly purpose = purposeLabel;
  protected readonly channel = asChannel;

  /** Campaigns already approved in this view, so a retry after a failed release only repeats the release. */
  private readonly approved = new Set<string>();
  private readonly approveKey = new ActionKey();
  private readonly releaseKey = new ActionKey();

  protected readonly selected = computed(() => {
    const list = this.items() ?? [];
    const id = this.picked() ?? this.campaign() ?? null;
    return list.find((a) => a.campaignId === id) ?? null;
  });

  protected readonly binding = computed(() => {
    const a = this.selected();
    if (!a) return '';
    return (
      `המשלוח "${a.name}" (${purposeLabel(a.purpose)}) יישלח ב-${a.channel ?? 'SMS'} ל-${formatNumber(a.recipients)} נמענים. ` +
      `האישור נקשר לחבילה ${a.packageHash.slice(0, 12)}…; כל שינוי במשלוח לאחר האישור מבטל אותו.`
    );
  });

  constructor() {
    this.load();
  }

  protected load(): void {
    this.listError.set(null);
    this.api.listApprovals().subscribe({
      next: (r) => this.items.set(r),
      error: (e: unknown) => {
        this.items.set([]);
        this.listError.set(apiError(e).messageHe);
      },
    });
  }

  protected select(a: ApprovalListItem): void {
    if (this.busy()) return;
    this.picked.set(a.campaignId);
    this.error.set(null);
  }

  protected async approveAndRelease(): Promise<void> {
    const a = this.selected();
    if (!a || this.busy()) return;
    this.busy.set(true);
    this.error.set(null);
    try {
      if (!this.approved.has(a.campaignId)) {
        await firstValueFrom(this.api.approve(a.campaignId, a.packageHash, this.approveKey.for(a.campaignId + '|' + a.packageHash)));
        this.approveKey.settle();
        this.approved.add(a.campaignId);
      }
      await firstValueFrom(this.api.release(a.campaignId, this.releaseKey.for(a.campaignId)));
      this.releaseKey.settle();
      await this.router.navigate(['/campaigns', a.campaignId, 'tracking']);
    } catch (e) {
      const err = apiError(e);
      this.error.set(err.messageHe);
      // A stale package can never be approved as-is: drop the per-action keys and refresh the inbox.
      if (err.code === 'STALE_REVISION' || err.code === 'APPROVAL_INVALID') {
        this.approveKey.settle();
        this.releaseKey.settle();
        this.approved.delete(a.campaignId);
        this.load();
      }
    } finally {
      this.busy.set(false);
    }
  }
}
