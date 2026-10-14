import express from 'express';
import { timingSafeEqual } from 'node:crypto';
import { resolve } from 'node:path';
import { Store } from './store.js';
import { Service } from './service.js';
import { Notifications, validWebhook } from './notifications.js';
import { listingSchema, monitorSchema, settingsSchema } from './model.js';
import { parseCarPart } from './providers.js';

const safeToken = (a: string, b: string) => {
  const aa = Buffer.from(a),
    bb = Buffer.from(b);
  return aa.length === bb.length && timingSafeEqual(aa, bb);
};
export const csvCell = (value: unknown) =>
  `"${String(value ?? '')
    .replace(/^[=+@\-\t\r]/, "'$&")
    .replace(/"/g, '""')}"`;
export function createApp(store: Store, service: Service, token = process.env.ADMIN_TOKEN || '') {
  const app = express();
  app.disable('x-powered-by');
  app.use((req, res, next) => {
    res.set({
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
      'X-Frame-Options': 'DENY',
      'Content-Security-Policy':
        "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' https: data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
    });
    next();
  });
  app.get('/healthz', (_, res) => res.json({ status: 'ok' }));
  const rates = new Map<string, { until: number; count: number }>();
  app.use('/api', (req, res, next) => {
    res.set('Cache-Control', 'no-store');
    const host = req.headers.host || '';
    const hostname = host.replace(/:\d+$/, '');
    if (!token && !['127.0.0.1', 'localhost', '[::1]'].includes(hostname))
      return res
        .status(403)
        .json({ error: 'Local access only. Configure ADMIN_TOKEN to use another host.' });
    if (req.headers.origin) {
      try {
        if (new URL(req.headers.origin).host !== host)
          return res.status(403).json({ error: 'Origin rejected' });
      } catch {
        return res.status(403).json({ error: 'Origin rejected' });
      }
    }
    if (token && !safeToken(req.headers.authorization?.replace(/^Bearer /, '') || '', token))
      return res.status(401).json({ error: 'Enter the admin token to connect.' });
    const key = req.ip || 'unknown';
    const now = Date.now();
    for (const [ip, rate] of rates) if (rate.until < now) rates.delete(ip);
    const rate = rates.get(key) || { until: now + 60000, count: 0 };
    rate.count++;
    rates.set(key, rate);
    if (rate.count > 240)
      return res.status(429).json({ error: 'Too many requests. Try again in a minute.' });
    next();
  });
  app.use(express.json({ limit: '6mb' }));
  const id = (raw: string) => {
    const n = Number(raw);
    if (!Number.isSafeInteger(n) || n < 1) throw new Error('Invalid ID');
    return n;
  };
  app.get('/api/status', (_, res) =>
    res.json({
      running: service.running,
      settings: store.settings(),
      monitors: store.monitors(),
      demo: store.get("SELECT value FROM meta WHERE key='demo'")?.value === 'true',
      total: store.inventory({ limit: 1 }).total,
      saved: store.inventory({ saved: true, active: false, limit: 1 }).total,
      deliveries: store.get(
        "SELECT COUNT(*) pending FROM jobs WHERE status IN ('pending','sending')",
      )!.pending,
      failedDeliveries: store.get("SELECT COUNT(*) failed FROM jobs WHERE status='failed'")!.failed,
      integrations: {
        webhook: validWebhook(process.env.DISCORD_WEBHOOK_URL || ''),
        carpart: process.env.CAR_PART_ENABLED === 'true',
        feeds: !!process.env.FEED_HOSTS,
        bot: !!process.env.DISCORD_BOT_TOKEN,
      },
      version: '1.0.0',
    }),
  );
  app.get('/api/monitors', (_, res) => res.json(store.monitors()));
  app.post('/api/monitors', (req, res) =>
    res.status(201).json(store.putMonitor(monitorSchema.parse(req.body))),
  );
  app.put('/api/monitors/:id', (req, res) => {
    if (service.running !== null)
      return res.status(409).json({ error: 'Wait for the active scan before editing monitors.' });
    res.json(store.putMonitor(monitorSchema.parse(req.body), id(req.params.id)));
  });
  app.delete('/api/monitors/:id', (req, res) => {
    if (service.running !== null)
      return res.status(409).json({ error: 'Wait for the active scan before deleting monitors.' });
    store.removeMonitor(id(req.params.id));
    res.json({ ok: true });
  });
  app.post('/api/monitors/:id/scan', async (req, res) => {
    if (service.running !== null)
      return res.status(409).json({ error: 'A scan is already running.' });
    res.json(await service.scan(id(req.params.id)));
  });
  app.post('/api/monitors/:id/import', (req, res) => {
    const result =
      typeof req.body.html === 'string'
        ? parseCarPart(req.body.html)
        : {
            listings: listingSchema.array().max(10000).parse(req.body.listings),
            complete: req.body.complete === true,
          };
    res.json(service.import(id(req.params.id), result.listings, result.complete));
  });
  app.get('/api/listings', (req, res) =>
    res.json(
      store.inventory({
        q: String(req.query.q || '').slice(0, 200),
        monitor: req.query.monitor ? id(String(req.query.monitor)) : undefined,
        saved: req.query.saved === 'true',
        active: req.query.active !== 'false',
        sort: String(req.query.sort || 'newest'),
        page: Math.max(1, Number(req.query.page) || 1),
        limit: 30,
      }),
    ),
  );
  app.get('/api/listings/:id', (req, res) => {
    const listing = store.detail(req.params.id);
    if (!listing) return res.status(404).json({ error: 'Listing not found' });
    res.json(listing);
  });
  app.patch('/api/listings/:id', (req, res) => {
    if (
      typeof req.body.saved !== 'boolean' ||
      typeof req.body.note !== 'string' ||
      req.body.note.length > 2000
    )
      throw new Error('Provide a bookmark and a note of up to 2,000 characters.');
    if (!store.save(req.params.id, req.body.saved, req.body.note))
      return res.status(404).json({ error: 'Listing not found' });
    res.json({ ok: true });
  });
  app.get('/api/runs', (_, res) => res.json(store.runs()));
  app.get('/api/analytics', (req, res) => {
    const boundaries = String(req.query.days || '')
      .split(',')
      .map(Number);
    if (
      boundaries.length !== 8 ||
      boundaries.some(
        (n, i) =>
          !Number.isSafeInteger(n) ||
          n < Date.now() - 9 * 86400000 ||
          n > Date.now() + 2 * 86400000 ||
          (i > 0 && (n <= boundaries[i - 1]! || n - boundaries[i - 1]! > 90000000)),
      )
    )
      throw new Error('Provide eight consecutive day boundaries.');
    res.json(
      boundaries
        .slice(0, 7)
        .map((start, i) =>
          store.get(
            "SELECT COUNT(*) scans,COALESCE(SUM(added),0) added,COALESCE(SUM(drops),0) drops FROM runs WHERE status='success' AND started>=? AND started<?",
            start,
            boundaries[i + 1],
          ),
        ),
    );
  });
  app.get('/api/deliveries', (_, res) => res.json(store.jobs()));
  app.post('/api/deliveries/:id/retry', (req, res) => {
    store.exec(
      "UPDATE jobs SET status='pending',attempts=0,due=? WHERE id=? AND status='failed'",
      Date.now(),
      id(req.params.id),
    );
    res.json({ ok: true });
  });
  app.put('/api/settings', (req, res) => {
    store.setSettings(settingsSchema.parse(req.body));
    res.json(store.settings());
  });
  app.get('/api/export/config', (_, res) =>
    res
      .attachment('part-scout-config.json')
      .json({
        version: 1,
        settings: store.settings(),
        monitors: store
          .monitors()
          .map(({ id, lastRun, nextRun, error, failures, initialized, ...config }) => config),
      }),
  );
  app.post('/api/import/config', (req, res) => {
    if (service.running !== null)
      return res
        .status(409)
        .json({ error: 'Wait for the active scan before importing configuration.' });
    if (
      req.body.version !== 1 ||
      !Array.isArray(req.body.monitors) ||
      req.body.monitors.length > 100
    )
      throw new Error('Unsupported configuration file');
    const monitors = req.body.monitors.map((m: unknown) => monitorSchema.parse(m));
    const settings = settingsSchema.parse(req.body.settings);
    // Validation precedes every write. Import adds monitors and does not overwrite existing ones.
    store.transaction(() => {
      store.setSettings(settings);
      for (const m of monitors)
        store.exec('INSERT INTO monitors(config) VALUES(?)', JSON.stringify(m));
    });
    res.json({ added: monitors.length });
  });
  app.get('/api/export/listings', (req, res) => {
    const rows = store.inventory({ active: false, limit: 100 }).items;
    let page = 2;
    while (rows.length < store.inventory({ active: false, limit: 1 }).total)
      rows.push(...store.inventory({ active: false, limit: 100, page: page++ }).items);
    const columns = [
      'year',
      'model',
      'part',
      'price',
      'miles',
      'grade',
      'dealer',
      'city',
      'state',
      'stock',
      'phone',
      'url',
      'note',
    ];
    res
      .type('text/csv')
      .attachment('part-scout-inventory.csv')
      .send(
        [
          columns.join(','),
          ...rows.map((row) => columns.map((c) => csvCell(row[c])).join(',')),
        ].join('\r\n'),
      );
  });
  app.use(express.static(resolve('public'), { maxAge: 0 }));
  app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    if (err?.name === 'ZodError')
      return res
        .status(400)
        .json({
          error: err.issues.map((i: any) => `${i.path.join('.')}: ${i.message}`).join('; '),
        });
    const message = err instanceof Error ? err.message : 'Request failed';
    res
      .status(err.status || (message === 'Monitor not found' ? 404 : 400))
      .json({ error: message.slice(0, 500) });
  });
  return app;
}
export function start() {
  const host = process.env.HOST || '127.0.0.1';
  const token = process.env.ADMIN_TOKEN || '';
  if (!['127.0.0.1', 'localhost', '::1'].includes(host) && token.length < 24)
    throw new Error(
      'Use an ADMIN_TOKEN of at least 24 characters before binding a network interface.',
    );
  const store = new Store();
  const service = new Service(store);
  const notifications = new Notifications(store);
  const app = createApp(store, service, token);
  const server = app.listen(Number(process.env.PORT || 4310), host, () =>
    console.log(`Part Scout: http://${host}:${process.env.PORT || 4310}`),
  );
  const scanTimer = setInterval(() => void service.tick(), 5000);
  const deliveryTimer = setInterval(
    () => void notifications.tick().catch(() => console.error('Notification worker failed')),
    2000,
  );
  const pruneTimer = setInterval(() => store.prune(), 3600000);
  let closing = false;
  const shutdown = async () => {
    if (closing) return;
    closing = true;
    clearInterval(scanTimer);
    clearInterval(deliveryTimer);
    clearInterval(pruneTimer);
    service.stop();
    server.close();
    while (service.running !== null || notifications.running)
      await new Promise((r) => setTimeout(r, 100));
    store.close();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown());
  process.on('SIGTERM', () => void shutdown());
  return { server, store, service };
}
if (process.argv[1]?.endsWith('server.ts') || process.argv[1]?.endsWith('server.js')) start();
