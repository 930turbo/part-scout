import { REST, Routes, SlashCommandBuilder } from 'discord.js';
if (
  !process.env.DISCORD_BOT_TOKEN ||
  !process.env.DISCORD_APPLICATION_ID ||
  !process.env.DISCORD_GUILD_ID
)
  throw new Error('Set Discord token, application ID, and guild ID.');
const command = new SlashCommandBuilder()
  .setName('scout')
  .setDescription('Manage your Part Scout instance')
  .addSubcommand((c) => c.setName('status').setDescription('Show inventory and worker status'))
  .addSubcommand((c) => c.setName('monitors').setDescription('List configured monitors'))
  .addSubcommand((c) =>
    c
      .setName('search')
      .setDescription('Search inventory')
      .addStringOption((o) =>
        o
          .setName('query')
          .setDescription('Model, part, recycler, or stock number')
          .setRequired(true),
      )
      .addBooleanOption((o) => o.setName('saved').setDescription('Only saved listings')),
  )
  .addSubcommand((c) =>
    c
      .setName('scan')
      .setDescription('Run a monitor now')
      .addIntegerOption((o) =>
        o.setName('id').setDescription('Monitor ID').setMinValue(1).setRequired(true),
      ),
  )
  .addSubcommand((c) => c.setName('pause').setDescription('Pause scheduled scans'))
  .addSubcommand((c) => c.setName('resume').setDescription('Resume scheduled scans'));
// Update only this application's /scout command; preserve its other guild commands.
const rest = new REST().setToken(process.env.DISCORD_BOT_TOKEN);
const route = Routes.applicationGuildCommands(
  process.env.DISCORD_APPLICATION_ID,
  process.env.DISCORD_GUILD_ID,
);
const existing = (await rest.get(route)) as { id: string; name: string }[];
const scout = existing.find((c) => c.name === 'scout');
if (scout) await rest.patch(`${route}/${scout.id}`, { body: command.toJSON() });
else await rest.post(route, { body: command.toJSON() });
console.log('Registered /scout in the configured guild.');
