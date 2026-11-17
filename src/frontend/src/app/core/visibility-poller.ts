/**
 * Runs `tick` every `intervalMs` while the document is visible (S17: tracking polls every 5s).
 * Hidden → the timer stops; visible again → one immediate tick, then the interval resumes.
 * A slow tick never overlaps the next one: the next timer is armed only after the tick settles.
 */
export class VisibilityPoller {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private running = false;
  private inFlight = false;
  private readonly onVisibility = () => {
    if (!this.running) return;
    if (this.doc.visibilityState === 'visible') {
      if (!this.inFlight && this.timer === null) void this.run();
    } else {
      this.clear();
    }
  };

  constructor(
    private readonly tick: () => Promise<unknown>,
    private readonly intervalMs = 5000,
    private readonly doc: Document = document,
  ) {}

  start(): void {
    if (this.running) return;
    this.running = true;
    this.doc.addEventListener('visibilitychange', this.onVisibility);
    if (this.doc.visibilityState === 'visible') void this.run();
  }

  stop(): void {
    this.running = false;
    this.clear();
    this.doc.removeEventListener('visibilitychange', this.onVisibility);
  }

  private clear(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
  }

  private async run(): Promise<void> {
    this.clear();
    this.inFlight = true;
    try {
      await this.tick();
    } catch {
      /* the caller shows its own error state; polling continues */
    } finally {
      this.inFlight = false;
    }
    if (this.running && this.doc.visibilityState === 'visible') {
      this.timer = setTimeout(() => {
        this.timer = null;
        void this.run();
      }, this.intervalMs);
    }
  }
}

/**
 * Decides when an aria-live summary may be spoken: at most once per `minIntervalMs` (S17: 30s), so a 5s poll does not
 * flood screen-reader users. A text equal to the last announced one is never repeated.
 */
export class ThrottledAnnouncer {
  private lastAt: number | null = null;
  private lastText: string | null = null;

  constructor(private readonly minIntervalMs = 30_000) {}

  /** Returns the text to put in the live region now, or null to leave it unchanged. */
  offer(text: string, now: number = Date.now()): string | null {
    if (text === this.lastText) return null;
    if (this.lastAt !== null && now - this.lastAt < this.minIntervalMs) return null;
    this.lastAt = now;
    this.lastText = text;
    return text;
  }
}
