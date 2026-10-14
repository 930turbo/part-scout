import { Store } from './store.js';
export function validWebhook(raw: string) {
  try {
    const u = new URL(raw);
    return (
      u.protocol === 'https:' &&
      ['discord.com', 'discordapp.com'].includes(u.hostname) &&
      !u.username &&
      !u.password &&
      !u.port &&
      /^\/api(?:\/v\d+)?\/webhooks\/\d+\/[\w-]+$/.test(u.pathname)
    );
  } catch {
    return false;
  }
}
export function webhookDestinations(
  defaultUrl = process.env.DISCORD_WEBHOOK_URL || '',
): Record<string, string> {
  const destinations: Record<string, string> = Object.create(null);
  if (process.env.DISCORD_WEBHOOKS_JSON) {
    let entries: unknown;
    try {
      entries = JSON.parse(process.env.DISCORD_WEBHOOKS_JSON);
    } catch {
      throw new Error(
        'DISCORD_WEBHOOKS_JSON must be a JSON object of destination names and webhook URLs.',
      );
    }
    if (
      !entries ||
      typeof entries !== 'object' ||
      Array.isArray(entries) ||
      Object.keys(entries).length > 50
    )
      throw new Error('Configure at most 50 named Discord destinations.');
    for (const [name, url] of Object.entries(entries)) {
      if (!/^[a-zA-Z0-9_-]{1,40}$/.test(name) || typeof url !== 'string' || !validWebhook(url))
        throw new Error('Each Discord destination needs a valid name and Discord webhook URL.');
      destinations[name] = url;
    }
  }
  if (validWebhook(defaultUrl)) destinations.default = defaultUrl;
  return destinations;
}
const money = (n: number | null) =>
  n === null
    ? 'Ask for price'
    : `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const clean = (s: string, max = 1000) => s.replace(/([*_`~|>\\])/g, '\\$1').slice(0, max);
export function embed(payload: any) {
  const l = payload.listing;
  return {
    title:
      `${payload.kind === 'price-drop' ? 'Price drop' : 'New match'} · ${l.year} ${l.model}`.slice(
        0,
        256,
      ),
    description: clean(`${l.part}\n${l.description}`),
    color: 0x4b806b,
    ...(l.url ? { url: l.url } : {}),
    ...(l.image ? { thumbnail: { url: l.image } } : {}),
    fields: [
      {
        name: 'Price',
        value:
          payload.kind === 'price-drop'
            ? `${money(payload.previousPrice)} → ${money(l.price)}`
            : money(l.price),
        inline: true,
      },
      {
        name: 'Condition',
        value: `Grade ${clean(l.grade || '—')} · ${l.miles === null ? 'Mileage unknown' : `${l.miles.toLocaleString()} mi`}`,
        inline: true,
      },
      {
        name: 'Recycler',
        value: clean(
          `${l.dealer}\n${[l.city, l.state].filter(Boolean).join(', ')}\n${l.phone || ''}`,
        ),
      },
      { name: 'Monitor / stock', value: clean(`${payload.monitor} / ${l.stock}`) },
    ],
    timestamp: new Date().toISOString(),
  };
}
export class Notifications {
  running = false;
  constructor(
    private store: Store,
    url = process.env.DISCORD_WEBHOOK_URL || '',
    private request: typeof fetch = fetch,
    private destinations: Record<string, string> = webhookDestinations(url),
  ) {}
  async tick() {
    if (
      this.running ||
      !Object.keys(this.destinations).length ||
      this.store.settings().notificationMode === 'off' ||
      this.store.get("SELECT value FROM meta WHERE key='demo'")?.value === 'true'
    )
      return;
    this.running = true;
    const first = this.store.get(
      "SELECT * FROM jobs WHERE status='pending' AND due<=? ORDER BY id LIMIT 1",
      Date.now(),
    );
    if (!first) {
      this.running = false;
      return;
    }
    const destination = JSON.parse(first.payload).destination || 'default';
    const url = this.destinations[destination];
    if (!url) {
      this.store.exec(
        "UPDATE jobs SET status='failed',error=? WHERE id=?",
        'Discord destination is not configured. Restore it, then retry.',
        first.id,
      );
      this.running = false;
      return;
    }
    const jobs = this.store.all(
      "SELECT * FROM jobs WHERE status='pending' AND due<=? AND COALESCE(json_extract(payload,'$.destination'),'default')=? ORDER BY id LIMIT ?",
      Date.now(),
      destination,
      this.store.settings().notificationMode === 'digest' ? 10 : 1,
    );
    try {
      if (!jobs.length) return;
      this.store.transaction(() => {
        for (const j of jobs)
          this.store.exec("UPDATE jobs SET status='sending',attempts=attempts+1 WHERE id=?", j.id);
      });
      try {
        const endpoint = new URL(url);
        endpoint.searchParams.set('wait', 'true');
        const response = await this.request(endpoint.toString(), {
          method: 'POST',
          redirect: 'error',
          signal: AbortSignal.timeout(15000),
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            allowed_mentions: { parse: [] },
            embeds: jobs.map((j) => embed(JSON.parse(j.payload))),
          }),
        });
        if (response.ok) {
          this.store.transaction(() => {
            for (const j of jobs)
              this.store.exec("UPDATE jobs SET status='sent',error=NULL WHERE id=?", j.id);
          });
          return;
        }
        let retryAfter = Number(response.headers.get('retry-after'));
        if (response.status === 429) {
          const body = (await response.json().catch(() => ({}))) as { retry_after?: number };
          retryAfter = Number(body.retry_after) || retryAfter || 5;
        }
        const permanent =
          response.status >= 400 && response.status < 500 && response.status !== 429;
        for (const j of jobs)
          this.retry(j, `Discord HTTP ${response.status}`, permanent, retryAfter);
      } catch {
        for (const j of jobs)
          this.retry(j, 'Discord delivery failed. Check connectivity and configuration.', false);
      }
    } finally {
      this.running = false;
    }
  }
  private retry(j: any, error: string, permanent: boolean, retryAfter = 0) {
    const failed = permanent || j.attempts + 1 >= 8;
    const seconds = Math.max(retryAfter || 0, Math.min(3600, 5 * 2 ** j.attempts)) + Math.random();
    this.store.exec(
      'UPDATE jobs SET status=?,due=?,error=? WHERE id=?',
      failed ? 'failed' : 'pending',
      Date.now() + seconds * 1000,
      error,
      j.id,
    );
  }
}
