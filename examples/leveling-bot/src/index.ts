import {
  Client,
  EmbedBuilder,
  Events,
  GatewayIntentBits,
  PermissionFlagsBits,
  type ChatInputCommandInteraction,
  type Guild,
} from 'discord.js';
import { commands } from './commands.ts';
import {
  addXp,
  gainMessageXp,
  getLeaderboard,
  getRank,
  migrate,
  removeLevelRole,
  resetXp,
  rewardRoles,
  setLevelRole,
} from './db.ts';
import { levelForXp, xpForLevel, XP_PER_MESSAGE } from './levels.ts';

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent],
});

async function grantRewards(guild: Guild, userId: string, level: number): Promise<void> {
  const member = await guild.members.fetch(userId);
  for (const { roleId } of await rewardRoles(guild.id, level)) {
    if (!member.roles.cache.has(roleId)) await member.roles.add(roleId);
  }
}

/** レベルが上がっていれば、お知らせを投稿して報酬ロールを付与する。 */
async function handleXpChange(
  guild: Guild,
  send: (content: string) => Promise<unknown>,
  userId: string,
  before: number,
  after: number,
): Promise<void> {
  const level = levelForXp(after);
  if (level <= levelForXp(before)) return;
  await send(`🎉 <@${userId}> さんがレベル ${level} になりました！`);
  await grantRewards(guild, userId, level);
}

client.once(Events.ClientReady, async (ready) => {
  await ready.application.commands.set(commands.map((command) => command.toJSON()));
});

client.on(Events.MessageCreate, async (message) => {
  if (message.author.bot || !message.inGuild()) return;
  const xp = await gainMessageXp(message.guildId, message.author.id);
  if (xp === null) return;
  const send = (content: string) => message.channel.send(content);
  await handleXpChange(message.guild, send, message.author.id, xp - XP_PER_MESSAGE, xp);
});

async function showRank(interaction: ChatInputCommandInteraction<'cached'>): Promise<void> {
  const user = interaction.options.getUser('user') ?? interaction.user;
  const { xp, rank } = await getRank(interaction.guildId, user.id);
  const level = levelForXp(xp);
  const embed = new EmbedBuilder()
    .setTitle(`${user.username} のランク`)
    .addFields(
      { name: 'レベル', value: String(level), inline: true },
      { name: 'XP', value: `${xp} / ${xpForLevel(level + 1)}`, inline: true },
      { name: '順位', value: `#${rank}`, inline: true },
    );
  await interaction.reply({ embeds: [embed] });
}

async function showLeaderboard(interaction: ChatInputCommandInteraction<'cached'>): Promise<void> {
  const rows = await getLeaderboard(interaction.guildId);
  const lines = rows.map((row, i) => `${i + 1}. <@${row.userId}> Lv.${levelForXp(row.xp)} (${row.xp} XP)`);
  const embed = new EmbedBuilder()
    .setTitle('ランキング')
    .setDescription(lines.join('\n') || 'まだ誰も XP を獲得していません');
  await interaction.reply({ embeds: [embed] });
}

async function manageXp(interaction: ChatInputCommandInteraction<'cached'>): Promise<void> {
  const { guild, guildId, options } = interaction;
  const user = options.getUser('user', true);
  if (options.getSubcommand() === 'reset') {
    await resetXp(guildId, user.id);
    await interaction.reply(`${user.username} の XP をリセットしました`);
    return;
  }
  const amount = options.getInteger('amount', true);
  const xp = await addXp(guildId, user.id, amount);
  await interaction.reply(`${user.username} に ${amount} XP を加算しました（合計 ${xp} XP）`);
  const send = (content: string) => interaction.followUp(content);
  await handleXpChange(guild, send, user.id, xp - amount, xp);
}

async function manageLevelRole(interaction: ChatInputCommandInteraction<'cached'>): Promise<void> {
  const { guildId, options } = interaction;
  const level = options.getInteger('level', true);
  if (options.getSubcommand() === 'remove') {
    const removed = await removeLevelRole(guildId, level);
    await interaction.reply(removed ? `レベル ${level} の報酬を解除しました` : `レベル ${level} に報酬はありません`);
    return;
  }
  const role = options.getRole('role', true);
  await setLevelRole(guildId, level, role.id);
  await interaction.reply(`レベル ${level} の報酬を ${role.name} に設定しました`);
}

client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand() || !interaction.inCachedGuild()) return;
  const isAdminCommand = interaction.commandName === 'xp' || interaction.commandName === 'levelrole';
  if (isAdminCommand && !interaction.memberPermissions.has(PermissionFlagsBits.ManageGuild)) {
    await interaction.reply({ content: 'このコマンドを使う権限がありません', flags: 64 });
    return;
  }
  switch (interaction.commandName) {
    case 'rank':
      return showRank(interaction);
    case 'leaderboard':
      return showLeaderboard(interaction);
    case 'xp':
      return manageXp(interaction);
    case 'levelrole':
      return manageLevelRole(interaction);
  }
});

await migrate();
await client.login(process.env.DISCORD_TOKEN);
