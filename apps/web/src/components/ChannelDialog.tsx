import { useState, type FormEvent } from 'react';
import { api, ChannelKind, type Json } from '../api';
import { Select } from './Select';

const CREATABLE_TYPES = [
  { value: 'text', label: 'テキスト' },
  { value: 'voice', label: 'ボイス' },
  { value: 'announcement', label: 'お知らせ' },
  { value: 'stage', label: 'ステージ' },
  { value: 'forum', label: 'フォーラム' },
  { value: 'media', label: 'メディア' },
  { value: 'directory', label: 'ディレクトリ' },
];

export function ChannelCreateDialog({ guild, categories, initialType, initialParent, onClose, onError }: {
  guild: Json;
  categories: Json[];
  /** `category` のときはカテゴリーを作成する。 */
  initialType: string;
  initialParent?: string;
  onClose: () => void;
  onError: (message: string) => void;
}) {
  const [name, setName] = useState('');
  const [type, setType] = useState(initialType);
  const [parent, setParent] = useState(initialParent ?? '');
  const isCategory = type === 'category';
  const title = isCategory ? 'カテゴリーの作成' : 'チャンネルの作成';

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!name.trim()) return;
    const channel = { name: name.trim(), guild: guild.id, type, parent: isCategory ? undefined : parent || undefined };
    api.post('/seed', { channels: [channel] }).catch((error: Error) => onError(error.message));
    onClose();
  };

  return (
    <div className="overlay" onClick={onClose}>
      <form className="dialog" role="dialog" aria-label={title} onSubmit={submit} onClick={(event) => event.stopPropagation()}>
        <h2>{title}</h2>
        <div className="dialog-body">
          <label className="field">
            <span>{isCategory ? 'カテゴリー名' : 'チャンネル名'}</span>
            <input autoFocus value={name} onChange={(event) => setName(event.target.value)} />
          </label>
          {!isCategory && (
            <>
              <div className="field">
                <span>種類</span>
                <Select label="チャンネルの種類" value={type} onChange={setType} options={CREATABLE_TYPES} />
              </div>
              <div className="field">
                <span>カテゴリー</span>
                <Select label="カテゴリー" value={parent} onChange={setParent} options={[
                  { value: '', label: 'カテゴリーなし' },
                  ...categories.map((category) => ({ value: category.id as string, label: category.name as string })),
                ]} />
              </div>
            </>
          )}
        </div>
        <div className="dialog-actions">
          <button type="button" className="button secondary" onClick={onClose}>キャンセル</button>
          <button className="button primary" disabled={!name.trim()}>作成</button>
        </div>
      </form>
    </div>
  );
}

/** お知らせチャンネルをフォローする。フォロー先はメッセージを送信できるテキストかお知らせのチャンネル。 */
export function FollowDialog({ channel, state, onClose, onError }: {
  channel: Json;
  state: Json;
  onClose: () => void;
  onError: (message: string) => void;
}) {
  const guilds = Object.values<Json>(state.guilds);
  const [guildId, setGuildId] = useState<string>(channel.guild_id);
  const followed = (target: Json) => Object.values<Json>(state.webhooks)
    .some((webhook) => webhook.channel_id === target.id && webhook.source_channel?.id === channel.id);
  const targets = Object.values<Json>(state.channels).filter((target) => target.guild_id === guildId && target.id !== channel.id
    && (target.type === ChannelKind.text || target.type === ChannelKind.announcement) && !followed(target));
  const [targetId, setTargetId] = useState('');
  const selected = targets.some((target) => target.id === targetId) ? targetId : '';

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!selected) return;
    api.post(`/channels/${selected}/followers`, { userId: state.activeUserId, sourceId: channel.id })
      .catch((error: Error) => onError(error.message));
    onClose();
  };

  return (
    <div className="overlay" onClick={onClose}>
      <form className="dialog" role="dialog" aria-label="チャンネルのフォロー" onSubmit={submit} onClick={(event) => event.stopPropagation()}>
        <h2>#{channel.name} をフォロー</h2>
        <p className="dialog-message">このチャンネルで公開されたメッセージが、選んだチャンネルに届きます。</p>
        <div className="dialog-body">
          <div className="field">
            <span>サーバー</span>
            <Select label="フォロー先のサーバー" value={guildId} onChange={setGuildId}
              options={guilds.map((guild) => ({ value: guild.id as string, label: guild.name as string }))} />
          </div>
          <div className="field">
            <span>チャンネル</span>
            <Select label="フォロー先のチャンネル" value={selected} placeholder={targets.length === 0 ? 'フォローできるチャンネルがありません' : 'チャンネルを選択'}
              disabled={targets.length === 0} onChange={setTargetId}
              options={targets.map((target) => ({ value: target.id as string, label: `#${target.name}` }))} />
          </div>
        </div>
        <div className="dialog-actions">
          <button type="button" className="button secondary" onClick={onClose}>キャンセル</button>
          <button className="button primary" disabled={!selected}>フォロー</button>
        </div>
      </form>
    </div>
  );
}

/** Discord の上限。メッセージから作るときは、本文の先頭を名前の初期値にする。 */
const THREAD_NAME_MAX_LENGTH = 100;

export function ThreadCreateDialog({ channel, message, userId, onCreated, onClose, onError }: {
  channel: Json;
  /** 元にするメッセージ。省略するとメッセージのないスレッドを作る。 */
  message?: Json;
  userId: string;
  onCreated?: (thread: Json) => void;
  onClose: () => void;
  onError: (message: string) => void;
}) {
  const [name, setName] = useState<string>(() => String(message?.content ?? '').slice(0, THREAD_NAME_MAX_LENGTH));
  const [type, setType] = useState(String(ChannelKind.public_thread));
  // お知らせチャンネルのスレッドと、メッセージから作るスレッドは、種類を選べない。
  const selectable = channel.type === ChannelKind.text && !message;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!name.trim()) return;
    const path = message ? `/channels/${channel.id}/messages/${message.id}/threads` : `/channels/${channel.id}/threads`;
    api
      .post(path, { userId, name: name.trim(), ...(message ? {} : { type: Number(type) }) })
      .then((thread: Json) => onCreated?.(thread), (error: Error) => onError(error.message));
    onClose();
  };

  return (
    <div className="overlay" onClick={onClose}>
      <form className="dialog" role="dialog" aria-label="スレッドの作成" onSubmit={submit} onClick={(event) => event.stopPropagation()}>
        <h2>スレッドの作成</h2>
        <div className="dialog-body">
          <label className="field">
            <span>スレッド名</span>
            <input autoFocus value={name} maxLength={THREAD_NAME_MAX_LENGTH} onChange={(event) => setName(event.target.value)} />
          </label>
          {selectable && (
            <div className="field">
              <span>公開範囲</span>
              <Select label="公開範囲" value={type} onChange={setType} options={[
                { value: String(ChannelKind.public_thread), label: '公開' },
                { value: String(ChannelKind.private_thread), label: '非公開' },
              ]} />
            </div>
          )}
        </div>
        <div className="dialog-actions">
          <button type="button" className="button secondary" onClick={onClose}>キャンセル</button>
          <button className="button primary" disabled={!name.trim()}>作成</button>
        </div>
      </form>
    </div>
  );
}
