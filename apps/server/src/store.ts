import { EventEmitter } from 'node:events';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import {
  AuditLogEvent, ChannelType, DEFAULT_USERS, hasThreads, isForumType, isThreadType, isVoiceType, isWithoutMessages, MessageFlag,
  SystemChannelFlag,
} from './constants.js';
import type { Attachments } from './attachments.js';
import { createPoll } from './polls.js';
import { computePermissions, isSynced, OverwriteType, Permission, type PermissionOverwrite } from './permissions.js';

/** Discord API の JSON オブジェクト。 */
export type Json = Record<string, any>;

const DISCORD_EPOCH = 1420070400000n;
const ADMINISTRATOR = String(Permission.administrator);
const EVERYONE_PERMISSIONS = '2248473465835073';

/** コミュニティサーバーとして扱う。お知らせチャンネルなどの前提になる。 */
const GUILD_FEATURES = ['COMMUNITY', 'NEWS'];
const DEFAULT_AUTO_ARCHIVE_MINUTES = 1440;
const STAGE_PRIVACY_GUILD_ONLY = 2;

const MessageType = { userJoin: 7, threadCreated: 18, threadStarter: 21 };
/** 初期データ。`pnpm web` と `pnpm app` の起動時と、サーバーのリセットで入れる。 */
const DEFAULT_GUILD_NAME = 'テストサーバー';
const DEFAULT_RULES_CHANNEL = 'ルール';
const DEFAULT_UPDATES_CHANNEL = 'モデレーター';
const DEFAULT_CHANNELS: SeedChannel[] = [
  { name: 'テキストチャンネル', type: 'category' },
  { name: '一般', parent: 'テキストチャンネル' },
  { name: DEFAULT_RULES_CHANNEL, parent: 'テキストチャンネル' },
  { name: DEFAULT_UPDATES_CHANNEL, parent: 'テキストチャンネル' },
  { name: 'お知らせ', type: 'announcement', parent: 'テキストチャンネル' },
  { name: 'フォーラム', type: 'forum', parent: 'テキストチャンネル' },
  { name: 'メディア', type: 'media', parent: 'テキストチャンネル' },
  { name: 'ボイスチャンネル', type: 'category' },
  { name: 'ボイス', type: 'voice', parent: 'ボイスチャンネル' },
  { name: 'ステージ', type: 'stage', parent: 'ボイスチャンネル' },
];
const DEFAULT_ADMIN_ROLE: SeedRole = { name: '管理者', permissions: ADMINISTRATOR, color: 0xe67e22, hoist: true };

/** 画面で見られるよう、サーバーごとに保持する監査ログの件数。 */
const MAX_AUDIT_ENTRIES = 500;
/** サーバーの変更で受け付ける項目。 */
const GUILD_FIELDS = [
  'name', 'description', 'system_channel_id', 'system_channel_flags', 'default_message_notifications',
  'verification_level', 'explicit_content_filter', 'afk_channel_id', 'afk_timeout', 'preferred_locale',
];

/** 監査ログの `changes`。前と後で値の違う項目だけを返す。 */
export function auditChanges(before: Json, after: Json, keys: string[]): Json[] {
  return keys
    .filter((key) => JSON.stringify(before[key]) !== JSON.stringify(after[key]))
    .map((key) => ({ key, old_value: before[key], new_value: after[key] }));
}

const pick = (source: Json, keys: string[]) => Object.fromEntries(keys.map((key) => [key, source[key]]));
const ROLE_AUDIT_KEYS = ['name', 'color', 'hoist', 'mentionable', 'permissions'];
const CHANNEL_AUDIT_KEYS = [
  'name', 'type', 'topic', 'nsfw', 'parent_id', 'rate_limit_per_user', 'bitrate', 'user_limit', 'permission_overwrites',
  'default_auto_archive_duration', 'available_tags',
];
const THREAD_AUDIT_KEYS = ['name', 'type', 'rate_limit_per_user', 'applied_tags', 'thread_metadata'];
/** Discord の公開ドキュメントのエラーコード。 */
const ErrorCode = {
  unknownStageInstance: 10067,
  wrongChannelType: 50024,
  archivedThread: 50083,
  threadAlreadyCreated: 160004,
  stageAlreadyOpen: 150006,
};

/** チャンネルの変更で受け付ける項目。 */
const CHANNEL_FIELDS = [
  'name', 'type', 'topic', 'nsfw', 'position', 'parent_id', 'rate_limit_per_user', 'bitrate', 'user_limit', 'rtc_region',
  'permission_overwrites', 'default_auto_archive_duration', 'default_reaction_emoji', 'default_thread_rate_limit_per_user',
  'default_sort_order', 'default_forum_layout', 'flags',
];
const THREAD_FIELDS = ['name', 'rate_limit_per_user', 'flags', 'applied_tags'];
const THREAD_METADATA_FIELDS = ['archived', 'locked', 'auto_archive_duration', 'invitable'];

const withTagIds = (tags: Json[]) => tags.map((tag) => ({ moderated: false, emoji_id: null, emoji_name: null, ...tag, id: tag.id ?? snowflake() }));

export interface GuildRecord {
  id: string;
  name: string;
  owner_id: string;
  roles: Json[];
  members: Record<string, Json>;
  joined_at: string;
  rules_channel_id?: string;
  public_updates_channel_id?: string;
  description?: string | null;
  icon?: string | null;
  system_channel_id?: string | null;
  system_channel_flags?: number;
  default_message_notifications?: number;
  verification_level?: number;
  explicit_content_filter?: number;
  afk_channel_id?: string | null;
  afk_timeout?: number;
  preferred_locale?: string;
  emojis?: Json[];
  stickers?: Json[];
}

/** 管理画面で登録した Bot のフォルダー。 */
export interface BotProject {
  id: string;
  label: string;
  dir: string;
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
  projects: BotProject[];
  /** スレッドの ID ごとの参加者。 */
  threadMembers: Record<string, Json[]>;
  /** ステージチャンネルの ID ごとの開催中のステージ。 */
  stageInstances: Record<string, Json>;
  /** コードごとの招待。 */
  invites: Record<string, Json>;
  /** サーバーの ID ごとの、新しい順の監査ログ。 */
  auditLogs: Record<string, Json[]>;
  /** サーバーの ID ごとの、ユーザーの ID と BAN の組。 */
  bans: Record<string, Record<string, Json>>;
  /** ID ごとの AutoMod のルール。 */
  autoModRules: Record<string, Json>;
  /** アイコン、絵文字、スタンプの画像。ハッシュまたは ID ごとの data URI。 */
  media: Record<string, string>;
  /** メッセージの ID ごとの、選択肢の ID と投票したユーザーの ID。 */
  pollVotes: Record<string, Record<string, string[]>>;
  /** 画面と初期データで作ったものの ID（招待はコード）。Mock を起動し直しても残す。 */
  kept: string[];
  /** ID ごとのウェブフック。お知らせのフォローもウェブフックとして持つ。 */
  webhooks: Record<string, Json>;
  /** メッセージの ID ごとの、リアクションの絵文字（`reactionKey`）と付けたユーザーの ID。 */
  reactionUsers: Record<string, Record<string, string[]>>;
  /** チャンネルの ID ごとの、新しい順のピン留め。 */
  pins: Record<string, { message_id: string; pinned_at: string }[]>;
  /** ボイスチャンネルの ID ごとの、ステータスと通話の開始時刻（Unix 秒）。 */
  voiceChannelInfo: Record<string, { status: string | null; voice_start_time: number | null }>;
  /** ユーザーの ID ごとのプレゼンス。 */
  presences: Record<string, Json>;
  /** ID ごとのイベント。 */
  scheduledEvents: Record<string, Json>;
  /** イベントの ID ごとの、興味ありのユーザーの ID。 */
  scheduledEventUsers: Record<string, string[]>;
  /** ID ごとのサーバーのサウンドボードの音声。 */
  soundboardSounds: Record<string, Json>;
  /** コードごとのサーバーテンプレート。 */
  templates: Record<string, Json>;
  /** コマンドの権限。キーは `サーバーの ID:コマンドの ID`。 */
  commandPermissions: Record<string, Json>;
  /** アプリケーションの絵文字。 */
  applicationEmojis: Json[];
  /** アプリケーションの、Bot が変更できる項目。 */
  application: Json;
  /** アプリケーションのロール連携のメタデータ。 */
  roleConnectionMetadata: Json[];
  /** アプリケーションの ID ごとの、Bot のユーザーのロール連携。 */
  roleConnections: Record<string, Json>;
  /** アプリケーションの SKU。 */
  skus: Json[];
  /** ID ごとのエンタイトルメント。 */
  entitlements: Record<string, Json>;
  /** ID ごとの SKU のサブスクリプション。 */
  subscriptions: Record<string, Json>;
  /** ID ごとのロビー。 */
  lobbies: Record<string, Json>;
  /** ロビーの ID ごとのメッセージ。 */
  lobbyMessages: Record<string, Json[]>;
  /** 招待のコードごとの、招待を使えるユーザーの ID。 */
  inviteTargets: Record<string, string[]>;
}

/** 追加するロール。 */
export interface SeedRole {
  /** ロールの ID。省略すると生成する。同じ ID のロールは追加せず使い回す。 */
  id?: string;
  /** ロールの名前。 */
  name: string;
  /** 追加先のサーバーの ID または名前。 */
  guild?: string;
  /** 権限のビットフィールド。 */
  permissions?: string | bigint;
  /** 表示色。 */
  color?: number;
  /** メンバーリストで分けて表示するか。 */
  hoist?: boolean;
  /** メンションできるか。 */
  mentionable?: boolean;
}

/** 追加するチャンネル。 */
export interface SeedChannel {
  /** チャンネルの ID。省略すると生成する。同じ ID のチャンネルは追加せず使い回す。 */
  id?: string;
  /** チャンネルの名前。 */
  name: string;
  /** 追加先のサーバーの ID または名前。 */
  guild?: string;
  /** チャンネルの種類。既定は `text`。 */
  type?: keyof typeof ChannelType | number;
  /** 親のカテゴリーの ID または名前。スレッドでは親のチャンネル。 */
  parent?: string;
  /** トピック。 */
  topic?: string;
  /** スレッドの作成者の ID。既定は Bot。 */
  owner?: string;
  /** グループ DM の参加者の ID。 */
  recipients?: string[];
  /** フォーラムとメディアのチャンネルのタグ。 */
  available_tags?: Json[];
  /** フォーラムとメディアのチャンネルの投稿の、最初のメッセージ。 */
  message?: Json;
  /** 権限の上書き。省略してカテゴリーに入れると、カテゴリーの権限を引き継ぐ（同期する）。 */
  permission_overwrites?: Json[];
}

/** 追加するダミーユーザー。 */
export interface SeedUser {
  /** ユーザーの ID。省略すると生成する。 */
  id?: string;
  /** ユーザー名。 */
  username: string;
  /** 表示名。 */
  globalName?: string;
  /** アバターのハッシュ。 */
  avatar?: string | null;
  /** Bot のユーザーとして扱うか。 */
  bot?: boolean;
  /** 参加するサーバーの ID または名前。 */
  guild?: string;
  /** 複数のサーバーに参加させるときに指定する。 */
  guilds?: string[];
  /** 付与するロールの ID または名前。 */
  roles?: string[];
  /** サーバーでのニックネーム。 */
  nick?: string;
  /** テストが追加したユーザー。型定義の補完の対象にしない。 */
  temporary?: boolean;
}

/** 追加するサーバー。 */
export interface SeedGuild {
  /** サーバーの ID。省略すると生成する。同じ ID のサーバーは追加せず使い回す。 */
  id?: string;
  /** サーバーの名前。 */
  name: string;
}

/** 一括で追加するダミーデータ。 */
export interface SeedInput {
  /** サーバーを指定しないデータの追加先。省略すると最初のサーバーに追加する。 */
  defaultGuild?: string;
  /** 追加するサーバー。 */
  guilds?: SeedGuild[];
  /** 追加するロール。 */
  roles?: SeedRole[];
  /** 追加するチャンネル。 */
  channels?: SeedChannel[];
  /** 追加するダミーユーザー。 */
  users?: SeedUser[];
}

let sequence = 0n;

/** URL の絵文字（Unicode の絵文字、またはカスタム絵文字の `名前:ID`）を、リアクションの絵文字にする。 */
export function parseEmoji(value: string): Json {
  const custom = /^(?:a:)?([\w~]+):(\d+)$/.exec(value);
  return custom ? { id: custom[2], name: custom[1] } : { id: null, name: value };
}

/** リアクションを区別する値。カスタム絵文字は ID、Unicode の絵文字は絵文字そのもの。 */
export function reactionKey(emoji: Json): string {
  return (emoji.id as string | null) ?? (emoji.name as string);
}

export function snowflake(): string {
  const timestamp = BigInt(Date.now()) - DISCORD_EPOCH;
  sequence = (sequence + 1n) & 0xfffn;
  return String((timestamp << 22n) | sequence);
}

const CUSTOM_TOKEN = /^[\w.-]{16,}$/;

/** URL に入れられる値だけを受け付け、本物の Bot のトークンと同じ形の値は保存しない。 */
function assertCustomToken(token: string): void {
  if (!CUSTOM_TOKEN.test(token)) {
    throw new Error('トークンは英数字、`-`、`_`、`.` を使い、16 文字以上で指定してください');
  }
  const segments = token.split('.');
  if (segments.length === 3 && segments[1] !== 'mock') {
    throw new Error('本物の Bot のトークンと同じ形式の値は Mock のトークンに指定できません');
  }
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
    projects: [],
    threadMembers: {},
    stageInstances: {},
    invites: {},
    webhooks: {},
    auditLogs: {},
    bans: {},
    autoModRules: {},
    media: {},
    pollVotes: {},
    kept: [],
    reactionUsers: {},
    pins: {},
    voiceChannelInfo: {},
    presences: {},
    scheduledEvents: {},
    scheduledEventUsers: {},
    soundboardSounds: {},
    templates: {},
    commandPermissions: {},
    applicationEmojis: [],
    application: {},
    roleConnectionMetadata: [],
    roleConnections: {},
    skus: [],
    entitlements: {},
    subscriptions: {},
    lobbies: {},
    lobbyMessages: {},
    inviteTargets: {},
  };
}

/**
 * Discord の全リソースを保持する。変更は `dispatch` イベントとして通知し、
 * Gateway がそれを Bot に配信する。
 */
export class Store extends EventEmitter {
  state: MockState;
  /** 添付ファイルの保存先。起動時に設定する。 */
  attachments?: Attachments;
  /**
   * 操作したユーザーと監査ログの理由。API の処理の間だけ設定する。
   * `keep` は画面からの操作で、このとき作ったものは Mock を起動し直しても残す。
   */
  actor: { userId: string; reason?: string; keep?: boolean } | null = null;
  /** メッセージの作成前に呼ばれる AutoMod。送信を止めるときは例外を投げ、作成後の処理を返す。 */
  moderate?: (channel: Json, author: Json, message: Json) => ((messageId?: string) => void) | undefined;
  private saveTimer: NodeJS.Timeout | null = null;

  constructor(
    private readonly file?: string,
    token?: string,
  ) {
    super();
    if (token) assertCustomToken(token);
    this.state = file && existsSync(file) ? this.load(file) : emptyState();
    if (token) this.state.token = token;
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

  /** 変更を画面へ通知し、JSON への保存を予約する。 */
  changed(): void {
    this.emit('ui', 'STATE_SYNC', {});
    if (!this.file || this.saveTimer) return;
    this.saveTimer = setTimeout(() => this.flush(), 50);
    this.saveTimer.unref();
  }

  flush(): void {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = null;
    if (!this.file) return;
    mkdirSync(dirname(this.file), { recursive: true });
    // testClient が同時に読むので、書き込み途中の内容が見えないよう置き換える。
    // トークンを含むため、所有者以外は読めないようにする。
    const temporary = `${this.file}.tmp`;
    writeFileSync(temporary, JSON.stringify(this.state, null, 2), { mode: 0o600 });
    renameSync(temporary, this.file);
  }

  private dispatch(event: string, data: Json): void {
    this.emit('dispatch', event, data);
  }

  /** トークンと Bot のユーザー、アプリケーション、登録済みコマンド、Bot プロジェクトを残して初期化する。 */
  reset(): void {
    const { token, url, applicationId, application, botUserId, commands, projects } = this.state;
    const bot = this.botUser;
    this.state = { ...emptyState(), token, url, applicationId, application, botUserId, commands, projects, users: { [botUserId]: bot } };
    this.attachments?.clear();
    this.changed();
  }

  /**
   * サーバーのメッセージとスレッドを消す。チャンネル、ロール、権限、招待、ウェブフックなどは残す。
   * Bot には `MESSAGE_DELETE_BULK` と `THREAD_DELETE` で知らせる。
   */
  resetGuildMessages(guildId: string): void {
    this.requireGuild(guildId);
    for (const thread of this.guildThreads(guildId)) this.deleteChannel(thread.id);
    for (const channel of this.guildChannels(guildId)) {
      const messages = this.state.messages[channel.id] ?? [];
      if (messages.length === 0) continue;
      this.state.messages[channel.id] = [];
      for (const message of messages) delete this.state.reactionUsers[message.id];
      delete this.state.pins[channel.id];
      channel.last_message_id = null;
      this.dispatch('MESSAGE_DELETE_BULK', { ids: messages.map((message) => message.id), channel_id: channel.id, guild_id: guildId });
    }
    this.attachments?.removeGuild(guildId);
    this.changed();
  }

  /**
   * 起動時に、画面と初期データで作ったもの（`kept`）だけを残して消す。
   * テストや Bot が作ったもの、メッセージ、スレッド、添付、ボイスの接続、投票、監査ログ、BAN、登録済みのコマンドは消す。
   */
  clearAll(): void {
    const state = this.state;
    const kept = new Set(state.kept);
    const keep = (id: string) => kept.has(id);
    const users = Object.fromEntries(Object.entries(state.users).filter(([id]) => id === state.botUserId || keep(id)));
    const guilds = Object.fromEntries(Object.entries(state.guilds).filter(([id]) => keep(id)));
    for (const guild of Object.values(guilds)) {
      guild.roles = guild.roles.filter((role) => role.id === guild.id || role.managed || keep(role.id));
      const roleIds = new Set(guild.roles.map((role) => role.id as string));
      guild.members = Object.fromEntries(Object.entries(guild.members).filter(([id]) => users[id]));
      for (const member of Object.values(guild.members)) member.roles = (member.roles as string[]).filter((id) => roleIds.has(id));
      guild.emojis = (guild.emojis ?? []).filter((emoji) => keep(emoji.id));
      guild.stickers = (guild.stickers ?? []).filter((sticker) => keep(sticker.id));
    }
    const channels = Object.fromEntries(Object.entries(state.channels)
      .filter(([id, channel]) => keep(id) && guilds[channel.guild_id] && !isThreadType(channel.type)));
    for (const channel of Object.values(channels)) {
      const guild = guilds[channel.guild_id]!;
      if (channel.parent_id && !channels[channel.parent_id]) channel.parent_id = null;
      channel.last_message_id = null;
      channel.permission_overwrites = (channel.permission_overwrites as PermissionOverwrite[] ?? [])
        .filter((overwrite) => guild.roles.some((role) => role.id === overwrite.id) || guild.members[overwrite.id]);
    }
    for (const guild of Object.values(guilds)) {
      for (const key of ['system_channel_id', 'rules_channel_id', 'public_updates_channel_id', 'afk_channel_id'] as const) {
        if (guild[key] && !channels[guild[key]!]) delete guild[key];
      }
    }
    const media = Object.fromEntries(Object.entries(state.media).filter(([id]) =>
      keep(id) || Object.values(guilds).some((guild) => guild.icon === id)));
    this.state = {
      ...emptyState(),
      token: state.token,
      url: state.url,
      applicationId: state.applicationId,
      application: state.application,
      botUserId: state.botUserId,
      projects: state.projects,
      users,
      guilds,
      channels,
      messages: Object.fromEntries(Object.keys(channels).map((id) => [id, []])),
      invites: Object.fromEntries(Object.entries(state.invites).filter(([code, invite]) => keep(code) && channels[invite.channel_id])),
      webhooks: Object.fromEntries(Object.entries(state.webhooks).filter(([id, webhook]) =>
        keep(id) && channels[webhook.channel_id] && (!webhook.source_channel || channels[webhook.source_channel.id]))),
      autoModRules: Object.fromEntries(Object.entries(state.autoModRules).filter(([id, rule]) => keep(id) && guilds[rule.guild_id])),
      media,
      activeUserId: state.activeUserId && users[state.activeUserId] ? state.activeUserId : null,
    };
    this.state.kept = [...Object.keys(users), ...Object.keys(guilds), ...Object.keys(channels), ...Object.values(guilds).flatMap((guild) => [
      ...guild.roles.map((role) => role.id as string), ...(guild.emojis ?? []).map((emoji) => emoji.id as string), ...(guild.stickers ?? []).map((sticker) => sticker.id as string),
    ]), ...Object.keys(this.state.invites), ...Object.keys(this.state.webhooks), ...Object.keys(this.state.autoModRules)].filter(keep);
    this.attachments?.clear();
    this.flush();
  }

  addProject(label: string, dir: string): BotProject {
    const project = { id: snowflake(), label, dir };
    this.state.projects.push(project);
    this.changed();
    return project;
  }

  removeProject(id: string): void {
    this.state.projects = this.state.projects.filter((project) => project.id !== id);
    this.changed();
  }

  /** テストの区切りを画面に表示する。Bot には通知しない。 */
  addTestDivider(channelId: string, label: string): void {
    this.requireChannel(channelId);
    (this.state.messages[channelId] ??= []).push({
      id: snowflake(),
      channel_id: channelId,
      author: this.botUser,
      content: '',
      timestamp: new Date().toISOString(),
      flags: 0,
      dismock_test: label,
    });
    this.changed();
  }

  /** ダミーデータが 1 件もないとき、画面をすぐ操作できる初期データを入れる。 */
  seedDefaults(): void {
    if (Object.keys(this.state.guilds).length > 0) return;
    // 初期データは画面で作ったものと同じく、起動し直しても残す。
    this.actor = { userId: this.state.botUserId, keep: true };
    try {
      const { users, guilds } = this.seed({ guilds: [{ name: DEFAULT_GUILD_NAME }], users: [...DEFAULT_USERS] });
      this.seedGuildContent(guilds[0].id);
      this.state.activeUserId = users[0].id;
    } finally {
      this.actor = null;
    }
    this.changed();
  }

  /** 初期データのチャンネルとロールを入れる。既定の管理者のユーザーがメンバーなら、管理者のロールを付ける。 */
  private seedGuildContent(guildId: string): void {
    const { channels, roles } = this.seed({
      channels: DEFAULT_CHANNELS.map((channel) => ({ ...channel, guild: guildId })),
      roles: [{ ...DEFAULT_ADMIN_ROLE, guild: guildId }],
    });
    const channelNamed = (name: string) => channels.find((channel: Json) => channel.name === name).id as string;
    Object.assign(this.requireGuild(guildId), {
      rules_channel_id: channelNamed(DEFAULT_RULES_CHANNEL),
      public_updates_channel_id: channelNamed(DEFAULT_UPDATES_CHANNEL),
    });
    const [admin] = DEFAULT_USERS;
    if (this.state.guilds[guildId]?.members[admin.id]) this.setMemberRoles(guildId, admin.id, [roles[0].id]);
  }

  /**
   * サーバーを初期データと同じ状態に戻す。チャンネル（メッセージを含む）、ロール、権限、絵文字、スタンプ、
   * AutoMod、BAN、設定を消して入れ直す。名前、アイコン、説明とメンバーは残す。
   */
  resetGuild(guildId: string): void {
    const guild = this.requireGuild(guildId);
    for (const channel of this.guildChannels(guildId)) {
      if (this.state.channels[channel.id]) this.deleteChannel(channel.id);
    }
    for (const role of guild.roles.filter((candidate) => candidate.id !== guildId && !candidate.managed)) this.deleteRole(guildId, role.id);
    for (const [userId, member] of Object.entries(guild.members)) {
      const kept = (member.roles as string[]).filter((id) => guild.roles.some((role) => role.id === id));
      if (kept.length !== member.roles.length) this.setMemberRoles(guildId, userId, kept);
      if (member.nick || member.communication_disabled_until) this.updateMember(guildId, userId, { nick: null, communication_disabled_until: null });
    }
    for (const id of [...(guild.emojis ?? []), ...(guild.stickers ?? [])].map((item) => item.id as string)) delete this.state.media[id];
    guild.emojis = [];
    guild.stickers = [];
    this.dispatch('GUILD_EMOJIS_UPDATE', { guild_id: guildId, emojis: [] });
    this.dispatch('GUILD_STICKERS_UPDATE', { guild_id: guildId, stickers: [] });
    for (const rule of Object.values(this.state.autoModRules).filter((candidate) => candidate.guild_id === guildId)) {
      delete this.state.autoModRules[rule.id];
      this.dispatch('AUTO_MODERATION_RULE_DELETE', rule);
    }
    for (const { user } of Object.values(this.state.bans[guildId] ?? {})) this.dispatch('GUILD_BAN_REMOVE', { guild_id: guildId, user });
    delete this.state.bans[guildId];
    // イベント、サウンドボード、テンプレートなどは、それぞれのモジュールが消す。
    this.emit('guild-cleared', guildId);
    const { name, icon, description } = guild;
    for (const key of GUILD_FIELDS) delete (guild as Json)[key];
    Object.assign(guild, { name, icon, description });
    this.seedGuildContent(guildId);
    this.dispatch('GUILD_UPDATE', this.guildPayload(guild));
    // リセットの途中の記録は残さない。
    delete this.state.auditLogs[guildId];
    this.changed();
  }

  switchUser(userId: string): void {
    this.requireUser(userId);
    this.state.activeUserId = userId;
    this.changed();
  }

  updateUser(userId: string, patch: Json): Json {
    const user = this.requireUser(userId);
    if (typeof patch.username === 'string') user.username = patch.username;
    if (patch.bot !== undefined) user.bot = Boolean(patch.bot);
    if (patch.avatar !== undefined) user.avatar = patch.avatar;
    this.changed();
    for (const guild of Object.values(this.state.guilds)) {
      const member = guild.members[userId];
      if (member) this.dispatch('GUILD_MEMBER_UPDATE', { guild_id: guild.id, ...member });
    }
    return user;
  }

  deleteUser(userId: string): void {
    if (userId === this.state.botUserId) throw new Error('Bot のユーザーは削除できません');
    const user = this.requireUser(userId);
    for (const guild of Object.values(this.state.guilds)) {
      if (!guild.members[userId]) continue;
      delete guild.members[userId];
      this.dispatch('GUILD_MEMBER_REMOVE', { guild_id: guild.id, user });
    }
    delete this.state.users[userId];
    if (this.state.activeUserId === userId) this.state.activeUserId = null;
    this.changed();
  }

  deleteGuild(guildId: string): void {
    this.requireGuild(guildId);
    for (const channel of Object.values(this.state.channels)) {
      if (channel.guild_id !== guildId) continue;
      delete this.state.channels[channel.id];
      delete this.state.messages[channel.id];
      delete this.state.threadMembers[channel.id];
      delete this.state.stageInstances[channel.id];
      this.removeChannelLinks(channel.id);
    }
    this.emit('guild-cleared', guildId);
    delete this.state.guilds[guildId];
    this.attachments?.removeGuild(guildId);
    this.changed();
    this.dispatch('GUILD_DELETE', { id: guildId, unavailable: false });
  }

  /** 画面からの操作で作ったものを、起動し直しても残すものとして記録する。 */
  markCreated(id: string): void {
    if (this.actor?.keep && !this.state.kept.includes(id)) this.state.kept.push(id);
  }

  /** 監査ログに記録し、`GUILD_AUDIT_LOG_ENTRY_CREATE` を配信する。操作したユーザーは `actor`、なければ Bot。 */
  audit(guildId: string | undefined, actionType: number, targetId: string | null, changes: Json[] = [], options?: Json): void {
    if (!guildId || !this.state.guilds[guildId]) return;
    const entry = {
      id: snowflake(),
      guild_id: guildId,
      user_id: this.actor?.userId ?? this.state.botUserId,
      target_id: targetId,
      action_type: actionType,
      changes,
      ...(this.actor?.reason ? { reason: this.actor.reason } : {}),
      ...(options ? { options } : {}),
    };
    const entries = (this.state.auditLogs[guildId] ??= []);
    entries.unshift(entry);
    entries.length = Math.min(entries.length, MAX_AUDIT_ENTRIES);
    this.changed();
    this.dispatch('GUILD_AUDIT_LOG_ENTRY_CREATE', entry);
  }

  /** data URI の画像を保存し、ハッシュを返す。`null` は画像の削除。 */
  storeImage(data: string | null | undefined): string | null {
    if (!data) return null;
    // discord.js は Buffer を `image/jpg` として送る。
    if (!/^data:image\/(png|jpe?g|gif|webp);base64,/.test(data)) throw new BadRequest('画像は data URI で指定してください', 50035);
    const hash = `${data.startsWith('data:image/gif') ? 'a_' : ''}${randomBytes(16).toString('hex')}`;
    this.state.media[hash] = data;
    return hash;
  }

  updateGuild(guildId: string, patch: Json): Json {
    const guild = this.requireGuild(guildId) as GuildRecord & Json;
    const before = this.guildPayload(guild);
    for (const key of GUILD_FIELDS) {
      if (patch[key] !== undefined) guild[key] = patch[key];
    }
    if (patch.icon !== undefined) {
      if (guild.icon) delete this.state.media[guild.icon];
      guild.icon = this.storeImage(patch.icon);
    }
    const after = this.guildPayload(guild);
    this.changed();
    this.dispatch('GUILD_UPDATE', after);
    this.audit(guildId, AuditLogEvent.guildUpdate, guildId, auditChanges(before, after, [...GUILD_FIELDS, 'icon']));
    return after;
  }

  updateRole(guildId: string, roleId: string, patch: Json): Json {
    const guild = this.requireGuild(guildId);
    const role = guild.roles.find((candidate) => candidate.id === roleId);
    if (!role) throw new NotFound('Unknown Role', 10011);
    const before = pick(role, ROLE_AUDIT_KEYS);
    const { name, color, hoist, mentionable, permissions } = patch;
    if (name !== undefined) role.name = name;
    if (color !== undefined) {
      role.color = color;
      role.colors = { ...role.colors, primary_color: color };
    }
    if (hoist !== undefined) role.hoist = hoist;
    if (mentionable !== undefined) role.mentionable = mentionable;
    if (permissions !== undefined) role.permissions = String(permissions);
    this.changed();
    this.dispatch('GUILD_ROLE_UPDATE', { guild_id: guildId, role });
    const changes = auditChanges(before, role, ROLE_AUDIT_KEYS);
    if (changes.length > 0) this.audit(guildId, AuditLogEvent.roleUpdate, roleId, changes);
    return role;
  }

  updateChannel(channelId: string, patch: Json): Json {
    const channel = this.requireChannel(channelId);
    if (isThreadType(channel.type)) return this.updateThread(channel, patch);
    // 画面でカテゴリーの権限を変えると、同期しているチャンネルも合わせる（Discord のクライアントと同じ）。
    // Bot の API での変更はカテゴリーだけを変える。
    const synced = channel.type === ChannelType.category && patch.permission_overwrites !== undefined && this.actor?.keep
      ? this.syncedChildren(channel)
      : [];
    const before = structuredClone(pick(channel, CHANNEL_AUDIT_KEYS));
    for (const key of CHANNEL_FIELDS) {
      if (patch[key] !== undefined) channel[key] = patch[key];
    }
    if (patch.available_tags !== undefined) channel.available_tags = withTagIds(patch.available_tags);
    this.changed();
    this.dispatch('CHANNEL_UPDATE', channel);
    const changes = auditChanges(before, channel, CHANNEL_AUDIT_KEYS);
    if (changes.length > 0) this.audit(channel.guild_id, AuditLogEvent.channelUpdate, channelId, changes);
    for (const child of synced) this.updateChannel(child.id, { permission_overwrites: structuredClone(channel.permission_overwrites) });
    return channel;
  }

  /** カテゴリーと権限の上書きが同じ（同期している）チャンネル。 */
  private syncedChildren(category: Json): Json[] {
    return Object.values(this.state.channels).filter((channel) => channel.parent_id === category.id && isSynced(channel, category));
  }

  /**
   * チャンネルの並び順とカテゴリーを変える（Modify Guild Channel Positions）。
   * `lock_permissions` はカテゴリーの権限に合わせる。変わったチャンネルだけ `CHANNEL_UPDATE` を配信する。
   */
  reorderChannels(guildId: string, entries: { id: string; position?: number | null; parent_id?: string | null; lock_permissions?: boolean | null }[]): void {
    this.requireGuild(guildId);
    for (const entry of entries) {
      const channel = this.requireChannel(entry.id);
      if (channel.guild_id !== guildId || isThreadType(channel.type)) throw new Error(`Invalid channel: ${entry.id}`);
      const parentId = entry.parent_id === undefined ? channel.parent_id : entry.parent_id;
      if (parentId) {
        const parent = this.requireChannel(parentId);
        if (parent.guild_id !== guildId || parent.type !== ChannelType.category || channel.type === ChannelType.category) {
          throw new Error(`Invalid parent: ${parentId}`);
        }
      }
      const before = JSON.stringify(pick(channel, ['position', 'parent_id', 'permission_overwrites']));
      if (typeof entry.position === 'number') channel.position = entry.position;
      if (entry.parent_id !== undefined) channel.parent_id = entry.parent_id;
      if (entry.lock_permissions && channel.parent_id) {
        channel.permission_overwrites = structuredClone(this.requireChannel(channel.parent_id).permission_overwrites ?? []);
      }
      if (JSON.stringify(pick(channel, ['position', 'parent_id', 'permission_overwrites'])) !== before) {
        this.dispatch('CHANNEL_UPDATE', channel);
      }
    }
    this.changed();
  }

  /**
   * ロールの並び順を変える（Modify Guild Role Positions）。`@everyone` は常に一番下（0）。
   * 位置が重ならないよう 1 から振り直し、変わったロールだけ `GUILD_ROLE_UPDATE` を配信する。
   */
  reorderRoles(guildId: string, entries: { id: string; position?: number | null }[]): Json[] {
    const guild = this.requireGuild(guildId);
    const requested = new Map(entries.map((entry) => [entry.id, entry.position]));
    for (const id of requested.keys()) {
      if (!guild.roles.some((role) => role.id === id)) throw new NotFound('Unknown Role', 10011);
    }
    const before = new Map(guild.roles.map((role) => [role.id, role.position as number]));
    const target = (role: Json) => (typeof requested.get(role.id) === 'number' ? requested.get(role.id)! : role.position);
    // 同じ位置に指定したときは、指定したロールを上にする。
    const ordered = guild.roles
      .filter((role) => role.id !== guildId)
      .sort((a, b) => target(a) - target(b) || Number(requested.has(a.id)) - Number(requested.has(b.id)));
    ordered.forEach((role, index) => {
      role.position = index + 1;
    });
    const everyone = guild.roles.find((role) => role.id === guildId);
    if (everyone) everyone.position = 0;
    this.changed();
    for (const role of guild.roles) {
      if (before.get(role.id) !== role.position) this.dispatch('GUILD_ROLE_UPDATE', { guild_id: guildId, role });
    }
    return [...guild.roles].sort((a, b) => a.position - b.position);
  }

  private updateThread(thread: Json, patch: Json): Json {
    const before = structuredClone(pick(thread, THREAD_AUDIT_KEYS));
    for (const key of THREAD_FIELDS) {
      if (patch[key] !== undefined) thread[key] = patch[key];
    }
    const metadata = thread.thread_metadata as Json;
    const wasArchived = metadata.archived;
    for (const key of THREAD_METADATA_FIELDS) {
      if (patch[key] !== undefined) metadata[key] = patch[key];
    }
    if (metadata.archived !== wasArchived) metadata.archive_timestamp = new Date().toISOString();
    this.changed();
    this.dispatch('THREAD_UPDATE', thread);
    const changes = auditChanges(before, thread, THREAD_AUDIT_KEYS);
    if (changes.length > 0) this.audit(thread.guild_id, AuditLogEvent.threadUpdate, thread.id, changes);
    return thread;
  }

  deleteChannel(channelId: string): void {
    const channel = this.requireChannel(channelId);
    for (const child of Object.values(this.state.channels)) {
      if (child.parent_id !== channelId) continue;
      if (isThreadType(child.type)) this.deleteChannel(child.id);
      else this.updateChannel(child.id, { parent_id: null });
    }
    if (this.state.stageInstances[channelId]) this.closeStage(channelId);
    this.attachments?.removeChannel(channel);
    delete this.state.channels[channelId];
    for (const message of this.state.messages[channelId] ?? []) delete this.state.reactionUsers[message.id];
    delete this.state.messages[channelId];
    delete this.state.threadMembers[channelId];
    delete this.state.pins[channelId];
    delete this.state.voiceChannelInfo[channelId];
    this.removeChannelLinks(channelId);
    this.changed();
    if (!isThreadType(channel.type)) {
      this.dispatch('CHANNEL_DELETE', channel);
      this.audit(channel.guild_id, AuditLogEvent.channelDelete, channelId, auditChanges(channel, {}, CHANNEL_AUDIT_KEYS));
      return;
    }
    this.audit(channel.guild_id, AuditLogEvent.threadDelete, channelId, auditChanges(channel, {}, THREAD_AUDIT_KEYS));
    const starter = this.state.messages[channel.parent_id]?.find((message) => message.id === channelId);
    if (starter) delete starter.thread;
    this.dispatch('THREAD_DELETE', { id: channelId, guild_id: channel.guild_id, parent_id: channel.parent_id, type: channel.type });
  }

  /** チャンネルの招待とウェブフック、そのチャンネルをフォローするウェブフックを消す。 */
  private removeChannelLinks(channelId: string): void {
    const { invites, webhooks } = this.state;
    for (const invite of Object.values(invites)) {
      if (invite.channel_id === channelId) delete invites[invite.code];
    }
    for (const webhook of Object.values(webhooks)) {
      if (webhook.channel_id === channelId || webhook.source_channel?.id === channelId) delete webhooks[webhook.id];
    }
  }

  /** 名前、種類、カテゴリー、トピック、権限の設定を引き継いだチャンネルを作成する。 */
  cloneChannel(channelId: string): Json {
    const { guild_id, name, type, parent_id, topic, permission_overwrites, available_tags } = this.requireChannel(channelId);
    const clone = this.createChannel(guild_id, { name, type, parent: parent_id ?? undefined, topic, available_tags });
    return this.updateChannel(clone.id, { permission_overwrites });
  }

  deleteRole(guildId: string, roleId: string): void {
    const guild = this.requireGuild(guildId);
    if (roleId === guildId) throw new Error('@everyone は削除できません');
    const deleted = guild.roles.find((role) => role.id === roleId);
    guild.roles = guild.roles.filter((role) => role.id !== roleId);
    for (const member of Object.values(guild.members)) {
      member.roles = member.roles.filter((id: string) => id !== roleId);
    }
    for (const channel of this.guildChannels(guildId)) {
      const remaining = channel.permission_overwrites.filter((overwrite: PermissionOverwrite) => overwrite.id !== roleId);
      if (remaining.length !== channel.permission_overwrites.length) this.updateChannel(channel.id, { permission_overwrites: remaining });
    }
    this.changed();
    this.dispatch('GUILD_ROLE_DELETE', { guild_id: guildId, role_id: roleId });
    if (deleted) this.audit(guildId, AuditLogEvent.roleDelete, roleId, auditChanges(deleted, {}, ROLE_AUDIT_KEYS));
  }

  /** DM の中身を含まない状態を返す。DM の閲覧には `dmsFor` を使う。 */
  publicState(): Json {
    const { token: _token, ...state } = this.state;
    const isDm = (channelId: string) => Boolean(this.state.channels[channelId]?.recipients);
    const messages = Object.fromEntries(Object.entries(state.messages).filter(([id]) => !isDm(id)));
    // DM の投票で誰が投票したかも、DM の内容として伏せる。
    const dmMessages = new Set(Object.entries(state.messages).filter(([id]) => isDm(id)).flatMap(([, list]) => list.map((message) => message.id as string)));
    const pollVotes = Object.fromEntries(Object.entries(state.pollVotes).filter(([id]) => !dmMessages.has(id)));
    const reactionUsers = Object.fromEntries(Object.entries(state.reactionUsers).filter(([id]) => !dmMessages.has(id)));
    const pins = Object.fromEntries(Object.entries(state.pins).filter(([id]) => !isDm(id)));
    return { ...state, messages, pollVotes, reactionUsers, pins };
  }


  createUser(input: SeedUser): Json {
    const user = {
      id: input.id ?? snowflake(),
      username: input.username,
      discriminator: '0',
      global_name: input.globalName ?? null,
      avatar: input.avatar ?? null,
      ...(input.temporary ? { temporary: true } : {}),
      bot: input.bot ?? false,
      system: false,
      public_flags: 0,
    };
    this.state.users[user.id] = user;
    this.markCreated(user.id);
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
    // 同じ ID を指定したときは使い回す。テストを繰り返しても増えない。
    const existing = input.id ? this.state.guilds[input.id] : undefined;
    if (existing) return existing;
    const id = input.id ?? snowflake();
    const botRoleId = snowflake();
    const guild: GuildRecord = {
      id,
      name: input.name,
      owner_id: this.state.botUserId,
      joined_at: new Date().toISOString(),
      roles: [
        this.roleRecord(id, { name: '@everyone', permissions: EVERYONE_PERMISSIONS }, 0),
        { ...this.roleRecord(botRoleId, { name: this.botUser.username, permissions: ADMINISTRATOR }, 1), managed: true },
      ],
      members: {},
    };
    guild.members[this.state.botUserId] = this.memberRecord(this.botUser, [botRoleId]);
    this.state.guilds[id] = guild;
    this.markCreated(id);
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
    const existing = guild.roles.find((role) => role.id === input.id);
    if (existing) return existing;
    const role = this.roleRecord(input.id ?? snowflake(), input, guild.roles.length);
    guild.roles.push(role);
    this.markCreated(role.id);
    this.changed();
    this.dispatch('GUILD_ROLE_CREATE', { guild_id: guildId, role });
    this.audit(guildId, AuditLogEvent.roleCreate, role.id, auditChanges({}, role, ROLE_AUDIT_KEYS));
    return role;
  }

  createChannel(guildId: string, input: SeedChannel): Json {
    const existing = input.id ? this.state.channels[input.id] : undefined;
    if (existing) return existing;
    const type = typeof input.type === 'number' ? input.type : ChannelType[input.type ?? 'text'];
    const parent = input.parent ? this.findChannel(guildId, input.parent) : undefined;
    if (type === ChannelType.dm) return this.dmChannel(input.recipients?.[0] ?? '');
    if (type === ChannelType.group_dm) return this.createGroupDm(input.recipients ?? [], input.name);
    if (isThreadType(type)) {
      if (!parent) throw new BadRequest('スレッドの親のチャンネルを指定してください');
      return this.createThread(parent.id, { ...input, type }, input.owner ?? this.state.botUserId);
    }
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
      permission_overwrites: structuredClone(input.permission_overwrites ?? (parent?.type === ChannelType.category ? parent.permission_overwrites : []) ?? []),
      rate_limit_per_user: 0,
      ...(isVoiceType(type) ? { bitrate: 64000, user_limit: 0, rtc_region: null } : {}),
      ...(hasThreads(type) ? { default_auto_archive_duration: DEFAULT_AUTO_ARCHIVE_MINUTES } : {}),
      ...(isForumType(type)
        ? {
            flags: 0,
            available_tags: withTagIds(input.available_tags ?? []),
            default_reaction_emoji: null,
            default_thread_rate_limit_per_user: 0,
            default_sort_order: null,
            ...(type === ChannelType.forum ? { default_forum_layout: 0 } : {}),
          }
        : {}),
    };
    this.state.channels[channel.id] = channel;
    this.state.messages[channel.id] = [];
    this.markCreated(channel.id);
    this.changed();
    this.dispatch('CHANNEL_CREATE', channel);
    this.audit(guildId, AuditLogEvent.channelCreate, channel.id, auditChanges({}, channel, CHANNEL_AUDIT_KEYS));
    return channel;
  }

  /**
   * スレッドを作成する。`starterId` を指定すると、そのメッセージから作成する。
   * フォーラムとメディアのチャンネルでは投稿になり、`input.message` が最初のメッセージになる。
   */
  createThread(parentId: string, input: Json, ownerId: string, starterId?: string): Json {
    const parent = this.requireChannel(parentId);
    if (!hasThreads(parent.type)) throw new BadRequest('このチャンネルにはスレッドを作成できません', ErrorCode.wrongChannelType);
    const isPost = isForumType(parent.type);
    // フォーラムとメディアでは、メッセージからスレッドを作成できない。
    if (isPost && starterId) throw new BadRequest('このチャンネルではメッセージからスレッドを作成できません', ErrorCode.wrongChannelType);
    const starter = starterId ? this.findMessage(parentId, starterId) : undefined;
    if (starter?.thread) throw new BadRequest('このメッセージにはスレッドがあります', ErrorCode.threadAlreadyCreated);
    if (isPost && !input.message) throw new BadRequest('投稿には最初のメッセージが必要です');
    const type = parent.type === ChannelType.announcement
      ? ChannelType.announcement_thread
      : isPost || starter ? ChannelType.public_thread : (input.type ?? ChannelType.private_thread);
    const now = new Date().toISOString();
    const thread: Json = {
      id: starter?.id ?? input.id ?? snowflake(),
      type,
      guild_id: parent.guild_id,
      parent_id: parentId,
      owner_id: ownerId,
      name: input.name,
      last_message_id: null,
      message_count: 0,
      total_message_sent: 0,
      member_count: 0,
      rate_limit_per_user: input.rate_limit_per_user ?? 0,
      flags: 0,
      thread_metadata: {
        archived: false,
        auto_archive_duration: input.auto_archive_duration ?? parent.default_auto_archive_duration,
        archive_timestamp: now,
        locked: false,
        create_timestamp: now,
        ...(type === ChannelType.private_thread ? { invitable: input.invitable ?? true } : {}),
      },
      ...(isPost ? { applied_tags: input.applied_tags ?? [] } : {}),
    };
    this.state.channels[thread.id] = thread;
    this.state.messages[thread.id] = [];
    this.state.threadMembers[thread.id] = [];
    this.changed();
    this.dispatch('THREAD_CREATE', { ...thread, newly_created: true });
    this.audit(thread.guild_id, AuditLogEvent.threadCreate, thread.id, auditChanges({}, thread, THREAD_AUDIT_KEYS));
    this.addThreadMember(thread.id, ownerId);

    const owner = this.requireUser(ownerId);
    if (isPost) {
      return { ...thread, message: this.createMessage(thread.id, owner, input.message, { id: thread.id }) };
    }
    if (starter) {
      starter.thread = thread;
      starter.flags |= MessageFlag.hasThread;
      this.dispatch('MESSAGE_UPDATE', starter);
      this.createMessage(thread.id, owner, {}, {
        type: MessageType.threadStarter,
        message_reference: { message_id: starter.id, channel_id: parentId, guild_id: parent.guild_id },
        referenced_message: starter,
      });
    } else if (type !== ChannelType.private_thread) {
      this.createMessage(parentId, owner, { content: input.name }, {
        type: MessageType.threadCreated,
        message_reference: { channel_id: thread.id, guild_id: parent.guild_id },
      });
    }
    return thread;
  }

  addThreadMember(threadId: string, userId: string): Json {
    const thread = this.requireChannel(threadId);
    const members = (this.state.threadMembers[threadId] ??= []);
    const existing = members.find((member) => member.user_id === userId);
    if (existing) return existing;
    const member = { id: threadId, user_id: userId, join_timestamp: new Date().toISOString(), flags: 0 };
    members.push(member);
    thread.member_count = members.length;
    this.changed();
    this.dispatch('THREAD_MEMBERS_UPDATE', {
      id: threadId,
      guild_id: thread.guild_id,
      member_count: members.length,
      added_members: [member],
    });
    if (userId === this.state.botUserId) this.dispatch('THREAD_MEMBER_UPDATE', { ...member, guild_id: thread.guild_id });
    return member;
  }

  removeThreadMember(threadId: string, userId: string): void {
    const thread = this.requireChannel(threadId);
    const members = (this.state.threadMembers[threadId] ?? []).filter((member) => member.user_id !== userId);
    this.state.threadMembers[threadId] = members;
    thread.member_count = members.length;
    this.changed();
    this.dispatch('THREAD_MEMBERS_UPDATE', {
      id: threadId,
      guild_id: thread.guild_id,
      member_count: members.length,
      removed_member_ids: [userId],
    });
  }

  threadMembers(threadId: string): Json[] {
    this.requireChannel(threadId);
    return this.state.threadMembers[threadId] ?? [];
  }

  threadMember(threadId: string, userId: string): Json {
    const member = this.threadMembers(threadId).find((candidate) => candidate.user_id === userId);
    if (!member) throw new NotFound('Unknown Member', 10007);
    return member;
  }

  /** アーカイブされていないスレッドと、Bot の参加状況を返す。 */
  activeThreads(guildId: string): Json {
    const threads = this.guildThreads(guildId).filter((thread) => !thread.thread_metadata.archived);
    return { threads, members: this.botThreadMembers(threads) };
  }

  /** チャンネルのアーカイブされたスレッドを、新しい順に返す。 */
  archivedThreads(channelId: string, type: number, joinedOnly = false): Json {
    this.requireChannel(channelId);
    const threads = Object.values(this.state.channels)
      .filter((thread) => thread.parent_id === channelId && thread.thread_metadata?.archived)
      .filter((thread) => (type === ChannelType.private_thread) === (thread.type === ChannelType.private_thread))
      .filter((thread) => !joinedOnly || this.botThreadMembers([thread]).length > 0)
      .sort((a, b) => b.thread_metadata.archive_timestamp.localeCompare(a.thread_metadata.archive_timestamp));
    return { threads, members: this.botThreadMembers(threads), has_more: false };
  }

  private botThreadMembers(threads: Json[]): Json[] {
    return threads.flatMap((thread) =>
      (this.state.threadMembers[thread.id] ?? []).filter((member) => member.user_id === this.state.botUserId),
    );
  }

  openStage(input: Json): Json {
    const channel = this.requireChannel(input.channel_id);
    if (channel.type !== ChannelType.stage) throw new BadRequest('ステージチャンネルではありません', ErrorCode.wrongChannelType);
    if (this.state.stageInstances[channel.id]) throw new BadRequest('ステージは開催中です', ErrorCode.stageAlreadyOpen);
    const instance = {
      id: snowflake(),
      guild_id: channel.guild_id,
      channel_id: channel.id,
      topic: input.topic,
      privacy_level: input.privacy_level ?? STAGE_PRIVACY_GUILD_ONLY,
      discoverable_disabled: false,
      guild_scheduled_event_id: null,
    };
    this.state.stageInstances[channel.id] = instance;
    this.changed();
    this.dispatch('STAGE_INSTANCE_CREATE', instance);
    return instance;
  }

  requireStage(channelId: string): Json {
    const instance = this.state.stageInstances[channelId];
    if (!instance) throw new NotFound('Unknown Stage Instance', ErrorCode.unknownStageInstance);
    return instance;
  }

  updateStage(channelId: string, patch: Json): Json {
    const instance = this.requireStage(channelId);
    if (patch.topic !== undefined) instance.topic = patch.topic;
    if (patch.privacy_level !== undefined) instance.privacy_level = patch.privacy_level;
    this.changed();
    this.dispatch('STAGE_INSTANCE_UPDATE', instance);
    return instance;
  }

  closeStage(channelId: string): void {
    const instance = this.requireStage(channelId);
    delete this.state.stageInstances[channelId];
    this.changed();
    this.dispatch('STAGE_INSTANCE_DELETE', instance);
  }

  /** ステージで発言できるかを変更する。 */
  updateVoiceState(guildId: string, userId: string, patch: Json): Json {
    const voiceState = this.state.voiceStates[`${guildId}:${userId}`];
    if (!voiceState) throw new NotFound('Unknown Voice State', 10065);
    if (patch.suppress !== undefined) voiceState.suppress = patch.suppress;
    if (patch.request_to_speak_timestamp !== undefined) voiceState.request_to_speak_timestamp = patch.request_to_speak_timestamp;
    this.changed();
    this.dispatch('VOICE_STATE_UPDATE', voiceState);
    return voiceState;
  }

  addMember(guildId: string, userId: string, roles: string[] = [], nick?: string): Json {
    const guild = this.requireGuild(guildId);
    const member = this.memberRecord(this.requireUser(userId), roles, nick);
    guild.members[userId] = member;
    this.changed();
    this.dispatch('GUILD_MEMBER_ADD', { guild_id: guildId, ...member });
    // システムメッセージのチャンネルがあれば、参加を知らせる。
    const flags = guild.system_channel_flags ?? 0;
    if (guild.system_channel_id && this.state.channels[guild.system_channel_id] && !(flags & SystemChannelFlag.suppressJoinNotifications)) {
      this.createMessage(guild.system_channel_id, member.user, {}, { type: MessageType.userJoin });
    }
    return member;
  }

  /** メンバーをサーバーから外す。キックや BAN で使う。 */
  removeMember(guildId: string, userId: string): void {
    const guild = this.requireGuild(guildId);
    const member = this.requireMember(guildId, userId);
    delete guild.members[userId];
    const voiceKey = `${guildId}:${userId}`;
    if (this.state.voiceStates[voiceKey]) this.setVoiceState(guildId, userId, null, '');
    this.changed();
    this.dispatch('GUILD_MEMBER_REMOVE', { guild_id: guildId, user: member.user });
  }

  /** ニックネーム、ロール、タイムアウトを変更する。 */
  updateMember(guildId: string, userId: string, patch: Json): Json {
    const member = this.requireMember(guildId, userId);
    if (patch.roles !== undefined) this.setMemberRoles(guildId, userId, patch.roles);
    const keys = ['nick', 'communication_disabled_until', 'mute', 'deaf'];
    const before = pick(member, keys);
    for (const key of keys) {
      if (patch[key] !== undefined) member[key] = patch[key];
    }
    const changes = auditChanges(before, member, keys);
    if (changes.length === 0) return member;
    this.changed();
    this.dispatch('GUILD_MEMBER_UPDATE', { guild_id: guildId, ...member });
    this.audit(guildId, AuditLogEvent.memberUpdate, userId, changes);
    return member;
  }

  setMemberRoles(guildId: string, userId: string, roles: string[]): Json {
    const member = this.requireMember(guildId, userId);
    const guild = this.requireGuild(guildId);
    const summary = (ids: string[]) => ids.map((id) => ({ id, name: guild.roles.find((role) => role.id === id)?.name }));
    const added = roles.filter((id) => !member.roles.includes(id));
    const removed = (member.roles as string[]).filter((id) => !roles.includes(id));
    member.roles = roles;
    this.changed();
    this.dispatch('GUILD_MEMBER_UPDATE', { guild_id: guildId, ...member });
    const changes = [
      ...(added.length > 0 ? [{ key: '$add', new_value: summary(added) }] : []),
      ...(removed.length > 0 ? [{ key: '$remove', new_value: summary(removed) }] : []),
    ];
    if (changes.length > 0) this.audit(guildId, AuditLogEvent.memberRoleUpdate, userId, changes);
    return member;
  }

  /** ダミーデータをまとめて投入する。ロールとチャンネルは名前で相互に参照できる。 */
  seed(input: SeedInput): Json {
    const guilds = (input.guilds ?? []).map((guild) => this.createGuild(guild));
    const needsGuild = input.roles?.length || input.channels?.length || input.users?.length;
    if (needsGuild && Object.keys(this.state.guilds).length === 0) {
      guilds.push(this.createGuild({ name: 'Test Guild' }));
    }
    // 同じ名前のサーバーがあるときは、今回追加したサーバーを優先する。
    const resolveGuild = (ref?: string): string => {
      if (!ref) return guilds[0]?.id ?? input.defaultGuild ?? Object.keys(this.state.guilds)[0]!;
      const found = [...guilds, ...Object.values(this.state.guilds)].find((g) => g.id === ref || g.name === ref);
      if (!found) throw new NotFound(`Unknown guild: ${ref}`);
      return found.id;
    };

    const roles = (input.roles ?? []).map((r) => this.createRole(resolveGuild(r.guild), r));
    const channels = (input.channels ?? []).map((c) => this.createChannel(resolveGuild(c.guild), c));
    const users = (input.users ?? []).map((u) => {
      const user = this.createUser(u);
      const joining = u.guilds ?? (u.bot !== true || u.guild ? [u.guild] : []);
      for (const ref of joining) {
        const guildId = resolveGuild(ref);
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

  /** Discord と同じく、@everyone と所持ロールの権限の和を返す。 */
  /** ユーザーの権限を返す。チャンネルを指定すると、そのチャンネルの権限の設定も反映する。 */
  memberPermissions(guildId: string, userId: string, channelId?: string): string {
    this.requireMember(guildId, userId);
    const channel = channelId ? this.requireChannel(channelId) : undefined;
    // スレッドの権限は親のチャンネルに従う。
    const source = channel && isThreadType(channel.type) ? this.requireChannel(channel.parent_id) : channel;
    const overwrites = (source?.permission_overwrites ?? []) as PermissionOverwrite[];
    return String(computePermissions(this.requireGuild(guildId) as never, userId, overwrites));
  }

  /** `@everyone` と指定したロールだけを持つメンバーの権限。チャンネルのロールの上書きは反映し、メンバーごとの上書きは使わない。 */
  rolePermissions(guildId: string, roleId: string, overwrites: PermissionOverwrite[] = []): string {
    const guild = this.requireGuild(guildId);
    if (!guild.roles.some((role) => role.id === roleId)) throw new NotFound('Unknown Role', 10011);
    const holder = `role:${roleId}`;
    const roleOverwrites = overwrites.filter((overwrite) => overwrite.type === OverwriteType.role);
    return String(computePermissions({ ...guild, owner_id: '', members: { [holder]: { roles: [roleId] } } } as never, holder, roleOverwrites));
  }

  requireChannel(id: string): Json {
    const channel = this.state.channels[id];
    if (!channel) throw new NotFound('Unknown Channel', 10003);
    return channel;
  }

  /** スレッドを除くチャンネルを返す。Discord の API も一覧にスレッドを含めない。 */
  guildChannels(guildId: string): Json[] {
    return Object.values(this.state.channels).filter((c) => c.guild_id === guildId && !isThreadType(c.type));
  }

  guildThreads(guildId: string): Json[] {
    return Object.values(this.state.channels).filter((c) => c.guild_id === guildId && isThreadType(c.type));
  }

  guildPayload(guild: GuildRecord): Json {
    return {
      id: guild.id,
      name: guild.name,
      icon: guild.icon ?? null,
      splash: null,
      discovery_splash: null,
      owner_id: guild.owner_id,
      afk_channel_id: guild.afk_channel_id ?? null,
      afk_timeout: guild.afk_timeout ?? 300,
      verification_level: guild.verification_level ?? 0,
      default_message_notifications: guild.default_message_notifications ?? 0,
      explicit_content_filter: guild.explicit_content_filter ?? 0,
      roles: guild.roles,
      emojis: guild.emojis ?? [],
      stickers: guild.stickers ?? [],
      features: GUILD_FEATURES,
      mfa_level: 0,
      application_id: null,
      system_channel_id: guild.system_channel_id ?? null,
      system_channel_flags: guild.system_channel_flags ?? 0,
      rules_channel_id: guild.rules_channel_id ?? null,
      vanity_url_code: null,
      description: guild.description ?? null,
      banner: null,
      premium_tier: 0,
      premium_subscription_count: 0,
      preferred_locale: guild.preferred_locale ?? 'en-US',
      public_updates_channel_id: guild.public_updates_channel_id ?? null,
      nsfw_level: 0,
      premium_progress_bar_enabled: false,
      widget_enabled: (guild as Json).widget?.enabled ?? false,
      widget_channel_id: (guild as Json).widget?.channel_id ?? null,
      incidents_data: (guild as Json).incidents_data ?? null,
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
      threads: this.activeThreads(guild.id).threads,
      presences: Object.values(this.state.presences).filter((presence) => guild.members[presence.user.id]).map((presence) => ({ ...presence, guild_id: guild.id })),
      stage_instances: Object.values(this.state.stageInstances).filter((instance) => instance.guild_id === guild.id),
      guild_scheduled_events: Object.values(this.state.scheduledEvents).filter((event) => event.guild_id === guild.id),
      soundboard_sounds: Object.values(this.state.soundboardSounds).filter((sound) => sound.guild_id === guild.id),
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

  /** グループ DM を作成する。参加者は Bot とダミーユーザー。 */
  createGroupDm(recipientIds: string[], name?: string): Json {
    const channel = {
      id: snowflake(),
      type: ChannelType.group_dm,
      name: name ?? null,
      icon: null,
      owner_id: this.state.botUserId,
      application_id: this.state.applicationId,
      last_message_id: null,
      recipients: recipientIds.map((id) => this.requireUser(id)),
    };
    this.state.channels[channel.id] = channel;
    this.state.messages[channel.id] = [];
    this.changed();
    return channel;
  }

  /** ユーザーが参加するグループ DM を返す。DM と同じく、そのユーザーでのログインが必要。 */
  groupDmsFor(userId: string): Json[] {
    if (this.state.activeUserId !== userId) {
      throw new Forbidden('DM を閲覧するには宛先のユーザーでログインしてください');
    }
    return Object.values(this.state.channels)
      .filter((c) => c.type === ChannelType.group_dm && c.recipients.some((user: Json) => user.id === userId))
      .map((channel) => ({ channel, messages: this.state.messages[channel.id] ?? [] }));
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
    if (isWithoutMessages(channel.type)) throw new BadRequest('このチャンネルにはメッセージを送信できません', ErrorCode.wrongChannelType);
    if (isThreadType(channel.type)) this.reopenThread(channel);
    const content = String(input.content ?? '');
    const moderated = this.moderate?.(channel, author, input);
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
      attachments: input.uploads?.length ? this.attachments?.save(channel, input.uploads) ?? [] : (input.attachments ?? []),
      embeds: input.embeds ?? [],
      components: input.components ?? [],
      reactions: [],
      ...(input.sticker_ids?.length ? { sticker_items: this.stickerItems(channel.guild_id, input.sticker_ids) } : {}),
      ...(input.poll ? { poll: createPoll(input.poll) } : {}),
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
    if (isThreadType(channel.type)) {
      // 最初のメッセージは `message_count` に含めない。
      if (message.id !== channelId && message.type !== MessageType.threadStarter) {
        channel.message_count += 1;
        channel.total_message_sent += 1;
      }
      this.addThreadMember(channelId, author.id as string);
    }
    this.changed();
    if (((message.flags as number) & 64) === 0) this.dispatch('MESSAGE_CREATE', message);
    moderated?.(message.id);
    return message;
  }

  /** アーカイブされたスレッドは、メッセージが送信されると元に戻る。ロックされていると送信できない。 */
  private reopenThread(thread: Json): void {
    const metadata = thread.thread_metadata as Json;
    if (!metadata.archived) return;
    if (metadata.locked) throw new BadRequest('スレッドはアーカイブされています', ErrorCode.archivedThread);
    this.updateThread(thread, { archived: false });
  }

  private stickerItems(guildId: string | undefined, ids: string[]): Json[] {
    const stickers = guildId ? (this.state.guilds[guildId]?.stickers ?? []) : [];
    return ids.map((id) => {
      const sticker = stickers.find((candidate) => candidate.id === id);
      if (!sticker) throw new NotFound('Unknown Sticker', 10060);
      return { id, name: sticker.name, format_type: sticker.format_type };
    });
  }

  findMessage(channelId: string, messageId: string): Json {
    const message = this.state.messages[channelId]?.find((m) => m.id === messageId);
    if (!message) throw new NotFound('Unknown Message', 10008);
    return message;
  }

  editMessage(channelId: string, messageId: string, patch: Json): Json {
    const message = this.findMessage(channelId, messageId);
    for (const key of ['content', 'embeds', 'components', 'flags']) {
      if (patch[key] !== undefined) message[key] = patch[key];
    }
    // `attachments` は残す添付の一覧。新しいファイルは後ろに加える。
    if (patch.attachments !== undefined || patch.uploads?.length) {
      const channel = this.requireChannel(channelId);
      const keep = patch.attachments === undefined ? null : new Set((patch.attachments as Json[]).map((attachment) => String(attachment.id)));
      const current = message.attachments as Json[];
      const kept = keep ? current.filter((attachment) => keep.has(String(attachment.id))) : current;
      this.attachments?.removeFrom(channel, current.filter((attachment) => !kept.includes(attachment)));
      message.attachments = [...kept, ...(patch.uploads?.length ? this.attachments?.save(channel, patch.uploads) ?? [] : [])];
    }
    message.edited_timestamp = new Date().toISOString();
    this.changed();
    this.dispatch('MESSAGE_UPDATE', message);
    return message;
  }

  deleteMessage(channelId: string, messageId: string): void {
    const message = this.removeMessage(channelId, messageId);
    // 他のユーザーのメッセージを削除したときだけ記録する。Discord と同じ。
    if (this.actor && this.actor.userId !== message.author.id) {
      this.audit(message.guild_id, AuditLogEvent.messageDelete, message.author.id, [], { channel_id: channelId, count: '1' });
    }
    this.changed();
    this.dispatch('MESSAGE_DELETE', {
      id: messageId,
      channel_id: channelId,
      ...(message.guild_id ? { guild_id: message.guild_id } : {}),
    });
  }

  /** メッセージをまとめて削除し、`MESSAGE_DELETE_BULK` を 1 回だけ配信する。 */
  deleteMessages(channelId: string, messageIds: string[]): void {
    const channel = this.requireChannel(channelId);
    for (const id of messageIds) this.findMessage(channelId, id);
    for (const id of messageIds) this.removeMessage(channelId, id);
    this.audit(channel.guild_id, AuditLogEvent.messageBulkDelete, channelId, [], { count: String(messageIds.length) });
    this.changed();
    this.dispatch('MESSAGE_DELETE_BULK', { ids: messageIds, channel_id: channelId, ...(channel.guild_id ? { guild_id: channel.guild_id } : {}) });
  }

  /** メッセージと、その添付、リアクション、ピン留めを消す。Bot への通知は呼び出し元が行う。 */
  private removeMessage(channelId: string, messageId: string): Json {
    const messages = this.state.messages[channelId] ?? [];
    const message = this.findMessage(channelId, messageId);
    messages.splice(messages.indexOf(message), 1);
    const channel = this.state.channels[channelId];
    if (channel) this.attachments?.removeFrom(channel, message.attachments);
    if (channel?.message_count) channel.message_count -= 1;
    delete this.state.reactionUsers[messageId];
    if (this.state.pins[channelId]) this.state.pins[channelId] = this.state.pins[channelId]!.filter((pin) => pin.message_id !== messageId);
    return message;
  }

  /** リアクションを付ける。同じユーザーが同じ絵文字を付け直しても数は増えない。 */
  addReaction(channelId: string, messageId: string, userId: string, value: string): void {
    const message = this.findMessage(channelId, messageId);
    const emoji = parseEmoji(value);
    const key = reactionKey(emoji);
    const users = ((this.state.reactionUsers[messageId] ??= {})[key] ??= []);
    if (users.includes(userId)) return;
    users.push(userId);
    const reaction = (message.reactions as Json[]).find((candidate) => reactionKey(candidate.emoji) === key);
    if (reaction) {
      reaction.count += 1;
      reaction.count_details.normal += 1;
      if (userId === this.state.botUserId) reaction.me = true;
    } else {
      message.reactions.push({
        count: 1,
        count_details: { burst: 0, normal: 1 },
        me: userId === this.state.botUserId,
        me_burst: false,
        burst_colors: [],
        emoji,
      });
    }
    this.changed();
    const member = message.guild_id ? this.state.guilds[message.guild_id]?.members[userId] : undefined;
    this.dispatch('MESSAGE_REACTION_ADD', {
      ...this.reactionTarget(message),
      user_id: userId,
      ...(member ? { member } : {}),
      emoji,
      message_author_id: message.author.id,
      type: 0,
      burst: false,
      burst_colors: [],
    });
  }

  /** ユーザーのリアクションを外す。付けていなければ何もしない。 */
  removeReaction(channelId: string, messageId: string, userId: string, value: string): void {
    const message = this.findMessage(channelId, messageId);
    const emoji = parseEmoji(value);
    const key = reactionKey(emoji);
    const users = this.state.reactionUsers[messageId]?.[key];
    if (!users?.includes(userId)) return;
    users.splice(users.indexOf(userId), 1);
    const reaction = (message.reactions as Json[]).find((candidate) => reactionKey(candidate.emoji) === key)!;
    reaction.count -= 1;
    reaction.count_details.normal -= 1;
    if (userId === this.state.botUserId) reaction.me = false;
    if (reaction.count === 0) {
      message.reactions = (message.reactions as Json[]).filter((candidate) => candidate !== reaction);
      delete this.state.reactionUsers[messageId]![key];
    }
    this.changed();
    this.dispatch('MESSAGE_REACTION_REMOVE', { ...this.reactionTarget(message), user_id: userId, emoji: reaction.emoji, type: 0, burst: false });
  }

  /** メッセージのリアクションをすべて外す。絵文字を指定すると、その絵文字だけを外す。 */
  removeAllReactions(channelId: string, messageId: string, value?: string): void {
    const message = this.findMessage(channelId, messageId);
    if (value === undefined) {
      message.reactions = [];
      delete this.state.reactionUsers[messageId];
      this.changed();
      this.dispatch('MESSAGE_REACTION_REMOVE_ALL', this.reactionTarget(message));
      return;
    }
    const key = reactionKey(parseEmoji(value));
    const reaction = (message.reactions as Json[]).find((candidate) => reactionKey(candidate.emoji) === key);
    if (!reaction) return;
    message.reactions = (message.reactions as Json[]).filter((candidate) => candidate !== reaction);
    delete this.state.reactionUsers[messageId]?.[key];
    this.changed();
    this.dispatch('MESSAGE_REACTION_REMOVE_EMOJI', { ...this.reactionTarget(message), emoji: reaction.emoji });
  }

  /** 絵文字のリアクションを付けたユーザーの ID。付けた順。 */
  reactionUserIds(channelId: string, messageId: string, value: string): string[] {
    this.findMessage(channelId, messageId);
    return this.state.reactionUsers[messageId]?.[reactionKey(parseEmoji(value))] ?? [];
  }

  private reactionTarget(message: Json): Json {
    return { channel_id: message.channel_id, message_id: message.id, ...(message.guild_id ? { guild_id: message.guild_id } : {}) };
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
      // ステージでは聴衆として参加する。発言には `suppress` の解除が必要。
      suppress: this.state.channels[channelId ?? '']?.type === ChannelType.stage,
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

export class BadRequest extends Error {
  readonly status = 400;
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
