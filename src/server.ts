import express from 'express';
import { timingSafeEqual } from 'node:crypto';
import { resolve, dirname, join } from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { Store } from './store.js';
import { Service } from './service.js';
import { Notifications, webhookDestinations } from './notifications.js';
import {
  listingSchema,
  monitorSchema,
  settingsSchema,
  garageSchema,
  carSchema,
  checklistSchema,
} from './model.js';
import { parseCarPart } from './providers.js';
import { Providers } from './providers.js';
import { Connections, connectionSchema } from './connections.js';
import { monitorWorkbook } from './exports.js';
import { partCatalog } from './catalog.js';
import { BotManager } from './bot-manager.js';

const safeToken = (a: string, b: string) => {
  const aa = Buffer.from(a),
    bb = Buffer.from(b);
  return aa.length === bb.length && timingSafeEqual(aa, bb);
};
export const csvCell = (value: unknown) =>
  `"${String(value ?? '')
    .replace(/^[=+@\-\t\r]/, "'$&")
    .replace(/"/g, '""')}"`;
export function createApp(
  store: Store,
  service: Service,
  token = process.env.ADMIN_TOKEN || '',
  connections = new Connections(
    store,
    resolve(dirname(process.env.DATABASE_PATH || 'data/part-scout.db')),
  ),
  bot?: BotManager,
) {
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
      garage: store.garage(),
      cars: store.cars(),
      connections: connections.public(),
      monitors: store.monitors(),
      demo: store.get("SELECT value FROM meta WHERE key='demo'")?.value === 'true',
      total: store.inventory({ limit: 1 }).total,
      saved: store.inventory({ saved: true, active: false, limit: 1 }).total,
      deliveries: store.get(
        "SELECT COUNT(*) pending FROM jobs WHERE status IN ('pending','sending')",
      )!.pending,
      failedDeliveries: store.get("SELECT COUNT(*) failed FROM jobs WHERE status='failed'")!.failed,
      integrations: {
        webhook: Object.keys(connections.destinations()).length > 0,
        carpart: connections.config().carPartEnabled,
        feeds: !!connections.config().feedHosts,
        bot: !!process.env.DISCORD_BOT_TOKEN,
      },
      destinations: Object.keys(connections.destinations()),
      version: '2.0.0',
    }),
  );
  app.get('/api/catalog', (_, res) => res.json(partCatalog));
  app.get('/api/garage', (_, res) => res.json({ ...store.garage(), cars: store.cars() }));
  app.put('/api/garage', (req, res) => {
    store.setMeta('garage', garageSchema.parse(req.body));
    res.json(store.garage());
  });
  app.post('/api/cars', (req, res) =>
    res.status(201).json(store.putCar(carSchema.parse(req.body))),
  );
  app.put('/api/cars/:id', (req, res) =>
    res.json(store.putCar(carSchema.parse(req.body), id(req.params.id))),
  );
  app.delete('/api/cars/:id', (req, res) => {
    const carId = id(req.params.id);
    store.transaction(() => {
      store.exec('DELETE FROM cars WHERE id=?', carId);
      for (const m of store.monitors().filter((m) => m.carId === carId))
        store.exec(
          'UPDATE monitors SET config=? WHERE id=?',
          JSON.stringify({ ...m, carId: null }),
          m.id,
        );
    });
    res.json({ ok: true });
  });
  app.post('/api/cars/:id/parts', (req, res) =>
    res.status(201).json(store.putChecklist(id(req.params.id), checklistSchema.parse(req.body))),
  );
  app.put('/api/cars/:id/parts/:partId', (req, res) =>
    res.json(
      store.putChecklist(id(req.params.id), checklistSchema.parse(req.body), id(req.params.partId)),
    ),
  );
  app.delete('/api/cars/:id/parts/:partId', (req, res) => {
    store.exec(
      'DELETE FROM checklist WHERE car_id=? AND id=?',
      id(req.params.id),
      id(req.params.partId),
    );
    res.json({ ok: true });
  });
  const mediaDirectory = resolve(
    dirname(process.env.DATABASE_PATH || 'data/part-scout.db'),
    'uploads',
  );
  app.post('/api/upload', (req, res) => {
    if (typeof req.body.data !== 'string') throw new Error('Choose a JPG, PNG, or WebP photo.');
    const match = req.body.data.match(/^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$/);
    if (!match) throw new Error('Only JPG, PNG, and WebP images are supported.');
    const bytes = Buffer.from(match[2], 'base64');
    if (bytes.length > 4_000_000) throw new Error('Choose a photo smaller than 4 MB.');
    const type = match[1];
    if (
      (type === 'png' &&
        !bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) ||
      (type === 'jpeg' && !(bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255)) ||
      (type === 'webp' &&
        !(bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP'))
    )
      throw new Error('The file does not match its image format.');
    mkdirSync(mediaDirectory, { recursive: true });
    const name = `${randomUUID()}.${type === 'jpeg' ? 'jpg' : type}`;
    writeFileSync(join(mediaDirectory, name), bytes, { flag: 'wx' });
    res.status(201).json({ url: `/media/${name}` });
  });
  app.get('/api/connections', (_, res) => res.json(connections.public()));
  app.put('/api/connections', (req, res) => {
    connections.save(connectionSchema.parse(req.body));
    res.json(connections.public());
  });
  app.post('/api/connections/discord/test', async (req, res) =>
    res.json(await connections.testDiscord(fetch, req.body.send === true)),
  );
  app.post('/api/connections/ebay/test', async (_, res) => {
    await service.providers.ebay.testAccess();
    res.json({ ok: true });
  });
  app.post('/api/connections/bot/start', async (_, res) => {
    if (!bot) return res.status(503).json({ error: 'Bot manager is not running' });
    res.json(await bot.start());
  });
  app.post('/api/connections/bot/stop', (_, res) => {
    bot?.stop();
    res.json({ ok: true });
  });
  app.post('/api/listings/:id/enrich', async (req, res) => {
    const listing = store.detail(req.params.id);
    if (!listing) return res.status(404).json({ error: 'Listing not found' });
    if (listing.source !== 'eBay') return res.json(listing);
    const details = (await service.providers.ebay.details(
      listing.sourceId || listing.stock,
    )) as any;
    const images = [
      ...new Set(
        [
          listing.image,
          ...listing.images,
          details.image?.imageUrl,
          ...(details.additionalImages || []).map((i: any) => i.imageUrl),
        ].filter((u: any) => typeof u === 'string' && u.startsWith('https://')),
      ),
    ];
    const attributes = {
      ...listing.attributes,
      ...Object.fromEntries(
        (details.localizedAspects || []).map((a: any) => [String(a.name), String(a.value)]),
      ),
    };
    const enriched = listingSchema.parse({
      ...listing,
      images,
      attributes,
      raw: { ...listing.raw, ...details },
      condition: details.condition || listing.condition,
    });
    store.exec('UPDATE listings SET data=? WHERE id=?', JSON.stringify(enriched), listing.id);
    res.json(store.detail(listing.id));
  });
  app.get('/api/monitors/:id/export', async (req, res) => {
    const from = Date.parse(String(req.query.from || '')),
      to = Date.parse(String(req.query.to || ''));
    if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from)
      throw new Error('Choose a valid start and end time.');
    const buffer = await monitorWorkbook(store, id(req.params.id), from, to);
    res
      .type('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
      .attachment(`part-scout-monitor-${req.params.id}.xlsx`)
      .send(buffer);
  });
  app.get('/api/events', (req, res) => {
    res.set({
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });
    res.flushHeaders();
    let previous = '';
    const notify = () => {
      const state = JSON.stringify({
        running: service.running,
        run: store.get('SELECT MAX(id) id FROM runs')?.id,
        job: store.get('SELECT MAX(id) id FROM jobs')?.id,
      });
      if (state !== previous) {
        previous = state;
        res.write(`data: ${state}\n\n`);
      } else res.write(': heartbeat\n\n');
    };
    notify();
    const timer = setInterval(notify, 2000);
    req.on('close', () => clearInterval(timer));
  });
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
    const monitorId = id(req.params.id);
    if (!store.monitor(monitorId)) return res.status(404).json({ error: 'Monitor not found' });
    if (req.query.async === 'true') {
      void service.scan(monitorId).catch(() => {});
      return res.status(202).json({ accepted: true });
    }
    res.json(await service.scan(monitorId));
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
    res.attachment('part-scout-config.json').json({
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
          ...rows.map((row) =>
            columns.map((c) => csvCell((row as Record<string, unknown>)[c])).join(','),
          ),
        ].join('\r\n'),
      );
  });
  app.use('/media', express.static(mediaDirectory, { maxAge: '1d', dotfiles: 'deny' }));
  app.use(express.static(process.env.SCOUT_PUBLIC_DIR || resolve('public'), { maxAge: 0 }));
  app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    if (err?.name === 'ZodError')
      return res.status(400).json({
        error: err.issues.map((i: any) => `${i.path.join('.')}: ${i.message}`).join('; '),
      });
    const message = err instanceof Error ? err.message : 'Request failed';
    res
      .status(err.status || (message === 'Monitor not found' ? 404 : 400))
      .json({ error: message.slice(0, 500) });
  });
  return app;
}
export function start(options: { connections?: (store: Store) => Connections } = {}) {
  const host = process.env.HOST || '127.0.0.1';
  const token = process.env.ADMIN_TOKEN || '';
  if (!['127.0.0.1', 'localhost', '::1'].includes(host) && token.length < 24)
    throw new Error(
      'Use an ADMIN_TOKEN of at least 24 characters before binding a network interface.',
    );
  const store = new Store();
  const service = new Service(store);
  const connections =
    options.connections?.(store) ||
    new Connections(store, resolve(dirname(process.env.DATABASE_PATH || 'data/part-scout.db')));
  service.providers = new Providers(
    () => store.settings().requestGapSeconds,
    fetch,
    () => connections.config(),
  );
  const notifications = new Notifications(store, '', fetch, () => connections.destinations());
  const bot = new BotManager(
    store,
    () => connections.botConfig(),
    () => `http://127.0.0.1:${(server.address() as import('node:net').AddressInfo).port}`,
    token,
  );
  bot.stop();
  const app = createApp(store, service, token, connections, bot);
  const server = app.listen(Number(process.env.PORT || 4310), host, () => {
    console.log(
      `Part Scout: http://${host}:${(server.address() as import('node:net').AddressInfo).port}`,
    );
    if (connections.botConfig().botEnabled) void bot.start().catch(() => {});
  });
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
    bot.stop();
    server.close();
    while (service.running !== null || notifications.running)
      await new Promise((r) => setTimeout(r, 100));
    store.close();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown());
  process.on('SIGTERM', () => void shutdown());
  return {
    server,
    store,
    service,
    connections,
    bot,
    close: async () => {
      clearInterval(scanTimer);
      clearInterval(deliveryTimer);
      clearInterval(pruneTimer);
      service.stop();
      bot.stop();
      server.closeAllConnections();
      await new Promise<void>((r) => server.close(() => r()));
      while (service.running !== null || notifications.running)
        await new Promise((r) => setTimeout(r, 50));
      store.close();
    },
  };
}
if (process.argv[1]?.endsWith('server.ts') || process.argv[1]?.endsWith('server.js')) start();
