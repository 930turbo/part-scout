import { listingSchema, type Listing, type Monitor } from './model.js';
export type ProviderConfig = {
  carPartEnabled?: boolean;
  feedHosts?: string;
  ebayClientId?: string;
  ebayClientSecret?: string;
  ebayAccessToken?: string;
};
export function ebayListing(item: any, monitor: Monitor): Listing {
  const aspects = Object.fromEntries(
    (item.localizedAspects || []).map((a: any) => [String(a.name), String(a.value)]),
  );
  const title = String(item.title || '');
  const matchYear = title.match(/\b(?:19|20)\d{2}\b/);
  const range = title.match(/\b((?:19|20)\d{2})\s*[-–]\s*((?:19|20)\d{2})\b/);
  const candidate = range
    ? Math.max(Number(range[1]), monitor.yearStart) <= Math.min(Number(range[2]), monitor.yearEnd)
      ? Math.max(Number(range[1]), monitor.yearStart)
      : Number(range[1])
    : Number(matchYear?.[0] || monitor.yearStart);
  const year = Number(aspects.Year || candidate);
  const images = [
    ...new Set(
      [item.image?.imageUrl, ...(item.additionalImages || []).map((i: any) => i.imageUrl)].filter(
        (v: any) => typeof v === 'string' && v.startsWith('https://'),
      ),
    ),
  ] as string[];
  const price = item.price || item.currentBidPrice;
  return listingSchema.parse({
    stock: String(item.itemId),
    sourceId: String(item.itemId),
    source: 'eBay',
    year,
    model: monitor.model,
    part: monitor.part,
    description: title,
    dealer: item.seller?.username || 'eBay seller',
    city: item.itemLocation?.city || '',
    state: item.itemLocation?.stateOrProvince || '',
    price: price ? Number(price.value) : null,
    currency: price?.currency || 'USD',
    condition: item.condition || '',
    url: item.itemWebUrl || null,
    sellerUrl: item.seller?.username
      ? `https://www.ebay.com/usr/${encodeURIComponent(item.seller.username)}`
      : null,
    image: images[0] || null,
    images,
    buyingOptions: (item.buyingOptions || []).filter((v: string) =>
      ['FIXED_PRICE', 'AUCTION', 'BEST_OFFER'].includes(v),
    ),
    shipping: item.shippingOptions?.[0]?.shippingCost
      ? Number(item.shippingOptions[0].shippingCost.value)
      : null,
    endsAt: item.itemEndDate || '',
    raw: item,
    attributes: {
      ...aspects,
      Fitment: 'Keyword search match; confirm compatibility with the seller',
      ...(item.seller?.feedbackPercentage
        ? { 'Seller feedback': `${item.seller.feedbackPercentage}%` }
        : {}),
      ...(matchYear ? {} : { 'Vehicle year': 'Search criterion; confirm fitment with seller' }),
    },
  });
}
export class Ebay {
  private token = '';
  private expires = 0;
  private credentialKey = '';
  constructor(
    private config: () => ProviderConfig,
    private request: typeof fetch = fetch,
  ) {}
  async accessToken(signal?: AbortSignal) {
    const c = this.config();
    if (c.ebayAccessToken) return c.ebayAccessToken;
    if (!c.ebayClientId || !c.ebayClientSecret)
      throw new Error('Connect your eBay API credentials in Settings to scan eBay.');
    const key = `${c.ebayClientId}:${c.ebayClientSecret}`;
    if (this.token && Date.now() < this.expires && key === this.credentialKey) return this.token;
    const response = await this.request('https://api.ebay.com/identity/v1/oauth2/token', {
      method: 'POST',
      redirect: 'error',
      signal: AbortSignal.any([AbortSignal.timeout(30000), ...(signal ? [signal] : [])]),
      headers: {
        Authorization: `Basic ${Buffer.from(key).toString('base64')}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        scope: 'https://api.ebay.com/oauth/api_scope',
      }),
    });
    if (!response.ok)
      throw new Error(
        `eBay authentication failed (HTTP ${response.status}). Check your production credentials.`,
      );
    const data = (await response.json()) as any;
    if (!data.access_token) throw new Error('eBay returned no access token.');
    this.token = data.access_token;
    this.expires = Date.now() + (Number(data.expires_in) - 60) * 1000;
    this.credentialKey = key;
    return this.token;
  }
  async scan(monitor: Monitor, wait: () => Promise<void>, signal?: AbortSignal) {
    const token = await this.accessToken(signal);
    const listings: Listing[] = [];
    let total = 0;
    for (let page = 0; page < monitor.pageLimit; page++) {
      await wait();
      const url = new URL('https://api.ebay.com/buy/browse/v1/item_summary/search');
      url.search = new URLSearchParams({
        q: monitor.keywords || `${monitor.model} ${monitor.part}`,
        category_ids: '6030',
        limit: '50',
        offset: String(page * 50),
        fieldgroups: 'EXTENDED',
        filter: 'deliveryCountry:US',
      }).toString();
      const response = await this.request(url, {
        redirect: 'error',
        signal: AbortSignal.any([AbortSignal.timeout(30000), ...(signal ? [signal] : [])]),
        headers: { Authorization: `Bearer ${token}`, 'X-EBAY-C-MARKETPLACE-ID': 'EBAY_US' },
      });
      if (!response.ok) {
        if (response.status === 401) this.expires = 0;
        throw new Error(`eBay inventory request failed (HTTP ${response.status}).`);
      }
      const data = (await response.json()) as any;
      total = Number(data.total) || 0;
      const items = data.itemSummaries || [];
      for (const item of items) listings.push(ebayListing(item, monitor));
      if (!data.next || items.length === 0) return { listings, complete: true };
    }
    return { listings, complete: listings.length >= total };
  }
  async details(sourceId: string, signal?: AbortSignal) {
    if (!/^v1\|\d+\|\d+$/.test(sourceId)) throw new Error('Invalid eBay item ID');
    const token = await this.accessToken(signal);
    const response = await this.request(
      `https://api.ebay.com/buy/browse/v1/item/${encodeURIComponent(sourceId)}`,
      {
        redirect: 'error',
        signal: AbortSignal.any([AbortSignal.timeout(30000), ...(signal ? [signal] : [])]),
        headers: { Authorization: `Bearer ${token}`, 'X-EBAY-C-MARKETPLACE-ID': 'EBAY_US' },
      },
    );
    if (!response.ok) throw new Error(`eBay listing details failed (HTTP ${response.status}).`);
    return await response.json();
  }
  async testAccess() {
    const token = await this.accessToken();
    const response = await this.request(
      'https://api.ebay.com/buy/browse/v1/item_summary/search?q=car%20parts&category_ids=6030&limit=1',
      {
        redirect: 'error',
        signal: AbortSignal.timeout(30000),
        headers: { Authorization: `Bearer ${token}`, 'X-EBAY-C-MARKETPLACE-ID': 'EBAY_US' },
      },
    );
    if (!response.ok)
      throw new Error(
        `eBay Browse access failed (HTTP ${response.status}). Check production API access.`,
      );
    return { ok: true };
  }
}
