import { useState, type ReactNode } from 'react';
import { api, type Json } from '../api';
import { Avatar, displayName } from './Avatar';
import { SmileIcon } from './Icons';

const EPHEMERAL = 64;
const LOADING = 128;
const REACTIONS = ['👍', '❤️', '😂', '🎉', '👀'];

const BUTTON_STYLES: Record<number, string> = { 1: 'primary', 2: 'secondary', 3: 'success', 4: 'danger', 5: 'link' };

interface MessageProps {
  message: Json;
  previous?: Json;
  state: Json;
  activeUser?: Json;
  onResult: (result: Json) => void;
  onError: (message: string) => void;
}

/** 本文を読み取り専用の要素へ変換する。HTML としては扱わない。 */
function renderContent(content: string, state: Json, guildId?: string, mentions: Json[] = []): ReactNode[] {
  const pattern = /(<@!?\d+>|<@&\d+>|<#\d+>|\*\*[^*]+\*\*|`[^`]+`)/g;
  return content.split(pattern).map((part, index) => {
    const user = /^<@!?(\d+)>$/.exec(part);
    if (user) {
      // テストのユーザーは終了後に消えるため、メッセージが持つ情報も使う。
      const mentioned = state.users[user[1]!] ?? mentions.find((m) => m.id === user[1]);
      return <span key={index} className="mention">@{displayName(mentioned)}</span>;
    }
    const role = /^<@&(\d+)>$/.exec(part);
    if (role) {
      const found = state.guilds[guildId ?? '']?.roles.find((r: Json) => r.id === role[1]);
      return <span key={index} className="mention">@{found?.name ?? '不明なロール'}</span>;
    }
    const channel = /^<#(\d+)>$/.exec(part);
    if (channel) return <span key={index} className="mention">#{state.channels[channel[1]!]?.name ?? '不明'}</span>;
    if (/^\*\*.+\*\*$/.test(part)) return <strong key={index}>{part.slice(2, -2)}</strong>;
    if (/^`.+`$/.test(part)) return <code key={index}>{part.slice(1, -1)}</code>;
    return part;
  });
}

function Embed({ embed, state, guildId }: { embed: Json; state: Json; guildId?: string }) {
  const color = embed.color === undefined ? '#1e1f22' : `#${(embed.color as number).toString(16).padStart(6, '0')}`;
  return (
    <div className="embed" style={{ borderLeftColor: color }}>
      {embed.author?.name && <div className="embed-author">{embed.author.name}</div>}
      {embed.title && <div className="embed-title">{embed.title}</div>}
      {embed.description && <div className="embed-description">{renderContent(embed.description, state, guildId)}</div>}
      {embed.fields?.length > 0 && (
        <div className="embed-fields">
          {embed.fields.map((field: Json, index: number) => (
            <div key={index} className={field.inline ? 'embed-field inline' : 'embed-field'}>
              <div className="embed-field-name">{field.name}</div>
              <div>{renderContent(field.value, state, guildId)}</div>
            </div>
          ))}
        </div>
      )}
      {embed.footer?.text && <div className="embed-footer">{embed.footer.text}</div>}
    </div>
  );
}

function Components({ message, userId, onResult, onError }: {
  message: Json;
  userId?: string;
  onResult: MessageProps['onResult'];
  onError: MessageProps['onError'];
}) {
  const interact = (kind: string, customId: string, values?: string[]) => {
    api
      .post('/interact', { kind, userId, channelId: message.channel_id, messageId: message.id, customId, values })
      .then(onResult, (error: Error) => onError(error.message));
  };
  return (
    <>
      {message.components.map((row: Json, rowIndex: number) => (
        <div key={rowIndex} className="component-row">
          {(row.components ?? []).map((component: Json) => {
            if (component.type === 2) {
              const style = BUTTON_STYLES[component.style as number] ?? 'secondary';
              if (component.url) {
                return <a key={component.url} className={`button ${style}`} href={component.url} target="_blank" rel="noreferrer">{component.label}</a>;
              }
              return (
                <button key={component.custom_id} className={`button ${style}`} disabled={component.disabled}
                  onClick={() => interact('button', component.custom_id)}>
                  {component.emoji?.name} {component.label}
                </button>
              );
            }
            return (
              <select key={component.custom_id} className="select-menu" defaultValue="" disabled={component.disabled}
                onChange={(event) => interact('select', component.custom_id, [event.target.value])}>
                <option value="" disabled>{component.placeholder ?? '選択してください'}</option>
                {(component.options ?? []).map((option: Json) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            );
          })}
        </div>
      ))}
    </>
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
  if (props.message.dismock_test !== undefined) {
    return (
      <div className="test-divider" role="separator">
        <span>テスト: {props.message.dismock_test}</span>
      </div>
    );
  }
  return <ChatMessage {...props} />;
}

function ChatMessage({ message, previous, state, activeUser, onResult, onError }: MessageProps) {
  const [picking, setPicking] = useState(false);
  const flags = (message.flags ?? 0) as number;
  const guildId = message.guild_id as string | undefined;
  const compact = isContinuation(message, previous);
  const metadata = message.interaction_metadata as Json | undefined;
  const react = (emoji: string) => {
    setPicking(false);
    api
      .post('/reactions', { userId: activeUser?.id, channelId: message.channel_id, messageId: message.id, emoji })
      .catch((error: Error) => onError(error.message));
  };

  return (
    <article className={compact ? 'message compact' : 'message'} data-testid="message">
      {message.referenced_message && (
        <div className="message-context">
          <span className="reply-line" />@{displayName(message.referenced_message.author)} {message.referenced_message.content}
        </div>
      )}
      {metadata?.name && (
        <div className="message-context">
          <span className="reply-line" />{displayName(metadata.user)} が <span className="command-name">/{metadata.name}</span> を使用しました
        </div>
      )}
      <div className="message-body">
        <div className="message-gutter">{!compact && <Avatar user={message.author} />}</div>
        <div className="message-main">
          {!compact && (
            <div className="message-header">
              <span className="author">{displayName(message.author)}</span>
              {message.author.bot && <span className="bot-tag">BOT</span>}
              <time>{time(message.timestamp)}</time>
            </div>
          )}
          {flags & LOADING ? (
            <div className="thinking">Bot が考えています…</div>
          ) : (
            message.content && <div className="content">{renderContent(message.content, state, guildId, message.mentions)}</div>
          )}
          {message.attachments?.map((file: Json) => (
            <div key={file.id} className="attachment">📎 {file.filename} <small>{file.size} bytes</small></div>
          ))}
          {message.embeds?.map((embed: Json, index: number) => (
            <Embed key={index} embed={embed} state={state} guildId={guildId} />
          ))}
          {message.components?.length > 0 && (
            <Components message={message} userId={activeUser?.id} onResult={onResult} onError={onError} />
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
          {flags & EPHEMERAL ? <div className="ephemeral">これはあなただけに表示されています</div> : null}
        </div>
      </div>
      <div className="message-actions">
        <button aria-label="リアクションを追加" onClick={() => setPicking(!picking)}><SmileIcon /></button>
        {picking && (
          <div className="emoji-picker">
            {REACTIONS.map((emoji) => <button key={emoji} onClick={() => react(emoji)}>{emoji}</button>)}
          </div>
        )}
      </div>
    </article>
  );
}
