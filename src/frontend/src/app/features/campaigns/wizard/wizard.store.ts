import { computed, inject, Injectable, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import {
  ApiClient,
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

/** What survives a reload (sessionStorage, per campaign). The file itself is not kept. */
interface Snapshot {
  campaignId: string;
  name: string;
  purpose: Purpose;
  fileName: string | null;
  mapping: ImportMapping;
  summary: ImportSummary | null;
  content: string;
  defaults: Record<string, string>;
  scheduleMode: 'now' | 'at';
  scheduleAt: string;
  step: number;
  maxStep: number;
}

const EMPTY_MAPPING: ImportMapping = { idColumn: '', nameColumn: null, phoneColumn: '', variableColumns: [] };
const snapshotKey = (id: string) => `rc.wizard.${id}`;

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
  readonly scheduleLocked = signal(false);

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

  private readonly keys = { create: new ActionKey(), import: new ActionKey(), patch: new ActionKey(), preflight: new ActionKey(), submit: new ActionKey() };
  private saving: Promise<unknown> = Promise.resolve();
  private lastSaved: string | null = null;

  /** Columns that can be used as {fields}: the mapped name column plus the mapped variable columns. */
  readonly fieldColumns = computed(() => {
    const m = this.summary() ? this.mapping() : null;
    if (!m) return [];
    return [...(m.nameColumn ? [m.nameColumn] : []), ...m.variableColumns.filter((c) => c !== m.nameColumn)];
  });

  readonly blockers = computed<Finding[]>(() => (this.preflight()?.findings ?? []).filter((f) => f.severity === 'BLOCKER'));

  readonly canImport = computed(
    () => !!this.name().trim() && !!this.file() && !!this.mapping().idColumn && !!this.mapping().phoneColumn && !this.busy(),
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

  resume(campaignId: string): void {
    this.campaignId.set(campaignId);
    let snap: Snapshot | null = null;
    try {
      snap = JSON.parse(sessionStorage.getItem(snapshotKey(campaignId)) ?? 'null') as Snapshot | null;
    } catch {
      snap = null;
    }
    if (snap && snap.campaignId === campaignId) {
      this.name.set(snap.name);
      this.purpose.set(snap.purpose);
      this.fileName.set(snap.fileName);
      this.mapping.set(snap.mapping);
      this.summary.set(snap.summary);
      this.content.set(snap.content);
      this.defaults.set(snap.defaults);
      this.scheduleMode.set(snap.scheduleMode);
      this.scheduleAt.set(snap.scheduleAt);
      this.maxStep.set(snap.maxStep);
      this.step.set(snap.step);
      if (snap.step >= PREFLIGHT_STEP) void this.refreshPreflight();
    } else {
      // No local snapshot (another tab or browser): only the name is known, from the list.
      this.api.listCampaigns().subscribe({
        next: (rows) => {
          const c = rows.find((r) => r.campaignId === campaignId);
          if (c) {
            this.name.set(c.name);
            this.purpose.set(c.purpose);
          }
        },
        error: () => undefined,
      });
    }
  }

  private persist(): void {
    const id = this.campaignId();
    if (!id) return;
    const snap: Snapshot = {
      campaignId: id,
      name: this.name(),
      purpose: this.purpose(),
      fileName: this.fileName(),
      mapping: this.mapping(),
      summary: this.summary(),
      content: this.content(),
      defaults: this.defaults(),
      scheduleMode: this.scheduleMode(),
      scheduleAt: this.scheduleAt(),
      step: this.step(),
      maxStep: this.maxStep(),
    };
    try {
      sessionStorage.setItem(snapshotKey(id), JSON.stringify(snap));
    } catch {
      /* storage unavailable: the server draft is still saved */
    }
  }

  /* ---------- Step 1: file and mapping ---------- */

  async chooseFile(f: File): Promise<void> {
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

  /** Creates the campaign once (idempotent per name/purpose until it succeeds). */
  private async ensureCampaign(): Promise<string> {
    const existing = this.campaignId();
    if (existing) return existing;
    const body = { name: this.name().trim(), purpose: this.purpose() };
    const r = await firstValueFrom(this.api.createCampaign(body, this.keys.create.for(JSON.stringify(body))));
    this.keys.create.settle();
    this.campaignId.set(r.campaignId);
    return r.campaignId;
  }

  async runImport(): Promise<boolean> {
    const f = this.file();
    if (!f || !this.canImport()) return false;
    return this.act(async () => {
      const id = await this.ensureCampaign();
      const m = this.mapping();
      const fp = JSON.stringify([f.name, f.size, f.lastModified, m]);
      const s = await firstValueFrom(this.api.importFile(f, m, this.name().trim(), this.keys.import.for(fp)));
      this.keys.import.settle();
      this.summary.set(s);
      this.importErrors.set(null);
      await this.saveDraft();
      return id;
    });
  }

  async loadImportErrors(): Promise<void> {
    const s = this.summary();
    if (!s) return;
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
    const defaults = Object.fromEntries(Object.entries(this.defaults()).filter(([k, v]) => cols.has(k) && v !== ''));
    body.fieldDefaults = defaults;
    if (this.scheduleMode() === 'at' && this.scheduleAt()) {
      const d = new Date(this.scheduleAt());
      if (!Number.isNaN(d.getTime())) body.scheduledAt = d.toISOString();
    }
    return body;
  }

  /** PATCH /draft with the current fields (serialised; skipped when nothing changed since the last save). */
  saveDraft(): Promise<void> {
    const run = async () => {
      const id = this.campaignId();
      if (!id) return;
      const body = this.draftBody();
      const fp = JSON.stringify(body);
      if (fp === this.lastSaved) return;
      const r = await firstValueFrom(this.api.patchDraft(id, body, this.keys.patch.for(fp)));
      this.keys.patch.settle();
      this.lastSaved = fp;
      this.savedAt.set(new Date());
      // PATCH treats a missing scheduledAt as "unchanged", so a saved schedule cannot be cleared from the client.
      if (body.scheduledAt) this.scheduleLocked.set(true);
      if (r.approvalInvalidated) this.approvalInvalidated.set(true);
      this.submittedHash.set(null);
      this.persist();
    };
    const p = this.saving.then(run, run);
    this.saving = p.catch(() => undefined);
    return p;
  }

  /** Save, then ask the server for the preflight (segments, cost, findings). Needs audience, channel and content. */
  async refreshPreflight(): Promise<void> {
    const id = this.campaignId();
    if (!id || !this.summary() || !this.content().trim()) {
      this.preflight.set(null);
      return;
    }
    this.preflightPending.set(true);
    try {
      await this.saveDraft();
      const r = await firstValueFrom(this.api.preflight(id, this.keys.preflight.for(this.lastSaved ?? '')));
      this.keys.preflight.settle();
      this.preflight.set(r);
      this.error.set(null);
    } catch (e) {
      const err = apiError(e);
      if (err.code === 'DRAFT_INCOMPLETE') this.preflight.set(null);
      else this.error.set(err);
    } finally {
      this.preflightPending.set(false);
    }
  }

  /** Step change = autosave (spec §4). The documents step is not used for SMS and is passed over. */
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
    if (!id) return false;
    return this.act(async () => {
      await this.saveDraft();
      const note = this.note().trim() || null;
      try {
        const r = await firstValueFrom(this.api.submit(id, note, this.keys.submit.for(JSON.stringify([this.lastSaved, note]))));
        this.keys.submit.settle();
        this.submittedHash.set(r.packageHash);
        try {
          sessionStorage.removeItem(snapshotKey(id));
        } catch {
          /* ignore */
        }
        return r;
      } catch (e) {
        const err = apiError(e);
        const findings = (err.body as { findings?: Finding[] } | null)?.findings;
        if (err.code === 'PREFLIGHT_BLOCKED' && findings) {
          this.keys.submit.settle();
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
