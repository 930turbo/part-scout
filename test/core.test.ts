import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Store, fingerprint } from '../src/store.js';
import { listingSchema, monitorSchema, matches } from '../src/model.js';
import { parseCarPart, privateAddress, Providers } from '../src/providers.js';
import { Notifications, validWebhook } from '../src/notifications.js';
import { Service } from '../src/service.js';
import { createApp, csvCell } from '../src/server.js';
import { once } from 'node:events';
import { mkdtempSync, rmSync, rmdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { convertLegacy, legacyInterval } from '../src/migrate.js';
const part = (changes = {}) =>
  listingSchema.parse({
    stock: 'A100',
    year: 1987,
    model: 'Mazda RX7',
    part: 'Transmission',
    description: 'Manual turbo',
    dealer: 'Test Yard',
    price: 500,
    ...changes,
  });
const config = (changes = {}) =>
  monitorSchema.parse({
    name: 'RX7',
    model: 'Mazda RX7',
    part: 'Transmission',
    yearStart: 1986,
    yearEnd: 1988,
    zip: '01545',
    ...changes,
  });
function setup() {
  const store = new Store(':memory:');
  return { store, m: store.putMonitor(config()) };
}

test('deduplication separates stock reused for different parts and normalizes casing', () => {
  assert.notEqual(fingerprint(part()), fingerprint(part({ part: 'Engine' })));
  assert.equal(fingerprint(part()), fingerprint(part({ dealer: ' test yard ' })));
});
test('baseline is quiet, zero-dollar prices persist, duplicate imports do not duplicate alerts', () => {
  const { store, m } = setup();
  try {
    store.ingest(m, [part({ price: 0 }), part({ price: 0 })], Date.now(), 0);
    assert.equal(store.inventory().total, 1);
    assert.equal(store.jobs().length, 0);
    assert.equal(store.inventory().items[0]!.price, 0);
    store.ingest(
      store.monitor(m.id)!,
      [part({ price: 0 }), part({ stock: 'B200' })],
      Date.now(),
      0,
    );
    assert.equal(store.jobs().length, 1);
    store.ingest(
      store.monitor(m.id)!,
      [part({ price: 0 }), part({ stock: 'B200' })],
      Date.now(),
      0,
    );
    assert.equal(store.jobs().length, 1);
  } finally {
    store.close();
  }
});
test('per-monitor prices produce alerts for every matching monitor', () => {
  const { store, m } = setup();
  try {
    const second = store.putMonitor(config({ name: 'Second' }));
    store.ingest(m, [part()], Date.now(), 0);
    store.ingest(second, [part()], Date.now(), 0);
    for (const monitor of store.monitors()) {
      const result = store.ingest(monitor, [part({ price: 400 })], Date.now(), 0);
      assert.equal(result.drops, 1);
    }
    assert.equal(store.jobs().length, 2);
    assert.equal(store.inventory().total, 1);
    assert.equal(store.detail(fingerprint(part()))!.history.length, 2);
  } finally {
    store.close();
  }
});
test('partial snapshots and failures cannot age inventory; three complete misses do', () => {
  const { store, m } = setup();
  try {
    store.ingest(m, [part()], Date.now(), 0);
    store.ingest(m, [], Date.now(), 0, false);
    store.failure(m, Date.now(), 'offline');
    assert.equal(store.inventory().total, 1);
    for (let i = 0; i < 2; i++) store.ingest(m, [], Date.now(), 0, true);
    assert.equal(store.inventory().total, 1);
    store.ingest(m, [], Date.now(), 0, true);
    assert.equal(store.inventory().total, 0);
    assert.equal(store.inventory({ active: false }).total, 1);
  } finally {
    store.close();
  }
});
test('filters handle unknowns, exclusions, condition and distance', () => {
  assert.equal(matches(part({ price: null }), config({ allowUnknownPrice: false })), false);
  assert.equal(
    matches(part(), config({ include: 'manual,turbo', exclude: 'automatic', maxPrice: 500 })),
    true,
  );
  assert.equal(matches(part({ state: 'NY' }), config({ states: 'MA,CT' })), false);
  assert.equal(matches(part({ grade: 'C' }), config({ grades: 'A,B' })), false);
  assert.equal(matches(part({ distance: 200 }), config({ maxDistance: 100 })), false);
  assert.equal(matches(part({ miles: null }), config({ allowUnknownMiles: false })), false);
});
test('transaction rolls back all changes on an interrupted inventory write', () => {
  const { store, m } = setup();
  try {
    store.db.exec(
      "CREATE TRIGGER fail_test BEFORE INSERT ON listings WHEN json_extract(NEW.data,'$.stock')='BAD' BEGIN SELECT RAISE(ABORT,'failed write'); END;",
    );
    assert.throws(() => store.ingest(m, [part(), part({ stock: 'BAD' })], Date.now(), 0));
    assert.equal(store.inventory().total, 0);
    assert.equal(store.runs().length, 0);
    assert.equal(store.monitor(m.id)!.initialized, false);
  } finally {
    store.close();
  }
});
test('saved listings survive monitor deletion and retention', () => {
  const { store, m } = setup();
  try {
    store.ingest(m, [part()], Date.now(), 0);
    store.save(fingerprint(part()), true, 'Call tomorrow');
    store.removeMonitor(m.id);
    store.exec('UPDATE listings SET last_seen=0');
    store.prune();
    assert.equal(store.inventory({ saved: true, active: false }).total, 1);
    assert.equal(store.detail(fingerprint(part()))!.note, 'Call tomorrow');
  } finally {
    store.close();
  }
});
const row = (columns = 8) =>
  `<table border="1"><tr><td>1987<br>Transmission<br>Mazda RX7</td><td>Manual turbo</td>${columns === 8 ? '<td>82,000</td>' : ''}<td>A</td><td>ST01</td><td>$1,250.50 actual</td><td>Test Yard USA-MA (Boston) 508-555-0100</td><td>42</td></tr></table>`;
test('parser supports 7 and 8 columns, prices, missing dealer locations, and partial pages', () => {
  for (const columns of [7, 8]) {
    const result = parseCarPart(row(columns));
    assert.equal(result.listings[0]!.price, 1250.5);
    assert.equal(result.listings[0]!.miles, columns === 8 ? 82000 : null);
    assert.equal(result.listings[0]!.distance, 42);
  }
  assert.equal(parseCarPart(row().replace('USA-MA (Boston)', '')).listings[0]!.city, '');
  assert.equal(parseCarPart(`${row()}<input name="userPage" value="2">`).complete, false);
  assert.throws(() => parseCarPart('<h1>Service changed</h1>'));
  assert.throws(() => parseCarPart(row().replace('ST01', '')));
  assert.equal(parseCarPart('could not match your request').listings.length, 0);
});
test('network targets and webhooks reject restricted destinations', () => {
  for (const address of [
    '127.0.0.1',
    '10.0.0.1',
    '169.254.169.254',
    '172.16.0.1',
    '192.168.1.2',
    '::1',
    '::ffff:127.0.0.1',
    'fc00::1',
  ])
    assert.equal(privateAddress(address), true);
  assert.equal(privateAddress('8.8.8.8'), false);
  assert.equal(validWebhook('https://discord.com/api/webhooks/123/token'), true);
  assert.equal(validWebhook('https://discord.com.evil.test/api/webhooks/123/token'), false);
  assert.equal(validWebhook('http://discord.com/api/webhooks/123/token'), false);
});
test('Discord rate limits keep jobs durable and respect retry-after', async () => {
  const { store, m } = setup();
  try {
    store.ingest(m, [part()], Date.now(), 0);
    store.ingest(store.monitor(m.id)!, [part({ price: 400 })], Date.now(), 0);
    const worker = new Notifications(
      store,
      'https://discord.com/api/webhooks/123/token',
      async () =>
        new Response(JSON.stringify({ retry_after: 30 }), {
          status: 429,
          headers: { 'Content-Type': 'application/json' },
        }),
    );
    const before = Date.now();
    await worker.tick();
    const job = store.jobs()[0]!;
    assert.equal(job.status, 'pending');
    assert.equal(job.attempts, 1);
    assert.ok(job.due >= before + 30000);
    store.exec('UPDATE jobs SET due=0');
    await new Notifications(
      store,
      'https://discord.com/api/webhooks/123/token',
      async (_url, options) => {
        assert.deepEqual(JSON.parse(String(options?.body)).allowed_mentions, { parse: [] });
        return new Response('{}', { status: 200 });
      },
    ).tick();
    assert.equal(store.jobs()[0]!.status, 'sent');
  } finally {
    store.close();
  }
});
test('a permanent Discord failure remains visible and does not retry automatically', async () => {
  const { store, m } = setup();
  try {
    store.ingest(m, [part()], Date.now(), 0);
    store.ingest(store.monitor(m.id)!, [part({ price: 400 })], Date.now(), 0);
    await new Notifications(
      store,
      'https://discord.com/api/webhooks/123/token',
      async () => new Response('', { status: 404 }),
    ).tick();
    assert.equal(store.jobs()[0]!.status, 'failed');
  } finally {
    store.close();
  }
});
test('service serializes scans and releases its lock on failure', async () => {
  const { store, m } = setup();
  let finish: () => void = () => {};
  const providers = new Providers(() => 2);
  providers.scan = async () => {
    await new Promise<void>((r) => (finish = r));
    throw new Error('offline');
  };
  const service = new Service(store, providers);
  const scan = service.scan(m.id);
  await assert.rejects(service.scan(m.id), /already running/);
  finish();
  await assert.rejects(scan, /offline/);
  assert.equal(service.running, null);
  assert.equal(store.monitor(m.id)!.failures, 1);
  store.close();
});
test('API authentication, origin validation, secret redaction, and import validation', async () => {
  const { store, m } = setup();
  const server = createApp(store, new Service(store), 'long-test-token').listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address() as { port: number };
  const url = `http://127.0.0.1:${address.port}`;
  const headers = { Authorization: 'Bearer long-test-token', 'Content-Type': 'application/json' };
  try {
    assert.equal((await fetch(`${url}/api/status`)).status, 401);
    assert.equal(
      (await fetch(`${url}/api/status`, { headers: { ...headers, Origin: 'https://evil.test' } }))
        .status,
      403,
    );
    const response = await fetch(`${url}/api/status`, { headers });
    assert.equal(response.status, 200);
    assert.equal((await response.text()).includes('long-test-token'), false);
    const malformed = await fetch(`${url}/api/monitors/${m.id}/import`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ listings: [part(), { stock: 'bad' }], complete: true }),
    });
    assert.equal(malformed.status, 400);
    assert.equal(store.inventory().total, 0);
    const status = await fetch(`${url}/api/import/config`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        version: 1,
        settings: store.settings(),
        monitors: [config(), { bad: true }],
      }),
    });
    assert.equal(status.status, 400);
    assert.equal(store.monitors().length, 1);
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
    store.close();
  }
});
test('CSV quotes data and neutralizes spreadsheet formulas', () => {
  assert.equal(csvCell('=HYPERLINK("url")'), '"\'=HYPERLINK(""url"")"');
  assert.equal(csvCell('one,two'), '"one,two"');
});
test('restart recovers an interrupted notification without losing payload or attempts', () => {
  const folder = mkdtempSync(join(tmpdir(), 'part-scout-test-'));
  const path = join(folder, 'test.db');
  let store = new Store(path);
  try {
    const m = store.putMonitor(config());
    store.ingest(m, [part()], Date.now(), 0);
    store.ingest(store.monitor(m.id)!, [part({ price: 400 })], Date.now(), 0);
    store.exec("UPDATE jobs SET status='sending',attempts=1");
    store.close();
    store = new Store(path);
    assert.equal(store.jobs()[0]!.status, 'pending');
    assert.equal(store.jobs()[0]!.attempts, 1);
    assert.equal(JSON.parse(store.get('SELECT payload FROM jobs')!.payload).listing.price, 400);
  } finally {
    store.close();
    for (const name of ['test.db', 'test.db-wal', 'test.db-shm'])
      rmSync(join(folder, name), { force: true });
    rmdirSync(folder);
  }
});
test('legacy search conversion keeps variants, pauses imports, and rejects complex cron', () => {
  assert.equal(legacyInterval('00 * * * *'), 60);
  assert.equal(legacyInterval('*/5 * * * *'), 15);
  assert.equal(legacyInterval('0 */2 * * *'), 120);
  assert.throws(() => legacyInterval('0 8 * * 1'));
  const converted = convertLegacy(
    [
      {
        year: 1987,
        model: 'Mazda RX7',
        year_range: [1986, 1988],
        schedule: '0 * * * *',
        discord_webhook: 'secret',
        parts: [
          { type: 'Transmission', variant: 'MT, Turbo' },
          { type: 'Engine', variant: '[ALL]' },
        ],
      },
    ],
    { zip_code: '01545', location: 'boston' },
  );
  assert.equal(converted[0].variant, 'MT, Turbo');
  assert.equal(converted[1].variant, '');
  assert.equal(converted[0].enabled, false);
  assert.equal(JSON.stringify(converted).includes('secret'), false);
});
test('demo workspaces never deliver sample inventory to Discord', async () => {
  const { store, m } = setup();
  let calls = 0;
  try {
    store.ingest(m, [part()], Date.now(), 0);
    store.ingest(store.monitor(m.id)!, [part({ price: 400 })], Date.now(), 0);
    store.exec("INSERT INTO meta VALUES('demo','true')");
    await new Notifications(store, 'https://discord.com/api/webhooks/123/token', async () => {
      calls++;
      return new Response('{}');
    }).tick();
    assert.equal(calls, 0);
  } finally {
    store.close();
  }
});
test('authorized adapter follows provider pages and marks page-limit results partial', async () => {
  const original = process.env.CAR_PART_ENABLED;
  process.env.CAR_PART_ENABLED = 'true';
  const { store, m } = setup();
  try {
    const pages: number[] = [];
    const provider = new Providers(
      () => 0,
      async (_url, options) => {
        const page = Number((options!.body as URLSearchParams).get('userPage'));
        pages.push(page);
        return new Response(
          page === 1 ? `${row()}<a href="?userPage=2">Next</a>` : row().replace('ST01', 'ST02'),
        );
      },
    );
    const result = await provider.scan({ ...m, provider: 'carpart', pageLimit: 5 });
    assert.equal(result.listings.length, 2);
    assert.equal(result.complete, true);
    assert.deepEqual(pages, [1, 2]);
    const partial = await provider.scan({ ...m, provider: 'carpart', pageLimit: 1 });
    assert.equal(partial.complete, false);
    assert.equal(partial.listings.length, 1);
  } finally {
    if (original === undefined) delete process.env.CAR_PART_ENABLED;
    else process.env.CAR_PART_ENABLED = original;
    store.close();
  }
});
test('Discord digests never mix destinations or expose webhook URLs in payloads', async () => {
  const { store, m } = setup();
  const urls: string[] = [];
  try {
    store.setSettings({ ...store.settings(), notificationMode: 'digest' });
    const other = store.putMonitor(config({ name: 'Other channel', destination: 'parts' }));
    for (const monitor of [m, other]) {
      store.ingest(monitor, [part()], Date.now(), 0);
      store.ingest(store.monitor(monitor.id)!, [part({ price: 400 })], Date.now(), 0);
    }
    store.exec('UPDATE jobs SET due=0');
    const worker = new Notifications(
      store,
      '',
      async (url, options) => {
        urls.push(String(url));
        const body = JSON.parse(String(options?.body));
        assert.equal(body.embeds.length, 1);
        assert.equal(String(options?.body).includes('/webhooks/'), false);
        return new Response('{}');
      },
      {
        default: 'https://discord.com/api/webhooks/123/default',
        parts: 'https://discord.com/api/webhooks/456/parts',
      },
    );
    await worker.tick();
    await worker.tick();
    assert.deepEqual(urls, [
      'https://discord.com/api/webhooks/123/default?wait=true',
      'https://discord.com/api/webhooks/456/parts?wait=true',
    ]);
    assert.equal(
      store.jobs().every((j) => j.status === 'sent'),
      true,
    );
  } finally {
    store.close();
  }
});
