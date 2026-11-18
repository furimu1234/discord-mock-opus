export const DEFAULT_HOST = '127.0.0.1';

/** 画面からのリクエストの印。画面で作ったものは、Mock を起動し直しても残す。 */
export const WEB_ORIGIN_HEADER = 'x-dismock-origin';
export const WEB_ORIGIN = 'web';

/** 状態を保存する JSON のファイル名。 */
export const STATE_FILE_NAME = 'discord-mock-state.json';
/** 起動したときに画面の URL を出力する行の先頭。配布版のウインドウが読み取って開く。 */
export const URL_LINE_PREFIX = 'dismock: ';
/** 親のプロセスが IPC で Mock の停止を指示するメッセージ。 */
export const MOCK_STOP_MESSAGE = 'dismock:stop';

/** ターミナル、画面、ドキュメントに表示する、非公式であることと商標の表示。 */
export const LEGAL_NOTICE = 'dismock は Discord Inc. とは関係のない非公式のツールです。Discord は Discord Inc. の商標です。';
export const DEFAULT_PORT = 6470;

/** エージェントが起動エラーを出力するときの接頭辞。画面に表示するために Mock が読み取る。 */
export const STARTUP_ERROR_PREFIX = '起動エラー: ';

/** チャンネルの種類と、Discord API の値の対応。 */
export const ChannelType = {
  text: 0,
  dm: 1,
  voice: 2,
  group_dm: 3,
  category: 4,
  announcement: 5,
  announcement_thread: 10,
  public_thread: 11,
  private_thread: 12,
  stage: 13,
  directory: 14,
  forum: 15,
  media: 16,
} as const;

/** メッセージとモーダルのコンポーネントの `type`。9 以降は Components V2。 */
export const ComponentType = {
  actionRow: 1,
  button: 2,
  stringSelect: 3,
  textInput: 4,
  userSelect: 5,
  roleSelect: 6,
  mentionableSelect: 7,
  channelSelect: 8,
  section: 9,
  textDisplay: 10,
  thumbnail: 11,
  mediaGallery: 12,
  file: 13,
  separator: 14,
  container: 17,
  label: 18,
} as const;

/** Bot がインタラクションに時間内に応答しなかったときに、`/api/mock/interact` が返す HTTP のステータス。 */
export const INTERACTION_TIMEOUT_STATUS = 408;

/** Bot が Gateway に接続していないときに、`/api/mock/interact` が待たずに返す HTTP のステータス。 */
export const BOT_NOT_CONNECTED_STATUS = 503;

/** モーダルの入力欄の `style`。`paragraph` は複数行。 */
export const TextInputStyle = { short: 1, paragraph: 2 } as const;

const includes = (types: readonly number[]) => (type: number) => types.includes(type);

export const isThreadType = includes([ChannelType.announcement_thread, ChannelType.public_thread, ChannelType.private_thread]);
export const isVoiceType = includes([ChannelType.voice, ChannelType.stage]);
/** 投稿をスレッドとして持つチャンネル。チャンネルに直接メッセージを送信できない。 */
export const isForumType = includes([ChannelType.forum, ChannelType.media]);
/** スレッドを作成できるチャンネル。 */
export const hasThreads = includes([ChannelType.text, ChannelType.announcement, ChannelType.forum, ChannelType.media]);
/** メッセージを送信できないチャンネル。 */
export const isWithoutMessages = includes([ChannelType.category, ChannelType.directory, ChannelType.forum, ChannelType.media]);

/** 招待とウェブフックを作成できるチャンネル。 */
export const isInvitable = includes([
  ChannelType.text, ChannelType.voice, ChannelType.announcement, ChannelType.stage, ChannelType.forum, ChannelType.media,
]);

/** 招待のリンクの形式。コードを後ろに付ける。 */
export const INVITE_URL = 'https://discord.gg';

/** メッセージの `flags` のビット。Discord の公開ドキュメントの値。 */
export const MessageFlag = {
  crossposted: 1 << 0,
  isCrosspost: 1 << 1,
  suppressEmbeds: 1 << 2,
  hasThread: 1 << 5,
  ephemeral: 1 << 6,
  loading: 1 << 7,
  suppressNotifications: 1 << 12,
  isVoiceMessage: 1 << 13,
  isComponentsV2: 1 << 15,
} as const;

/**
 * メッセージの作成とウェブフックの実行で指定できるフラグ。
 * ほかのフラグ（エフェメラルなど）は、Discord と同じく無視する。エフェメラルにできるのはインタラクションの応答だけ。
 */
export const CREATABLE_MESSAGE_FLAGS =
  MessageFlag.suppressEmbeds | MessageFlag.suppressNotifications | MessageFlag.isVoiceMessage | MessageFlag.isComponentsV2;

/** 指定できるフラグだけを残す。 */
export const creatableMessageFlags = (flags: unknown) => (Number(flags) || 0) & CREATABLE_MESSAGE_FLAGS;

export const WebhookType = { incoming: 1, channelFollower: 2 } as const;

/** 監査ログの種類。Discord の公開ドキュメントの値。 */
export const AuditLogEvent = {
  guildUpdate: 1,
  channelCreate: 10,
  channelUpdate: 11,
  channelDelete: 12,
  channelOverwriteCreate: 13,
  channelOverwriteUpdate: 14,
  channelOverwriteDelete: 15,
  memberKick: 20,
  memberPrune: 21,
  memberBanAdd: 22,
  memberBanRemove: 23,
  memberUpdate: 24,
  memberRoleUpdate: 25,
  roleCreate: 30,
  roleUpdate: 31,
  roleDelete: 32,
  inviteCreate: 40,
  inviteDelete: 42,
  webhookCreate: 50,
  webhookUpdate: 51,
  webhookDelete: 52,
  emojiCreate: 60,
  emojiUpdate: 61,
  emojiDelete: 62,
  messageDelete: 72,
  messageBulkDelete: 73,
  messagePin: 74,
  messageUnpin: 75,
  integrationDelete: 82,
  stickerCreate: 90,
  stickerUpdate: 91,
  stickerDelete: 92,
  guildScheduledEventCreate: 100,
  guildScheduledEventUpdate: 101,
  guildScheduledEventDelete: 102,
  threadCreate: 110,
  threadUpdate: 111,
  threadDelete: 112,
  applicationCommandPermissionUpdate: 121,
  soundboardSoundCreate: 130,
  soundboardSoundUpdate: 131,
  soundboardSoundDelete: 132,
  autoModerationRuleCreate: 140,
  autoModerationRuleUpdate: 141,
  autoModerationRuleDelete: 142,
  autoModerationBlockMessage: 143,
  autoModerationFlagToChannel: 144,
  autoModerationUserCommunicationDisabled: 145,
  voiceChannelStatusUpdate: 192,
  voiceChannelStatusDelete: 193,
} as const;

/** システムメッセージの抑制。`system_channel_flags` のビット。 */
export const SystemChannelFlag = {
  suppressJoinNotifications: 1 << 0,
  suppressPremiumSubscriptions: 1 << 1,
  suppressGuildReminderNotifications: 1 << 2,
  suppressJoinNotificationReplies: 1 << 3,
} as const;

/** ブーストのないサーバーの、1 つのメッセージの添付の上限。 */
export const MAX_ATTACHMENTS = 10;
export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;

/** ブーストのないサーバーの、絵文字とスタンプの上限。 */
export const GUILD_EMOJI_LIMIT = 50;
export const GUILD_STICKER_LIMIT = 5;

export const AutoModTrigger = { keyword: 1, spam: 3, keywordPreset: 4, mentionSpam: 5, memberProfile: 6 } as const;
export const AutoModAction = { blockMessage: 1, sendAlertMessage: 2, timeout: 3 } as const;

/** アプリケーションコマンドの種類のうち、ユーザーの右クリックから実行するもの。 */
export const USER_COMMAND_TYPE = 2;

/** アプリケーションコマンドの種類のうち、メッセージの右クリックから実行するもの。 */
export const MESSAGE_COMMAND_TYPE = 3;

/** アプリケーションコマンドの種類のうち、スラッシュコマンド。 */
export const CHAT_INPUT_COMMAND_TYPE = 1;

/** 画面へ配信する音声の形式。 */
export const VOICE_SAMPLE_RATE = 48000;
export const VOICE_CHANNELS = 2;
export const AUDIO_LENGTH_SIZE = 2;

/**
 * 既定のダミーユーザー。テストの `users` で指定できるよう ID を固定する。
 * `alice` は管理者、`bob` は権限のないユーザー。
 */
export const DEFAULT_USERS = [
  { id: '1000000000000000101', username: 'alice' },
  { id: '1000000000000000102', username: 'bob' },
] as const;
