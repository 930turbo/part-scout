import { Client, GatewayIntentBits, Events, MessageFlags, REST, Routes } from 'discord.js';
import { command } from './commands.js';
import { Store } from './store.js';
export type BotConfig = {
  botToken: string;
  applicationId: string;
  guildId: string;
  userIds: string;
  botEnabled: boolean;
};
export class BotManager {
  private client?: Client;
  private starting = false;
  constructor(
    private store: Store,
    private config: () => BotConfig,
    private base: () => string,
    private adminToken: string,
  ) {}
  async start() {
    if (this.starting) throw new Error('Bot connection is already starting.');
    this.starting = true;
    try {
      this.stop();
      const config = this.config();
      const users = new Set(
        config.userIds
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean),
      );
      if (!config.botToken || !config.applicationId || !config.guildId || !users.size)
        throw new Error('Set bot token, application ID, guild ID, and allowed user IDs.');
      const rest = new REST({ timeout: 15000 }).setToken(config.botToken);
      const route = Routes.applicationGuildCommands(config.applicationId, config.guildId);
      const existing = (await rest.get(route)) as { id: string; name: string }[];
      const scout = existing.find((c) => c.name === 'scout');
      if (scout) await rest.patch(`${route}/${scout.id}`, { body: command.toJSON() });
      else await rest.post(route, { body: command.toJSON() });
      const client = (this.client = new Client({ intents: [GatewayIntentBits.Guilds] }));
      client.on(Events.Error, () =>
        this.store.setMeta('botStatus', {
          connected: false,
          error: 'Discord gateway connection failed. Reconnect the bot.',
        }),
      );
      client.on(Events.InteractionCreate, async (interaction) => {
        if (!interaction.isChatInputCommand() || interaction.commandName !== 'scout') return;
        try {
          if (interaction.guildId !== config.guildId || !users.has(interaction.user.id)) {
            await interaction.reply({
              content: 'You do not have access to this garage.',
              flags: MessageFlags.Ephemeral,
            });
            return;
          }
          await interaction.deferReply({ flags: MessageFlags.Ephemeral });
          const action = interaction.options.getSubcommand();
          let content = '';
          const api = async (path: string, method = 'GET', body?: unknown) => {
            const response = await fetch(new URL(path, this.base()), {
              method,
              headers: {
                Authorization: `Bearer ${this.adminToken}`,
                'Content-Type': 'application/json',
              },
              signal: AbortSignal.timeout(30000),
              ...(body ? { body: JSON.stringify(body) } : {}),
            });
            const data = (await response.json()) as any;
            if (!response.ok) throw new Error(data.error || 'Request failed');
            return data;
          };
          if (action === 'status') {
            const s = await api('/api/status');
            content = `${s.garage.name}: ${s.total} active matches, ${s.monitors.length} monitors, ${s.deliveries} queued alerts. Scheduler ${s.settings.paused ? 'paused' : 'running'}.`;
          }
          if (action === 'monitors')
            content =
              (await api('/api/monitors'))
                .map((m: any) => `#${m.id} ${m.name} · ${m.enabled ? 'enabled' : 'paused'}`)
                .join('\n') || 'No monitors configured.';
          if (action === 'search') {
            const data = await api(
              `/api/listings?q=${encodeURIComponent(interaction.options.getString('query', true))}&saved=${interaction.options.getBoolean('saved') || false}`,
            );
            content =
              data.items
                .slice(0, 5)
                .map(
                  (l: any) =>
                    `${l.year} ${l.model} · ${l.part} · ${l.price === null ? 'Ask for price' : `${l.currency} ${l.price}`}\n${l.dealer}${l.url ? `\n${l.url}` : ''}`,
                )
                .join('\n\n') || 'No matching parts.';
          }
          if (action === 'scan') {
            await api(
              `/api/monitors/${interaction.options.getInteger('id', true)}/scan?async=true`,
              'POST',
            );
            content = 'Scan started. Results and alerts update when the scan finishes.';
          }
          if (action === 'pause' || action === 'resume') {
            const s = await api('/api/status');
            await api('/api/settings', 'PUT', { ...s.settings, paused: action === 'pause' });
            content = `Scheduler ${action === 'pause' ? 'paused' : 'resumed'}.`;
          }
          await interaction.editReply({
            content: content.slice(0, 1950),
            allowedMentions: { parse: [] },
          });
        } catch (error) {
          if (interaction.deferred || interaction.replied)
            await interaction
              .editReply({
                content: (error instanceof Error ? error.message : 'Command failed').slice(0, 1900),
                allowedMentions: { parse: [] },
              })
              .catch(() => {});
        }
      });
      await client.login(config.botToken);
      this.store.setMeta('botStatus', {
        connected: true,
        error: null,
        name: client.user?.tag || 'Part Scout bot',
      });
      return { ok: true };
    } catch (error) {
      this.stop();
      this.store.setMeta('botStatus', {
        connected: false,
        error: 'Bot connection failed. Check its token, IDs, and guild access.',
      });
      throw new Error('Bot connection failed. Check its token, IDs, and guild access.');
    } finally {
      this.starting = false;
    }
  }
  stop() {
    this.client?.destroy();
    this.client = undefined;
    this.store.setMeta('botStatus', { connected: false, error: null });
  }
}
