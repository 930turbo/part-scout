import { randomBytes, createCipheriv, createDecipheriv } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { Store } from './store.js';
import { validWebhook, webhookDestinations } from './notifications.js';
import { z } from 'zod';

export const connectionSchema = z.object({
  webhookUrl: z.string().max(1500).default(''),
  ebayClientId: z.string().max(500).default(''),
  ebayClientSecret: z.string().max(500).default(''),
  ebayAccessToken: z.string().max(5000).default(''),
  applicationId: z
    .string()
    .regex(/^\d{15,22}$|^$/)
    .default(''),
  botToken: z.string().max(500).default(''),
  guildId: z
    .string()
    .regex(/^\d{15,22}$|^$/)
    .default(''),
  userIds: z
    .string()
    .max(1000)
    .refine((v) => !v || v.split(',').every((id) => /^\d{15,22}$/.test(id.trim())))
    .default(''),
  botEnabled: z.boolean().default(false),
  carPartEnabled: z.boolean().default(false),
  feedHosts: z.string().max(2000).default(''),
  disconnectDiscord: z.boolean().default(false),
  disconnectEbay: z.boolean().default(false),
});
type Secrets = {
  webhookUrl?: string;
  ebayClientId?: string;
  ebayClientSecret?: string;
  ebayAccessToken?: string;
  botToken?: string;
};
export class Connections {
  private key?: Buffer;
  constructor(
    private store: Store,
    private directory: string,
    private codec?: { encrypt: (s: string) => Buffer; decrypt: (b: Buffer) => string },
  ) {}
  private getKey() {
    if (this.key) return this.key;
    mkdirSync(this.directory, { recursive: true });
    const path = join(this.directory, '.vault-key');
    if (!existsSync(path)) writeFileSync(path, randomBytes(32), { mode: 0o600, flag: 'wx' });
    return (this.key = readFileSync(path));
  }
  secrets(): Secrets {
    const raw = this.store.getMeta<string>('secrets', '');
    if (!raw) return {};
    try {
      const bytes = Buffer.from(raw, 'base64');
      if (bytes[0] === 1 && this.codec) return JSON.parse(this.codec.decrypt(bytes.subarray(1)));
      if (bytes[0] !== 2) throw new Error('Unsupported vault');
      const cipher = createDecipheriv('aes-256-gcm', this.getKey(), bytes.subarray(1, 13));
      cipher.setAuthTag(bytes.subarray(13, 29));
      return JSON.parse(
        Buffer.concat([cipher.update(bytes.subarray(29)), cipher.final()]).toString(),
      );
    } catch {
      throw new Error(
        'Saved connection credentials could not be unlocked. Restore the original Windows profile or reconnect.',
      );
    }
  }
  save(input: z.infer<typeof connectionSchema>) {
    if (input.webhookUrl && !validWebhook(input.webhookUrl))
      throw new Error('Enter a complete Discord channel webhook URL.');
    const secrets = this.secrets();
    if (input.disconnectDiscord || (input.webhookUrl && input.webhookUrl !== secrets.webhookUrl))
      this.store.setMeta('discordVerified', null);
    for (const key of [
      'webhookUrl',
      'ebayClientId',
      'ebayClientSecret',
      'ebayAccessToken',
      'botToken',
    ] as const)
      if (input[key]) secrets[key] = input[key];
    if (input.disconnectDiscord) delete secrets.webhookUrl;
    if (input.disconnectEbay) {
      delete secrets.ebayClientId;
      delete secrets.ebayClientSecret;
      delete secrets.ebayAccessToken;
    }
    const plain = JSON.stringify(secrets);
    let bytes: Buffer;
    if (this.codec) bytes = Buffer.concat([Buffer.from([1]), this.codec.encrypt(plain)]);
    else {
      const iv = randomBytes(12);
      const cipher = createCipheriv('aes-256-gcm', this.getKey(), iv);
      const encrypted = Buffer.concat([cipher.update(plain), cipher.final()]);
      bytes = Buffer.concat([Buffer.from([2]), iv, cipher.getAuthTag(), encrypted]);
    }
    this.store.setMeta('secrets', bytes.toString('base64'));
    this.store.setMeta('connections', {
      applicationId: input.applicationId,
      carPartEnabled: input.carPartEnabled,
      feedHosts: input.feedHosts,
      guildId: input.guildId,
      userIds: input.userIds,
      botEnabled: input.botEnabled,
    });
  }
  config() {
    const config = this.store.getMeta('connections', {
      applicationId: '',
      carPartEnabled: false,
      feedHosts: '',
    });
    const secret = this.secrets();
    return {
      ...config,
      carPartEnabled: config.carPartEnabled || process.env.CAR_PART_ENABLED === 'true',
      feedHosts: config.feedHosts || process.env.FEED_HOSTS || '',
      ebayClientId: secret.ebayClientId || process.env.EBAY_CLIENT_ID || '',
      ebayClientSecret: secret.ebayClientSecret || process.env.EBAY_CLIENT_SECRET || '',
      ebayAccessToken: secret.ebayAccessToken || process.env.EBAY_ACCESS_TOKEN || '',
    };
  }
  destinations() {
    const map = webhookDestinations();
    const url = this.secrets().webhookUrl;
    if (url) map.default = url;
    return map;
  }
  botConfig() {
    const c = this.store.getMeta('connections', {
      applicationId: '',
      guildId: '',
      userIds: '',
      botEnabled: false,
    });
    return {
      ...c,
      botToken: this.secrets().botToken || process.env.DISCORD_BOT_TOKEN || '',
      applicationId: c.applicationId || process.env.DISCORD_APPLICATION_ID || '',
      guildId: c.guildId || process.env.DISCORD_GUILD_ID || '',
      userIds: c.userIds || process.env.DISCORD_USER_IDS || '',
    };
  }
  public() {
    const c = this.config();
    return {
      discord: !!this.destinations().default,
      discordVerified: this.store.getMeta('discordVerified', null),
      botStatus: this.store.getMeta('botStatus', { connected: false }),
      guildId: this.botConfig().guildId,
      userIds: this.botConfig().userIds,
      botEnabled: this.botConfig().botEnabled,
      botConfigured: !!this.botConfig().botToken,
      destinations: Object.keys(this.destinations()),
      ebay: !!(c.ebayAccessToken || (c.ebayClientId && c.ebayClientSecret)),
      applicationId: c.applicationId,
      carPartEnabled: c.carPartEnabled,
      feedHosts: c.feedHosts,
      inviteUrl: c.applicationId
        ? `https://discord.com/oauth2/authorize?client_id=${c.applicationId}&scope=bot%20applications.commands&permissions=2048`
        : null,
    };
  }
  async testDiscord(request: typeof fetch = fetch, send = false) {
    const url = this.destinations().default;
    if (!url) throw new Error('Connect a Discord webhook first.');
    const endpoint = new URL(url);
    endpoint.searchParams.set('wait', 'true');
    const response = await request(send ? endpoint : url, {
      method: send ? 'POST' : 'GET',
      redirect: 'error',
      signal: AbortSignal.timeout(15000),
      ...(send
        ? {
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              content: 'Part Scout connection test. Your alert channel is ready.',
              allowed_mentions: { parse: [] },
            }),
          }
        : {}),
    });
    if (!response.ok) throw new Error(`Discord connection failed (HTTP ${response.status}).`);
    const data = (await response.json()) as any;
    const result = {
      ok: true,
      at: Date.now(),
      channelId: data.channel_id || '',
      guildId: data.guild_id || '',
      name: send ? 'Test message delivered' : data.name || 'Discord channel',
    };
    this.store.setMeta('discordVerified', result);
    return result;
  }
}
