import { HttpClient, HttpContext } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { withIdempotencyKey } from './idempotency.interceptor';

/* Shapes follow src/backend/ResidentComms.Api/Endpoints/*.cs (camelCase JSON). */

export type Role = 'creator' | 'approver' | 'analyst';
export type Purpose = 'SERVICE' | 'OPERATIONAL' | 'PUBLIC_INFO' | 'EMERGENCY' | 'PROMOTIONAL';

export interface DevUser {
  id: string;
  name: string;
  role: Role;
  tenantId: string;
  departmentId: string;
}

export interface ImportMapping {
  idColumn: string;
  nameColumn: string | null;
  phoneColumn: string;
  variableColumns: string[];
}

export interface ImportSampleRow {
  row: number;
  sourceRecipientId: string;
  name: string | null;
  phone: string;
  state: string;
  codes: string[];
}

export interface ImportSummary {
  importRunId: string;
  audienceId: string;
  audienceVersionId: string;
  rowCount: number;
  validCount: number;
  invalidCount: number;
  codes: Record<string, number>;
  sample: ImportSampleRow[];
}

export interface ImportErrorRow {
  row: number;
  sourceRecipientId: string;
  codes: string[];
}

export interface DraftPatch {
  audienceVersionId?: string;
  channel?: 'SMS';
  contentText?: string;
  fieldDefaults?: Record<string, string>;
  /** Absent = unchanged; null = clear the schedule (send right after approval). */
  scheduledAt?: string | null;
}

export interface Finding {
  code: string;
  severity: 'BLOCKER' | 'WARNING';
  messageHe: string;
  /** Wizard step label: "למי" · "איך" · "מה" · "בדיקה" · "אישור ושליחה". */
  step: string;
}

export interface PreflightReport {
  findings: Finding[];
  eligibleRecipients: number;
  segmentsPerMessage: number;
  encoding: string;
  estimatedCost: { min: number; max: number; currency: 'ILS'; isEstimate: true };
}

export interface CampaignListItem {
  campaignId: string;
  name: string;
  purpose: Purpose;
  state: string;
  channel: string | null;
  recipients: number;
  counts: { accepted: number; delivered: number; unknown: number; failed: number };
  dataAsOf: string;
}

export interface ApprovalListItem {
  campaignId: string;
  name: string;
  purpose: Purpose;
  submittedBy: string;
  channel: string | null;
  recipients: number;
  packageHash: string;
}

export interface ApprovedListItem {
  campaignId: string;
  name: string;
  purpose: Purpose;
  submittedBy: string;
  channel: string | null;
  recipients: number;
  approvedBy: string;
  approvedAt: string;
}

export interface CampaignPreview {
  recipientName: string | null;
  recipientPhone: string;
  text: string;
  missingFields: string[];
}

export interface CampaignDetail {
  campaignId: string;
  name: string;
  purpose: Purpose;
  state: string;
  createdBy: string;
  revisionId: string;
  revisionNo: number;
  channel: string | null;
  contentText: string | null;
  fieldDefaults: Record<string, string>;
  scheduledAt: string | null;
  audience: {
    audienceVersionId: string;
    importRunId: string | null;
    fileName: string | null;
    rowCount: number;
    validCount: number;
    invalidCount: number;
    eligibleRecipients: number;
    fieldNames: string[];
  } | null;
  preview: CampaignPreview | null;
}

export interface ReleaseResult {
  messagesCreated: number;
  suppressed: number;
  environment: 'sandbox-mock';
}

export interface TrackingKpi {
  key: 'accepted' | 'operationalDeliveryRate' | string;
  value: number | null;
  numerator: number;
  denominator: number;
}

export interface TrackingException {
  messageId: string;
  recipientMasked: string;
  displayStatus: string;
  displayLabelHe: string;
  lastAttempt: string | null;
  nextActionHe: string;
}

export interface TrackingView {
  environment: 'sandbox-mock';
  dataAsOf: string;
  messages: number;
  delivery: { delivered: number; sentOrNotReported: number; unknown: number; failed: number };
  handoff: { accepted: number; rejected: number; unknown: number; notHandedOff: number };
  kpis: TrackingKpi[];
  bannerHe: string;
  exceptions: TrackingException[];
}

/** Typed access to /v1. Mutating calls take the action's Idempotency-Key (see ActionKey); omitted → one per request. */
@Injectable({ providedIn: 'root' })
export class ApiClient {
  private readonly http = inject(HttpClient);

  private ctx(key?: string): HttpContext {
    return key ? withIdempotencyKey(key) : new HttpContext();
  }

  devUsers(): Observable<DevUser[]> {
    return this.http.get<DevUser[]>('/v1/dev/users');
  }

  devLogin(userId: string): Observable<{ token: string }> {
    return this.http.post<{ token: string }>('/v1/dev/login', { userId });
  }

  listCampaigns(): Observable<CampaignListItem[]> {
    return this.http.get<CampaignListItem[]>('/v1/campaigns');
  }

  /** Approved but not yet released (approver only; others get []). */
  listApproved(): Observable<ApprovedListItem[]> {
    return this.http.get<ApprovedListItem[]>('/v1/approvals/approved');
  }

  campaign(campaignId: string): Observable<CampaignDetail> {
    return this.http.get<CampaignDetail>(`/v1/campaigns/${encodeURIComponent(campaignId)}`);
  }

  listApprovals(): Observable<ApprovalListItem[]> {
    return this.http.get<ApprovalListItem[]>('/v1/approvals');
  }

  createCampaign(body: { name: string; purpose: Purpose }, key?: string): Observable<{ campaignId: string; revisionId: string }> {
    return this.http.post<{ campaignId: string; revisionId: string }>('/v1/campaigns', body, { context: this.ctx(key) });
  }

  importFile(file: File, mapping: ImportMapping, audienceName: string | null, key?: string): Observable<ImportSummary> {
    const form = new FormData();
    form.append('file', file, file.name);
    form.append('mapping', JSON.stringify(mapping));
    if (audienceName) form.append('audienceName', audienceName);
    return this.http.post<ImportSummary>('/v1/import-jobs', form, { context: this.ctx(key) });
  }

  importErrors(importRunId: string): Observable<ImportErrorRow[]> {
    return this.http.get<ImportErrorRow[]>(`/v1/import-jobs/${encodeURIComponent(importRunId)}/errors`);
  }

  patchDraft(campaignId: string, patch: DraftPatch, key?: string): Observable<{ revisionId: string; approvalInvalidated: boolean }> {
    return this.http.patch<{ revisionId: string; approvalInvalidated: boolean }>(
      `/v1/campaigns/${encodeURIComponent(campaignId)}/draft`,
      patch,
      { context: this.ctx(key) },
    );
  }

  /** Withdraw a submission (and approval): back to DRAFT on a new revision. */
  reopen(campaignId: string, key?: string): Observable<{ revisionId: string; approvalInvalidated: boolean }> {
    return this.http.post<{ revisionId: string; approvalInvalidated: boolean }>(
      `/v1/campaigns/${encodeURIComponent(campaignId)}/reopen`,
      {},
      { context: this.ctx(key) },
    );
  }

  preflight(campaignId: string, key?: string): Observable<PreflightReport> {
    return this.http.post<PreflightReport>(`/v1/campaigns/${encodeURIComponent(campaignId)}/preflight`, {}, { context: this.ctx(key) });
  }

  submit(campaignId: string, note: string | null, key?: string): Observable<{ packageHash: string }> {
    return this.http.post<{ packageHash: string }>(`/v1/campaigns/${encodeURIComponent(campaignId)}/submit`, note ? { note } : {}, {
      context: this.ctx(key),
    });
  }

  approve(campaignId: string, packageHash: string, key?: string): Observable<{ approvalId: string }> {
    return this.http.post<{ approvalId: string }>(`/v1/campaigns/${encodeURIComponent(campaignId)}/approve`, { packageHash }, {
      context: this.ctx(key),
    });
  }

  release(campaignId: string, key?: string): Observable<ReleaseResult> {
    return this.http.post<ReleaseResult>(`/v1/campaigns/${encodeURIComponent(campaignId)}/release`, {}, { context: this.ctx(key) });
  }

  tracking(campaignId: string): Observable<TrackingView> {
    return this.http.get<TrackingView>(`/v1/campaigns/${encodeURIComponent(campaignId)}/tracking`);
  }
}
