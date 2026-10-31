import { Client, Events, GatewayIntentBits } from 'discord.js';
import legacy from './legacy.cjs';

export const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent] });

client.on(Events.MessageCreate, async (message) => {
  if (message.author.bot) return;
  await legacy.visit(message.author.username);
  await message.channel.send(`Visits: ${await legacy.count()}`);
});

client.on(Events.InteractionCreate, async (interaction) => {
  if (interaction.isChatInputCommand()) await interaction.reply(`Hi ${interaction.user.username}`);
});
