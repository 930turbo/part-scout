import { DatabaseSync, type StatementSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import {
  defaultSettings,
  matches,
  type Listing,
  type Monitor,
  type MonitorInput,
  type Settings,
  monitorSchema,
  listingSchema,
} from './model.js';

export type Row = Record<string, any>;
export function fingerprint(l: Listing): string {
  if (l.sourceId)
    return createHash('sha256')
      .update(JSON.stringify([l.source.toLowerCase(), l.sourceId]))
      .digest('hex');
  return createHash('sha256')
    .update(
      JSON.stringify(
        [l.dealer, l.city, l.state, l.stock, l.year, l.model, l.part].map((v) =>
          String(v).trim().toLowerCase(),
        ),
      ),
    )
    .digest('hex');
}
export class Store {
  db: DatabaseSync;
  private statements = new Map<string, StatementSync>();
  constructor(path = process.env.DATABASE_PATH || 'data/part-scout.db') {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY,value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS monitors(id INTEGER PRIMARY KEY,config TEXT NOT NULL,last_run INTEGER,next_run INTEGER NOT NULL DEFAULT 0,error TEXT,failures INTEGER NOT NULL DEFAULT 0,initialized INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE IF NOT EXISTS listings(id TEXT PRIMARY KEY,data TEXT NOT NULL,price REAL,first_seen INTEGER NOT NULL,last_seen INTEGER NOT NULL,saved INTEGER NOT NULL DEFAULT 0,note TEXT NOT NULL DEFAULT '');
      CREATE TABLE IF NOT EXISTS matches(monitor_id INTEGER REFERENCES monitors(id) ON DELETE CASCADE,listing_id TEXT REFERENCES listings(id) ON DELETE CASCADE,eligible INTEGER NOT NULL,observed_price REAL,missed INTEGER NOT NULL DEFAULT 0,PRIMARY KEY(monitor_id,listing_id));
      CREATE TABLE IF NOT EXISTS prices(id INTEGER PRIMARY KEY,listing_id TEXT REFERENCES listings(id) ON DELETE CASCADE,price REAL,at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS runs(id INTEGER PRIMARY KEY,monitor_id INTEGER REFERENCES monitors(id) ON DELETE SET NULL,name TEXT NOT NULL,started INTEGER NOT NULL,duration INTEGER NOT NULL,status TEXT NOT NULL,seen INTEGER NOT NULL DEFAULT 0,added INTEGER NOT NULL DEFAULT 0,drops INTEGER NOT NULL DEFAULT 0,error TEXT);
      CREATE TABLE IF NOT EXISTS jobs(id INTEGER PRIMARY KEY,dedupe TEXT UNIQUE NOT NULL,payload TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'pending',attempts INTEGER NOT NULL DEFAULT 0,due INTEGER NOT NULL,created INTEGER NOT NULL,error TEXT);
      CREATE INDEX IF NOT EXISTS idx_listings_seen ON listings(last_seen);
      CREATE INDEX IF NOT EXISTS idx_matches_listing ON matches(listing_id);
      CREATE INDEX IF NOT EXISTS idx_prices_listing ON prices(listing_id,at);
      CREATE INDEX IF NOT EXISTS idx_jobs_due ON jobs(status,due);
      CREATE INDEX IF NOT EXISTS idx_runs_started ON runs(started);
      CREATE TABLE IF NOT EXISTS cars(id INTEGER PRIMARY KEY,config TEXT NOT NULL,created INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS checklist(id INTEGER PRIMARY KEY,car_id INTEGER NOT NULL REFERENCES cars(id) ON DELETE CASCADE,config TEXT NOT NULL,updated INTEGER NOT NULL);
      INSERT OR IGNORE INTO meta VALUES('schema','1');`);
    const matchColumns = this.db.prepare('PRAGMA table_info(matches)').all() as Row[];
    for (const column of ['first_seen', 'last_seen'])
      if (!matchColumns.some((c) => c.name === column))
        this.db.exec(`ALTER TABLE matches ADD COLUMN ${column} INTEGER NOT NULL DEFAULT 0`);
    this.db
      .exec(`UPDATE matches SET first_seen=(SELECT first_seen FROM listings WHERE id=listing_id) WHERE first_seen=0;
      UPDATE matches SET last_seen=(SELECT last_seen FROM listings WHERE id=listing_id) WHERE last_seen=0;
      INSERT OR REPLACE INTO meta VALUES('schema','2');`);
    // This server owns a single worker. Recover notifications interrupted during delivery.
    this.db.prepare("UPDATE jobs SET status='pending' WHERE status='sending'").run();
  }
  private statement(sql: string) {
    let statement = this.statements.get(sql);
    if (!statement) {
      statement = this.db.prepare(sql);
      this.statements.set(sql, statement);
    }
    return statement;
  }
  all(sql: string, ...params: any[]): Row[] {
    return this.statement(sql).all(...params) as Row[];
  }
  get(sql: string, ...params: any[]): Row | undefined {
    return this.statement(sql).get(...params) as Row | undefined;
  }
  exec(sql: string, ...params: any[]) {
    return this.statement(sql).run(...params);
  }
  transaction<T>(fn: () => T): T {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const result = fn();
      this.db.exec('COMMIT');
      return result;
    } catch (e) {
      this.db.exec('ROLLBACK');
      throw e;
    }
  }
  settings(): Settings {
    const row = this.get("SELECT value FROM meta WHERE key='settings'");
    return row ? { ...defaultSettings, ...JSON.parse(row.value) } : { ...defaultSettings };
  }
  setSettings(s: Settings) {
    this.exec(
      "INSERT INTO meta VALUES('settings',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
      JSON.stringify(s),
    );
  }
  monitors(): Monitor[] {
    return this.all('SELECT * FROM monitors ORDER BY id').map((r) => ({
      ...monitorSchema.parse(JSON.parse(r.config)),
      id: r.id,
      lastRun: r.last_run,
      nextRun: r.next_run,
      error: r.error,
      failures: r.failures,
      initialized: !!r.initialized,
    }));
  }
  monitor(id: number): Monitor | undefined {
    return this.monitors().find((m) => m.id === id);
  }
  putMonitor(config: MonitorInput, id?: number): Monitor {
    return this.transaction(() => {
      if (id) {
        if (!this.monitor(id)) throw new Error('Monitor not found');
        this.exec('UPDATE monitors SET config=?,next_run=0 WHERE id=?', JSON.stringify(config), id);
      } else
        id = Number(
          this.exec('INSERT INTO monitors(config) VALUES(?)', JSON.stringify(config))
            .lastInsertRowid,
        );
      const monitor = this.monitor(id)!;
      for (const row of this.all(
        'SELECT l.id,l.data FROM listings l JOIN matches m ON m.listing_id=l.id WHERE m.monitor_id=?',
        id,
      ))
        this.exec(
          'UPDATE matches SET eligible=? WHERE monitor_id=? AND listing_id=?',
          Number(matches(JSON.parse(row.data), monitor)),
          id,
          row.id,
        );
      return monitor;
    });
  }
  removeMonitor(id: number) {
    this.exec('DELETE FROM monitors WHERE id=?', id);
  }
  inventory(
    options: {
      q?: string;
      monitor?: number;
      saved?: boolean;
      active?: boolean;
      sort?: string;
      page?: number;
      limit?: number;
    } = {},
  ) {
    const conditions: string[] = [];
    const args: any[] = [];
    if (options.q) {
      conditions.push("l.data LIKE ? ESCAPE '\\'");
      args.push(`%${options.q.replace(/[\\%_]/g, '\\$&')}%`);
    }
    if (options.saved) conditions.push('l.saved=1');
    let scope = 'm.listing_id=l.id AND m.eligible=1';
    if (options.active !== false) scope += ' AND m.missed<3';
    if (options.monitor) {
      scope += ' AND m.monitor_id=?';
      args.push(options.monitor);
    }
    conditions.push(
      options.saved && !options.monitor && options.active === false
        ? `(EXISTS(SELECT 1 FROM matches m WHERE ${scope}) OR NOT EXISTS(SELECT 1 FROM matches m WHERE m.listing_id=l.id))`
        : `EXISTS(SELECT 1 FROM matches m WHERE ${scope})`,
    );
    const where = conditions.join(' AND ');
    const count = this.get(`SELECT COUNT(*) count FROM listings l WHERE ${where}`, ...args)!.count;
    const sort =
      (
        {
          newest: 'l.first_seen DESC',
          price: 'l.price IS NULL,l.price ASC',
          oldest: 'l.first_seen ASC',
        } as Record<string, string>
      )[options.sort || 'newest'] || 'l.first_seen DESC';
    const limit = Math.min(100, Math.max(1, options.limit || 30));
    const page = Math.max(1, options.page || 1);
    const items = this.all(
      `SELECT l.*, (SELECT MAX(m.missed<3) FROM matches m WHERE m.listing_id=l.id) active,(SELECT json_group_array(m.monitor_id) FROM matches m WHERE m.listing_id=l.id) monitors FROM listings l WHERE ${where} ORDER BY ${sort},l.id LIMIT ? OFFSET ?`,
      ...args,
      limit,
      (page - 1) * limit,
    ).map((r) => this.listingRow(r));
    return { items, total: count, page, limit };
  }
  listingRow(r: Row) {
    return {
      ...listingSchema.parse(JSON.parse(r.data)),
      id: r.id,
      firstSeen: r.first_seen,
      lastSeen: r.last_seen,
      saved: !!r.saved,
      note: r.note,
      active: !!r.active,
      monitors: r.monitors ? JSON.parse(r.monitors) : [],
    };
  }
  detail(id: string) {
    const r = this.get(
      'SELECT *,EXISTS(SELECT 1 FROM matches WHERE listing_id=listings.id AND missed<3) active FROM listings WHERE id=?',
      id,
    );
    return r
      ? {
          ...this.listingRow(r),
          history: this.all('SELECT price,at FROM prices WHERE listing_id=? ORDER BY at,id', id),
          monitors: this.all('SELECT monitor_id id FROM matches WHERE listing_id=?', id).map(
            (m) => m.id,
          ),
        }
      : undefined;
  }
  save(id: string, saved: boolean, note: string) {
    return this.exec('UPDATE listings SET saved=?,note=? WHERE id=?', Number(saved), note, id)
      .changes;
  }
  ingest(m: Monitor, incoming: Listing[], started: number, duration: number, complete = true) {
    return this.transaction(() => {
      const now = Date.now();
      const settings = this.settings();
      let added = 0;
      let drops = 0;
      const unique = new Map(incoming.map((l) => [fingerprint(l), l]));
      if (complete) this.exec('UPDATE matches SET missed=missed+1 WHERE monitor_id=?', m.id);
      for (const [id, l] of unique) {
        const previous = this.get('SELECT price FROM listings WHERE id=?', id);
        const previousMatch = this.get(
          'SELECT eligible,observed_price FROM matches WHERE monitor_id=? AND listing_id=?',
          m.id,
          id,
        );
        const eligible = matches(l, m);
        this.exec(
          'INSERT INTO listings(id,data,price,first_seen,last_seen) VALUES(?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data,price=excluded.price,last_seen=excluded.last_seen',
          id,
          JSON.stringify(l),
          l.price,
          now,
          now,
        );
        this.exec(
          'INSERT INTO matches(monitor_id,listing_id,eligible,observed_price,first_seen,last_seen) VALUES(?,?,?,?,?,?) ON CONFLICT(monitor_id,listing_id) DO UPDATE SET missed=0,eligible=excluded.eligible,observed_price=excluded.observed_price,last_seen=excluded.last_seen',
          m.id,
          id,
          Number(eligible),
          l.price,
          now,
          now,
        );
        let historyId: number | null = null;
        if (!previous || previous.price !== l.price)
          historyId = Number(
            this.exec('INSERT INTO prices(listing_id,price,at) VALUES(?,?,?)', id, l.price, now)
              .lastInsertRowid,
          );
        const fresh = eligible && (!previousMatch || !previousMatch.eligible);
        const drop =
          eligible &&
          previousMatch &&
          l.price !== null &&
          previousMatch.observed_price !== null &&
          l.price < previousMatch.observed_price;
        if (fresh) added++;
        if (drop) drops++;
        const kind = fresh && m.notifyNew ? 'new' : drop && m.notifyDrops ? 'price-drop' : null;
        if (kind && (m.initialized || m.notifyInitial) && settings.notificationMode !== 'off') {
          this.exec(
            'INSERT OR IGNORE INTO jobs(dedupe,payload,due,created) VALUES(?,?,?,?)',
            `${m.id}:${id}:${kind}:${historyId ?? this.get('SELECT id FROM prices WHERE listing_id=? ORDER BY id DESC LIMIT 1', id)?.id ?? 'match'}`,
            JSON.stringify({
              kind,
              monitor: m.name,
              destination: m.destination ?? 'default',
              listing: l,
              previousPrice: previousMatch?.observed_price ?? null,
            }),
            now + (settings.notificationMode === 'digest' ? settings.digestMinutes * 60000 : 0),
            now,
          );
        }
      }
      this.exec(
        'UPDATE monitors SET last_run=?,next_run=?,failures=0,error=NULL,initialized=1 WHERE id=?',
        now,
        now + m.intervalMinutes * 60000,
        m.id,
      );
      this.exec(
        "INSERT INTO runs(monitor_id,name,started,duration,status,seen,added,drops) VALUES(?,?,?,?,'success',?,?,?)",
        m.id,
        m.name,
        started,
        duration,
        unique.size,
        added,
        drops,
      );
      return { seen: unique.size, added, drops };
    });
  }
  failure(m: Monitor, started: number, error: string) {
    this.transaction(() => {
      const delay = Math.min(24 * 60, m.intervalMinutes * 2 ** Math.min(5, m.failures));
      this.exec(
        'UPDATE monitors SET last_run=?,next_run=?,failures=failures+1,error=? WHERE id=?',
        Date.now(),
        Date.now() + delay * 60000,
        error,
        m.id,
      );
      this.exec(
        "INSERT INTO runs(monitor_id,name,started,duration,status,error) VALUES(?,?,?,?,'failed',?)",
        m.id,
        m.name,
        started,
        Date.now() - started,
        error,
      );
    });
  }
  runs() {
    return this.all('SELECT * FROM runs ORDER BY id DESC LIMIT 100');
  }
  jobs() {
    return this.all(
      'SELECT id,status,attempts,created,due,error FROM jobs ORDER BY id DESC LIMIT 100',
    );
  }
  prune() {
    const cutoff = Date.now() - this.settings().retentionDays * 86400000;
    this.transaction(() => {
      this.exec('DELETE FROM runs WHERE started<?', cutoff);
      this.exec("DELETE FROM jobs WHERE created<? AND status IN ('sent','failed')", cutoff);
      this.exec(
        'DELETE FROM listings WHERE saved=0 AND last_seen<? AND NOT EXISTS(SELECT 1 FROM matches WHERE listing_id=listings.id AND missed<3)',
        cutoff,
      );
    });
  }
  close() {
    this.db.close();
  }
  garage() {
    return this.getMeta('garage', { name: 'Your garage', owner: '', zip: '' });
  }
  getMeta<T>(key: string, fallback: T): T {
    const row = this.get('SELECT value FROM meta WHERE key=?', key);
    return row ? JSON.parse(row.value) : fallback;
  }
  setMeta(key: string, value: unknown) {
    this.exec(
      'INSERT INTO meta(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value',
      key,
      JSON.stringify(value),
    );
  }
  cars() {
    return this.all('SELECT * FROM cars ORDER BY id').map((r) => ({
      ...JSON.parse(r.config),
      id: r.id,
      checklist: this.all('SELECT * FROM checklist WHERE car_id=? ORDER BY id', r.id).map((p) => ({
        ...JSON.parse(p.config),
        id: p.id,
        updated: p.updated,
      })),
    }));
  }
  putCar(config: unknown, id?: number) {
    if (id) {
      if (!this.get('SELECT id FROM cars WHERE id=?', id)) throw new Error('Car not found');
      this.exec('UPDATE cars SET config=? WHERE id=?', JSON.stringify(config), id);
    } else
      id = Number(
        this.exec(
          'INSERT INTO cars(config,created) VALUES(?,?)',
          JSON.stringify(config),
          Date.now(),
        ).lastInsertRowid,
      );
    return this.cars().find((c) => c.id === id);
  }
  putChecklist(carId: number, config: unknown, id?: number) {
    if (!this.get('SELECT id FROM cars WHERE id=?', carId)) throw new Error('Car not found');
    if (id) {
      const result = this.exec(
        'UPDATE checklist SET config=?,updated=? WHERE id=? AND car_id=?',
        JSON.stringify(config),
        Date.now(),
        id,
        carId,
      );
      if (!result.changes) throw new Error('Checklist entry not found');
    } else
      id = Number(
        this.exec(
          'INSERT INTO checklist(car_id,config,updated) VALUES(?,?,?)',
          carId,
          JSON.stringify(config),
          Date.now(),
        ).lastInsertRowid,
      );
    return { id };
  }
  monitorExport(id: number, from: number, to: number) {
    return this.all(
      'SELECT l.*,m.first_seen found_at,m.last_seen observed_at,m.missed FROM listings l JOIN matches m ON m.listing_id=l.id WHERE m.monitor_id=? AND m.eligible=1 AND m.first_seen>=? AND m.first_seen<? ORDER BY m.first_seen DESC',
      id,
      from,
      to,
    ).map((r) => ({
      ...this.listingRow(r),
      foundAt: r.found_at,
      observedAt: r.observed_at,
      active: r.missed < 3,
    }));
  }
}
