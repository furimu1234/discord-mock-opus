import { EventEmitter } from 'node:events';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

export type Json = Record<string, any>;

const DISCORD_EPOCH = 1420070400000n;
const ADMINISTRATOR = '8';
const EVERYONE_PERMISSIONS = '2248473465835073';

export const ChannelType = { text: 0, dm: 1, voice: 2, category: 4 } as const;

export interface GuildRecord {
  id: string;
  name: string;
  owner_id: string;
  roles: Json[];
  members: Record<string, Json>;
  joined_at: string;
}

export interface MockState {
  /** Bot のトークン。一度発行したら JSON に保存して使い回す。 */
  token: string;
  /** 起動中の Mock の URL。testClient の接続先になる。 */
  url: string | null;
  applicationId: string;
  botUserId: string;
  users: Record<string, Json>;
  guilds: Record<string, GuildRecord>;
  channels: Record<string, Json>;
  messages: Record<string, Json[]>;
  commands: Json[];
  voiceStates: Record<string, Json>;
  activeUserId: string | null;
}

export interface SeedRole {
  id?: string;
  name: string;
  guild?: string;
  permissions?: string | bigint;
  color?: number;
  hoist?: boolean;
  mentionable?: boolean;
}

export interface SeedChannel {
  id?: string;
  name: string;
  guild?: string;
  type?: keyof typeof ChannelType | number;
  parent?: string;
  topic?: string;
}

export interface SeedUser {
  id?: string;
  username: string;
  globalName?: string;
  avatar?: string | null;
  bot?: boolean;
  guild?: string;
  roles?: string[];
  nick?: string;
}

export interface SeedGuild {
  id?: string;
  name: string;
}

export interface SeedInput {
  guilds?: SeedGuild[];
  roles?: SeedRole[];
  channels?: SeedChannel[];
  users?: SeedUser[];
}

let sequence = 0n;

export function snowflake(): string {
  const timestamp = BigInt(Date.now()) - DISCORD_EPOCH;
  sequence = (sequence + 1n) & 0xfffn;
  return String((timestamp << 22n) | sequence);
}

function emptyState(): MockState {
  const botUserId = snowflake();
  const secret = randomBytes(20).toString('base64url');
  return {
    token: `${Buffer.from(botUserId).toString('base64url')}.mock.${secret}`,
    url: null,
    applicationId: botUserId,
    botUserId,
    users: {
      [botUserId]: {
        id: botUserId,
        username: 'mock-bot',
        discriminator: '0',
        global_name: null,
        avatar: null,
        bot: true,
        system: false,
        public_flags: 0,
      },
    },
    guilds: {},
    channels: {},
    messages: {},
    commands: [],
    voiceStates: {},
    activeUserId: null,
  };
}

/**
 * Discord の全リソースを保持する。変更は `dispatch` イベントとして通知し、
 * Gateway がそれを Bot に配信する。
 */
export class Store extends EventEmitter {
  state: MockState;
  private saveTimer: NodeJS.Timeout | null = null;

  constructor(private readonly file?: string) {
    super();
    this.state = file && existsSync(file) ? this.load(file) : emptyState();
    // ポートの競合などで起動に失敗しても、トークンは発行済みの状態にする。
    this.flush();
  }

  private load(file: string): MockState {
    return { ...emptyState(), ...JSON.parse(readFileSync(file, 'utf8')) };
  }

  /** 起動時に URL を記録し、トークンとともに JSON へ保存する。 */
  published(url: string): void {
    this.state.url = url;
    this.flush();
  }

  get botUser(): Json {
    return this.state.users[this.state.botUserId]!;
  }

  private changed(): void {
    if (!this.file || this.saveTimer) return;
    this.saveTimer = setTimeout(() => this.flush(), 50);
    this.saveTimer.unref();
  }

  flush(): void {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = null;
    if (!this.file) return;
    mkdirSync(dirname(this.file), { recursive: true });
    // トークンを含むため、所有者以外は読めないようにする。
    writeFileSync(this.file, JSON.stringify(this.state, null, 2), { mode: 0o600 });
  }

  private dispatch(event: string, data: Json): void {
    this.emit('dispatch', event, data);
  }

  /** トークンと Bot のユーザー、アプリケーション、登録済みコマンドを残して初期化する。 */
  reset(): void {
    const { token, url, applicationId, botUserId, commands } = this.state;
    const bot = this.botUser;
    this.state = { ...emptyState(), token, url, applicationId, botUserId, commands, users: { [botUserId]: bot } };
    this.changed();
  }

  createUser(input: SeedUser): Json {
    const user = {
      id: input.id ?? snowflake(),
      username: input.username,
      discriminator: '0',
      global_name: input.globalName ?? null,
      avatar: input.avatar ?? null,
      bot: input.bot ?? false,
      system: false,
      public_flags: 0,
    };
    this.state.users[user.id] = user;
    this.changed();
    return user;
  }

  private memberRecord(user: Json, roles: string[], nick?: string): Json {
    return {
      user,
      nick: nick ?? null,
      avatar: null,
      roles,
      joined_at: new Date().toISOString(),
      premium_since: null,
      deaf: false,
      mute: false,
      flags: 0,
      pending: false,
      communication_disabled_until: null,
    };
  }

  createGuild(input: SeedGuild): GuildRecord {
    const id = input.id ?? snowflake();
    const botRoleId = snowflake();
    const guild: GuildRecord = {
      id,
      name: input.name,
      owner_id: this.state.botUserId,
      joined_at: new Date().toISOString(),
      roles: [
        this.roleRecord(id, { name: '@everyone', permissions: EVERYONE_PERMISSIONS }, 0),
        this.roleRecord(botRoleId, { name: this.botUser.username, permissions: ADMINISTRATOR }, 1),
      ],
      members: {},
    };
    guild.members[this.state.botUserId] = this.memberRecord(this.botUser, [botRoleId]);
    this.state.guilds[id] = guild;
    this.changed();
    this.dispatch('GUILD_CREATE', this.guildCreatePayload(guild));
    return guild;
  }

  private roleRecord(id: string, input: SeedRole, position: number): Json {
    return {
      id,
      name: input.name,
      color: input.color ?? 0,
      colors: { primary_color: input.color ?? 0, secondary_color: null, tertiary_color: null },
      hoist: input.hoist ?? false,
      icon: null,
      unicode_emoji: null,
      position,
      permissions: String(input.permissions ?? '0'),
      managed: false,
      mentionable: input.mentionable ?? false,
      flags: 0,
    };
  }

  createRole(guildId: string, input: SeedRole): Json {
    const guild = this.requireGuild(guildId);
    const role = this.roleRecord(input.id ?? snowflake(), input, guild.roles.length);
    guild.roles.push(role);
    this.changed();
    this.dispatch('GUILD_ROLE_CREATE', { guild_id: guildId, role });
    return role;
  }

  createChannel(guildId: string, input: SeedChannel): Json {
    const type = typeof input.type === 'number' ? input.type : ChannelType[input.type ?? 'text'];
    const parent = input.parent ? this.findChannel(guildId, input.parent) : undefined;
    const channel: Json = {
      id: input.id ?? snowflake(),
      type,
      guild_id: guildId,
      name: input.name,
      position: this.guildChannels(guildId).length,
      parent_id: parent?.id ?? null,
      topic: input.topic ?? null,
      nsfw: false,
      last_message_id: null,
      permission_overwrites: [],
      rate_limit_per_user: 0,
      ...(type === ChannelType.voice ? { bitrate: 64000, user_limit: 0 } : {}),
    };
    this.state.channels[channel.id] = channel;
    this.state.messages[channel.id] = [];
    this.changed();
    this.dispatch('CHANNEL_CREATE', channel);
    return channel;
  }

  addMember(guildId: string, userId: string, roles: string[] = [], nick?: string): Json {
    const guild = this.requireGuild(guildId);
    const member = this.memberRecord(this.requireUser(userId), roles, nick);
    guild.members[userId] = member;
    this.changed();
    this.dispatch('GUILD_MEMBER_ADD', { guild_id: guildId, ...member });
    return member;
  }

  setMemberRoles(guildId: string, userId: string, roles: string[]): Json {
    const member = this.requireMember(guildId, userId);
    member.roles = roles;
    this.changed();
    this.dispatch('GUILD_MEMBER_UPDATE', { guild_id: guildId, ...member });
    return member;
  }

  /** ダミーデータをまとめて投入する。ロールとチャンネルは名前で相互に参照できる。 */
  seed(input: SeedInput): Json {
    const guilds = (input.guilds ?? []).map((guild) => this.createGuild(guild));
    const needsGuild = input.roles?.length || input.channels?.length || input.users?.length;
    if (needsGuild && Object.keys(this.state.guilds).length === 0) {
      guilds.push(this.createGuild({ name: 'Test Guild' }));
    }
    const resolveGuild = (ref?: string): string => {
      if (!ref) return Object.keys(this.state.guilds)[0]!;
      const found = Object.values(this.state.guilds).find((g) => g.id === ref || g.name === ref);
      if (!found) throw new NotFound(`Unknown guild: ${ref}`);
      return found.id;
    };

    const roles = (input.roles ?? []).map((r) => this.createRole(resolveGuild(r.guild), r));
    const channels = (input.channels ?? []).map((c) => this.createChannel(resolveGuild(c.guild), c));
    const users = (input.users ?? []).map((u) => {
      const user = this.createUser(u);
      if (u.bot !== true || u.guild) {
        const guildId = resolveGuild(u.guild);
        const guild = this.requireGuild(guildId);
        const roleIds = (u.roles ?? []).map((ref) => {
          const role = guild.roles.find((r) => r.id === ref || r.name === ref);
          if (!role) throw new NotFound(`Unknown role: ${ref}`);
          return role.id as string;
        });
        this.addMember(guildId, user.id, roleIds, u.nick);
      }
      return user;
    });
    return { guilds: guilds.map((g) => this.guildPayload(g)), roles, channels, users };
  }

  private findChannel(guildId: string, ref: string): Json | undefined {
    return this.guildChannels(guildId).find((c) => c.id === ref || c.name === ref);
  }

  requireGuild(id: string): GuildRecord {
    const guild = this.state.guilds[id];
    if (!guild) throw new NotFound('Unknown Guild', 10004);
    return guild;
  }

  requireUser(id: string): Json {
    const user = this.state.users[id];
    if (!user) throw new NotFound('Unknown User', 10013);
    return user;
  }

  requireMember(guildId: string, userId: string): Json {
    const member = this.requireGuild(guildId).members[userId];
    if (!member) throw new NotFound('Unknown Member', 10007);
    return member;
  }

  requireChannel(id: string): Json {
    const channel = this.state.channels[id];
    if (!channel) throw new NotFound('Unknown Channel', 10003);
    return channel;
  }

  guildChannels(guildId: string): Json[] {
    return Object.values(this.state.channels).filter((c) => c.guild_id === guildId);
  }

  guildPayload(guild: GuildRecord): Json {
    return {
      id: guild.id,
      name: guild.name,
      icon: null,
      splash: null,
      discovery_splash: null,
      owner_id: guild.owner_id,
      afk_channel_id: null,
      afk_timeout: 300,
      verification_level: 0,
      default_message_notifications: 0,
      explicit_content_filter: 0,
      roles: guild.roles,
      emojis: [],
      stickers: [],
      features: [],
      mfa_level: 0,
      application_id: null,
      system_channel_id: null,
      system_channel_flags: 0,
      rules_channel_id: null,
      vanity_url_code: null,
      description: null,
      banner: null,
      premium_tier: 0,
      premium_subscription_count: 0,
      preferred_locale: 'en-US',
      public_updates_channel_id: null,
      nsfw_level: 0,
      premium_progress_bar_enabled: false,
    };
  }

  guildCreatePayload(guild: GuildRecord): Json {
    const members = Object.values(guild.members);
    return {
      ...this.guildPayload(guild),
      joined_at: guild.joined_at,
      large: false,
      unavailable: false,
      member_count: members.length,
      voice_states: Object.values(this.state.voiceStates).filter((v) => v.guild_id === guild.id),
      members,
      channels: this.guildChannels(guild.id),
      threads: [],
      presences: [],
      stage_instances: [],
      guild_scheduled_events: [],
    };
  }

  /** ボットとユーザーの間の DM チャンネルを取得し、なければ作成する。 */
  dmChannel(userId: string): Json {
    const existing = Object.values(this.state.channels).find(
      (c) => c.type === ChannelType.dm && c.recipients[0].id === userId,
    );
    if (existing) return existing;
    const channel = {
      id: snowflake(),
      type: ChannelType.dm,
      last_message_id: null,
      recipients: [this.requireUser(userId)],
    };
    this.state.channels[channel.id] = channel;
    this.state.messages[channel.id] = [];
    this.changed();
    return channel;
  }

  /** ユーザーの DM を返す。DM の閲覧には、そのユーザーでのログインが必要。 */
  dmsFor(userId: string): Json[] {
    if (this.state.activeUserId !== userId) {
      throw new Forbidden('DM を閲覧するには宛先のユーザーでログインしてください');
    }
    const channel = Object.values(this.state.channels).find(
      (c) => c.type === ChannelType.dm && c.recipients[0].id === userId,
    );
    return channel ? (this.state.messages[channel.id] ?? []) : [];
  }

  createMessage(channelId: string, author: Json, input: Json, extra: Json = {}): Json {
    const channel = this.requireChannel(channelId);
    const content = String(input.content ?? '');
    const mentions = [...content.matchAll(/<@!?(\d+)>/g)]
      .map((match) => this.state.users[match[1]!])
      .filter((user): user is Json => Boolean(user));
    const referenceId = input.message_reference?.message_id as string | undefined;
    const referenced = referenceId
      ? this.state.messages[channelId]?.find((m) => m.id === referenceId)
      : undefined;
    const guildId = channel.guild_id as string | undefined;
    const message: Json = {
      id: snowflake(),
      channel_id: channelId,
      ...(guildId ? { guild_id: guildId } : {}),
      author,
      content,
      timestamp: new Date().toISOString(),
      edited_timestamp: null,
      tts: Boolean(input.tts),
      mention_everyone: false,
      mentions,
      mention_roles: [...content.matchAll(/<@&(\d+)>/g)].map((match) => match[1]),
      attachments: input.attachments ?? [],
      embeds: input.embeds ?? [],
      components: input.components ?? [],
      reactions: [],
      pinned: false,
      type: referenced ? 19 : 0,
      flags: input.flags ?? 0,
      ...(referenced ? { message_reference: input.message_reference, referenced_message: referenced } : {}),
      ...extra,
    };
    if (guildId && author.id !== undefined) {
      const member = this.state.guilds[guildId]?.members[author.id as string];
      if (member) {
        const { user: _user, ...partial } = member;
        message.member = partial;
      }
    }
    (this.state.messages[channelId] ??= []).push(message);
    channel.last_message_id = message.id;
    this.changed();
    if (((message.flags as number) & 64) === 0) this.dispatch('MESSAGE_CREATE', message);
    return message;
  }

  findMessage(channelId: string, messageId: string): Json {
    const message = this.state.messages[channelId]?.find((m) => m.id === messageId);
    if (!message) throw new NotFound('Unknown Message', 10008);
    return message;
  }

  editMessage(channelId: string, messageId: string, patch: Json): Json {
    const message = this.findMessage(channelId, messageId);
    for (const key of ['content', 'embeds', 'components', 'attachments', 'flags']) {
      if (patch[key] !== undefined) message[key] = patch[key];
    }
    message.edited_timestamp = new Date().toISOString();
    this.changed();
    this.dispatch('MESSAGE_UPDATE', message);
    return message;
  }

  deleteMessage(channelId: string, messageId: string): void {
    const messages = this.state.messages[channelId] ?? [];
    const message = this.findMessage(channelId, messageId);
    messages.splice(messages.indexOf(message), 1);
    this.changed();
    this.dispatch('MESSAGE_DELETE', {
      id: messageId,
      channel_id: channelId,
      ...(message.guild_id ? { guild_id: message.guild_id } : {}),
    });
  }

  addReaction(channelId: string, messageId: string, userId: string, emoji: string): void {
    const message = this.findMessage(channelId, messageId);
    const reaction = message.reactions.find((r: Json) => r.emoji.name === emoji);
    if (reaction) reaction.count += 1;
    else {
      message.reactions.push({
        count: 1,
        count_details: { burst: 0, normal: 1 },
        me: userId === this.state.botUserId,
        me_burst: false,
        burst_colors: [],
        emoji: { id: null, name: emoji },
      });
    }
    this.changed();
    this.dispatch('MESSAGE_REACTION_ADD', {
      user_id: userId,
      channel_id: channelId,
      message_id: messageId,
      ...(message.guild_id ? { guild_id: message.guild_id } : {}),
      emoji: { id: null, name: emoji },
      type: 0,
      burst: false,
    });
  }

  setCommands(commands: Json[], guildId?: string): Json[] {
    const others = this.state.commands.filter((c) => (c.guild_id ?? undefined) !== guildId);
    const saved = commands.map((command) => this.commandRecord(command, guildId));
    this.state.commands = [...others, ...saved];
    this.changed();
    return saved;
  }

  addCommand(command: Json, guildId?: string): Json {
    const existing = this.state.commands.find(
      (c) => c.name === command.name && (c.guild_id ?? undefined) === guildId,
    );
    const saved = { ...this.commandRecord(command, guildId), ...(existing ? { id: existing.id } : {}) };
    this.state.commands = [...this.state.commands.filter((c) => c !== existing), saved];
    this.changed();
    return saved;
  }

  private commandRecord(command: Json, guildId?: string): Json {
    return {
      id: command.id ?? snowflake(),
      application_id: this.state.applicationId,
      type: command.type ?? 1,
      version: snowflake(),
      default_member_permissions: null,
      description_localizations: null,
      name_localizations: null,
      nsfw: false,
      options: [],
      ...command,
      ...(guildId ? { guild_id: guildId } : {}),
    };
  }

  /** ボイスチャンネルの接続状態を更新し、`VOICE_STATE_UPDATE` を配信する。 */
  setVoiceState(guildId: string, userId: string, channelId: string | null, sessionId: string): Json {
    const member = this.requireMember(guildId, userId);
    const voiceState = {
      guild_id: guildId,
      channel_id: channelId,
      user_id: userId,
      member,
      session_id: sessionId,
      deaf: false,
      mute: false,
      self_deaf: false,
      self_mute: false,
      self_video: false,
      suppress: false,
      request_to_speak_timestamp: null,
    };
    if (channelId) this.state.voiceStates[`${guildId}:${userId}`] = voiceState;
    else delete this.state.voiceStates[`${guildId}:${userId}`];
    this.changed();
    this.dispatch('VOICE_STATE_UPDATE', voiceState);
    return voiceState;
  }
}

export class NotFound extends Error {
  readonly status = 404;
  constructor(
    message: string,
    readonly code = 0,
  ) {
    super(message);
  }
}

export class Forbidden extends Error {
  readonly status = 403;
  readonly code = 50001;
}
