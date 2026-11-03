/** Discord の公開ドキュメントの権限ビット。画面からも使うので、Node に依存しない。 */
export const Permission = {
  createInstantInvite: 1n << 0n,
  kickMembers: 1n << 1n,
  banMembers: 1n << 2n,
  administrator: 1n << 3n,
  manageChannels: 1n << 4n,
  manageGuild: 1n << 5n,
  addReactions: 1n << 6n,
  viewAuditLog: 1n << 7n,
  prioritySpeaker: 1n << 8n,
  stream: 1n << 9n,
  viewChannel: 1n << 10n,
  sendMessages: 1n << 11n,
  manageMessages: 1n << 13n,
  embedLinks: 1n << 14n,
  attachFiles: 1n << 15n,
  readMessageHistory: 1n << 16n,
  mentionEveryone: 1n << 17n,
  useExternalEmojis: 1n << 18n,
  connect: 1n << 20n,
  speak: 1n << 21n,
  muteMembers: 1n << 22n,
  deafenMembers: 1n << 23n,
  moveMembers: 1n << 24n,
  useVad: 1n << 25n,
  changeNickname: 1n << 26n,
  manageNicknames: 1n << 27n,
  manageRoles: 1n << 28n,
  manageWebhooks: 1n << 29n,
  useApplicationCommands: 1n << 31n,
  manageThreads: 1n << 34n,
  sendMessagesInThreads: 1n << 38n,
  moderateMembers: 1n << 40n,
} as const;

const ALL_PERMISSIONS = Object.values(Permission).reduce((total, flag) => total | flag, 0n);

/** 権限の設定先。`text` と `voice` はチャンネルの種類で、`guild` はロールだけで設定できる。 */
export type PermissionScope = 'text' | 'voice' | 'guild';

export interface PermissionInfo {
  flag: bigint;
  label: string;
  description: string;
  scopes: PermissionScope[];
}

export interface PermissionGroup {
  title: string;
  items: PermissionInfo[];
}

const ANY_CHANNEL: PermissionScope[] = ['text', 'voice'];

/** 設定画面に表示する権限の一覧。 */
export const PERMISSION_GROUPS: PermissionGroup[] = [
  {
    title: 'サーバー全般の権限',
    items: [
      { flag: Permission.administrator, label: '管理者', description: 'すべての権限を持ち、チャンネルの権限の設定も無視します。', scopes: ['guild'] },
      { flag: Permission.manageGuild, label: 'サーバーの管理', description: 'サーバーの名前などを変更できます。', scopes: ['guild'] },
      { flag: Permission.viewAuditLog, label: '監査ログの表示', description: 'サーバーの監査ログを閲覧できます。', scopes: ['guild'] },
      { flag: Permission.kickMembers, label: 'メンバーのキック', description: 'メンバーをサーバーから追い出せます。', scopes: ['guild'] },
      { flag: Permission.banMembers, label: 'メンバーの BAN', description: 'メンバーをサーバーから BAN できます。', scopes: ['guild'] },
      { flag: Permission.moderateMembers, label: 'メンバーのタイムアウト', description: 'メンバーを一時的に発言できなくします。', scopes: ['guild'] },
      { flag: Permission.changeNickname, label: 'ニックネームの変更', description: '自分のニックネームを変更できます。', scopes: ['guild'] },
      { flag: Permission.manageNicknames, label: 'ニックネームの管理', description: '他のメンバーのニックネームを変更できます。', scopes: ['guild'] },
    ],
  },
  {
    title: 'チャンネル全般の権限',
    items: [
      { flag: Permission.viewChannel, label: 'チャンネルを見る', description: 'この権限を持つメンバーは、デフォルトでこのチャンネルを閲覧できます。この権限を @everyone に対して無効にした場合、このチャンネルはプライベート設定になります。', scopes: ANY_CHANNEL },
      { flag: Permission.manageChannels, label: 'チャンネルの管理', description: 'チャンネルの編集や削除ができます。', scopes: ANY_CHANNEL },
      { flag: Permission.manageRoles, label: '権限の管理', description: 'ロールの付与や、チャンネルの権限の変更ができます。', scopes: ANY_CHANNEL },
      { flag: Permission.manageWebhooks, label: 'Webhook の管理', description: 'Webhook の作成、編集、削除ができます。', scopes: ANY_CHANNEL },
      { flag: Permission.createInstantInvite, label: '招待の作成', description: 'メンバーを招待できます。', scopes: ANY_CHANNEL },
    ],
  },
  {
    title: 'テキストチャンネルの権限',
    items: [
      { flag: Permission.sendMessages, label: 'メッセージを送信', description: 'このチャンネルにメッセージを送信できます。', scopes: ['text'] },
      { flag: Permission.manageThreads, label: 'スレッドの管理', description: 'スレッドの変更、削除、非公開スレッドの閲覧ができます。', scopes: ['text'] },
      { flag: Permission.sendMessagesInThreads, label: 'スレッドでメッセージを送信', description: 'スレッドにメッセージを送信できます。', scopes: ['text'] },
      { flag: Permission.embedLinks, label: '埋め込みリンク', description: '送信したリンクの内容を埋め込みで表示します。', scopes: ['text'] },
      { flag: Permission.attachFiles, label: 'ファイルを添付', description: 'ファイルを添付できます。', scopes: ['text'] },
      { flag: Permission.addReactions, label: 'リアクションの追加', description: 'メッセージにリアクションを追加できます。', scopes: ['text'] },
      { flag: Permission.useExternalEmojis, label: '外部の絵文字を使用', description: '他のサーバーの絵文字を使えます。', scopes: ['text'] },
      { flag: Permission.mentionEveryone, label: '@everyone へのメンション', description: '@everyone と @here でメンションできます。', scopes: ['text'] },
      { flag: Permission.manageMessages, label: 'メッセージの管理', description: '他のメンバーのメッセージを削除できます。', scopes: ['text'] },
      { flag: Permission.readMessageHistory, label: 'メッセージ履歴を読む', description: '過去のメッセージを閲覧できます。', scopes: ['text'] },
      { flag: Permission.useApplicationCommands, label: 'アプリケーションコマンドの使用', description: 'Bot のコマンドを実行できます。', scopes: ANY_CHANNEL },
    ],
  },
  {
    title: 'ボイスチャンネルの権限',
    items: [
      { flag: Permission.connect, label: '接続', description: 'ボイスチャンネルに接続できます。', scopes: ['voice'] },
      { flag: Permission.speak, label: '発言', description: 'ボイスチャンネルで発言できます。', scopes: ['voice'] },
      { flag: Permission.stream, label: '配信', description: '画面を配信できます。', scopes: ['voice'] },
      { flag: Permission.useVad, label: '音声検出の使用', description: 'キーを押さずに発言できます。', scopes: ['voice'] },
      { flag: Permission.prioritySpeaker, label: '優先スピーカー', description: '発言したときに他の人の音量を下げます。', scopes: ['voice'] },
      { flag: Permission.muteMembers, label: 'メンバーをミュート', description: '他のメンバーをミュートできます。', scopes: ['voice'] },
      { flag: Permission.deafenMembers, label: 'メンバーのスピーカーをミュート', description: '他のメンバーの音声を聞こえなくできます。', scopes: ['voice'] },
      { flag: Permission.moveMembers, label: 'メンバーを移動', description: '他のメンバーを別のチャンネルへ移動できます。', scopes: ['voice'] },
    ],
  },
];

/** チャンネルのロールごとの権限の上書き。 */
/** 権限の設定の対象。 */
export const OverwriteType = { role: 0, member: 1 } as const;

export interface PermissionOverwrite {
  id: string;
  type: number;
  allow: string;
  deny: string;
}

interface GuildLike {
  id: string;
  owner_id: string;
  roles: { id: string; permissions: string }[];
  members: Record<string, { roles: string[] } | undefined>;
}

/** Discord の公開ドキュメントの手順で、ユーザーの権限を求める。チャンネルを省略するとサーバーの権限を返す。 */
export function computePermissions(guild: GuildLike, userId: string, overwrites: PermissionOverwrite[] = []): bigint {
  const member = guild.members[userId];
  if (!member) return 0n;
  if (guild.owner_id === userId) return ALL_PERMISSIONS;
  const held = new Set([guild.id, ...member.roles]);
  const base = guild.roles
    .filter((role) => held.has(role.id))
    .reduce((total, role) => total | BigInt(role.permissions), 0n);
  if (base & Permission.administrator) return ALL_PERMISSIONS;

  const apply = (permissions: bigint, overwrite?: { allow: bigint; deny: bigint }) =>
    overwrite ? (permissions & ~overwrite.deny) | overwrite.allow : permissions;
  const toBits = (overwrite?: PermissionOverwrite) => overwrite && { allow: BigInt(overwrite.allow), deny: BigInt(overwrite.deny) };
  const roleOverwrites = overwrites.filter((overwrite) => overwrite.type !== OverwriteType.member);
  const everyone = roleOverwrites.find((overwrite) => overwrite.id === guild.id);
  const roles = roleOverwrites.filter((overwrite) => overwrite.id !== guild.id && held.has(overwrite.id));
  const own = overwrites.find((overwrite) => overwrite.type === OverwriteType.member && overwrite.id === userId);
  const combined = roles.reduce(
    (total, overwrite) => ({ allow: total.allow | BigInt(overwrite.allow), deny: total.deny | BigInt(overwrite.deny) }),
    { allow: 0n, deny: 0n },
  );
  // @everyone、ロール、メンバーの順に適用する。
  return apply(apply(apply(base, toBits(everyone)), combined), toBits(own));
}

/** 権限の上書きを、順番によらず比べられる形にする。 */
const overwriteKey = (overwrites: PermissionOverwrite[] | undefined) =>
  JSON.stringify(
    [...(overwrites ?? [])]
      .map(({ id, type, allow, deny }) => ({ id, type: Number(type), allow: String(allow), deny: String(deny) }))
      .sort((a, b) => a.id.localeCompare(b.id)),
  );

/** チャンネルの権限の上書きが、親のカテゴリーと同じ（同期している）か。 */
export const isSynced = (
  channel: { permission_overwrites?: PermissionOverwrite[] },
  category: { permission_overwrites?: PermissionOverwrite[] },
): boolean => overwriteKey(channel.permission_overwrites) === overwriteKey(category.permission_overwrites);
