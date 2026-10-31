import { PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';

export const commands = [
  new SlashCommandBuilder()
    .setName('rank')
    .setDescription('レベルと順位を表示します')
    .addUserOption((option) => option.setName('user').setDescription('対象のユーザー')),
  new SlashCommandBuilder().setName('leaderboard').setDescription('XP のランキングを表示します'),
  new SlashCommandBuilder()
    .setName('xp')
    .setDescription('XP を管理します')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand((sub) =>
      sub
        .setName('add')
        .setDescription('XP を加算します')
        .addUserOption((option) => option.setName('user').setDescription('対象のユーザー').setRequired(true))
        .addIntegerOption((option) =>
          option.setName('amount').setDescription('加算する XP').setRequired(true).setMinValue(1),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName('reset')
        .setDescription('XP をリセットします')
        .addUserOption((option) => option.setName('user').setDescription('対象のユーザー').setRequired(true)),
    ),
  new SlashCommandBuilder()
    .setName('levelrole')
    .setDescription('レベルの報酬ロールを管理します')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand((sub) =>
      sub
        .setName('set')
        .setDescription('報酬ロールを設定します')
        .addIntegerOption((option) =>
          option.setName('level').setDescription('レベル').setRequired(true).setMinValue(1),
        )
        .addRoleOption((option) => option.setName('role').setDescription('ロール').setRequired(true)),
    )
    .addSubcommand((sub) =>
      sub
        .setName('remove')
        .setDescription('報酬ロールを解除します')
        .addIntegerOption((option) =>
          option.setName('level').setDescription('レベル').setRequired(true).setMinValue(1),
        ),
    ),
];
