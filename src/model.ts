import { z } from 'zod';

const text = z.string().trim().min(1).max(160);
const optionalNumber = z.number().finite().nonnegative().nullable();
export const listingSchema = z.object({
  stock: text,
  year: z.number().int().min(1900).max(2100),
  model: text,
  part: text,
  description: z.string().max(2000).default(''),
  dealer: text,
  city: z.string().max(100).default(''),
  state: z.string().max(30).default(''),
  phone: z.string().max(40).default(''),
  price: optionalNumber.default(null),
  miles: optionalNumber.default(null),
  distance: optionalNumber.default(null),
  grade: z.string().max(10).default(''),
  url: z
    .string()
    .url()
    .refine((v) => /^https?:\/\//.test(v))
    .nullable()
    .default(null),
  image: z
    .string()
    .url()
    .refine((v) => /^https:\/\//.test(v))
    .nullable()
    .default(null),
});
export type Listing = z.infer<typeof listingSchema>;
export const monitorSchema = z
  .object({
    name: text,
    model: text,
    part: text,
    yearStart: z.number().int().min(1900).max(2100),
    yearEnd: z.number().int().min(1900).max(2100),
    zip: z.string().regex(/^\d{5}$/),
    region: z.string().max(60).default(''),
    variant: z.string().max(150).default(''),
    provider: z.enum(['import', 'feed', 'carpart']).default('import'),
    feedUrl: z.string().max(1000).default(''),
    intervalMinutes: z.number().int().min(15).max(10080).default(60),
    pageLimit: z.number().int().min(1).max(20).default(5),
    enabled: z.boolean().default(true),
    maxPrice: optionalNumber.default(null),
    maxMiles: optionalNumber.default(null),
    maxDistance: optionalNumber.default(null),
    include: z.string().max(250).default(''),
    exclude: z.string().max(250).default(''),
    states: z.string().max(200).default(''),
    grades: z.string().max(30).default(''),
    allowUnknownPrice: z.boolean().default(true),
    allowUnknownMiles: z.boolean().default(true),
    allowUnknownDistance: z.boolean().default(true),
    notifyInitial: z.boolean().default(false),
    notifyNew: z.boolean().default(true),
    notifyDrops: z.boolean().default(true),
  })
  .refine((m) => m.yearEnd >= m.yearStart, {
    message: 'Ending year must be at least the starting year.',
  })
  .refine((m) => m.provider !== 'feed' || /^https:\/\//.test(m.feedUrl), {
    message: 'Feed monitors require an HTTPS URL.',
  });
export type MonitorInput = z.infer<typeof monitorSchema>;
export type Monitor = MonitorInput & {
  id: number;
  lastRun: number | null;
  nextRun: number;
  error: string | null;
  failures: number;
  initialized: boolean;
};
export const settingsSchema = z.object({
  paused: z.boolean(),
  retentionDays: z.number().int().min(7).max(3650),
  requestGapSeconds: z.number().int().min(2).max(120),
  notificationMode: z.enum(['instant', 'digest', 'off']),
  digestMinutes: z.number().int().min(5).max(1440),
});
export type Settings = z.infer<typeof settingsSchema>;
export const defaultSettings: Settings = {
  paused: false,
  retentionDays: 90,
  requestGapSeconds: 10,
  notificationMode: 'instant',
  digestMinutes: 60,
};
const tokens = (s: string) =>
  s
    .split(',')
    .map((v) => v.trim().toLowerCase())
    .filter(Boolean);
export function matches(l: Listing, m: MonitorInput): boolean {
  const haystack = `${l.model} ${l.part} ${l.description} ${l.dealer}`.toLowerCase();
  return (
    l.year >= m.yearStart &&
    l.year <= m.yearEnd &&
    l.model.toLowerCase().includes(m.model.toLowerCase()) &&
    l.part.toLowerCase().includes(m.part.toLowerCase()) &&
    (l.price === null ? m.allowUnknownPrice : m.maxPrice === null || l.price <= m.maxPrice) &&
    (l.miles === null ? m.allowUnknownMiles : m.maxMiles === null || l.miles <= m.maxMiles) &&
    (l.distance === null
      ? m.allowUnknownDistance
      : m.maxDistance === null || l.distance <= m.maxDistance) &&
    tokens(m.include).every((s) => haystack.includes(s)) &&
    !tokens(m.exclude).some((s) => haystack.includes(s)) &&
    (!m.states || tokens(m.states).includes(l.state.toLowerCase())) &&
    (!m.grades || tokens(m.grades).includes(l.grade.toLowerCase()))
  );
}
