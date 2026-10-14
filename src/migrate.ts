import { readFileSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { Store } from './store.js';
import { monitorSchema } from './model.js';
export function legacyInterval(cron: string): number {
  const pieces = cron.trim().split(/\s+/);
  if (pieces.length !== 5) throw new Error(`Unsupported legacy schedule: ${cron}`);
  const [minute, hour, day, month, weekday] = pieces;
  if (day !== '*' || month !== '*' || weekday !== '*')
    throw new Error(`Unsupported legacy schedule: ${cron}. Set a fixed interval in the dashboard.`);
  if (/^\*\/\d+$/.test(minute!) && hour === '*') return Math.max(15, Number(minute!.slice(2)));
  if (/^\d+$/.test(minute!) && hour === '*') return 60;
  if (/^\d+$/.test(minute!) && /^\*\/\d+$/.test(hour!)) return Number(hour!.slice(2)) * 60;
  if (/^\d+$/.test(minute!) && /^\d+$/.test(hour!)) return 1440;
  throw new Error(`Unsupported legacy schedule: ${cron}. Set a fixed interval in the dashboard.`);
}
export function convertLegacy(vehicles: any[], config: { zip_code: string; location?: string }) {
  return vehicles.flatMap((vehicle) =>
    vehicle.parts.map((part: any) =>
      monitorSchema.parse({
        name: `${vehicle.year} ${vehicle.model} · ${part.type}${part.variant && part.variant !== '[ALL]' ? ` · ${part.variant}` : ''}`,
        model: vehicle.model,
        part: part.type,
        yearStart: vehicle.year_range?.[0] ?? vehicle.year,
        yearEnd: vehicle.year_range?.[1] ?? vehicle.year,
        zip: config.zip_code,
        region: config.location || '',
        variant: part.variant === '[ALL]' ? '' : part.variant || '',
        intervalMinutes: legacyInterval(vehicle.schedule || '0 * * * *'),
        provider: 'carpart',
        enabled: false,
      }),
    ),
  );
}
if (process.argv[1]?.endsWith('migrate.ts') || process.argv[1]?.endsWith('migrate.js')) {
  const directory = resolve(process.argv[2] || '../car-part-monitor-original');
  const monitorFile = join(directory, 'monitors.json');
  const configFile = join(directory, 'config.json');
  if (!existsSync(monitorFile) || !existsSync(configFile))
    throw new Error('Provide the original folder containing monitors.json and config.json.');
  const converted = convertLegacy(
    JSON.parse(readFileSync(monitorFile, 'utf8')),
    JSON.parse(readFileSync(configFile, 'utf8')),
  );
  const store = new Store();
  const existing = new Set(store.monitors().map((m) => m.name));
  store.transaction(() => {
    for (const m of converted)
      if (!existing.has(m.name)) {
        store.exec('INSERT INTO monitors(config) VALUES(?)', JSON.stringify(m));
        existing.add(m.name);
      }
  });
  console.log(
    `Converted ${converted.length} searches. Imported monitors are paused; review them in the dashboard. Webhook secrets were not copied.`,
  );
  store.close();
}
