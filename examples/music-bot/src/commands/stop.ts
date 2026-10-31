import { InteractionContextType, MessageFlags, SlashCommandBuilder } from 'discord.js';
import { leave } from '../music.ts';
import type { Command } from '../types.ts';

export default {
  data: new SlashCommandBuilder()
    .setName('stop')
    .setDescription('再生を止めてボイスチャンネルから退出します')
    .setContexts(InteractionContextType.Guild),

  async execute(interaction) {
    if (leave(interaction.guildId)) await interaction.reply('退出しました');
    else await interaction.reply({ content: 'ボイスチャンネルに接続していません', flags: MessageFlags.Ephemeral });
  },
} satisfies Command;
