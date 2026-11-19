export type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';

export type SaverOptions = { debounceMs: number; retryMs: number[] };

const DEFAULTS: SaverOptions = { debounceMs: 1200, retryMs: [2000, 5000, 15000, 30000] };

/**
 * Batches the photos edited within one quiet window into a single save, keeps
 * one save in flight at a time, and retries a failed batch on its own.
 */
export class Saver {
  private pending = new Set<string>();
  private timer: ReturnType<typeof setTimeout> | undefined;
  private inFlight: Promise<void> | null = null;
  private again = false;
  private failures = 0;
  status: SaveStatus = 'idle';

  constructor(
    private readonly save: (ids: string[]) => Promise<void>,
    private readonly onStatus: (status: SaveStatus) => void,
    private readonly options: SaverOptions = DEFAULTS,
  ) {}

  /** Unsaved photos, including those being written right now. */
  get busy(): boolean {
    return this.pending.size > 0 || this.inFlight !== null;
  }

  mark(ids: Iterable<string>): void {
    for (const id of ids) this.pending.add(id);
    if (this.status !== 'error') this.setStatus('saving');
    this.schedule(this.options.debounceMs);
  }

  /** Save now. While a save is running, the next one starts as soon as it ends. */
  flush(): Promise<void> {
    clearTimeout(this.timer);
    if (this.inFlight) {
      this.again = true;
      return this.inFlight;
    }
    if (!this.pending.size) return Promise.resolve();
    const ids = [...this.pending];
    this.pending.clear();
    this.inFlight = this.save(ids)
      .then(
        () => {
          this.failures = 0;
        },
        () => {
          for (const id of ids) this.pending.add(id);
          this.failures++;
        },
      )
      .finally(() => {
        this.inFlight = null;
        this.settle();
      });
    return this.inFlight;
  }

  dispose(): void {
    clearTimeout(this.timer);
  }

  private settle(): void {
    const again = this.again;
    this.again = false;
    if (this.failures) {
      this.setStatus('error');
      const { retryMs } = this.options;
      this.schedule(retryMs[Math.min(this.failures, retryMs.length) - 1]);
    } else if (this.pending.size) {
      this.setStatus('saving');
      if (again) void this.flush();
      else this.schedule(this.options.debounceMs);
    } else this.setStatus('saved');
  }

  private schedule(ms: number): void {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.flush(), ms);
  }

  private setStatus(status: SaveStatus): void {
    if (status === this.status) return;
    this.status = status;
    this.onStatus(status);
  }
}
