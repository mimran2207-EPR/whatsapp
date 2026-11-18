import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { forkJoin } from 'rxjs';
import { ApiClient, ApprovalListItem, ApprovedListItem, CampaignListItem } from '../../core/api.client';
import { AuthService } from '../../core/auth.service';
import { apiError } from '../../core/error-messages';
import { asChannel, formatNumber, formatTime, stateLabel } from '../../core/format';
import { ChannelChipComponent } from '../../ui/channel-chip/channel-chip.component';
import { IconComponent } from '../../ui/icon/icon.component';
import { IconName } from '../../ui/icon/icon-paths';

interface QuickAction {
  label: string;
  hint: string;
  icon: IconName;
  route: string;
  tone: 'sms' | 'whatsapp' | 'email' | 'pink';
}

interface TaskItem {
  key: string;
  text: string;
  meta: string;
  route: string[];
  query?: Record<string, string>;
}

/** S01 — home: greeting banner, quick actions, my tasks (approvals + drafts), recent campaigns. */
@Component({
  selector: 'app-home',
  imports: [RouterLink, ChannelChipComponent, IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './home.component.html',
  styleUrl: './home.component.css',
})
export class HomeComponent {
  private readonly api = inject(ApiClient);
  protected readonly auth = inject(AuthService);

  protected readonly campaigns = signal<CampaignListItem[] | null>(null);
  protected readonly approvals = signal<ApprovalListItem[]>([]);
  protected readonly ready = signal<ApprovedListItem[]>([]);
  protected readonly error = signal<string | null>(null);

  protected readonly fmt = formatNumber;
  protected readonly time = formatTime;
  protected readonly stateLabel = stateLabel;
  protected readonly channel = asChannel;

  protected readonly actions: QuickAction[] = [
    { label: 'משלוח חדש', hint: 'אשף SMS: קהל, תוכן, בדיקה והגשה', icon: 'plus', route: '/campaigns/new', tone: 'sms' },
    { label: 'העלאת קובץ נמענים', hint: 'XLSX או CSV, מיפוי עמודות', icon: 'upload', route: '/campaigns/new', tone: 'whatsapp' },
    { label: 'תיבת אישורים', hint: 'משלוחים שממתינים לאישורך', icon: 'shield', route: '/approvals', tone: 'email' },
    { label: 'כל המשלוחים', hint: 'מצב ומונים לכל משלוח', icon: 'list', route: '/campaigns', tone: 'pink' },
  ];

  protected readonly recent = computed(() => (this.campaigns() ?? []).slice(0, 5));

  protected readonly tasks = computed<TaskItem[]>(() => [
    ...this.approvals().map((a) => ({
      key: 'a-' + a.campaignId,
      text: `ממתין לאישורך: ${a.name}`,
      meta: `${formatNumber(a.recipients)} נמענים`,
      route: ['/approvals'],
      query: { campaign: a.campaignId },
    })),
    ...this.ready().map((a) => ({
      key: 'r-' + a.campaignId,
      text: `אושר וממתין לשליחה: ${a.name}`,
      meta: `${formatNumber(a.recipients)} נמענים`,
      route: ['/approvals'],
      query: { campaign: a.campaignId },
    })),
    ...(this.campaigns() ?? [])
      .filter((c) => c.state === 'DRAFT')
      .map((c) => ({ key: 'd-' + c.campaignId, text: `טיוטה: ${c.name}`, meta: 'להמשך עריכה', route: ['/campaigns', c.campaignId, 'edit'] })),
  ]);

  constructor() {
    forkJoin({ campaigns: this.api.listCampaigns(), approvals: this.api.listApprovals(), ready: this.api.listApproved() }).subscribe({
      next: ({ campaigns, approvals, ready }) => {
        this.campaigns.set(campaigns);
        this.approvals.set(approvals);
        this.ready.set(ready);
      },
      error: (e: unknown) => {
        this.campaigns.set([]);
        this.error.set(apiError(e).messageHe);
      },
    });
  }

  protected campaignLink(c: CampaignListItem): string[] | null {
    if (c.state === 'RELEASED') return ['/campaigns', c.campaignId, 'tracking'];
    if (c.state === 'DRAFT') return ['/campaigns', c.campaignId, 'edit'];
    // Waiting for approval or for release: the approvals screen (approver) handles both.
    if ((c.state === 'SUBMITTED' || c.state === 'APPROVED') && this.auth.user()?.role === 'approver') return ['/approvals'];
    return null;
  }

  protected linkQuery(c: CampaignListItem): Record<string, string> | null {
    return c.state === 'SUBMITTED' || c.state === 'APPROVED' ? { campaign: c.campaignId } : null;
  }
}
