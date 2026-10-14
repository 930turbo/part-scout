import { performance } from 'node:perf_hooks';
import { Store } from '../src/store.js';
import { listingSchema, monitorSchema } from '../src/model.js';
const store = new Store(':memory:');
const m = store.putMonitor(
  monitorSchema.parse({
    name: 'Benchmark',
    model: 'Mazda RX7',
    part: 'Engine',
    yearStart: 1986,
    yearEnd: 1988,
    zip: '01545',
  }),
);
const listings = Array.from({ length: 10000 }, (_, i) =>
  listingSchema.parse({
    stock: `S${i}`,
    year: 1987,
    model: 'Mazda RX7',
    part: 'Engine',
    dealer: `Yard ${i % 100}`,
    price: 500 + i,
    miles: 100000,
  }),
);
const timed = (name: string, fn: () => void) => {
  const start = performance.now();
  fn();
  console.log(`${name}: ${(performance.now() - start).toFixed(1)} ms`);
};
timed('10,000 listing baseline import', () => {
  store.ingest(m, listings, Date.now(), 0);
});
timed('10,000 unchanged listings', () => {
  store.ingest(store.monitor(m.id)!, listings, Date.now(), 0);
});
timed('100 paginated inventory reads', () => {
  for (let i = 0; i < 100; i++) store.inventory({ page: (i % 20) + 1 });
});
console.log(`Listings: ${store.inventory().total}; duplicate alerts: ${store.jobs().length}`);
store.close();
