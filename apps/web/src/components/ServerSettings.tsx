import { AuditLogEvent, AutoModAction, AutoModTrigger, ChannelType, GUILD_EMOJI_LIMIT, GUILD_STICKER_LIMIT, SystemChannelFlag } from '@dismock/server/constants';
import { PERMISSION_GROUPS } from '@dismock/server/permissions';
import { useCallback, useState, type ChangeEvent, type DragEvent } from 'react';
import { api, type Json } from '../api';
import { DRAG_TYPE, isLowerHalf, moveItem, type DropTarget } from '../reorder';
import { Avatar, colorOf, displayName } from './Avatar';
import { ConfirmDialog } from './ConfirmDialog';
import { Select } from './Select';
import { durationLabel, InviteTable, readImageFile, ToggleRow, UnsavedBar, useGuardedClose, WebhookRow } from './SettingsParts';

export type ServerSection =
  | 'profile' | 'engagement' | 'emojis' | 'stickers' | 'members' | 'roles' | 'invites' | 'integrations'
  | 'safety' | 'audit' | 'bans' | 'automod';

/** Discord のサーバー設定と同じ並び。コミュニティ、ブースト、サウンドボードは扱わない。 */
const NAV: { label?: string; items: [ServerSection, string][] }[] = [
  { items: [['profile', 'サーバープロフィール'], ['engagement', 'エンゲージメント']] },
  { label: 'エクスプレッション', items: [['emojis', '絵文字'], ['stickers', 'スタンプ']] },
  { label: '人物', items: [['members', 'メンバー'], ['roles', 'ロール'], ['invites', '招待']] },
  { label: 'アプリ', items: [['integrations', '連携サービス']] },
  { label: '管理', items: [['safety', '安全設定'], ['audit', '監査ログ'], ['bans', 'BANしたユーザー'], ['automod', 'AutoMod']] },
];

const DEFAULT_ROLE_NAME = '新しいロール';
const NO_COLOR = '#000000';
const toHexColor = (color: number) => `#${color.toString(16).padStart(6, '0')}`;
const DISCORD_EPOCH = 1420070400000n;
const createdAt = (id: string) => new Date(Number((BigInt(id) >> 22n) + DISCORD_EPOCH));
const DESCRIPTION_MAX_LENGTH = 120;
const EMOJI_NAME_PATTERN = /[^\w]/g;
const IMAGE_TYPES = 'image/png,image/jpeg,image/gif,image/webp';
const STICKER_TYPES = 'image/png,image/apng,image/gif';
const TIMEOUT_SECONDS = [60, 300, 600, 3600, 86400, 604800];

const VERIFICATION_LEVELS = [
  { value: '0', label: 'なし', description: '制限はありません。' },
  { value: '1', label: '低', description: 'メールアドレスの認証が必要です。' },
  { value: '2', label: '中', description: 'アカウントの作成から 5 分以上が必要です。' },
  { value: '3', label: '高', description: 'サーバーのメンバーになってから 10 分以上が必要です。' },
  { value: '4', label: '最高', description: '電話番号の認証が必要です。' },
];
const CONTENT_FILTERS = [
  { value: '0', label: '無効' },
  { value: '1', label: 'ロールのないメンバーのメディアをスキャン' },
  { value: '2', label: 'すべてのメンバーのメディアをスキャン' },
];
const NOTIFICATION_LEVELS = [
  { value: '0', label: 'すべてのメッセージ' },
  { value: '1', label: '@mentions のみ' },
];

/** 監査ログの種類の表示名。 */
const AUDIT_LABELS: Record<number, string> = {
  [AuditLogEvent.guildUpdate]: 'サーバーを更新',
  [AuditLogEvent.channelCreate]: 'チャンネルを作成',
  [AuditLogEvent.channelUpdate]: 'チャンネルを更新',
  [AuditLogEvent.channelDelete]: 'チャンネルを削除',
  [AuditLogEvent.memberKick]: 'メンバーをキック',
  [AuditLogEvent.memberBanAdd]: 'メンバーを BAN',
  [AuditLogEvent.memberBanRemove]: 'BAN を解除',
  [AuditLogEvent.memberUpdate]: 'メンバーを更新',
  [AuditLogEvent.memberRoleUpdate]: 'メンバーのロールを更新',
  [AuditLogEvent.roleCreate]: 'ロールを作成',
  [AuditLogEvent.roleUpdate]: 'ロールを更新',
  [AuditLogEvent.roleDelete]: 'ロールを削除',
  [AuditLogEvent.inviteCreate]: '招待を作成',
  [AuditLogEvent.inviteDelete]: '招待を削除',
  [AuditLogEvent.webhookCreate]: 'ウェブフックを作成',
  [AuditLogEvent.webhookUpdate]: 'ウェブフックを更新',
  [AuditLogEvent.webhookDelete]: 'ウェブフックを削除',
  [AuditLogEvent.emojiCreate]: '絵文字を作成',
  [AuditLogEvent.emojiUpdate]: '絵文字を更新',
  [AuditLogEvent.emojiDelete]: '絵文字を削除',
  [AuditLogEvent.messageDelete]: 'メッセージを削除',
  [AuditLogEvent.stickerCreate]: 'スタンプを作成',
  [AuditLogEvent.stickerUpdate]: 'スタンプを更新',
  [AuditLogEvent.stickerDelete]: 'スタンプを削除',
  [AuditLogEvent.threadCreate]: 'スレッドを作成',
  [AuditLogEvent.threadUpdate]: 'スレッドを更新',
  [AuditLogEvent.threadDelete]: 'スレッドを削除',
  [AuditLogEvent.autoModerationRuleCreate]: 'AutoMod のルールを作成',
  [AuditLogEvent.autoModerationRuleUpdate]: 'AutoMod のルールを更新',
  [AuditLogEvent.autoModerationRuleDelete]: 'AutoMod のルールを削除',
  [AuditLogEvent.autoModerationBlockMessage]: 'AutoMod がメッセージをブロック',
  [AuditLogEvent.autoModerationFlagToChannel]: 'AutoMod がメッセージを通知',
  [AuditLogEvent.autoModerationUserCommunicationDisabled]: 'AutoMod がタイムアウト',
};

/** サーバーの項目の下書き。プロフィール、エンゲージメント、安全設定を「変更を保存」でまとめて反映する。 */
function draftOf(guild: Json): Json {
  return {
    name: guild.name,
    description: guild.description ?? '',
    icon: guild.icon ?? null,
    system_channel_id: guild.system_channel_id ?? null,
    system_channel_flags: guild.system_channel_flags ?? 0,
    default_message_notifications: guild.default_message_notifications ?? 0,
    verification_level: guild.verification_level ?? 0,
    explicit_content_filter: guild.explicit_content_filter ?? 0,
  };
}

/** アイコンはハッシュか、新しく選んだ画像の data URI。 */
const iconSource = (icon: string | null, state: Json) => (icon ? (icon.startsWith('data:') ? icon : state.media[icon]) : undefined);

interface SectionProps {
  guild: Json;
  state: Json;
  onError: (message: string) => void;
}

interface DraftProps {
  draft: Json;
  onChange: (patch: Json) => void;
}

function GuildIcon({ guild, icon, state, size }: { guild: Json; icon: string | null; state: Json; size: number }) {
  const source = iconSource(icon, state);
  return source
    ? <img className="guild-icon" src={source} alt="" width={size} height={size} />
    : <span className="guild-icon placeholder" style={{ width: size, height: size, background: colorOf(guild.id) }}>{guild.name.slice(0, 2)}</span>;
}

function ProfileSection({ guild, state, draft, onChange, onError }: SectionProps & DraftProps) {
  const pickIcon = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (file) readImageFile(file).then((icon) => onChange({ icon }), (error: Error) => onError(error.message));
  };
  const members = Object.keys(guild.members).length;
  const created = createdAt(guild.id);
  return (
    <div className="profile-layout">
      <div className="settings-form">
        <h1>サーバープロフィール</h1>
        <p className="settings-lead">招待リンクなどに表示される、サーバーの外観を設定します。</p>
        <label className="field">
          <span>名前</span>
          <input value={draft.name} onChange={(event) => onChange({ name: event.target.value })} />
        </label>
        <hr className="settings-rule" />
        <div className="field">
          <span>アイコン</span>
          <small>推奨画像サイズは 512x512 以上です。</small>
          <div className="button-row">
            <label className="button primary file-button">
              サーバーアイコンを変更
              <input type="file" accept={IMAGE_TYPES} onChange={pickIcon} />
            </label>
            {draft.icon && <button className="permission-delete inline" onClick={() => onChange({ icon: null })}>アイコンを削除</button>}
          </div>
        </div>
        <hr className="settings-rule" />
        <label className="field">
          <span>説明</span>
          <textarea rows={3} maxLength={DESCRIPTION_MAX_LENGTH} value={draft.description} placeholder="サーバーの紹介を書きましょう"
            onChange={(event) => onChange({ description: event.target.value })} />
          <small className="field-count">{draft.description.length}/{DESCRIPTION_MAX_LENGTH}</small>
        </label>
      </div>
      <aside className="profile-preview" aria-label="プレビュー">
        <div className="profile-preview-banner" style={{ background: colorOf(guild.id) }} />
        <div className="profile-preview-icon"><GuildIcon guild={guild} icon={draft.icon} state={state} size={64} /></div>
        <strong>{draft.name}</strong>
        <small><span className="presence-dot" />{members}人のメンバー</small>
        <small>創設：{created.getFullYear()}年{created.getMonth() + 1}月</small>
        {draft.description && <p>{draft.description}</p>}
      </aside>
    </div>
  );
}

function EngagementSection({ guild, state, draft, onChange }: SectionProps & DraftProps) {
  const textChannels = Object.values<Json>(state.channels).filter((channel) => channel.guild_id === guild.id && channel.type === ChannelType.text);
  const flags = draft.system_channel_flags as number;
  // Discord の画面は「送信する」で表すので、抑制のビットを反転して扱う。
  const toggle = (flag: number, label: string, description: string) => (
    <ToggleRow label={label} description={description} checked={(flags & flag) === 0}
      onChange={(enabled) => onChange({ system_channel_flags: enabled ? flags & ~flag : flags | flag })} />
  );
  return (
    <div className="settings-form">
      <h1>エンゲージメント</h1>
      <div className="field">
        <span>システムメッセージのチャンネル</span>
        <Select label="システムメッセージのチャンネル" value={draft.system_channel_id ?? ''} onChange={(id) => onChange({ system_channel_id: id || null })}
          options={[{ value: '', label: 'システムメッセージなし' }, ...textChannels.map((channel) => ({ value: channel.id as string, label: `#${channel.name}` }))]} />
        <small>新しいメンバーの参加などを知らせるチャンネルです。</small>
      </div>
      {toggle(SystemChannelFlag.suppressJoinNotifications, '新しいメンバーの参加時にウェルカムメッセージを送信', 'メンバーが参加すると、システムメッセージのチャンネルに知らせます。')}
      {toggle(SystemChannelFlag.suppressJoinNotificationReplies, 'ウェルカムメッセージにスタンプで返信するよう促す', 'ウェルカムメッセージに返信のボタンを表示します。')}
      {toggle(SystemChannelFlag.suppressPremiumSubscriptions, 'サーバーがブーストされたときにメッセージを送信', 'Mock にブーストはないので、設定だけを保存します。')}
      {toggle(SystemChannelFlag.suppressGuildReminderNotifications, 'サーバー設定のヒントを送信', 'Mock では設定だけを保存します。')}
      <div className="field">
        <span>通知の既定値</span>
        <Select label="通知の既定値" value={String(draft.default_message_notifications)} options={NOTIFICATION_LEVELS}
          onChange={(value) => onChange({ default_message_notifications: Number(value) })} />
      </div>
    </div>
  );
}

function EmojisSection({ guild, state, onError }: SectionProps) {
  const fail = (error: Error) => onError(error.message);
  const emojis = (guild.emojis ?? []) as Json[];
  const upload = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    const name = file.name.replace(/\.[^.]+$/, '').replace(EMOJI_NAME_PATTERN, '_').padEnd(2, '_');
    readImageFile(file).then((image) => api.post(`/guilds/${guild.id}/emojis`, { name, image })).catch(fail);
  };
  return (
    <div className="settings-form wide">
      <h1>絵文字</h1>
      <p className="settings-lead">メンバーがこのサーバーで使える絵文字を、{GUILD_EMOJI_LIMIT} 個まで追加できます。名前は英数字と _ で 2 文字以上です。</p>
      <label className="button primary file-button">
        絵文字をアップロード
        <input type="file" accept={IMAGE_TYPES} disabled={emojis.length >= GUILD_EMOJI_LIMIT} onChange={upload} />
      </label>
      <h3 className="settings-subhead">絵文字 — 残り {GUILD_EMOJI_LIMIT - emojis.length} 個</h3>
      <table className="admin-table">
        <thead><tr><th>画像</th><th>名前</th><th>アップロードした人</th><th /></tr></thead>
        <tbody>
          {emojis.map((emoji) => (
            <tr key={emoji.id}>
              <td><img className="emoji-image" src={state.media[emoji.id]} alt={emoji.name} /></td>
              <td><EmojiName guildId={guild.id} emoji={emoji} onError={onError} /></td>
              <td>{displayName(emoji.user)}</td>
              <td>
                <button className="link-danger" aria-label={`${emoji.name} を削除`} onClick={() => void api.delete(`/guilds/${guild.id}/emojis/${emoji.id}`).catch(fail)}>削除</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function EmojiName({ guildId, emoji, onError }: { guildId: string; emoji: Json; onError: (message: string) => void }) {
  const [name, setName] = useState<string>(emoji.name);
  return (
    <input value={name} aria-label="絵文字の名前" onChange={(event) => setName(event.target.value)}
      onBlur={() => {
        if (name !== emoji.name) api.patch(`/guilds/${guildId}/emojis/${emoji.id}`, { name }).catch((error: Error) => onError(error.message));
      }} />
  );
}

function StickersSection({ guild, state, onError }: SectionProps) {
  const [name, setName] = useState('');
  const [tags, setTags] = useState('');
  const fail = (error: Error) => onError(error.message);
  const stickers = (guild.stickers ?? []) as Json[];
  const upload = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file || !name.trim()) return;
    readImageFile(file)
      .then((data) => api.post(`/guilds/${guild.id}/stickers`, { name: name.trim(), tags: tags.trim(), file: data }))
      .then(() => {
        setName('');
        setTags('');
      }, fail);
  };
  return (
    <div className="settings-form wide">
      <h1>スタンプ</h1>
      <p className="settings-lead">メンバーがメッセージに付けられるスタンプを、{GUILD_STICKER_LIMIT} 個まで追加できます。PNG、APNG、GIF で 512KB 以下です。</p>
      <div className="add-form">
        <input value={name} placeholder="スタンプの名前" aria-label="スタンプの名前" onChange={(event) => setName(event.target.value)} />
        <input value={tags} placeholder="関連する絵文字" aria-label="関連する絵文字" onChange={(event) => setTags(event.target.value)} />
        <label className={name.trim() ? 'button primary file-button' : 'button primary file-button disabled'}>
          スタンプをアップロード
          <input type="file" accept={STICKER_TYPES} disabled={!name.trim() || stickers.length >= GUILD_STICKER_LIMIT} onChange={upload} />
        </label>
      </div>
      <h3 className="settings-subhead">スタンプ — 残り {GUILD_STICKER_LIMIT - stickers.length} 個</h3>
      <ul className="sticker-grid">
        {stickers.map((sticker) => (
          <li key={sticker.id}>
            <img src={state.media[sticker.id]} alt={sticker.name} />
            <strong>{sticker.name}</strong>
            <small>{sticker.tags}</small>
            <button className="link-danger" aria-label={`${sticker.name} を削除`} onClick={() => void api.delete(`/guilds/${guild.id}/stickers/${sticker.id}`).catch(fail)}>削除</button>
          </li>
        ))}
      </ul>
    </div>
  );
}

interface RoleProps {
  guild: Json;
  onError: (message: string) => void;
}

function RoleEditor({ guild, role, onDelete, onError }: RoleProps & { role: Json; onDelete: () => void }) {
  const [name, setName] = useState<string>(role.name);
  const isEveryone = role.id === guild.id;
  const locked = isEveryone || role.managed;
  const permissions = BigInt(role.permissions as string);
  const update = (patch: Json) => {
    api.patch(`/guilds/${guild.id}/roles/${role.id}`, patch).catch((error: Error) => onError(error.message));
  };
  const toggle = (flag: bigint, enabled: boolean) =>
    update({ permissions: String(enabled ? permissions | flag : permissions & ~flag) });

  return (
    <div>
      <h1>ロールの編集 — {role.name}</h1>
      <label className="field">
        <span>ロール名</span>
        <input value={name} disabled={locked} onChange={(event) => setName(event.target.value)}
          onBlur={() => { if (name.trim() && name !== role.name) update({ name: name.trim() }); }} />
      </label>
      {!locked && (
        <>
          <label className="field">
            <span>ロールの色</span>
            <input type="color" value={role.color ? toHexColor(role.color) : NO_COLOR} aria-label="ロールの色"
              onChange={(event) => update({ color: Number.parseInt(event.target.value.slice(1), 16) })} />
          </label>
          <div className="role-options">
            <label className="check-label">
              <input type="checkbox" checked={role.hoist} onChange={(event) => update({ hoist: event.target.checked })} />
              メンバーを別に表示する
            </label>
            <label className="check-label">
              <input type="checkbox" checked={role.mentionable} onChange={(event) => update({ mentionable: event.target.checked })} />
              メンションを許可する
            </label>
          </div>
        </>
      )}
      {PERMISSION_GROUPS.map((group) => (
        <section key={group.title} className="permission-group">
          <h3>{group.title}</h3>
          {group.items.map((item) => (
            <label key={item.label} className="permission-row">
              <div>
                <strong>{item.label}</strong>
                <p>{item.description}</p>
              </div>
              <input type="checkbox" className="switch" checked={(permissions & item.flag) !== 0n}
                aria-label={item.label} onChange={(event) => toggle(item.flag, event.target.checked)} />
            </label>
          ))}
        </section>
      ))}
      {!locked && (
        <div className="role-toolbar">
          <button className="button danger" onClick={onDelete}>ロールを削除</button>
        </div>
      )}
    </div>
  );
}

function RolesSection({ guild, onError }: RoleProps) {
  const roles = [...(guild.roles as Json[])].sort((a, b) => b.position - a.position);
  const [selectedId, setSelectedId] = useState<string>(guild.id);
  const [deleting, setDeleting] = useState<Json | null>(null);
  const closeDeleting = useCallback(() => setDeleting(null), []);
  const selected = roles.find((role) => role.id === selectedId) ?? roles.find((role) => role.id === guild.id);

  const create = () => {
    api
      .post(`/guilds/${guild.id}/roles`, { name: DEFAULT_ROLE_NAME })
      .then((role: Json) => setSelectedId(role.id), (error: Error) => onError(error.message));
  };
  const remove = (role: Json) => {
    api.delete(`/guilds/${guild.id}/roles/${role.id}`).catch((error: Error) => onError(error.message));
  };

  // ドラッグで並び替える。上ほど位置が高い。@everyone は常に一番下で、動かせない。
  const [dragging, setDragging] = useState<Json | null>(null);
  const [drop, setDrop] = useState<DropTarget | null>(null);
  const movable = roles.filter((role) => role.id !== guild.id);
  const isEveryone = (role: Json) => role.id === guild.id;
  const reorder = (target: Json, after: boolean) => {
    if (!dragging) return;
    const ordered = moveItem(movable, dragging, target.id, after);
    const entries = ordered.map((role, index) => ({ id: role.id, position: ordered.length - index }));
    api.patch(`/guilds/${guild.id}/roles`, entries).catch((error: Error) => onError(error.message));
  };
  const endDrag = () => {
    setDragging(null);
    setDrop(null);
  };
  const dragProps = (role: Json) => isEveryone(role) ? {} : {
    draggable: true,
    onDragStart: (event: DragEvent<HTMLElement>) => {
      event.dataTransfer.setData(DRAG_TYPE, role.id);
      event.dataTransfer.effectAllowed = 'move';
      setDragging(role);
    },
    onDragOver: (event: DragEvent<HTMLElement>) => {
      if (!dragging || dragging.id === role.id) return;
      event.preventDefault();
      const after = isLowerHalf(event);
      if (!drop || drop.id !== role.id || drop.after !== after) setDrop({ id: role.id, after });
    },
    onDrop: (event: DragEvent<HTMLElement>) => {
      if (!dragging || dragging.id === role.id) return;
      event.preventDefault();
      reorder(role, isLowerHalf(event));
      endDrag();
    },
    onDragEnd: endDrag,
  };
  const dropClass = (role: Json) => (!drop || drop.id !== role.id ? '' : drop.after ? ' drop-after' : ' drop-before');

  return (
    <div className="role-layout">
      <div className="role-list">
        <button className="button primary" onClick={create}>ロールを作成</button>
        {roles.map((role) => (
          <button key={role.id} className={(role.id === selected?.id ? 'role-item active' : 'role-item') + dropClass(role)}
            title={isEveryone(role) ? undefined : 'ドラッグで並び替え'} onClick={() => setSelectedId(role.id)} {...dragProps(role)}>
            <span className="role-dot" style={{ background: role.color ? toHexColor(role.color) : 'var(--text-muted)' }} />
            {role.name}
          </button>
        ))}
      </div>
      {selected && <RoleEditor key={selected.id} guild={guild} role={selected} onDelete={() => setDeleting(selected)} onError={onError} />}
      {deleting && (
        <ConfirmDialog title="ロールの削除" message={`「${deleting.name}」を削除しますか？元に戻せません。`} confirmLabel="削除"
          onClose={closeDeleting} onConfirm={() => remove(deleting)} />
      )}
    </div>
  );
}

/** ログイン中のユーザーの権限に関係なく、メンバーのロールを設定する。新しいサーバーでも最初のロールを付与できるようにするため。 */
function MembersSection({ guild, state, onError }: SectionProps) {
  const [confirming, setConfirming] = useState<{ kind: 'kick' | 'ban'; member: Json } | null>(null);
  const closeConfirming = useCallback(() => setConfirming(null), []);
  const members = Object.values<Json>(guild.members);
  const roles = (guild.roles as Json[]).filter((role) => role.id !== guild.id && !role.managed);
  const fail = (error: Error) => onError(error.message);
  const setRoles = (member: Json, next: string[]) => {
    api.put(`/guilds/${guild.id}/members/${member.user.id}`, { roles: next }).catch(fail);
  };
  const roleColor = (role: Json) => (role.color ? toHexColor(role.color) : 'var(--text-muted)');
  const run = () => {
    if (!confirming) return;
    const { kind, member } = confirming;
    const path = kind === 'kick' ? `/guilds/${guild.id}/members/${member.user.id}` : `/guilds/${guild.id}/bans/${member.user.id}`;
    void (kind === 'kick' ? api.delete(path) : api.put(path)).catch(fail);
  };
  return (
    <div>
      <h1>メンバー</h1>
      <table className="admin-table">
        <thead><tr><th>名前</th><th>ロール</th><th /></tr></thead>
        <tbody>
          {members.map((member) => {
            const held = roles.filter((role) => member.roles.includes(role.id));
            const addable = roles.filter((role) => !member.roles.includes(role.id));
            return (
              <tr key={member.user.id}>
                <td><div className="member-cell"><Avatar user={member.user} size={24} />{member.nick ?? displayName(member.user)}</div></td>
                <td>
                  {/* 権限はロールから決まる。管理者にするときは、管理者の権限を持つロールを付ける。 */}
                  <div className="member-roles">
                    {held.map((role) => (
                      <span key={role.id} className="role-chip">
                        <span className="role-dot" style={{ background: roleColor(role) }} />
                        {role.name}
                        <button aria-label={`${role.name} を外す`} title="外す"
                          onClick={() => setRoles(member, (member.roles as string[]).filter((id) => id !== role.id))}>×</button>
                      </span>
                    ))}
                    {addable.length > 0 && (
                      <Select className="role-add" label="ロールを付ける" value="" placeholder="+"
                        options={addable.map((role) => ({ value: role.id as string, label: role.name as string }))}
                        onChange={(roleId) => setRoles(member, [...member.roles, roleId])} />
                    )}
                  </div>
                </td>
                <td>
                  {member.user.id !== state.botUserId && (
                    <div className="row-actions">
                      <button className="link-danger" onClick={() => setConfirming({ kind: 'kick', member })}>キック</button>
                      <button className="link-danger" onClick={() => setConfirming({ kind: 'ban', member })}>BAN</button>
                    </div>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {confirming && (
        <ConfirmDialog title={confirming.kind === 'kick' ? 'メンバーをキック' : 'メンバーを BAN'}
          message={`「${displayName(confirming.member.user)}」を${confirming.kind === 'kick' ? 'キック' : 'BAN'}しますか？`}
          confirmLabel={confirming.kind === 'kick' ? 'キック' : 'BAN'} onClose={closeConfirming} onConfirm={run} />
      )}
    </div>
  );
}

function GuildInvitesSection({ guild, state, onError }: SectionProps) {
  const invites = Object.values<Json>(state.invites).filter((invite) => invite.guild_id === guild.id);
  return (
    <div>
      <h1>招待</h1>
      <p className="settings-lead">このサーバーのすべての招待です。招待はチャンネルの設定か、チャンネルの右クリックで作成します。</p>
      <InviteTable invites={invites} state={state} showChannel onError={onError} />
    </div>
  );
}

function IntegrationsSection({ guild, state, onError }: SectionProps) {
  const fail = (error: Error) => onError(error.message);
  const webhooks = Object.values<Json>(state.webhooks).filter((webhook) => webhook.guild_id === guild.id);
  const incoming = webhooks.filter((webhook) => webhook.source_channel === undefined);
  const following = webhooks.filter((webhook) => webhook.source_channel !== undefined);
  const bot = state.users[state.botUserId];
  return (
    <div>
      <h1>連携サービス</h1>
      <section className="integration-section">
        <h2 className="settings-subhead">Bot とアプリ</h2>
        <div className="integration-card"><Avatar user={bot} size={32} /><strong>{displayName(bot)}</strong><small>Mock の Bot</small></div>
      </section>
      <section className="integration-section">
        <h2 className="settings-subhead">ウェブフック — {incoming.length}件</h2>
        <p className="settings-lead">ウェブフックの作成はチャンネルの設定の「連携サービス」で行います。</p>
        <ul className="admin-list integration-list">
          {incoming.map((webhook) => (
            <div key={webhook.id} className="integration-row">
              <small>#{state.channels[webhook.channel_id]?.name}</small>
              <WebhookRow webhook={webhook} onError={onError} />
            </div>
          ))}
        </ul>
      </section>
      <section className="integration-section">
        <h2 className="settings-subhead">フォロー中のチャンネル — {following.length}件</h2>
        <ul className="admin-list integration-list">
          {following.map((webhook) => (
            <li key={webhook.id}>
              <span>{webhook.source_guild.name} #{webhook.source_channel.name} → #{state.channels[webhook.channel_id]?.name}</span>
              <button className="link-danger" onClick={() => void api.delete(`/webhooks/${webhook.id}`).catch(fail)}>フォロー解除</button>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

function SafetySection({ draft, onChange }: DraftProps) {
  const level = VERIFICATION_LEVELS.find((candidate) => candidate.value === String(draft.verification_level));
  return (
    <div className="settings-form">
      <h1>安全設定</h1>
      <div className="field">
        <span>認証レベル</span>
        <Select label="認証レベル" value={String(draft.verification_level)} options={VERIFICATION_LEVELS}
          onChange={(value) => onChange({ verification_level: Number(value) })} />
        <small>{level?.description} Mock では設定だけを保存し、メンバーを制限しません。</small>
      </div>
      <div className="field">
        <span>不適切なメディアのフィルター</span>
        <Select label="不適切なメディアのフィルター" value={String(draft.explicit_content_filter)} options={CONTENT_FILTERS}
          onChange={(value) => onChange({ explicit_content_filter: Number(value) })} />
      </div>
    </div>
  );
}

/** 監査ログの対象の名前。消えた対象は ID を表示する。 */
function targetName(entry: Json, guild: Json, state: Json): string {
  const id = entry.target_id as string | null;
  if (!id) return entry.changes?.find((change: Json) => change.key === 'code')?.new_value ?? entry.changes?.find((change: Json) => change.key === 'code')?.old_value ?? '';
  const named = state.users[id] ? displayName(state.users[id])
    : state.channels[id] ? `#${state.channels[id].name}`
      : (guild.roles as Json[]).find((role) => role.id === id)?.name
        ?? state.webhooks[id]?.name ?? state.autoModRules[id]?.name
        ?? (guild.emojis as Json[] | undefined)?.find((emoji) => emoji.id === id)?.name
        ?? (guild.id === id ? guild.name : undefined);
  const deletedName = entry.changes?.find((change: Json) => change.key === 'name')?.old_value;
  return named ?? deletedName ?? id;
}

function AuditLogSection({ guild, state }: SectionProps) {
  const [userId, setUserId] = useState('');
  const [actionType, setActionType] = useState('');
  const entries = ((state.auditLogs[guild.id] ?? []) as Json[])
    .filter((entry) => !userId || entry.user_id === userId)
    .filter((entry) => !actionType || entry.action_type === Number(actionType));
  const executors = [...new Set(((state.auditLogs[guild.id] ?? []) as Json[]).map((entry) => entry.user_id as string))];
  return (
    <div>
      <h1>監査ログ</h1>
      <div className="add-form">
        <Select label="ユーザーで絞り込む" value={userId} onChange={setUserId}
          options={[{ value: '', label: 'すべてのユーザー' }, ...executors.map((id) => ({ value: id, label: displayName(state.users[id]) ?? id }))]} />
        <Select label="操作で絞り込む" value={actionType} onChange={setActionType}
          options={[{ value: '', label: 'すべての操作' }, ...Object.entries(AUDIT_LABELS).map(([value, label]) => ({ value, label }))]} />
      </div>
      {entries.length === 0 && <p className="permission-empty">記録はありません。</p>}
      <ul className="audit-list">
        {entries.map((entry) => (
          <li key={entry.id}>
            <details>
              <summary>
                <Avatar user={state.users[entry.user_id]} size={28} />
                <span className="audit-text"><strong>{displayName(state.users[entry.user_id]) ?? entry.user_id}</strong> が {AUDIT_LABELS[entry.action_type] ?? `操作 ${entry.action_type}`}{' '}
                  <strong>{targetName(entry, guild, state)}</strong></span>
                <time>{createdAt(entry.id).toLocaleString()}</time>
              </summary>
              {entry.reason && <p className="audit-reason">理由: {entry.reason}</p>}
              {(entry.changes as Json[]).length > 0 && (
                <ul className="audit-changes">
                  {(entry.changes as Json[]).map((change, index) => (
                    <li key={index}><code>{change.key}</code>: {JSON.stringify(change.old_value ?? null)} → {JSON.stringify(change.new_value ?? null)}</li>
                  ))}
                </ul>
              )}
            </details>
          </li>
        ))}
      </ul>
    </div>
  );
}

function BansSection({ guild, state, onError }: SectionProps) {
  const bans = Object.values<Json>(state.bans[guild.id] ?? {});
  return (
    <div>
      <h1>BANしたユーザー</h1>
      {bans.length === 0 && <p className="permission-empty">BAN したユーザーはいません。</p>}
      <ul className="admin-list">
        {bans.map((ban) => (
          <li key={ban.user.id}>
            <Avatar user={ban.user} size={24} />
            <span>{displayName(ban.user)}</span>
            {ban.reason && <small>{ban.reason}</small>}
            <code>{ban.user.id}</code>
            <button className="link-danger" onClick={() => void api.delete(`/guilds/${guild.id}/bans/${ban.user.id}`).catch((error: Error) => onError(error.message))}>BAN を解除</button>
          </li>
        ))}
      </ul>
    </div>
  );
}

const splitWords = (text: string) => text.split(/[,\n]/).map((word) => word.trim()).filter(Boolean);

function AutoModForm({ guild, state, onError }: SectionProps) {
  const [name, setName] = useState('');
  const [trigger, setTrigger] = useState(String(AutoModTrigger.keyword));
  const [keywords, setKeywords] = useState('');
  const [allowList, setAllowList] = useState('');
  const [mentionLimit, setMentionLimit] = useState('5');
  const [block, setBlock] = useState(true);
  const [customMessage, setCustomMessage] = useState('');
  const [alertChannel, setAlertChannel] = useState('');
  const [timeout, setTimeoutSeconds] = useState('');
  const [exemptRoles, setExemptRoles] = useState<string[]>([]);
  const textChannels = Object.values<Json>(state.channels).filter((channel) => channel.guild_id === guild.id && channel.type === ChannelType.text);
  const roles = (guild.roles as Json[]).filter((role) => role.id !== guild.id);
  const isKeyword = Number(trigger) === AutoModTrigger.keyword;
  const actions = [
    ...(block ? [{ type: AutoModAction.blockMessage, metadata: customMessage ? { custom_message: customMessage } : {} }] : []),
    ...(alertChannel ? [{ type: AutoModAction.sendAlertMessage, metadata: { channel_id: alertChannel } }] : []),
    ...(timeout ? [{ type: AutoModAction.timeout, metadata: { duration_seconds: Number(timeout) } }] : []),
  ];
  const ready = name.trim() && actions.length > 0 && (!isKeyword || splitWords(keywords).length > 0);
  const create = () => {
    const trigger_metadata = isKeyword
      ? { keyword_filter: splitWords(keywords), allow_list: splitWords(allowList) }
      : { mention_total_limit: Number(mentionLimit) };
    api.post(`/guilds/${guild.id}/auto-moderation/rules`, {
      name: name.trim(), trigger_type: Number(trigger), trigger_metadata, actions, enabled: true, exempt_roles: exemptRoles,
    }).then(() => {
      setName('');
      setKeywords('');
      setAllowList('');
    }, (error: Error) => onError(error.message));
  };
  return (
    <div className="automod-form">
      <h3 className="settings-subhead">ルールを作成</h3>
      <div className="add-form">
        <input value={name} placeholder="ルールの名前" aria-label="ルールの名前" onChange={(event) => setName(event.target.value)} />
        <Select label="種類" value={trigger} onChange={setTrigger} options={[
          { value: String(AutoModTrigger.keyword), label: 'キーワード' },
          { value: String(AutoModTrigger.mentionSpam), label: 'メンションスパム' },
        ]} />
      </div>
      {isKeyword ? (
        <>
          <label className="field"><span>キーワード（カンマか改行で区切る。* で前後一致）</span>
            <textarea rows={2} value={keywords} onChange={(event) => setKeywords(event.target.value)} /></label>
          <label className="field"><span>許可するキーワード</span>
            <textarea rows={2} value={allowList} onChange={(event) => setAllowList(event.target.value)} /></label>
        </>
      ) : (
        <label className="field"><span>メンションの上限</span>
          <input type="number" min={1} value={mentionLimit} onChange={(event) => setMentionLimit(event.target.value)} /></label>
      )}
      <div className="field">
        <span>アクション</span>
        <label className="check-label"><input type="checkbox" checked={block} onChange={(event) => setBlock(event.target.checked)} />メッセージをブロック</label>
        {block && <input value={customMessage} placeholder="ブロック時に表示するメッセージ（任意）" aria-label="ブロック時のメッセージ" onChange={(event) => setCustomMessage(event.target.value)} />}
        <Select label="通知するチャンネル" value={alertChannel} onChange={setAlertChannel}
          options={[{ value: '', label: '通知しない' }, ...textChannels.map((channel) => ({ value: channel.id as string, label: `#${channel.name} に通知` }))]} />
        <Select label="タイムアウト" value={timeout} onChange={setTimeoutSeconds}
          options={[{ value: '', label: 'タイムアウトしない' }, ...TIMEOUT_SECONDS.map((seconds) => ({ value: String(seconds), label: `${durationLabel(seconds)}タイムアウト` }))]} />
      </div>
      <div className="field">
        <span>除外するロール</span>
        <div className="role-checks">
          {roles.map((role) => (
            <label key={role.id} className="check-label">
              <input type="checkbox" checked={exemptRoles.includes(role.id)}
                onChange={(event) => setExemptRoles(event.target.checked ? [...exemptRoles, role.id] : exemptRoles.filter((id) => id !== role.id))} />
              {role.name}
            </label>
          ))}
        </div>
      </div>
      <button className="button primary" disabled={!ready} onClick={create}>ルールを作成</button>
    </div>
  );
}

function AutoModSection({ guild, state, onError }: SectionProps) {
  const fail = (error: Error) => onError(error.message);
  const rules = Object.values<Json>(state.autoModRules).filter((rule) => rule.guild_id === guild.id);
  const describe = (rule: Json) => rule.trigger_type === AutoModTrigger.keyword
    ? `キーワード: ${(rule.trigger_metadata.keyword_filter ?? []).join(', ')}`
    : rule.trigger_type === AutoModTrigger.mentionSpam ? `メンションが ${rule.trigger_metadata.mention_total_limit} 個を超える`
      : 'Mock では判定しない種類のルール';
  return (
    <div className="settings-form wide">
      <h1>AutoMod</h1>
      <p className="settings-lead">メンバーのメッセージをルールで判定します。Bot のメッセージは対象外です。キーワードとメンションスパムを判定します。</p>
      <ul className="automod-rules">
        {rules.map((rule) => (
          <li key={rule.id}>
            <div>
              <strong>{rule.name}</strong>
              <small>{describe(rule)}</small>
            </div>
            <input type="checkbox" className="switch" aria-label={`${rule.name} を有効にする`} checked={rule.enabled}
              onChange={(event) => void api.patch(`/guilds/${guild.id}/auto-moderation/rules/${rule.id}`, { enabled: event.target.checked }).catch(fail)} />
            <button className="link-danger" onClick={() => void api.delete(`/guilds/${guild.id}/auto-moderation/rules/${rule.id}`).catch(fail)}>削除</button>
          </li>
        ))}
      </ul>
      <AutoModForm guild={guild} state={state} onError={onError} />
    </div>
  );
}

/** Discord と同じ全画面のサーバー設定。プロフィール、エンゲージメント、安全設定は「変更を保存」でまとめて反映する。 */
export function ServerSettings({ guild, state, initialSection = 'profile', onDelete, onClose, onError }: SectionProps & {
  /** 最初に開く項目。 */
  initialSection?: ServerSection;
  onDelete: () => void;
  onClose: () => void;
}) {
  const [section, setSection] = useState<ServerSection>(initialSection);
  const [resetting, setResetting] = useState(false);
  const closeResetting = useCallback(() => setResetting(false), []);
  const [draft, setDraft] = useState<Json>(() => draftOf(guild));
  const saved = draftOf(guild);
  const changes = Object.fromEntries(Object.entries(draft).filter(([key, value]) => JSON.stringify(value) !== JSON.stringify(saved[key])));
  const dirty = Object.keys(changes).length > 0;
  const { shaking, close } = useGuardedClose(dirty, onClose);
  const change = (patch: Json) => setDraft({ ...draft, ...patch });
  const save = () => {
    if (!draft.name.trim()) return;
    api.patch(`/guilds/${guild.id}`, changes).catch((error: Error) => onError(error.message));
  };
  const props = { guild, state, onError };

  return (
    <div className="settings" role="dialog" aria-label="サーバー設定">
      <nav className="settings-nav" aria-label="サーバー設定">
        {NAV.map((group, index) => (
          <div key={group.label ?? index} className="settings-group">
            <h2>{group.label ?? guild.name}</h2>
            {group.items.map(([id, label]) => (
              <button key={id} className={section === id ? 'settings-tab active' : 'settings-tab'} onClick={() => setSection(id)}>{label}</button>
            ))}
          </div>
        ))}
        <hr className="settings-separator" />
        <button className="settings-tab danger" onClick={() => setResetting(true)}>サーバーをリセット</button>
        <button className="settings-tab danger" onClick={onDelete}>サーバーを削除</button>
      </nav>
      <main className="settings-main">
        <button className="settings-close" aria-label="閉じる" title="閉じる（Esc）" onClick={close}>×</button>
        {section === 'profile' && <ProfileSection {...props} draft={draft} onChange={change} />}
        {section === 'engagement' && <EngagementSection {...props} draft={draft} onChange={change} />}
        {section === 'emojis' && <EmojisSection {...props} />}
        {section === 'stickers' && <StickersSection {...props} />}
        {section === 'members' && <MembersSection {...props} />}
        {section === 'roles' && <RolesSection guild={guild} onError={onError} />}
        {section === 'invites' && <GuildInvitesSection {...props} />}
        {section === 'integrations' && <IntegrationsSection {...props} />}
        {section === 'safety' && <SafetySection draft={draft} onChange={change} />}
        {section === 'audit' && <AuditLogSection {...props} />}
        {section === 'bans' && <BansSection {...props} />}
        {section === 'automod' && <AutoModSection {...props} />}
        {dirty && <UnsavedBar shaking={shaking} disabled={!draft.name.trim()} onReset={() => setDraft(saved)} onSave={save} />}
      </main>
      {resetting && (
        <ConfirmDialog title="サーバーのリセット" confirmLabel="リセット" onClose={closeResetting}
          message={`「${guild.name}」のチャンネル、ロール、権限、絵文字、スタンプ、AutoMod、BAN、設定を初期データと同じ状態に戻しますか？メッセージも消えます。名前、アイコン、説明とメンバーは残ります。元に戻せません。`}
          onConfirm={() => void api.post(`/guilds/${guild.id}/reset`).catch((error: Error) => onError(error.message))} />
      )}
    </div>
  );
}
