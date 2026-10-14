import { Client, GatewayIntentBits, Events, MessageFlags } from 'discord.js';
const users = new Set(
  (process.env.DISCORD_USER_IDS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
);
const guild = process.env.DISCORD_GUILD_ID;
if (!process.env.DISCORD_BOT_TOKEN || !guild || !users.size)
  throw new Error('Set DISCORD_BOT_TOKEN, DISCORD_GUILD_ID, and DISCORD_USER_IDS.');
const apiUrl = new URL(process.env.SCOUT_API_URL || 'http://127.0.0.1:4310');
if (!['http:', 'https:'].includes(apiUrl.protocol) || apiUrl.username || apiUrl.password)
  throw new Error('Invalid SCOUT_API_URL');
if (
  apiUrl.protocol !== 'https:' &&
  !['localhost', '127.0.0.1', '[::1]'].includes(apiUrl.hostname) &&
  !(
    process.env.SCOUT_ALLOW_CONTAINER_HTTP === 'true' &&
    apiUrl.hostname === 'scout' &&
    apiUrl.port === '4310'
  )
)
  throw new Error('Remote API connections require HTTPS.');
const client = new Client({ intents: [GatewayIntentBits.Guilds] });
async function api(path: string, method = 'GET', body?: unknown) {
  const response = await fetch(new URL(path, apiUrl), {
    method,
    signal: AbortSignal.timeout(90000),
    headers: {
      Authorization: `Bearer ${process.env.ADMIN_TOKEN || ''}`,
      'Content-Type': 'application/json',
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const data = (await response.json()) as any;
  if (!response.ok) throw new Error(data.error || 'API request failed');
  return data;
}
client.once(Events.ClientReady, (ready) =>
  console.log(`Part Scout bot connected as ${ready.user.tag}`),
);
client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand() || interaction.commandName !== 'scout') return;
  if (interaction.guildId !== guild || !users.has(interaction.user.id)) {
    await interaction.reply({
      content: 'You do not have access to this Part Scout instance.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  try {
    const action = interaction.options.getSubcommand();
    let content = '';
    if (action === 'status') {
      const s = await api('/api/status');
      content = `${s.total} active matches · ${s.monitors.length} monitors · ${s.deliveries} queued alerts\nScheduler: ${s.settings.paused ? 'paused' : 'running'}`;
    }
    if (action === 'monitors') {
      const monitors = await api('/api/monitors');
      content =
        monitors
          .map(
            (m: any) =>
              `#${m.id} ${m.name} · ${m.enabled ? 'enabled' : 'paused'}${m.error ? ' · needs attention' : ''}`,
          )
          .join('\n') || 'No monitors yet. Add one in the dashboard.';
    }
    if (action === 'search') {
      const data = await api(
        `/api/listings?q=${encodeURIComponent(interaction.options.getString('query', true))}&saved=${interaction.options.getBoolean('saved') || false}`,
      );
      content =
        data.items
          .slice(0, 8)
          .map(
            (l: any) =>
              `${l.year} ${l.model} · ${l.part} · ${l.price === null ? 'Ask for price' : `$${l.price}`}\n${l.dealer} · ${l.city}, ${l.state} · Stock ${l.stock}`,
          )
          .join('\n\n') || 'No matches found.';
    }
    if (action === 'scan') {
      const result = await api(
        `/api/monitors/${interaction.options.getInteger('id', true)}/scan`,
        'POST',
      );
      content = `Scan complete: ${result.seen} listings, ${result.added} new matches, ${result.drops} price drops.`;
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
  } catch (e) {
    await interaction.editReply({
      content: (e instanceof Error ? e.message : 'Command failed').slice(0, 1900),
      allowedMentions: { parse: [] },
    });
  }
});
process.on('SIGINT', () => {
  client.destroy();
  process.exit(0);
});
process.on('SIGTERM', () => {
  client.destroy();
  process.exit(0);
});
await client.login(process.env.DISCORD_BOT_TOKEN);
