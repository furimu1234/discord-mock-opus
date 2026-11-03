import { BOT_NOT_CONNECTED_STATUS, ComponentType, INTERACTION_TIMEOUT_STATUS } from '@dismock/server/constants';
import { useState, type ReactNode } from 'react';
import { api, ApiError, type Json } from '../api';
import { displayName } from './Avatar';
import { renderMarkdown, type MarkdownContext } from './Markdown';
import { Select, type SelectOption } from './Select';

const BUTTON_STYLES: Record<number, string> = { 1: 'primary', 2: 'secondary', 3: 'success', 4: 'danger', 5: 'link' };
/** 操作に Bot が応答しなかったときに、部品の下に出す理由。 */
const FAILURE_MESSAGES: Record<number, string> = {
  [INTERACTION_TIMEOUT_STATUS]: '応答がありませんでした',
  [BOT_NOT_CONNECTED_STATUS]: '応答がありませんでした（Bot が接続していません。管理画面で起動してください）',
};
/** Components V2 の区切りの余白。1 は小さく、2 は大きい。 */
const SEPARATOR_SPACING: Record<number, string> = { 1: 'small', 2: 'large' };

interface ComponentsProps {
  message: Json;
  context: MarkdownContext;
  userId?: string;
  onResult: (result: Json) => void;
  onError: (message: string) => void;
}

/** ユーザー、ロール、チャンネルのセレクトメニューの選択肢を、Mock のサーバーの内容から作る。 */
function entityOptions(component: Json, { state, guildId }: MarkdownContext): SelectOption[] {
  const guild = state.guilds[guildId ?? ''] as Json | undefined;
  const users = (): SelectOption[] =>
    Object.keys(guild?.members ?? {}).map((id) => ({ value: id, label: `@${displayName(state.users[id] ?? { id })}` }));
  const roles = (): SelectOption[] => (guild?.roles ?? []).map((role: Json) => ({ value: role.id, label: `@${role.name}` }));
  switch (component.type) {
    case ComponentType.userSelect:
      return users();
    case ComponentType.roleSelect:
      return roles();
    case ComponentType.mentionableSelect:
      return [...users(), ...roles()];
    case ComponentType.channelSelect: {
      const types = component.channel_types as number[] | undefined;
      return Object.values<Json>(state.channels)
        .filter((channel) => channel.guild_id === guildId && (!types || types.includes(channel.type)))
        .map((channel) => ({ value: channel.id, label: `#${channel.name}` }));
    }
    default:
      return (component.options ?? []).map((option: Json) => ({ value: option.value, label: option.label }));
  }
}

function SelectMenu({ component, options, onSelect }: { component: Json; options: SelectOption[]; onSelect: (value: string) => void }) {
  const [value, setValue] = useState('');
  return (
    <Select className="select-menu" label={component.placeholder} value={value} disabled={component.disabled}
      placeholder={component.placeholder ?? '選択してください'} options={options}
      onChange={(next) => {
        setValue(next);
        onSelect(next);
      }} />
  );
}

/** `attachment://` の画像はメッセージの添付から探す。 */
function mediaUrl(message: Json, url: string | undefined): string | undefined {
  if (!url?.startsWith('attachment://')) return url;
  const name = url.slice('attachment://'.length);
  return message.attachments?.find((file: Json) => file.filename === name)?.url;
}

/** Bot が送ったボタン、セレクトメニュー、Components V2 の部品を描く。 */
export function MessageComponents({ message, context, userId, onResult, onError }: ComponentsProps) {
  /** Bot が応答しなかった理由。Discord と同じく、部品の下に表示する。 */
  const [failure, setFailure] = useState<string | null>(null);
  const interact = (kind: string, customId: string, values?: string[]) => {
    setFailure(null);
    api
      .post('/interact', { kind, userId, channelId: message.channel_id, messageId: message.id, customId, values })
      .then(onResult, (error: Error) => {
        const reason = error instanceof ApiError ? FAILURE_MESSAGES[error.status] : undefined;
        if (reason) setFailure(reason);
        else onError(error.message);
      });
  };

  const render = (component: Json, key: number | string): ReactNode => {
    switch (component.type) {
      case ComponentType.actionRow:
        return <div key={key} className="component-row">{(component.components ?? []).map(render)}</div>;
      case ComponentType.button: {
        const style = BUTTON_STYLES[component.style as number] ?? 'secondary';
        const label = <>{component.emoji?.name} {component.label}</>;
        if (component.url) {
          return <a key={key} className={`button ${style}`} href={component.url} target="_blank" rel="noreferrer">{label}</a>;
        }
        return (
          <button key={key} className={`button ${style}`} disabled={component.disabled} onClick={() => interact('button', component.custom_id)}>
            {label}
          </button>
        );
      }
      case ComponentType.stringSelect:
      case ComponentType.userSelect:
      case ComponentType.roleSelect:
      case ComponentType.mentionableSelect:
      case ComponentType.channelSelect:
        return (
          <SelectMenu key={key} component={component} options={entityOptions(component, context)}
            onSelect={(value) => interact('select', component.custom_id, [value])} />
        );
      case ComponentType.section:
        return (
          <div key={key} className="cv2-section">
            <div className="cv2-section-text">{(component.components ?? []).map(render)}</div>
            {component.accessory && <div className="cv2-accessory">{render(component.accessory, 'accessory')}</div>}
          </div>
        );
      case ComponentType.textDisplay:
        return <div key={key} className="cv2-text content">{renderMarkdown(component.content ?? '', context)}</div>;
      case ComponentType.thumbnail: {
        const url = mediaUrl(message, component.media?.url);
        return url ? <img key={key} className="cv2-thumbnail" src={url} alt={component.description ?? ''} /> : null;
      }
      case ComponentType.mediaGallery:
        return (
          <div key={key} className="cv2-gallery">
            {(component.items ?? []).map((item: Json, index: number) => {
              const url = mediaUrl(message, item.media?.url);
              return url ? <img key={index} src={url} alt={item.description ?? ''} /> : null;
            })}
          </div>
        );
      case ComponentType.file:
        return <div key={key} className="attachment">📎 {String(component.file?.url ?? '').replace('attachment://', '')}</div>;
      case ComponentType.separator: {
        const spacing = SEPARATOR_SPACING[component.spacing as number] ?? SEPARATOR_SPACING[1];
        return component.divider === false
          ? <div key={key} className={`cv2-space ${spacing}`} />
          : <hr key={key} className={`cv2-separator ${spacing}`} />;
      }
      case ComponentType.container: {
        const color = component.accent_color == null ? undefined : `#${(component.accent_color as number).toString(16).padStart(6, '0')}`;
        return (
          <div key={key} className="cv2-container" style={color ? { borderLeftColor: color } : undefined}>
            {(component.components ?? []).map(render)}
          </div>
        );
      }
      default:
        return null;
    }
  };

  return (
    <>
      {(message.components as Json[]).map(render)}
      {failure && <div className="interaction-failed" role="alert">{failure}</div>}
    </>
  );
}
