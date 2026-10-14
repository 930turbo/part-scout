import { REST, Routes } from 'discord.js';
import { command } from './commands.js';
if (
  !process.env.DISCORD_BOT_TOKEN ||
  !process.env.DISCORD_APPLICATION_ID ||
  !process.env.DISCORD_GUILD_ID
)
  throw new Error('Set Discord token, application ID, and guild ID.');
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
