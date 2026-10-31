import { Events, MessageFlags, type ChatInputCommandInteraction } from 'discord.js';
import { commands } from '../registry.ts';
import type { BotEvent } from '../types.ts';

const FAILURE_MESSAGE = '実行できませんでした';

async function reportFailure(interaction: ChatInputCommandInteraction): Promise<void> {
  if (interaction.deferred || interaction.replied) await interaction.editReply(FAILURE_MESSAGE);
  else await interaction.reply({ content: FAILURE_MESSAGE, flags: MessageFlags.Ephemeral });
}

export default {
  name: Events.InteractionCreate,
  async execute(interaction) {
    if (!interaction.isChatInputCommand() || !interaction.inCachedGuild()) return;
    const command = commands.find(({ data }) => data.name === interaction.commandName);
    try {
      await command?.execute(interaction);
    } catch (error) {
      console.error(error);
      await reportFailure(interaction);
    }
  },
} satisfies BotEvent<Events.InteractionCreate>;
