import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  Client,
  EmbedBuilder,
  Events,
  GatewayIntentBits,
  SlashCommandBuilder,
} from 'discord.js';
import { addNote, addScore, countNotes, findTag, getLevel, levelUp, saveTag, topScore } from './stores.ts';

const commands = [
  new SlashCommandBuilder().setName('ping').setDescription('Ping'),
  new SlashCommandBuilder().setName('whoami').setDescription('Show the caller'),
  new SlashCommandBuilder().setName('levelup').setDescription('Level up'),
  new SlashCommandBuilder().setName('level').setDescription('Show level'),
  new SlashCommandBuilder().setName('slow').setDescription('Deferred reply'),
  new SlashCommandBuilder().setName('silent').setDescription('Never replies'),
  new SlashCommandBuilder().setName('confirm').setDescription('Show a button'),
  new SlashCommandBuilder()
    .setName('note')
    .setDescription('Add a note')
    .addStringOption((option) => option.setName('body').setDescription('Body').setRequired(true)),
  new SlashCommandBuilder()
    .setName('tag')
    .setDescription('Tags')
    .addSubcommand((sub) =>
      sub
        .setName('set')
        .setDescription('Save a tag')
        .addStringOption((option) => option.setName('name').setDescription('Name').setRequired(true))
        .addStringOption((option) => option.setName('content').setDescription('Content').setRequired(true)),
    )
    .addSubcommand((sub) =>
      sub
        .setName('get')
        .setDescription('Read a tag')
        .addStringOption((option) => option.setName('name').setDescription('Name').setRequired(true)),
    ),
  new SlashCommandBuilder()
    .setName('score')
    .setDescription('Add a score')
    .addIntegerOption((option) => option.setName('value').setDescription('Value').setRequired(true)),
  new SlashCommandBuilder().setName('top').setDescription('Show the top score'),
  new SlashCommandBuilder()
    .setName('dm')
    .setDescription('Send a DM')
    .addUserOption((option) => option.setName('target').setDescription('Target').setRequired(true)),
  new SlashCommandBuilder()
    .setName('hasrole')
    .setDescription('Check a role')
    .addRoleOption((option) => option.setName('role').setDescription('Role').setRequired(true)),
];

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.DirectMessages,
  ],
});

client.once(Events.ClientReady, async (ready) => {
  await ready.application.commands.set(commands.map((command) => command.toJSON()));
});

client.on(Events.MessageCreate, async (message) => {
  if (message.author.bot) return;
  if (message.content === '!hello') await message.reply(`Hello, ${message.author.username}!`);
});

client.on(Events.InteractionCreate, async (interaction) => {
  if (interaction.isButton()) {
    await interaction.update({ content: `Confirmed by ${interaction.user.username}`, components: [] });
    return;
  }
  if (!interaction.isChatInputCommand()) return;
  const { user, options } = interaction;

  switch (interaction.commandName) {
    case 'ping':
      await interaction.reply({
        embeds: [new EmbedBuilder().setTitle('Pong').setDescription(interaction.channel?.id ?? '')],
      });
      break;
    case 'whoami':
      await interaction.reply(`You are ${user.username}`);
      break;
    case 'levelup':
      await interaction.reply(`Level ${await levelUp(user.id)}`);
      break;
    case 'level':
      await interaction.reply(`Level ${await getLevel(user.id)}`);
      break;
    case 'slow':
      await interaction.deferReply();
      await interaction.editReply('Finished');
      break;
    case 'silent':
      break;
    case 'confirm': {
      const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId('confirm').setLabel('OK').setStyle(ButtonStyle.Primary),
      );
      await interaction.reply({ content: 'Are you sure?', components: [row] });
      break;
    }
    case 'note': {
      await addNote(user.id, options.getString('body', true));
      await interaction.reply(`Notes: ${await countNotes(user.id)}`);
      break;
    }
    case 'tag': {
      const name = options.getString('name', true);
      if (options.getSubcommand() === 'set') {
        saveTag(name, options.getString('content', true));
        await interaction.reply('Saved');
      } else {
        await interaction.reply(findTag(name) ?? 'Not found');
      }
      break;
    }
    case 'score':
      await addScore(user.username, options.getInteger('value', true));
      await interaction.reply('Recorded');
      break;
    case 'top':
      await interaction.reply(`Top: ${await topScore()}`);
      break;
    case 'dm':
      await options.getUser('target', true).send('Secret message');
      await interaction.reply({ content: 'Sent', flags: 64 });
      break;
    case 'hasrole': {
      const role = options.getRole('role', true);
      const member = await interaction.guild!.members.fetch(user.id);
      await interaction.reply(member.roles.cache.has(role.id) ? 'Yes' : 'No');
      break;
    }
  }
});

await client.login(process.env.DISCORD_TOKEN);
