import { computed, inject, Injectable, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import {
  ApiClient,
  CampaignDetail,
  CampaignPreview,
  DraftPatch,
  Finding,
  ImportErrorRow,
  ImportMapping,
  ImportSummary,
  PreflightReport,
  Purpose,
} from '../../../core/api.client';
import { ApiError, apiError } from '../../../core/error-messages';
import { ActionKey } from '../../../core/idempotency.interceptor';
import { readHeaders } from '../../../core/sheet-headers';
import { StepState } from '../../../ui/step-item/step-item.component';

/** Wizard steps (spec §4). Labels equal the server's Finding.step values, so "תקן" can route to the step. */
export const STEPS = [
  { label: 'למי', hint: 'קהל' },
  { label: 'איך', hint: 'ערוץ' },
  { label: 'מה', hint: 'תוכן' },
  { label: 'מסמכים', hint: 'לא נדרש' },
  { label: 'בדיקה', hint: 'Preflight' },
  { label: 'אישור ושליחה', hint: 'הגשה' },
] as const;

export const DOCUMENTS_STEP = 3;
export const PREFLIGHT_STEP = 4;
export const SUBMIT_STEP = 5;

export function stepIndexFor(label: string): number {
  return STEPS.findIndex((s) => s.label === label);
}

/** Local extras that the server does not keep (the import sample, the mapping, the current step). Per campaign, sessionStorage. */
interface Snapshot {
  campaignId: string;
  fileName: string | null;
  mapping: ImportMapping;
  summary: ImportSummary | null;
  step: number;
  maxStep: number;
}

const EMPTY_MAPPING: ImportMapping = { idColumn: '', nameColumn: null, phoneColumn: '', variableColumns: [] };
const snapshotKey = (id: string) => `rc.wizard.${id}`;

/** "2026-11-18T09:30:00Z" → "2026-11-18T11:30" in the browser's zone, for <input type="datetime-local">. */
function toLocalInput(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** State and server actions for one campaign draft. Provided by WizardComponent, shared by its step components. */
@Injectable()
export class WizardStore {
  private readonly api = inject(ApiClient);

  // Draft fields
  readonly campaignId = signal<string | null>(null);
  readonly name = signal('');
  readonly purpose = signal<Purpose>('SERVICE');
  readonly file = signal<File | null>(null);
  readonly fileName = signal<string | null>(null);
  readonly headers = signal<string[]>([]);
  readonly headersError = signal<string | null>(null);
  readonly mapping = signal<ImportMapping>({ ...EMPTY_MAPPING });
  readonly summary = signal<ImportSummary | null>(null);
  readonly importErrors = signal<ImportErrorRow[] | null>(null);
  readonly content = signal('');
  readonly defaults = signal<Record<string, string>>({});
  readonly scheduleMode = signal<'now' | 'at'>('now');
  readonly scheduleAt = signal('');
  readonly note = signal('');
  /** Field names known from the server (resume in another browser, where the local mapping is not available). */
  readonly serverFields = signal<string[]>([]);
  readonly serverPreview = signal<CampaignPreview | null>(null);
  /** Server lifecycle state: DRAFT / SUBMITTED / APPROVED / RELEASED. */
  readonly serverState = signal('DRAFT');
  /** Read-only after submit (or when resumed in a non-draft state) until the user confirms that editing cancels the submission. */
  readonly locked = signal(false);
  /** Eligible recipients as last reported by the server (shown while locked, when no preflight runs). */
  readonly serverEligible = signal<number | null>(null);
  /** Step set by a resume (not by the user): the UI does not move focus for it. */
  readonly restoredStep = signal<number | null>(null);

  // Server results and UI state
  readonly preflight = signal<PreflightReport | null>(null);
  readonly preflightPending = signal(false);
  readonly savedAt = signal<Date | null>(null);
  readonly approvalInvalidated = signal(false);
  readonly submittedHash = signal<string | null>(null);
  readonly step = signal(0);
  readonly maxStep = signal(0);
  readonly busy = signal(false);
  readonly error = signal<ApiError | null>(null);

  private readonly keys = { create: new ActionKey(), import: new ActionKey(), patch: new ActionKey(), preflight: new ActionKey(), submit: new ActionKey(), reopen: new ActionKey() };
  private saving: Promise<unknown> = Promise.resolve();
  private lastSaved: string | null = null;
  /** The server holds a schedule for this revision: choosing "מיד" must send an explicit null to clear it. */
  private serverHasSchedule = false;
  private preflightSeq = 0;

  /** Columns that can be used as {fields}: the mapped name and variable columns, or the server's list after a remote resume. */
  readonly fieldColumns = computed(() => {
    if (!this.summary()) return [];
    const m = this.mapping();
    if (!m.idColumn) return this.serverFields();
    return [...(m.nameColumn ? [m.nameColumn] : []), ...m.variableColumns.filter((c) => c !== m.nameColumn)];
  });

  readonly blockers = computed<Finding[]>(() => (this.preflight()?.findings ?? []).filter((f) => f.severity === 'BLOCKER'));

  readonly canImport = computed(
    () => !this.locked() && !!this.name().trim() && !!this.file() && !!this.mapping().idColumn && !!this.mapping().phoneColumn && !this.busy(),
  );

  readonly stepStates = computed<StepState[]>(() =>
    STEPS.map((s, i) => {
      if (i === DOCUMENTS_STEP) return 'skipped';
      if (i === this.step()) return 'current';
      if (this.blockers().some((b) => b.step === s.label)) return 'blocked';
      return i < this.maxStep() ? 'done' : 'pending';
    }),
  );

  /* ---------- Resume ---------- */

  /** Loads the draft from the server (works in any browser); local extras (sample, mapping, step) come from sessionStorage if present. */
  resume(campaignId: string): void {
    this.campaignId.set(campaignId);
    let snap: Snapshot | null = null;
    try {
      snap = JSON.parse(sessionStorage.getItem(snapshotKey(campaignId)) ?? 'null') as Snapshot | null;
    } catch {
      snap = null;
    }
    this.api.campaign(campaignId).subscribe({
      next: (d) => this.applyDetail(d, snap && snap.campaignId === campaignId ? snap : null),
      error: (e: unknown) => this.error.set(apiError(e)),
    });
  }

  private applyDetail(d: CampaignDetail, snap: Snapshot | null): void {
    this.name.set(d.name);
    this.purpose.set(d.purpose);
    this.serverState.set(d.state);
    this.content.set(d.contentText ?? '');
    this.defaults.set({ ...d.fieldDefaults });
    this.serverPreview.set(d.preview);
    this.serverHasSchedule = !!d.scheduledAt;
    this.scheduleMode.set(d.scheduledAt ? 'at' : 'now');
    this.scheduleAt.set(d.scheduledAt ? toLocalInput(d.scheduledAt) : '');

    const a = d.audience;
    if (a) {
      this.serverFields.set(a.fieldNames);
      this.serverEligible.set(a.eligibleRecipients);
      const local = snap?.summary?.audienceVersionId === a.audienceVersionId ? snap : null;
      if (local?.summary) {
        this.summary.set(local.summary);
        this.mapping.set(local.mapping);
        this.fileName.set(local.fileName);
      } else {
        this.mapping.set({ ...EMPTY_MAPPING });
        this.fileName.set(a.fileName);
        this.summary.set({
          importRunId: a.importRunId ?? '',
          audienceId: '',
          audienceVersionId: a.audienceVersionId,
          rowCount: a.rowCount,
          validCount: a.validCount,
          invalidCount: a.invalidCount,
          codes: {},
          sample: [],
        });
      }
    }

    const draft = d.state === 'DRAFT';
    this.locked.set(!draft);
    const reached = !draft ? SUBMIT_STEP : d.contentText ? PREFLIGHT_STEP : a ? 2 : 0;
    this.maxStep.set(Math.max(reached, snap?.maxStep ?? 0));
    const step = !draft ? SUBMIT_STEP : Math.min(snap?.step ?? reached, this.maxStep());
    this.restoredStep.set(step);
    this.step.set(step);
    // What the server holds now counts as saved: resuming must not PATCH by itself.
    this.lastSaved = JSON.stringify(this.draftBody());
    if (draft && this.step() >= PREFLIGHT_STEP) void this.refreshPreflight();
  }

  private persist(): void {
    const id = this.campaignId();
    if (!id) return;
    const snap: Snapshot = {
      campaignId: id,
      fileName: this.fileName(),
      mapping: this.mapping(),
      summary: this.summary(),
      step: this.step(),
      maxStep: this.maxStep(),
    };
    try {
      sessionStorage.setItem(snapshotKey(id), JSON.stringify(snap));
    } catch {
      /* storage unavailable: the server draft is still saved */
    }
  }

  /**
   * "עריכה" on a submitted campaign really withdraws it on the server (POST /reopen: back to DRAFT on a new revision, any
   * approval invalidated) before the inputs unlock. If the server refuses, the draft stays locked and the error is shown.
   * An unchanged draft can then be submitted again straight away.
   */
  async unlockForEdit(): Promise<boolean> {
    const id = this.campaignId();
    if (!id || this.serverState() === 'RELEASED') return false;
    if (this.busy()) return false;
    this.busy.set(true);
    this.error.set(null);
    try {
      const r = await firstValueFrom(this.api.reopen(id, this.keys.reopen.for(id)));
      this.keys.reopen.settle();
      if (r.approvalInvalidated) this.approvalInvalidated.set(true);
      this.serverState.set('DRAFT');
      this.submittedHash.set(null);
      this.locked.set(false);
      return true;
    } catch (e) {
      this.keys.reopen.fail(e);
      this.error.set(apiError(e));
      return false;
    } finally {
      this.busy.set(false);
    }
  }

  /* ---------- Step 1: file and mapping ---------- */

  async chooseFile(f: File): Promise<void> {
    if (this.locked()) return;
    this.file.set(f);
    this.fileName.set(f.name);
    this.summary.set(null);
    this.importErrors.set(null);
    this.headersError.set(null);
    this.headers.set([]);
    this.mapping.set({ ...EMPTY_MAPPING });
    try {
      this.headers.set(await readHeaders(f));
      if (this.headers().length === 0) this.headersError.set('לא נמצאה שורת כותרות בקובץ');
    } catch {
      this.headersError.set('לא ניתן לקרוא את כותרות הקובץ בדפדפן. בדקו שהקובץ הוא XLSX או CSV תקין.');
    }
  }

  setMapping(patch: Partial<ImportMapping>): void {
    this.mapping.update((m) => {
      const next = { ...m, ...patch };
      // A column mapped as ID or phone is not also a personal field.
      return { ...next, variableColumns: next.variableColumns.filter((c) => c !== next.idColumn && c !== next.phoneColumn) };
    });
  }

  toggleVariable(col: string, on: boolean): void {
    this.mapping.update((m) => ({
      ...m,
      variableColumns: on ? [...m.variableColumns.filter((c) => c !== col), col] : m.variableColumns.filter((c) => c !== col),
    }));
  }

  /** Creates the campaign once. The key is reused only after a failure with no response. */
  private async ensureCampaign(): Promise<string> {
    const existing = this.campaignId();
    if (existing) return existing;
    const body = { name: this.name().trim(), purpose: this.purpose() };
    try {
      const r = await firstValueFrom(this.api.createCampaign(body, this.keys.create.for(JSON.stringify(body))));
      this.keys.create.settle();
      this.campaignId.set(r.campaignId);
      return r.campaignId;
    } catch (e) {
      this.keys.create.fail(e);
      throw e;
    }
  }

  async runImport(): Promise<boolean> {
    const f = this.file();
    if (!f || !this.canImport()) return false;
    return this.act(async () => {
      const id = await this.ensureCampaign();
      const m = this.mapping();
      const fp = JSON.stringify([f.name, f.size, f.lastModified, m]);
      try {
        const s = await firstValueFrom(this.api.importFile(f, m, this.name().trim(), this.keys.import.for(fp)));
        this.keys.import.settle();
        this.summary.set(s);
      } catch (e) {
        this.keys.import.fail(e);
        throw e;
      }
      this.importErrors.set(null);
      await this.saveDraft();
      return id;
    });
  }

  async loadImportErrors(): Promise<void> {
    const s = this.summary();
    if (!s?.importRunId) return;
    try {
      this.importErrors.set(await firstValueFrom(this.api.importErrors(s.importRunId)));
    } catch (e) {
      this.error.set(apiError(e));
    }
  }

  /* ---------- Draft autosave ---------- */

  private draftBody(): DraftPatch {
    const body: DraftPatch = {};
    const s = this.summary();
    if (s) {
      body.audienceVersionId = s.audienceVersionId;
      body.channel = 'SMS';
    }
    if (this.content().trim()) body.contentText = this.content();
    const cols = new Set(this.fieldColumns());
    body.fieldDefaults = Object.fromEntries(Object.entries(this.defaults()).filter(([k, v]) => cols.has(k) && v !== ''));
    if (this.scheduleMode() === 'at' && this.scheduleAt()) {
      const d = new Date(this.scheduleAt());
      if (!Number.isNaN(d.getTime())) body.scheduledAt = d.toISOString();
    } else if (this.scheduleMode() === 'now' && this.serverHasSchedule) {
      body.scheduledAt = null; // explicit null clears the saved schedule (absent would mean "unchanged")
    }
    return body;
  }

  /** PATCH /draft with the current fields (serialised; skipped when nothing changed, and never while locked). */
  saveDraft(): Promise<void> {
    const run = async () => {
      const id = this.campaignId();
      if (!id || this.locked()) return;
      const body = this.draftBody();
      const fp = JSON.stringify(body);
      if (fp === this.lastSaved) return;
      let r: { revisionId: string; approvalInvalidated: boolean };
      try {
        r = await firstValueFrom(this.api.patchDraft(id, body, this.keys.patch.for(fp)));
      } catch (e) {
        this.keys.patch.fail(e);
        throw e;
      }
      this.keys.patch.settle();
      this.lastSaved = fp;
      this.savedAt.set(new Date());
      if (body.scheduledAt !== undefined) this.serverHasSchedule = body.scheduledAt !== null;
      if (r.approvalInvalidated) this.approvalInvalidated.set(true);
      this.serverState.set('DRAFT');
      this.submittedHash.set(null);
      this.persist();
    };
    const p = this.saving.then(run, run);
    this.saving = p.catch(() => undefined);
    return p;
  }

  /**
   * Save, then ask the server for the preflight (segments, cost, findings). Needs audience, channel and content.
   * Requests are numbered: a response for an older text that arrives after a newer one is dropped.
   */
  async refreshPreflight(): Promise<void> {
    const id = this.campaignId();
    // Every call (including an early return) supersedes whatever is still in flight, so an older response can never overwrite it.
    const seq = ++this.preflightSeq;
    if (this.locked()) {
      this.preflightPending.set(false);
      return;
    }
    if (!id || !this.summary() || !this.content().trim()) {
      this.preflight.set(null);
      this.preflightPending.set(false);
      return;
    }
    this.preflightPending.set(true);
    try {
      await this.saveDraft();
      if (seq !== this.preflightSeq) return;
      let r: PreflightReport;
      try {
        r = await firstValueFrom(this.api.preflight(id, this.keys.preflight.for(`${seq}|${this.lastSaved ?? ''}`)));
      } catch (e) {
        this.keys.preflight.fail(e);
        throw e;
      }
      this.keys.preflight.settle();
      if (seq !== this.preflightSeq) return;
      this.preflight.set(r);
      this.error.set(null);
    } catch (e) {
      if (seq !== this.preflightSeq) return;
      const err = apiError(e);
      if (err.code === 'DRAFT_INCOMPLETE') this.preflight.set(null);
      else this.error.set(err);
    } finally {
      if (seq === this.preflightSeq) this.preflightPending.set(false);
    }
  }

  /** Step change = autosave (spec §4), except while locked (view only). The documents step is not used for SMS and is passed over. */
  async goTo(target: number): Promise<void> {
    if (target < 0 || target >= STEPS.length) return;
    if (target === DOCUMENTS_STEP) target = this.step() < DOCUMENTS_STEP ? PREFLIGHT_STEP : DOCUMENTS_STEP - 1;
    try {
      await this.saveDraft();
      this.error.set(null);
    } catch (e) {
      this.error.set(apiError(e));
      return;
    }
    this.step.set(target);
    this.maxStep.update((m) => Math.max(m, target));
    this.persist();
    if (target >= PREFLIGHT_STEP) void this.refreshPreflight();
  }

  /* ---------- Step 6: submit ---------- */

  async submit(): Promise<boolean> {
    const id = this.campaignId();
    if (!id || this.locked()) return false;
    return this.act(async () => {
      await this.saveDraft();
      const note = this.note().trim() || null;
      try {
        const r = await firstValueFrom(this.api.submit(id, note, this.keys.submit.for(JSON.stringify([this.lastSaved, note]))));
        this.keys.submit.settle();
        this.submittedHash.set(r.packageHash);
        this.serverState.set('SUBMITTED');
        this.locked.set(true);
        this.persist();
        return r;
      } catch (e) {
        this.keys.submit.fail(e);
        const err = apiError(e);
        const findings = (err.body as { findings?: Finding[] } | null)?.findings;
        if (err.code === 'PREFLIGHT_BLOCKED' && findings) {
          this.preflight.update((p) => (p ? { ...p, findings } : p));
          this.step.set(PREFLIGHT_STEP);
        }
        throw e;
      }
    });
  }

  /** Runs one user action: one at a time, errors shown as Hebrew messages. */
  private async act(fn: () => Promise<unknown>): Promise<boolean> {
    if (this.busy()) return false;
    this.busy.set(true);
    this.error.set(null);
    try {
      await fn();
      return true;
    } catch (e) {
      this.error.set(apiError(e));
      return false;
    } finally {
      this.busy.set(false);
    }
  }
}
