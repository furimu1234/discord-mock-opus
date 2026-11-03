import { ChannelType, hasThreads, INVITE_URL, isForumType, isInvitable, isThreadType, isVoiceType, WebhookType } from '@dismock/server/constants';
import { copyText } from './Menus';
import { isSynced, OverwriteType, PERMISSION_GROUPS, type PermissionInfo, type PermissionOverwrite } from '@dismock/server/permissions';
import { useState } from 'react';
import { api, ChannelKind, type Json } from '../api';
import { displayName } from './Avatar';
import { Select } from './Select';
import { durationLabel, InviteTable, ToggleRow, UnsavedBar, useGuardedClose, WebhookRow } from './SettingsParts';

type Section = 'overview' | 'permissions' | 'invites' | 'integrations';
type Choice = 'deny' | 'inherit' | 'allow';

const CHOICES: { value: Choice; symbol: string; label: string }[] = [
  { value: 'deny', symbol: '×', label: '拒否' },
  { value: 'inherit', symbol: '/', label: '設定なし' },
  { value: 'allow', symbol: '✓', label: '許可' },
];

function choiceOf(overwrite: PermissionOverwrite, flag: bigint): Choice {
  if (BigInt(overwrite.allow) & flag) return 'allow';
  return BigInt(overwrite.deny) & flag ? 'deny' : 'inherit';
}

function withChoice(overwrite: PermissionOverwrite, flag: bigint, choice: Choice): PermissionOverwrite {
  const allow = BigInt(overwrite.allow) & ~flag;
  const deny = BigInt(overwrite.deny) & ~flag;
  return {
    ...overwrite,
    allow: String(choice === 'allow' ? allow | flag : allow),
    deny: String(choice === 'deny' ? deny | flag : deny),
  };
}

/** チャンネルの種類に応じた権限の一覧。カテゴリは配下のチャンネルに関わるので、すべて表示する。 */
function appliesTo(item: PermissionInfo, type: number): boolean {
  if (item.scopes.includes('guild') && item.scopes.length === 1) return false;
  if (type === ChannelKind.category) return true;
  return item.scopes.includes(isVoiceType(type) ? 'voice' : 'text');
}

function PermissionRow({ item, choice, onChange }: { item: PermissionInfo; choice: Choice; onChange: (choice: Choice) => void }) {
  return (
    <div className="permission-row">
      <div>
        <strong>{item.label}</strong>
        <p>{item.description}</p>
      </div>
      <div className="tri-state" role="radiogroup" aria-label={item.label}>
        {CHOICES.map(({ value, symbol, label }) => (
          <button key={value} type="button" role="radio" className={value} aria-checked={choice === value} aria-label={label}
            title={label} onClick={() => onChange(value)}>{symbol}</button>
        ))}
      </div>
    </div>
  );
}

function PermissionsTab({ channel, guild, overwrites, onChange }: {
  channel: Json;
  guild: Json;
  overwrites: PermissionOverwrite[];
  onChange: (overwrites: PermissionOverwrite[]) => void;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(overwrites[0]?.id ?? null);
  const roles = guild.roles as Json[];
  const members = Object.values<Json>(guild.members);
  const nameOf = (overwrite: PermissionOverwrite) =>
    overwrite.type === OverwriteType.member
      ? (displayName(members.find((member) => member.user.id === overwrite.id)?.user) as string)
      : (roles.find((role) => role.id === overwrite.id)?.name as string | undefined) ?? overwrite.id;
  const unset = (id: string) => !overwrites.some((overwrite) => overwrite.id === id);
  const addable = [
    ...roles.filter((role) => unset(role.id)).map((role) => ({ value: `${OverwriteType.role}:${role.id}`, label: role.name as string })),
    ...members.filter((member) => unset(member.user.id))
      .map((member) => ({ value: `${OverwriteType.member}:${member.user.id}`, label: `@${displayName(member.user)}` })),
  ];
  const selected = overwrites.find((overwrite) => overwrite.id === selectedId);
  const groups = PERMISSION_GROUPS
    .map((group) => ({ ...group, items: group.items.filter((item) => appliesTo(item, channel.type)) }))
    .filter((group) => group.items.length > 0);

  const add = (value: string) => {
    const [type, id] = value.split(':') as [string, string];
    onChange([...overwrites, { id, type: Number(type), allow: '0', deny: '0' }]);
    setSelectedId(id);
  };
  const remove = (id: string) => {
    const remaining = overwrites.filter((overwrite) => overwrite.id !== id);
    onChange(remaining);
    if (selectedId === id) setSelectedId(remaining[0]?.id ?? null);
  };
  const setChoice = (flag: bigint, choice: Choice) =>
    onChange(overwrites.map((overwrite) => (overwrite.id === selectedId ? withChoice(overwrite, flag, choice) : overwrite)));

  return (
    <div className="permission-layout">
      <div className="permission-roles">
        <Select label="ロールまたはメンバーを追加" value="" placeholder="ロール／メンバーを追加…" disabled={addable.length === 0} onChange={add}
          options={addable} />
        {overwrites.map((overwrite) => {
          const name = nameOf(overwrite);
          return (
            <div key={overwrite.id} className={overwrite.id === selectedId ? 'permission-role active' : 'permission-role'}>
              <button type="button" onClick={() => setSelectedId(overwrite.id)}>{name}</button>
              <button type="button" aria-label={`${name} の権限の設定を削除`} title="削除" onClick={() => remove(overwrite.id)}>×</button>
            </div>
          );
        })}
      </div>
      {selected ? (
        <div>
          {groups.map((group) => (
            <section key={group.title} className="permission-group">
              <h3>{group.title}</h3>
              {group.items.map((item) => (
                <PermissionRow key={item.label} item={item} choice={choiceOf(selected, item.flag)}
                  onChange={(choice) => setChoice(item.flag, choice)} />
              ))}
            </section>
          ))}
          <button type="button" className="permission-delete" onClick={() => remove(selected.id)}>{nameOf(selected)}を削除</button>
        </div>
      ) : (
        <p className="permission-empty">権限は設定されていません。ロールかメンバーを追加すると、その権限を設定できます。</p>
      )}
    </div>
  );
}

const TYPE_LABELS: Record<number, string> = {
  [ChannelType.text]: 'テキストチャンネル',
  [ChannelType.voice]: 'ボイスチャンネル',
  [ChannelType.category]: 'カテゴリー',
  [ChannelType.announcement]: 'お知らせチャンネル',
  [ChannelType.announcement_thread]: 'スレッド',
  [ChannelType.public_thread]: 'スレッド',
  [ChannelType.private_thread]: '非公開スレッド',
  [ChannelType.stage]: 'ステージチャンネル',
  [ChannelType.directory]: 'ディレクトリチャンネル',
  [ChannelType.forum]: 'フォーラムチャンネル',
  [ChannelType.media]: 'メディアチャンネル',
};

/** Discord の公開ドキュメントの上限。 */
const TOPIC_MAX_LENGTH = 1024;
const FORUM_TOPIC_MAX_LENGTH = 4096;
const MAX_TAGS = 20;
const BITRATE_MIN_KBPS = 8;
const BITRATE_MAX_KBPS = 96;
const USER_LIMIT_MAX = 99;
const KBPS = 1000;

const DEFAULT_WEBHOOK_NAME = 'ウェブフック';
const INVITE_MAX_AGES = [1800, 3600, 21600, 43200, 86400, 604800, 0];
const INVITE_MAX_USES = [0, 1, 5, 10, 25, 50, 100];

const SLOWMODE_SECONDS = [0, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600, 7200, 21600];
const ARCHIVE_MINUTES = [60, 1440, 4320, 10080];

/** チャンネルの種類ごとに、設定できる項目。 */
function featuresOf(type: number) {
  const thread = isThreadType(type);
  const textual = type === ChannelType.text || type === ChannelType.announcement;
  return {
    thread,
    permissions: !thread,
    topic: textual || isForumType(type),
    slowmode: thread || isVoiceType(type) || isForumType(type) || type === ChannelType.text,
    nsfw: textual || isVoiceType(type) || isForumType(type),
    announcement: textual,
    archive: thread || hasThreads(type),
    bitrate: isVoiceType(type),
    userLimit: type === ChannelType.voice,
    tags: isForumType(type),
    invites: isInvitable(type),
  };
}

/** 変更を比べる項目の値。スレッドのアーカイブまでの時間は `thread_metadata` にある。 */
function draftOf(channel: Json): Json {
  const features = featuresOf(channel.type);
  return {
    name: channel.name,
    ...(features.topic ? { topic: channel.topic ?? '' } : {}),
    ...(features.slowmode ? { rate_limit_per_user: channel.rate_limit_per_user ?? 0 } : {}),
    ...(features.nsfw ? { nsfw: Boolean(channel.nsfw) } : {}),
    ...(features.announcement ? { type: channel.type } : {}),
    ...(features.archive
      ? features.thread
        ? { auto_archive_duration: channel.thread_metadata.auto_archive_duration }
        : { default_auto_archive_duration: channel.default_auto_archive_duration }
      : {}),
    ...(features.bitrate ? { bitrate: channel.bitrate } : {}),
    ...(features.userLimit ? { user_limit: channel.user_limit } : {}),
    ...(features.tags ? { available_tags: channel.available_tags } : {}),
    ...(features.permissions ? { permission_overwrites: channel.permission_overwrites ?? [] } : {}),
  };
}

const changedFields = (draft: Json, saved: Json) =>
  Object.fromEntries(Object.entries(draft).filter(([key, value]) => JSON.stringify(value) !== JSON.stringify(saved[key])));

function TagsField({ tags, onChange }: { tags: Json[]; onChange: (tags: Json[]) => void }) {
  const [name, setName] = useState('');
  const add = () => {
    if (!name.trim() || tags.length >= MAX_TAGS) return;
    onChange([...tags, { name: name.trim() }]);
    setName('');
  };
  return (
    <div className="field">
      <span>タグ（{tags.length}/{MAX_TAGS}）</span>
      <ul className="role-chips">
        {tags.map((tag, index) => (
          <li key={tag.id ?? `new-${index}`} className="role-chip">
            {tag.name}
            <button type="button" aria-label={`${tag.name} を削除`} title="削除" onClick={() => onChange(tags.filter((_, i) => i !== index))}>×</button>
          </li>
        ))}
      </ul>
      <div className="add-form">
        <input value={name} placeholder="タグの名前" aria-label="タグの名前" onChange={(event) => setName(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              add();
            }
          }} />
        <button type="button" className="button secondary" disabled={!name.trim() || tags.length >= MAX_TAGS} onClick={add}>追加</button>
      </div>
    </div>
  );
}

function OverviewSection({ channel, draft, onChange }: { channel: Json; draft: Json; onChange: (patch: Json) => void }) {
  const features = featuresOf(channel.type);
  const topicMax = isForumType(channel.type) ? FORUM_TOPIC_MAX_LENGTH : TOPIC_MAX_LENGTH;
  const kbps = Math.round(draft.bitrate / KBPS);
  return (
    <div className="settings-form">
      <h1>概要</h1>
      <label className="field">
        <span>{features.thread ? 'スレッド名' : channel.type === ChannelType.category ? 'カテゴリー名' : 'チャンネル名'}</span>
        <input value={draft.name} onChange={(event) => onChange({ name: event.target.value })} />
      </label>
      {features.topic && (
        <label className="field">
          <span>{isForumType(channel.type) ? 'ガイドライン' : 'チャンネルトピック'}</span>
          <textarea rows={4} maxLength={topicMax} value={draft.topic} placeholder="このチャンネルの使い方をメンバーに伝えましょう"
            onChange={(event) => onChange({ topic: event.target.value })} />
          <small className="field-count">{draft.topic.length}/{topicMax}</small>
        </label>
      )}
      {features.slowmode && (
        <div className="field">
          <span>低速モード</span>
          <Select label="低速モード" value={String(draft.rate_limit_per_user)} onChange={(value) => onChange({ rate_limit_per_user: Number(value) })}
            options={SLOWMODE_SECONDS.map((seconds) => ({ value: String(seconds), label: durationLabel(seconds) }))} />
          <small>メンバーが次のメッセージを送信できるまでの待ち時間です。</small>
        </div>
      )}
      {features.archive && (
        <div className="field">
          <span>{features.thread ? '非アクティブ時にアーカイブ' : '非アクティブ時にスレッドを非表示'}</span>
          <Select label="非アクティブ時にアーカイブ" value={String(draft.auto_archive_duration ?? draft.default_auto_archive_duration)}
            onChange={(value) => onChange(features.thread ? { auto_archive_duration: Number(value) } : { default_auto_archive_duration: Number(value) })}
            options={ARCHIVE_MINUTES.map((minutes) => ({ value: String(minutes), label: durationLabel(minutes * 60) }))} />
        </div>
      )}
      {features.bitrate && (
        <label className="field">
          <span>ビットレート — {kbps}kbps</span>
          <input type="range" min={BITRATE_MIN_KBPS} max={BITRATE_MAX_KBPS} value={kbps}
            onChange={(event) => onChange({ bitrate: Number(event.target.value) * KBPS })} />
        </label>
      )}
      {features.userLimit && (
        <label className="field">
          <span>ユーザー人数制限 — {draft.user_limit === 0 ? '無制限' : `${draft.user_limit}人`}</span>
          <input type="range" min={0} max={USER_LIMIT_MAX} value={draft.user_limit} onChange={(event) => onChange({ user_limit: Number(event.target.value) })} />
        </label>
      )}
      {features.tags && <TagsField tags={draft.available_tags} onChange={(available_tags) => onChange({ available_tags })} />}
      {features.nsfw && (
        <ToggleRow label="年齢制限チャンネル" description="閲覧には年齢の確認が必要になります。" checked={draft.nsfw}
          onChange={(nsfw) => onChange({ nsfw })} />
      )}
      {features.announcement && (
        <ToggleRow label="お知らせチャンネル" description="メンバーは、このチャンネルのメッセージを自分のサーバーでフォローできます。"
          checked={draft.type === ChannelType.announcement}
          onChange={(enabled) => onChange({ type: enabled ? ChannelType.announcement : ChannelType.text })} />
      )}
    </div>
  );
}

function InvitesSection({ channel, state, onError }: { channel: Json; state: Json; onError: (message: string) => void }) {
  const [maxAge, setMaxAge] = useState('86400');
  const [maxUses, setMaxUses] = useState('0');
  const fail = (error: Error) => onError(error.message);
  const invites = Object.values<Json>(state.invites).filter((invite) => invite.channel_id === channel.id);
  const create = () => {
    api.post(`/channels/${channel.id}/invites`, { userId: state.activeUserId, max_age: Number(maxAge), max_uses: Number(maxUses), unique: true })
      .then((invite: Json) => copyText(`${INVITE_URL}/${invite.code}`)).catch(fail);
  };
  return (
    <div>
      <h1>招待</h1>
      <div className="add-form">
        <Select label="有効期限" value={maxAge} onChange={setMaxAge}
          options={INVITE_MAX_AGES.map((seconds) => ({ value: String(seconds), label: seconds === 0 ? '無期限' : durationLabel(seconds) }))} />
        <Select label="使用回数の上限" value={maxUses} onChange={setMaxUses}
          options={INVITE_MAX_USES.map((uses) => ({ value: String(uses), label: uses === 0 ? '無制限' : `${uses}回` }))} />
        <button className="button primary" disabled={!state.activeUserId} onClick={create}>招待を作成</button>
      </div>
      <small className="settings-hint">作成した招待のリンクはクリップボードにコピーされます。招待の作成者はログイン中のユーザーです。</small>
      <InviteTable invites={invites} state={state} onError={onError} />
    </div>
  );
}

function IntegrationsSection({ channel, state, onError }: { channel: Json; state: Json; onError: (message: string) => void }) {
  const fail = (error: Error) => onError(error.message);
  const webhooks = Object.values<Json>(state.webhooks).filter((webhook) => webhook.channel_id === channel.id);
  const incoming = webhooks.filter((webhook) => webhook.type !== WebhookType.channelFollower);
  const following = webhooks.filter((webhook) => webhook.type === WebhookType.channelFollower);
  const followable = Object.values<Json>(state.channels).filter((candidate) => candidate.type === ChannelType.announcement
    && candidate.id !== channel.id && !following.some((webhook) => webhook.source_channel.id === candidate.id));
  const create = () => {
    api.post(`/channels/${channel.id}/webhooks`, { userId: state.activeUserId, name: DEFAULT_WEBHOOK_NAME }).catch(fail);
  };
  const follow = (sourceId: string) => {
    api.post(`/channels/${channel.id}/followers`, { userId: state.activeUserId, sourceId }).catch(fail);
  };
  return (
    <div>
      <h1>連携サービス</h1>
      <section className="integration-section">
        <div className="admin-section-header">
          <h2>ウェブフック</h2>
          <small>{incoming.length}件</small>
          <button className="button primary" disabled={!state.activeUserId} onClick={create}>新しいウェブフック</button>
        </div>
        <ul className="admin-list integration-list">
          {incoming.map((webhook) => <WebhookRow key={webhook.id} webhook={webhook} onError={onError} />)}
        </ul>
        {incoming.length === 0 && <p className="permission-empty">ウェブフックはありません。</p>}
      </section>
      <section className="integration-section">
        <div className="admin-section-header">
          <h2>フォロー中のチャンネル</h2>
          <small>{following.length}件</small>
          <Select label="フォローするお知らせチャンネル" value="" placeholder="お知らせチャンネルをフォロー…" disabled={followable.length === 0}
            onChange={follow} options={followable.map((candidate) => ({
              value: candidate.id as string,
              label: `${state.guilds[candidate.guild_id]?.name ?? ''} #${candidate.name}`,
            }))} />
        </div>
        <ul className="admin-list integration-list">
          {following.map((webhook) => (
            <li key={webhook.id}>
              <span>{webhook.source_guild.name} #{webhook.source_channel.name}</span>
              <button className="link-danger" onClick={() => void api.delete(`/webhooks/${webhook.id}`).catch(fail)}>フォロー解除</button>
            </li>
          ))}
        </ul>
        {following.length === 0 && <p className="permission-empty">フォロー中のチャンネルはありません。</p>}
      </section>
    </div>
  );
}

/** Discord と同じ全画面のチャンネル設定。変更は「変更を保存」でまとめて反映する。 */
export function ChannelSettings({ channel, guild, state, onDelete, onClose, onError }: {
  channel: Json;
  guild: Json;
  state: Json;
  onDelete: () => void;
  onClose: () => void;
  onError: (message: string) => void;
}) {
  const [section, setSection] = useState<Section>('overview');
  const [draft, setDraft] = useState<Json>(() => draftOf(channel));
  const saved = draftOf(channel);
  const changes = changedFields(draft, saved);
  const dirty = Object.keys(changes).length > 0;
  const features = featuresOf(channel.type);
  const kind = features.thread ? 'スレッド' : channel.type === ChannelType.category ? 'カテゴリー' : 'チャンネル';

  const { shaking, close } = useGuardedClose(dirty, onClose);

  const save = () => {
    if (!draft.name.trim()) return;
    api.patch(`/channels/${channel.id}`, changes).catch((error: Error) => onError(error.message));
  };
  // カテゴリーの中のチャンネルは、カテゴリーと権限が同じあいだ同期している。
  const parent = channel.parent_id && !features.thread ? (state.channels[channel.parent_id] as Json | undefined) : undefined;
  const synced = parent ? isSynced({ permission_overwrites: draft.permission_overwrites }, parent) : false;
  const syncNow = () => {
    if (!parent) return;
    api
      .patch(`/guilds/${guild.id}/channels`, [{ id: channel.id, lock_permissions: true }])
      .then(() => setDraft({ ...draft, permission_overwrites: structuredClone(parent.permission_overwrites ?? []) }))
      .catch((error: Error) => onError(error.message));
  };
  const tab = (id: Section, label: string) => (
    <button className={section === id ? 'settings-tab active' : 'settings-tab'} onClick={() => setSection(id)}>{label}</button>
  );

  return (
    <div className="settings" role="dialog" aria-label={`${kind}の設定`}>
      <nav className="settings-nav" aria-label={`${kind}の設定`}>
        <h2>{channel.name} <small>{TYPE_LABELS[channel.type]}</small></h2>
        {tab('overview', '概要')}
        {features.permissions && tab('permissions', '権限')}
        {features.invites && tab('invites', '招待')}
        {features.invites && tab('integrations', '連携サービス')}
        <hr className="settings-separator" />
        <button className="settings-tab danger" onClick={onDelete}>{kind}を削除</button>
      </nav>
      <main className="settings-main">
        <button className="settings-close" aria-label="閉じる" title="閉じる（Esc）" onClick={close}>×</button>
        {section === 'overview' && <OverviewSection channel={channel} draft={draft} onChange={(patch) => setDraft({ ...draft, ...patch })} />}
        {section === 'invites' && <InvitesSection channel={channel} state={state} onError={onError} />}
        {section === 'integrations' && <IntegrationsSection channel={channel} state={state} onError={onError} />}
        {section === 'permissions' && (
          <div>
            <h1>権限</h1>
            {parent && (
              <div className={synced ? 'sync-status synced' : 'sync-status'}>
                <span>
                  {synced
                    ? `カテゴリー「${parent.name}」と権限が同期されています。カテゴリーの権限を変えると、このチャンネルも変わります。`
                    : `カテゴリー「${parent.name}」と権限が同期されていません。`}
                </span>
                {!synced && <button className="button secondary" onClick={syncNow}>今すぐ同期</button>}
              </div>
            )}
            <PermissionsTab channel={channel} guild={guild} overwrites={draft.permission_overwrites}
              onChange={(permission_overwrites) => setDraft({ ...draft, permission_overwrites })} />
          </div>
        )}
        {dirty && <UnsavedBar shaking={shaking} disabled={!draft.name.trim()} onReset={() => setDraft(saved)} onSave={save} />}
      </main>
    </div>
  );
}
