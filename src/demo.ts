import { Store } from './store.js';
import { listingSchema, monitorSchema } from './model.js';

const path = process.env.DATABASE_PATH || 'data/demo.db';
if (!path.endsWith('demo.db'))
  throw new Error(
    'Demo seeding requires a database named demo.db. It never writes to your production database.',
  );
const store = new Store(path);
if (store.monitors().length) {
  console.log(`Demo already exists at ${path}`);
  store.close();
} else {
  const configurations = [
    {
      name: 'RX-7 · Drivetrain',
      model: 'Mazda RX7',
      part: 'Transmission',
      yearStart: 1986,
      yearEnd: 1988,
      zip: '01545',
      region: 'boston',
      maxPrice: 1500,
    },
    {
      name: '911 · Body & trim',
      model: 'Porsche 911',
      part: 'Hood',
      yearStart: 1984,
      yearEnd: 1989,
      zip: '01545',
      region: 'boston',
    },
    {
      name: 'E30 · Engine',
      model: 'BMW 325i',
      part: 'Engine',
      yearStart: 1987,
      yearEnd: 1991,
      zip: '01545',
      region: 'boston',
      maxPrice: 2500,
    },
  ];
  const dealers = [
    ['Pine Hill Auto Recycling', 'Worcester', 'MA'],
    ['Northeast Auto Parts', 'Hartford', 'CT'],
    ['Valley Auto Salvage', 'Springfield', 'MA'],
    ['Granite State Recyclers', 'Concord', 'NH'],
  ];
  let stock = 100;
  for (const [index, config] of configurations.entries()) {
    const m = store.putMonitor(
      monitorSchema.parse({ ...config, provider: 'import', intervalMinutes: 60 }),
    );
    const listings = Array.from({ length: index === 0 ? 8 : 6 }, (_, i) => {
      const dealer = dealers[i % dealers.length]!;
      return listingSchema.parse({
        year: config.yearStart + (i % 3),
        model: config.model,
        part: config.part,
        description:
          index === 0
            ? '5-speed manual · naturally aspirated'
            : index === 1
              ? 'Original steel hood · straight panel'
              : 'M20B25 · complete long block',
        price: index === 0 ? 425 + i * 65 : index === 1 ? 550 + i * 100 : 950 + i * 175,
        miles: index === 1 ? null : 82000 + i * 6700,
        grade: i % 3 === 0 ? 'B' : 'A',
        stock: `S${stock++}`,
        dealer: dealer[0],
        city: dealer[1],
        state: dealer[2],
        distance: 22 + i * 16,
        phone: '',
        image: null,
        url: null,
      });
    });
    store.ingest(m, listings, Date.now(), 1800);
    const now = Date.now();
    store
      .inventory({ monitor: m.id })
      .items.forEach((listing, i) =>
        store.exec(
          'UPDATE listings SET first_seen=? WHERE id=?',
          now - (i * 3 + index + 1) * 3600000,
          listing.id,
        ),
      );
    const first = store.inventory({ monitor: m.id }).items[0]!;
    store.save(first.id, true, 'Sample note: confirm compatibility before ordering.');
    for (let day = 6; day >= 1; day--)
      store.exec(
        "INSERT INTO runs(monitor_id,name,started,duration,status,seen,added,drops) VALUES(?,?,?,?,'success',?,?,?)",
        m.id,
        m.name,
        now - day * 86400000,
        1600 + day * 180,
        listings.length,
        ((day + index) % 5) + 1,
        day % 3 === 0 ? 1 : 0,
      );
    const changed = listings.map((l, i) => ({ ...l, price: i === 0 ? l.price! - 75 : l.price }));
    store.ingest(store.monitor(m.id)!, changed, Date.now(), 1600);
  }
  store.exec("INSERT OR REPLACE INTO meta VALUES('demo','true')");
  console.log(`Seeded sample workspace at ${path}. Start with DATABASE_PATH=${path}.`);
  store.close();
}
