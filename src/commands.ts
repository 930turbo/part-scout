import { SlashCommandBuilder } from 'discord.js';
export const command = new SlashCommandBuilder()
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
