import { Providers } from './providers.js';
import { Store } from './store.js';
import type { Listing } from './model.js';

export class Service {
  running: number | null = null;
  stopping = false;
  abort = new AbortController();
  providers: Providers;
  constructor(
    public store: Store,
    providers?: Providers,
  ) {
    this.providers = providers || new Providers(() => store.settings().requestGapSeconds);
  }
  async scan(id: number) {
    if (this.stopping) throw new Error('Server is stopping');
    if (this.running !== null)
      throw new Error('A scan is already running. Try again when it completes.');
    const monitor = this.store.monitor(id);
    if (!monitor) throw new Error('Monitor not found');
    this.running = id;
    const started = Date.now();
    try {
      const result = await this.providers.scan(monitor, this.abort.signal);
      return this.store.ingest(
        monitor,
        result.listings,
        started,
        Date.now() - started,
        result.complete,
      );
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Scan failed';
      this.store.failure(monitor, started, message);
      throw e;
    } finally {
      this.running = null;
    }
  }
  import(id: number, listings: Listing[], complete: boolean) {
    if (this.running !== null) throw new Error('A scan is running. Wait before importing.');
    const monitor = this.store.monitor(id);
    if (!monitor) throw new Error('Monitor not found');
    return this.store.ingest(monitor, listings, Date.now(), 0, complete);
  }
  async tick() {
    if (this.running !== null || this.stopping || this.store.settings().paused) return;
    const due = this.store
      .monitors()
      .filter((m) => m.enabled && m.provider !== 'import' && m.nextRun <= Date.now())
      .sort((a, b) => a.nextRun - b.nextRun)[0];
    if (due) {
      try {
        await this.scan(due.id);
      } catch {
        /* scan errors are persisted */
      }
    }
  }
  stop() {
    this.stopping = true;
    this.abort.abort();
  }
}
