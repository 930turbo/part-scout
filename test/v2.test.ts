import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, rmdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import ExcelJS from 'exceljs';
import { Store } from '../src/store.js';
import { Connections, connectionSchema } from '../src/connections.js';
import { Ebay, ebayListing } from '../src/ebay.js';
import {
  monitorSchema,
  listingSchema,
  carSchema,
  checklistSchema,
  defaultSettings,
} from '../src/model.js';
import { monitorWorkbook } from '../src/exports.js';
import { Notifications } from '../src/notifications.js';
import { Providers, parseCarPart } from '../src/providers.js';
import { Service } from '../src/service.js';
import { createApp } from '../src/server.js';
const config = () =>
  monitorSchema.parse({
    name: 'RX7',
    model: 'Mazda RX7',
    part: 'Transmission',
    yearStart: 1986,
    yearEnd: 1988,
    zip: '01545',
  });
const listing = () =>
  listingSchema.parse({
    stock: 'S1',
    year: 1987,
    model: 'Mazda RX7',
    part: 'Transmission',
    dealer: 'Test Seller',
    price: 500,
    url: 'https://seller.example/parts/S1',
    images: ['https://photos.example/1.png', 'https://photos.example/2.png'],
  });
test('connection secrets are encrypted, retained on blank updates, and absent from public metadata', () => {
  const directory = mkdtempSync(join(tmpdir(), 'scout-vault-'));
  const store = new Store(':memory:');
  try {
    const vault = new Connections(store, directory);
    vault.save(
      connectionSchema.parse({
        webhookUrl: 'https://discord.com/api/webhooks/123/test-secret',
        ebayClientId: 'client-id',
        ebayClientSecret: 'ebay-private-secret',
      }),
    );
    assert.equal(vault.destinations().default, 'https://discord.com/api/webhooks/123/test-secret');
    assert.equal(JSON.stringify(vault.public()).includes('secret'), false);
    assert.equal(store.getMeta<string>('secrets', '').includes('secret'), false);
    vault.save(connectionSchema.parse({}));
    assert.equal(vault.secrets().ebayClientSecret, 'ebay-private-secret');
    vault.save(connectionSchema.parse({ disconnectDiscord: true }));
    assert.equal(vault.public().discord, false);
    assert.equal(readFileSync(join(directory, '.vault-key')).length, 32);
  } finally {
    store.close();
    rmSync(join(directory, '.vault-key'), { force: true });
    rmdirSync(directory);
  }
});
test('Discord connection tests verify a real response shape and never enable arbitrary mentions', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'scout-discord-'));
  const store = new Store(':memory:');
  try {
    const vault = new Connections(store, directory);
    vault.save(connectionSchema.parse({ webhookUrl: 'https://discord.com/api/webhooks/123/test' }));
    const result = await vault.testDiscord(async (_url, options) => {
      assert.equal(options?.method, 'POST');
      assert.deepEqual(JSON.parse(String(options?.body)).allowed_mentions, { parse: [] });
      return new Response(JSON.stringify({ channel_id: '12345' }));
    }, true);
    assert.equal(result.channelId, '12345');
    assert.ok(store.getMeta<any>('discordVerified', null).at);
  } finally {
    store.close();
    rmSync(join(directory, '.vault-key'), { force: true });
    rmdirSync(directory);
  }
});
test('phone alerts mention only the explicitly configured user', async () => {
  const store = new Store(':memory:');
  try {
    store.setSettings({ ...defaultSettings, phonePush: true, discordUserId: '123456789012345678' });
    const m = store.putMonitor(config());
    store.ingest(m, [listing()], Date.now(), 0);
    store.ingest(store.monitor(m.id)!, [{ ...listing(), price: 400 }], Date.now(), 0);
    await new Notifications(
      store,
      'https://discord.com/api/webhooks/123/test',
      async (_url, options) => {
        const body = JSON.parse(String(options?.body));
        assert.equal(body.content.includes('<@123456789012345678>'), true);
        assert.deepEqual(body.allowed_mentions, { parse: [], users: ['123456789012345678'] });
        return new Response('{}');
      },
    ).tick();
    assert.equal(store.jobs()[0]!.status, 'sent');
  } finally {
    store.close();
  }
});
test('eBay adapter preserves photos, real seller links, buying options, and raw source fields', () => {
  const m = {
    ...config(),
    id: 1,
    lastRun: null,
    nextRun: 0,
    error: null,
    failures: 0,
    initialized: false,
  };
  const item = {
    itemId: 'v1|123456789|0',
    title: '1986-1988 Mazda RX7 manual transmission',
    price: { value: '550', currency: 'USD' },
    itemWebUrl: 'https://www.ebay.com/itm/123456789',
    image: { imageUrl: 'https://i.ebayimg.com/1.jpg' },
    additionalImages: [{ imageUrl: 'https://i.ebayimg.com/2.jpg' }],
    buyingOptions: ['FIXED_PRICE', 'BEST_OFFER'],
    condition: 'Used',
    seller: { username: 'testseller', feedbackPercentage: '99.8' },
    shippingOptions: [{ shippingCost: { value: '25' } }],
    returnTerms: { returnsAccepted: true },
  };
  const result = ebayListing(item, m);
  assert.equal(result.images.length, 2);
  assert.equal(result.url, item.itemWebUrl);
  assert.equal(result.shipping, 25);
  assert.deepEqual(result.buyingOptions, ['FIXED_PRICE', 'BEST_OFFER']);
  assert.deepEqual(result.raw.returnTerms, { returnsAccepted: true });
});
test('eBay OAuth is cached and inventory pagination is bounded', async () => {
  let tokens = 0,
    pages = 0;
  const ebay = new Ebay(
    () => ({ ebayClientId: 'id', ebayClientSecret: 'secret' }),
    async (url) => {
      if (String(url).includes('oauth2')) {
        tokens++;
        return new Response(JSON.stringify({ access_token: 'token', expires_in: 7200 }));
      }
      pages++;
      return new Response(
        JSON.stringify({
          total: 100,
          next: 'https://api.ebay.com/next',
          itemSummaries: [
            {
              itemId: `v1|${pages}|0`,
              title: '1987 Mazda RX7 Transmission',
              price: { value: '500', currency: 'USD' },
              seller: { username: 'test' },
            },
          ],
        }),
      );
    },
  );
  const m = {
    ...config(),
    provider: 'ebay' as const,
    pageLimit: 2,
    id: 1,
    lastRun: null,
    nextRun: 0,
    error: null,
    failures: 0,
    initialized: false,
  };
  const result = await ebay.scan(m, async () => {});
  assert.equal(result.listings.length, 2);
  assert.equal(result.complete, false);
  await ebay.accessToken();
  assert.equal(tokens, 1);
});
test('garage purchases and photo references persist across a database reopen', () => {
  const directory = mkdtempSync(join(tmpdir(), 'scout-garage-'));
  const path = join(directory, 'test.db');
  let store = new Store(path);
  try {
    const car = store.putCar(
      carSchema.parse({
        nickname: 'Project RX7',
        year: 1987,
        make: 'Mazda',
        model: 'RX7',
        photos: ['/media/car.png'],
      }),
    )!;
    store.putChecklist(
      car.id,
      checklistSchema.parse({
        part: 'Transmission',
        status: 'bought',
        paid: 425,
        seller: 'Recycler',
        purchasedAt: '2026-10-14',
      }),
    );
    store.close();
    store = new Store(path);
    assert.equal(store.cars()[0].photos[0], '/media/car.png');
    assert.equal(store.cars()[0].checklist[0].paid, 425);
    assert.equal(store.cars()[0].checklist[0].status, 'bought');
  } finally {
    store.close();
    for (const name of ['test.db', 'test.db-wal', 'test.db-shm'])
      rmSync(join(directory, name), { force: true });
    rmdirSync(directory);
  }
});
test('Excel export filters per-monitor discovery time and preserves numeric prices and hyperlinks', async () => {
  const store = new Store(':memory:');
  try {
    const m = store.putMonitor(config());
    store.ingest(m, [listing()], Date.now(), 0);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load((await monitorWorkbook(store, m.id, 0, Date.now() + 1000)) as any);
    const sheet = workbook.getWorksheet('Found parts')!;
    assert.equal(sheet.getCell('G6').value, 500);
    assert.deepEqual(sheet.getCell('N6').value, {
      text: 'Open listing',
      hyperlink: 'https://seller.example/parts/S1',
    });
    assert.equal(sheet.rowCount, 6);
    store.exec('UPDATE matches SET first_seen=100');
    const empty = new ExcelJS.Workbook();
    await empty.xlsx.load((await monitorWorkbook(store, m.id, 1000, 2000)) as any);
    assert.equal(empty.getWorksheet('Found parts')!.rowCount, 5);
  } finally {
    store.close();
  }
});
test('Car-Part captures multiple row photos, relative listing links, contact details, and full cell metadata', () => {
  const html =
    '<table border="1"><tr><td>1987<br>Transmission<br>Mazda RX7<a href="/images/parts?id=12"><img src="https://images.example/1.jpg"><img src="https://images.example/2.jpg"></a></td><td>Manual turbo</td><td>82,000</td><td>A</td><td>ST1</td><td>$500</td><td>Test Yard USA-MA (Boston) 508-555-0100<a href="mailto:parts@example.com">Email</a></td><td>42</td></tr></table>';
  const part = parseCarPart(html).listings[0]!;
  assert.equal(part.images.length, 2);
  assert.equal(part.url, 'https://car-part.com/images/parts?id=12');
  assert.equal(part.phone, '508-555-0100');
  assert.equal(part.email, 'parts@example.com');
  assert.equal((part.raw.cells as string[]).length, 8);
});
test('saved connections are picked up by the outbox without restarting', async () => {
  const store = new Store(':memory:');
  let ready = false,
    calls = 0;
  try {
    const m = store.putMonitor(config());
    store.ingest(m, [listing()], Date.now(), 0);
    store.ingest(store.monitor(m.id)!, [{ ...listing(), price: 400 }], Date.now(), 0);
    const worker = new Notifications(
      store,
      '',
      async () => {
        calls++;
        return new Response('{}');
      },
      () => (ready ? { default: 'https://discord.com/api/webhooks/123/test' } : {}),
    );
    await worker.tick();
    assert.equal(calls, 0);
    ready = true;
    await worker.tick();
    assert.equal(calls, 1);
  } finally {
    store.close();
  }
});
test('live event stream reports a completed import and disconnects cleanly', async () => {
  const store = new Store(':memory:');
  const m = store.putMonitor(config()),
    service = new Service(store),
    server = createApp(store, service).listen(0, '127.0.0.1');
  await once(server, 'listening');
  const controller = new AbortController();
  try {
    const url = `http://127.0.0.1:${(server.address() as any).port}`;
    const response = await fetch(`${url}/api/events`, { signal: controller.signal });
    const reader = response.body!.getReader();
    assert.match(new TextDecoder().decode((await reader.read()).value), /data:/);
    store.ingest(m, [listing()], Date.now(), 0);
    const next = new TextDecoder().decode((await reader.read()).value);
    assert.match(next, /"run":1/);
    controller.abort();
  } finally {
    controller.abort();
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    store.close();
  }
});
