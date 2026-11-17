import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { Router } from '@angular/router';
import { firstValueFrom, forkJoin } from 'rxjs';
import { ApiClient, ApprovalListItem, ApprovedListItem, CampaignDetail } from '../../core/api.client';
import { AuthService } from '../../core/auth.service';
import { apiError } from '../../core/error-messages';
import { asChannel, formatNumber, purposeLabel } from '../../core/format';
import { ActionKey } from '../../core/idempotency.interceptor';
import { ButtonComponent } from '../../ui/button/button.component';
import { ChannelChipComponent } from '../../ui/channel-chip/channel-chip.component';
import { GridRowComponent } from '../../ui/grid-row/grid-row.component';

type Selected = { kind: 'pending'; item: ApprovalListItem } | { kind: 'ready'; item: ApprovedListItem };

/**
 * S30 — approvals inbox.
 * - Submitted: "אישור ושליחת {N} הודעות" = approve (bound to the package hash) then release.
 * - Approved but not released (e.g. the release was refused outside the send window): "שליחת {N} הודעות" = release only.
 * The preview is the server's rendering of the first eligible recipient (GET /v1/campaigns/{id}), i.e. the exact text approved.
 */
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
  protected readonly ready = signal<ApprovedListItem[]>([]);
  protected readonly picked = signal<string | null>(null);
  protected readonly detail = signal<CampaignDetail | null>(null);
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly listError = signal<string | null>(null);

  protected readonly fmt = formatNumber;
  protected readonly purpose = purposeLabel;
  protected readonly channel = asChannel;

  private readonly approveKey = new ActionKey();
  private readonly releaseKey = new ActionKey();

  protected readonly selected = computed<Selected | null>(() => {
    const id = this.picked() ?? this.campaign() ?? null;
    if (!id) return null;
    const p = (this.items() ?? []).find((a) => a.campaignId === id);
    if (p) return { kind: 'pending', item: p };
    const r = this.ready().find((a) => a.campaignId === id);
    return r ? { kind: 'ready', item: r } : null;
  });

  private readonly selectedId = computed(() => this.selected()?.item.campaignId ?? null);

  protected readonly primaryLabel = computed(() => {
    const s = this.selected();
    if (!s) return '';
    if (this.busy()) return s.kind === 'pending' ? 'מאשר ושולח…' : 'שולח…';
    const n = formatNumber(s.item.recipients);
    return s.kind === 'pending' ? `אישור ושליחת ${n} הודעות` : `שליחת ${n} הודעות`;
  });

  protected readonly binding = computed(() => {
    const s = this.selected();
    if (!s) return '';
    const a = s.item;
    const head = `המשלוח "${a.name}" (${purposeLabel(a.purpose)}) יישלח ב-${a.channel ?? 'SMS'} ל-${formatNumber(a.recipients)} נמענים. `;
    return s.kind === 'pending'
      ? head + `האישור נקשר לחבילה ${s.item.packageHash.slice(0, 12)}…; כל שינוי במשלוח לאחר האישור מבטל אותו.`
      : head + `המשלוח אושר על ידי ${s.item.approvedBy} וטרם נשלח. השליחה בודקת מחדש את האישור, ההחרגות וחלון השעות.`;
  });

  constructor() {
    this.load();
    effect(() => {
      const id = this.selectedId();
      untracked(() => this.loadDetail(id));
    });
  }

  protected load(): void {
    this.listError.set(null);
    forkJoin({ pending: this.api.listApprovals(), ready: this.api.listApproved() }).subscribe({
      next: ({ pending, ready }) => {
        this.items.set(pending);
        this.ready.set(ready);
      },
      error: (e: unknown) => {
        if (this.items() === null) this.items.set([]);
        this.listError.set(apiError(e).messageHe);
      },
    });
  }

  private loadDetail(id: string | null): void {
    this.detail.set(null);
    if (!id) return;
    this.api.campaign(id).subscribe({
      next: (d) => {
        if (this.selectedId() === id) this.detail.set(d);
      },
      error: () => undefined, // the binding summary still shows; the preview area says it is unavailable
    });
  }

  private markApproved(p: ApprovalListItem): void {
    this.items.update((l) => (l ?? []).filter((x) => x.campaignId !== p.campaignId));
    this.ready.update((l) => [
      ...l.filter((x) => x.campaignId !== p.campaignId),
      {
        campaignId: p.campaignId,
        name: p.name,
        purpose: p.purpose,
        submittedBy: p.submittedBy,
        channel: p.channel,
        recipients: p.recipients,
        approvedBy: this.auth.user()?.id ?? '',
        approvedAt: new Date().toISOString(),
      },
    ]);
    this.picked.set(p.campaignId);
  }

  protected select(id: string): void {
    if (this.busy()) return;
    this.picked.set(id);
    this.error.set(null);
  }

  protected async act(): Promise<void> {
    const s = this.selected();
    if (!s || this.busy()) return;
    const id = s.item.campaignId;
    this.busy.set(true);
    this.error.set(null);
    let step: 'approve' | 'release' = 'approve';
    try {
      if (s.kind === 'pending') {
        const hash = s.item.packageHash;
        await firstValueFrom(this.api.approve(id, hash, this.approveKey.for(id + '|' + hash)));
        this.approveKey.settle();
        // Approved for good: from here on this campaign is a release-only item, so any retry (e.g. after a release that got no
        // response) goes straight to release and never through approve again.
        this.markApproved(s.item);
      }
      step = 'release';
      await firstValueFrom(this.api.release(id, this.releaseKey.for(id)));
      this.releaseKey.settle();
    } catch (e) {
      (step === 'approve' ? this.approveKey : this.releaseKey).fail(e);
      this.error.set(apiError(e).messageHe);
      // A definite answer may have moved the campaign (e.g. approved, then the release was refused): refresh both lists.
      if (!(e instanceof HttpErrorResponse && e.status === 0)) this.load();
      return;
    } finally {
      this.busy.set(false);
    }
    await this.router.navigate(['/campaigns', id, 'tracking']);
  }
}
