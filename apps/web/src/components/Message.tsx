import { ChannelType, hasThreads, isForumType, isThreadType, MESSAGE_COMMAND_TYPE, MessageFlag } from '@dismock/server/constants';
import { Permission } from '@dismock/server/permissions';
import { useEffect, useState } from 'react';
import { api, type Json } from '../api';
import { hasChannelPermission } from '../permissions';
import { Avatar, displayName } from './Avatar';
import { ConfirmDialog } from './ConfirmDialog';
import { ContextMenu, pointAnchor, type Anchor, type MenuEntry } from './ContextMenu';
import { MoreIcon, PencilIcon, ReplyIcon, SmileIcon, ThreadIcon } from './Icons';
import { copyText } from './Menus';
import { PollView } from './Poll';
import { channelUrl, DM_GUILD } from '../links';
import { renderMarkdown } from './Markdown';
import { MessageComponents } from './MessageComponents';

const THREAD_CREATED = 18;
const THREAD_STARTER = 21;
const USER_JOIN = 7;
const POLL_RESULT = 46;

const { ephemeral: EPHEMERAL, loading: LOADING } = MessageFlag;
const REACTIONS = ['👍', '❤️', '😂', '🎉', '👀'];
/** ツールバーに並べる、すぐに付けられるリアクション。 */
const QUICK_REACTIONS = REACTIONS.slice(0, 3);

interface MessageProps {
  message: Json;
  previous?: Json;
  state: Json;
  activeUser?: Json;
  onResult: (result: Json) => void;
  onError: (message: string) => void;
  /** 返信を始める。省略すると返信のボタンを出さない。 */
  onReply?: (message: Json) => void;
  /** メッセージからスレッドを作る。 */
  onCreateThread?: (message: Json) => void;
}

/** メッセージの JSON。Bot が受け取る形のまま表示する。 */
function JsonDialog({ message, onClose, onError }: { message: Json; onClose: () => void; onError: (message: string) => void }) {
  const json = JSON.stringify(message, null, 2);
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);
  return (
    <div className="overlay" onClick={onClose}>
      <div className="dialog wide" role="dialog" aria-label="メッセージの JSON" onClick={(event) => event.stopPropagation()}>
        <h2>メッセージの JSON</h2>
        <pre className="json-view">{json}</pre>
        <div className="dialog-actions">
          <button className="button secondary" onClick={() => void copyText(json).catch((error: Error) => onError(error.message))}>コピー</button>
          <button className="button primary" autoFocus onClick={onClose}>閉じる</button>
        </div>
      </div>
    </div>
  );
}

/** 自分のメッセージの本文を、その場で編集する。Enter で保存、Esc で取り消す。 */
function EditBox({ message, onDone, onError }: { message: Json; onDone: () => void; onError: (message: string) => void }) {
  const [content, setContent] = useState<string>(message.content);
  const save = () => {
    if (content.trim() && content !== message.content) {
      api.patch(`/channels/${message.channel_id}/messages/${message.id}`, { content }).catch((error: Error) => onError(error.message));
    }
    onDone();
  };
  return (
    <div className="edit-box">
      <textarea autoFocus value={content} aria-label="メッセージを編集" rows={Math.min(content.split('\n').length, 8)}
        onChange={(event) => setContent(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Escape') onDone();
          if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault();
            save();
          }
        }} />
      <small>Esc で<button className="link" onClick={onDone}>キャンセル</button>・Enter で<button className="link" onClick={save}>保存</button></small>
    </div>
  );
}

function Embed({ embed, state, guildId }: { embed: Json; state: Json; guildId?: string }) {
  const color = embed.color === undefined ? 'var(--bg-rail)' : `#${(embed.color as number).toString(16).padStart(6, '0')}`;
  return (
    <div className="embed" style={{ borderLeftColor: color }}>
      {embed.author?.name && <div className="embed-author">{embed.author.name}</div>}
      {embed.title && <div className="embed-title">{embed.title}</div>}
      {embed.description && <div className="embed-description">{renderMarkdown(embed.description, { state, guildId })}</div>}
      {embed.fields?.length > 0 && (
        <div className="embed-fields">
          {embed.fields.map((field: Json, index: number) => (
            <div key={index} className={field.inline ? 'embed-field inline' : 'embed-field'}>
              <div className="embed-field-name">{field.name}</div>
              <div>{renderMarkdown(field.value, { state, guildId })}</div>
            </div>
          ))}
        </div>
      )}
      {embed.footer?.text && <div className="embed-footer">{embed.footer.text}</div>}
    </div>
  );
}

const time = (value: string) =>
  new Date(value).toLocaleString('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });

function isContinuation(message: Json, previous?: Json): boolean {
  if (!previous || previous.dismock_test !== undefined || previous.author.id !== message.author.id) return false;
  if (message.referenced_message || message.interaction_metadata) return false;
  return Date.parse(message.timestamp) - Date.parse(previous.timestamp) < 7 * 60 * 1000;
}

export function Message(props: MessageProps) {
  if (props.message.type === THREAD_CREATED) {
    return <div className="thread-notice">{displayName(props.message.author)} がスレッド「{props.message.content}」を作成しました</div>;
  }
  if (props.message.type === POLL_RESULT) {
    const field = (name: string) => (props.message.embeds?.[0]?.fields as Json[] | undefined)?.find((candidate) => candidate.name === name)?.value;
    const victor = field('victor_answer_text');
    return (
      <div className="thread-notice">
        📊 {displayName(props.message.author)} の投票「{field('poll_question_text')}」が終了しました。
        {victor ? ` 最多は「${victor}」（${field('victor_answer_votes')}票）です。` : ' 最多の回答はありません。'}
      </div>
    );
  }
  if (props.message.type === USER_JOIN) {
    return <div className="thread-notice">→ {displayName(props.message.author)} がサーバーに参加しました</div>;
  }
  if (props.message.type === THREAD_STARTER) {
    return <div className="thread-notice">{props.message.referenced_message?.content}</div>;
  }
  if (props.message.dismock_test !== undefined) {
    return (
      <div className="test-divider" role="separator">
        <span>テスト: {props.message.dismock_test}</span>
      </div>
    );
  }
  return <ChatMessage {...props} />;
}

/** 閉じた「あなただけに表示」のメッセージ。Discord と同じく、この画面で隠すだけで Bot からは編集できる。 */
const DISMISSED_KEY = 'dismock:dismissed';
/** 覚えておく閉じたメッセージの数。古いものから忘れる。 */
const MAX_DISMISSED = 500;

function loadDismissed(): string[] {
  try {
    return JSON.parse(localStorage.getItem(DISMISSED_KEY) ?? '[]') as string[];
  } catch {
    return [];
  }
}

function saveDismissed(id: string): void {
  try {
    localStorage.setItem(DISMISSED_KEY, JSON.stringify([...loadDismissed(), id].slice(-MAX_DISMISSED)));
  } catch {
    // 保存できない画面では、表示している間だけ隠す。
  }
}

function ChatMessage({ message, previous, state, activeUser, onResult, onError, onReply, onCreateThread }: MessageProps) {
  const [dismissed, setDismissed] = useState(() => loadDismissed().includes(message.id));
  const [picking, setPicking] = useState(false);
  const [menu, setMenu] = useState<Anchor | null>(null);
  const [editing, setEditing] = useState(false);
  const [showingJson, setShowingJson] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const flags = (message.flags ?? 0) as number;
  const guildId = message.guild_id as string | undefined;
  const compact = isContinuation(message, previous);
  const metadata = message.interaction_metadata as Json | undefined;
  const channel = state.channels[message.channel_id] as Json | undefined;
  const fail = (error: Error) => onError(error.message);
  // お知らせチャンネルのメッセージは、フォロー中のチャンネルへ公開（クロスポスト）できる。
  const publishable = channel?.type === ChannelType.announcement
    && !(flags & (MessageFlag.crossposted | MessageFlag.isCrosspost));
  const own = message.author.id === activeUser?.id;
  const guild = guildId ? (state.guilds[guildId] as Json | undefined) : undefined;
  const canDelete = own || Boolean(guild && channel && activeUser && hasChannelPermission(state, guild, channel, activeUser.id, Permission.manageMessages));
  const canThread = Boolean(onCreateThread && channel && hasThreads(channel.type) && !isForumType(channel.type) && !isThreadType(channel.type) && !message.thread);
  const commands = (state.commands as Json[]).filter(
    (command) => command.type === MESSAGE_COMMAND_TYPE && (command.guild_id === undefined || command.guild_id === guildId),
  );
  const react = (emoji: string) => {
    setPicking(false);
    api
      .post('/reactions', { userId: activeUser?.id, channelId: message.channel_id, messageId: message.id, emoji })
      .catch(fail);
  };
  const runCommand = (name: string) => {
    api.post('/interact', { kind: 'command', userId: activeUser?.id, channelId: message.channel_id, name, targetMessageId: message.id })
      .then(onResult, fail);
  };
  const link = channelUrl({ guildId: guildId ?? DM_GUILD, channelId: message.channel_id, messageId: message.id });
  const entries: MenuEntry[] = [
    ...(own && activeUser ? [{ label: 'メッセージを編集', onSelect: () => setEditing(true) }] : []),
    ...(onReply && activeUser ? [{ label: '返信', onSelect: () => onReply(message) }] : []),
    ...(canThread && activeUser ? [{ label: 'スレッドを作成', onSelect: () => onCreateThread!(message) }] : []),
    {
      label: 'アプリ',
      disabled: commands.length === 0 || !activeUser,
      submenu: commands.map((command) => ({ label: command.name as string, onSelect: () => runCommand(command.name as string) })),
    },
    'separator',
    { label: 'テキストをコピー', disabled: !message.content, onSelect: () => void copyText(message.content).catch(fail) },
    { label: 'メッセージのリンクをコピー', onSelect: () => void copyText(link).catch(fail) },
    { label: 'JSON を表示', onSelect: () => setShowingJson(true) },
    ...(canDelete ? ['separator' as const, { label: 'メッセージを削除', danger: true, onSelect: () => setDeleting(true) }] : []),
    'separator',
    { label: 'ID をコピー', onSelect: () => void copyText(message.id).catch(fail) },
  ];
  const openMenu = (event: React.MouseEvent) => {
    event.preventDefault();
    setMenu(pointAnchor(event.clientX, event.clientY));
  };

  const dismiss = () => {
    saveDismissed(message.id);
    setDismissed(true);
  };
  if (dismissed) return null;
  const ephemeral = Boolean(flags & EPHEMERAL);

  return (
    <article className={(menu || picking ? 'message active' : compact ? 'message compact' : 'message') + (ephemeral ? ' ephemeral-message' : '')}
      data-testid="message" data-message-id={message.id} onContextMenu={openMenu}>
      {message.referenced_message && (
        <div className="message-context">
          <span className="reply-line" />@{displayName(message.referenced_message.author)} {message.referenced_message.content}
        </div>
      )}
      {metadata?.name && (
        <div className="message-context">
          <span className="reply-line" />{displayName(metadata.user)} が
          {metadata.target_user
            ? <> {displayName(metadata.target_user)} に <span className="command-name">{metadata.name}</span> </>
            : <> <span className="command-name">/{metadata.name}</span> </>}
          を使用しました
        </div>
      )}
      <div className="message-body">
        <div className="message-gutter">{!compact && <Avatar user={message.author} />}</div>
        <div className="message-main">
          {!compact && (
            <div className="message-header">
              <span className="author">{displayName(message.author)}</span>
              {flags & MessageFlag.isCrosspost
                ? <span className="bot-tag">サーバー</span>
                : message.author.bot && <span className="bot-tag">BOT</span>}
              {flags & MessageFlag.crossposted ? <span className="published-tag">公開済み</span> : null}
              <time>{time(message.timestamp)}</time>
            </div>
          )}
          {flags & LOADING ? (
            <div className="thinking">Bot が考えています…</div>
          ) : editing ? (
            <EditBox message={message} onDone={() => setEditing(false)} onError={onError} />
          ) : (
            message.content && (
              <div className="content">
                {renderMarkdown(message.content, { state, guildId, mentions: message.mentions })}
                {message.edited_timestamp && <small className="edited">（編集済み）</small>}
              </div>
            )
          )}
          {message.poll && <PollView message={message} state={state} userId={activeUser?.id} onError={onError} />}
          {message.sticker_items?.map((sticker: Json) => (
            state.media[sticker.id]
              ? <img key={sticker.id} className="sticker" src={state.media[sticker.id]} alt={sticker.name} title={sticker.name} />
              : <div key={sticker.id} className="attachment">スタンプ: {sticker.name}</div>
          ))}
          {message.attachments?.map((file: Json) => (
            String(file.content_type).startsWith('image/') && file.url?.startsWith('http')
              ? <a key={file.id} href={file.url} target="_blank" rel="noreferrer"><img className="attachment-image" src={file.url} alt={file.filename} /></a>
              : (
                <div key={file.id} className="attachment">
                  📎 {file.url?.startsWith('http') ? <a href={file.url} download={file.filename}>{file.filename}</a> : file.filename}
                  <small>{file.size} bytes</small>
                </div>
              )
          ))}
          {message.embeds?.map((embed: Json, index: number) => (
            <Embed key={index} embed={embed} state={state} guildId={guildId} />
          ))}
          {message.components?.length > 0 && (
            <MessageComponents message={message} context={{ state, guildId }} userId={activeUser?.id} onResult={onResult} onError={onError} />
          )}
          {message.reactions?.length > 0 && (
            <div className="reactions">
              {message.reactions.map((reaction: Json) => (
                <button key={reaction.emoji.name} className="reaction" onClick={() => react(reaction.emoji.name)}>
                  {reaction.emoji.name} {reaction.count}
                </button>
              ))}
            </div>
          )}
          {ephemeral && (
            <div className="ephemeral">
              これはあなただけに表示されています ・ <button type="button" className="link" onClick={dismiss}>このメッセージを消す</button>
            </div>
          )}
        </div>
      </div>
      <div className="message-actions" role="toolbar" aria-label="メッセージの操作">
        {publishable && (
          <button className="publish-button" title="フォロー中のサーバーに公開" onClick={() => {
            api.post(`/channels/${message.channel_id}/messages/${message.id}/crosspost`).catch(fail);
          }}>公開</button>
        )}
        {activeUser && QUICK_REACTIONS.map((emoji) => (
          <button key={emoji} className="quick-reaction" aria-label={`${emoji} を付ける`} title={emoji} onClick={() => react(emoji)}>{emoji}</button>
        ))}
        {activeUser && <button aria-label="リアクションを付ける" title="リアクションを付ける" onClick={() => setPicking(!picking)}><SmileIcon /></button>}
        {onReply && activeUser && <button aria-label="返信" title="返信" onClick={() => onReply(message)}><ReplyIcon /></button>}
        {canThread && activeUser && <button aria-label="スレッドを作成" title="スレッドを作成" onClick={() => onCreateThread!(message)}><ThreadIcon /></button>}
        {own && <button aria-label="編集" title="編集" onClick={() => setEditing(true)}><PencilIcon /></button>}
        <button aria-label="その他" title="その他" aria-haspopup="menu" onClick={(event) => {
          const { left, bottom } = event.currentTarget.getBoundingClientRect();
          setMenu(pointAnchor(left, bottom));
        }}><MoreIcon /></button>
        {picking && (
          <div className="emoji-picker">
            {REACTIONS.map((emoji) => <button key={emoji} onClick={() => react(emoji)}>{emoji}</button>)}
          </div>
        )}
      </div>
      {menu && <ContextMenu anchor={menu} label="メッセージのメニュー" entries={entries} onClose={() => setMenu(null)} />}
      {showingJson && <JsonDialog message={message} onClose={() => setShowingJson(false)} onError={onError} />}
      {deleting && (
        <ConfirmDialog title="メッセージの削除" message="このメッセージを削除しますか？元に戻せません。" confirmLabel="削除"
          onClose={() => setDeleting(false)}
          onConfirm={() => void api.delete(`/channels/${message.channel_id}/messages/${message.id}`).catch(fail)} />
      )}
    </article>
  );
}
