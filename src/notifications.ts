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
    private url = process.env.DISCORD_WEBHOOK_URL || '',
    private request: typeof fetch = fetch,
  ) {}
  async tick() {
    if (
      this.running ||
      !this.url ||
      this.store.settings().notificationMode === 'off' ||
      this.store.get("SELECT value FROM meta WHERE key='demo'")?.value === 'true'
    )
      return;
    if (!validWebhook(this.url)) return;
    this.running = true;
    const jobs = this.store.all(
      "SELECT * FROM jobs WHERE status='pending' AND due<=? ORDER BY id LIMIT ?",
      Date.now(),
      this.store.settings().notificationMode === 'digest' ? 10 : 1,
    );
    try {
      if (!jobs.length) return;
      this.store.transaction(() => {
        for (const j of jobs)
          this.store.exec("UPDATE jobs SET status='sending',attempts=attempts+1 WHERE id=?", j.id);
      });
      try {
        const response = await this.request(`${this.url}?wait=true`, {
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
