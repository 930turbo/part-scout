import * as cheerio from 'cheerio';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { listingSchema, type Listing, type Monitor } from './model.js';

export class ProviderError extends Error {}
export function numberValue(text: string): number | null {
  const value = text.replace(/,/g, '').match(/\d+(?:\.\d+)?/);
  return value ? Number(value[0]) : null;
}
export function parseCarPart(
  html: string,
  currentPage = 1,
): { listings: Listing[]; complete: boolean; nextPage: number | null } {
  if (/could not match your request|no parts found/i.test(html))
    return { listings: [], complete: true, nextPage: null };
  if (/INVALID SELECTION|captcha|access denied|temporarily unavailable/i.test(html))
    throw new ProviderError(
      'The provider rejected this search. Check the query and access permissions.',
    );
  const $ = cheerio.load(html);
  const listings: Listing[] = [];
  let candidates = 0;
  $('table[border="1"] tr').each((_, tr) => {
    const cells = $(tr).find('td');
    if (cells.length !== 7 && cells.length !== 8) return;
    const detail =
      cells
        .eq(0)
        .html()
        ?.split(/<br\s*\/?\s*>/i)
        .map((s) => cheerio.load(s).text().trim()) || [];
    if (!/^\d{4}$/.test(detail[0] || '')) return;
    candidates++;
    const offset = cells.length === 7 ? 1 : 0;
    const dealerText =
      cells
        .eq(6 - offset)
        .text()
        .split('Request_Quote')[0]
        ?.trim() || '';
    const location = dealerText.match(/USA-([A-Z]{2})\s*\(([^)]+)\)/);
    const phone = dealerText.match(/(?:\+1[-\s]?)?\(?\d{3}\)?[-.\s]\d{3}[-.\s]\d{4}/)?.[0] || '';
    const priceText = cells.eq(5 - offset).text();
    const rawImage = $(tr).find('img').attr('src');
    const image = rawImage && /^https:\/\//i.test(rawImage) ? rawImage : null;
    const rawLink = cells
      .eq(6 - offset)
      .find('a[href^="http"]')
      .attr('href');
    const result = listingSchema.safeParse({
      stock: cells
        .eq(4 - offset)
        .text()
        .trim(),
      year: Number(detail[0]),
      part: detail[1],
      model: detail.slice(2).join(' '),
      description: cells.eq(1).text().split('Estimated CO2e')[0]?.trim(),
      dealer: dealerText.split(/USA-/)[0]?.replace(phone, '').trim(),
      city: location?.[2] || '',
      state: location?.[1] || '',
      phone,
      price: priceText.includes('$') ? numberValue(priceText) : null,
      miles: cells.length === 8 ? numberValue(cells.eq(2).text()) : null,
      grade: cells
        .eq(3 - offset)
        .text()
        .trim()
        .slice(0, 1),
      distance: numberValue(cells.eq(7 - offset).text()),
      image,
      url: rawLink || null,
    });
    if (result.success) listings.push(result.data);
  });
  if (!candidates)
    throw new ProviderError('Unrecognized results page. Inventory was left unchanged.');
  if (listings.length !== candidates)
    throw new ProviderError('Some result rows could not be parsed. Inventory was left unchanged.');
  // A page with more pages is partial: do not age listings that were not on this page.
  const targets = [...html.matchAll(/userPage=(\d+)/gi)].map((match) => Number(match[1]));
  $('input[name="userPage"],select[name="userPage"] option').each((_, el) => {
    const value = Number($(el).attr('value'));
    if (Number.isInteger(value)) targets.push(value);
  });
  const later = targets.filter((page) => page > currentPage && page <= 1000);
  const nextPage = later.length ? Math.min(...later) : null;
  const hasNextLabel = $('a')
    .toArray()
    .some((a) => /^next\b/i.test($(a).text().trim()));
  return { listings, complete: nextPage === null && !hasNextLabel, nextPage };
}
export const privateAddress = (ip: string) => {
  if (ip.includes(':')) return !/^2[0-9a-f]{3}:/i.test(ip) || /^2001:(?:0:|db8:)/i.test(ip);
  const [a, b] = ip.split('.').map(Number);
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 169 && b === 254) ||
    (a === 172 && b! >= 16 && b! <= 31) ||
    (a === 192 && (b === 168 || b === 0)) ||
    (a === 100 && b! >= 64 && b! <= 127) ||
    a! >= 224 ||
    (a === 198 && (b === 18 || b === 19))
  );
};
export async function validateFeedUrl(raw: string) {
  const url = new URL(raw);
  const allowed = (process.env.FEED_HOSTS || '')
    .split(',')
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean);
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    (url.port && url.port !== '443') ||
    !allowed.includes(url.hostname) ||
    isIP(url.hostname)
  )
    throw new ProviderError('Feed host must be an allowed HTTPS hostname. Configure FEED_HOSTS.');
  const addresses = await lookup(url.hostname, { all: true });
  if (!addresses.length || addresses.some((a) => privateAddress(a.address)))
    throw new ProviderError('Feed host resolves to a restricted address.');
  return url;
}
export async function responseText(response: Response, limit = 5_000_000): Promise<string> {
  if (!response.ok) throw new ProviderError(`Provider returned HTTP ${response.status}.`);
  if (Number(response.headers.get('content-length')) > limit)
    throw new ProviderError('Provider response is too large.');
  const reader = response.body?.getReader();
  if (!reader) throw new ProviderError('Empty provider response.');
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) {
      await reader.cancel();
      throw new ProviderError('Provider response is too large.');
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString('utf8');
}
export class Providers {
  nextRequest = 0;
  constructor(
    private gap: () => number,
    private request: typeof fetch = fetch,
  ) {}
  async post(form: URLSearchParams, signal?: AbortSignal) {
    await this.wait();
    return responseText(
      await this.request('https://car-part.com/cgi-bin/search.cgi', {
        method: 'POST',
        body: form,
        redirect: 'error',
        headers: {
          'User-Agent': 'PartScout/1.0 (authorized inventory monitor)',
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        signal: AbortSignal.any([AbortSignal.timeout(30000), ...(signal ? [signal] : [])]),
      }),
    );
  }
  async wait() {
    const delay = Math.max(0, this.nextRequest - Date.now());
    if (delay) await new Promise((r) => setTimeout(r, delay));
    this.nextRequest = Date.now() + this.gap() * 1000;
  }
  async scan(
    m: Monitor,
    signal?: AbortSignal,
  ): Promise<{ listings: Listing[]; complete: boolean }> {
    if (m.provider === 'import')
      throw new ProviderError(
        'This monitor accepts file imports. Import JSON or a saved results page from the dashboard.',
      );
    if (m.provider === 'feed') {
      const url = await validateFeedUrl(m.feedUrl);
      await this.wait();
      const text = await responseText(
        await this.request(url, {
          redirect: 'error',
          signal: AbortSignal.any([AbortSignal.timeout(30000), ...(signal ? [signal] : [])]),
        }),
      );
      const data = JSON.parse(text);
      const raw = Array.isArray(data) ? data : data.listings;
      const listings = listingSchema.array().max(10000).parse(raw);
      return { listings, complete: Array.isArray(data) ? true : data.complete === true };
    }
    if (process.env.CAR_PART_ENABLED !== 'true')
      throw new ProviderError(
        'Car-Part automated access is disabled. Enable the adapter only after obtaining permission.',
      );
    const form = new URLSearchParams({
      userPreference: 'zip',
      userPage: '1',
      userInterchange: 'None',
      userDate: String(m.yearStart),
      userDate2: String(m.yearEnd),
      userSearch: m.variant ? 'int' : 'exact',
      userModel: m.model,
      userPart: m.part,
      userLocation: m.region,
      userZip: m.zip,
    });
    let html = await this.post(form, signal);
    if (m.variant) {
      const $ = cheerio.load(html);
      const choices: string[] = [];
      $('label').each((_, el) => {
        if ($(el).text().toLowerCase().includes(m.variant.toLowerCase())) {
          const id = $(el).attr('for');
          const value = $('input')
            .filter((_, input) => $(input).attr('id') === id)
            .attr('value');
          if (value) choices.push(value);
        }
      });
      if (choices.length !== 1)
        throw new ProviderError(
          'Variant must match exactly one interchange choice. Refine the variant text.',
        );
      $('input[type="hidden"]').each((_, el) => {
        const name = $(el).attr('name');
        if (name?.startsWith('user')) form.set(name, $(el).attr('value') || '');
      });
      form.set('userInterchange', choices[0]!);
      html = await this.post(form, signal);
    }
    let parsed = parseCarPart(html);
    const listings = [...parsed.listings];
    let count = 1;
    let currentPage = 1;
    while (parsed.nextPage !== null && count < (m.pageLimit ?? 5)) {
      currentPage = parsed.nextPage;
      form.set('userPage', String(currentPage));
      parsed = parseCarPart(await this.post(form, signal), currentPage);
      listings.push(...parsed.listings);
      count++;
    }
    return { listings, complete: parsed.complete };
  }
}
