import { InteractionContextType, MessageFlags, SlashCommandBuilder } from 'discord.js';
import { parseYoutubeUrl, play } from '../music.ts';
import type { Command } from '../types.ts';

export default {
  data: new SlashCommandBuilder()
    .setName('play')
    .setDescription('接続中のボイスチャンネルで YouTube の音声を再生します')
    .setContexts(InteractionContextType.Guild)
    .addStringOption((option) => option.setName('url').setDescription('YouTube の URL').setRequired(true)),

  async execute(interaction) {
    const url = parseYoutubeUrl(interaction.options.getString('url', true));
    if (!url) {
      await interaction.reply({ content: 'YouTube の URL を指定してください', flags: MessageFlags.Ephemeral });
      return;
    }
    const { channel } = interaction.member.voice;
    if (!channel) {
      await interaction.reply({ content: '先にボイスチャンネルへ接続してください', flags: MessageFlags.Ephemeral });
      return;
    }
    await interaction.deferReply();
    const title = await play(channel, url);
    await interaction.editReply({ content: `再生します: ${title}`, allowedMentions: { parse: [] } });
  },
} satisfies Command;
