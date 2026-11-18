import { Permission } from '@dismock/server/permissions';
import { useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { api, type Json } from '../api';
import { displayName } from './Avatar';
import { PlusIcon } from './Icons';
import { hasChannelPermission } from '../permissions';
import { Select } from './Select';
import { ContextMenu, pointAnchor, type Anchor } from './ContextMenu';
import { PollDialog } from './Poll';
import { encodeFiles, UploadList, useUploads } from './Uploads';

const OptionType = { subcommand: 1, group: 2, boolean: 5, user: 6, channel: 7, role: 8, mentionable: 9 };

interface CommandChoice {
  name: string;
  description: string;
  options: Json[];
}

/** サブコマンドを `tag set` のような 1 つの候補へ展開する。 */
function expandCommands(commands: Json[]): CommandChoice[] {
  return commands
    .filter((command) => (command.type ?? 1) === 1)
    .flatMap((command) => {
      const options = (command.options ?? []) as Json[];
      const subcommands = options.filter((o) => o.type === OptionType.subcommand || o.type === OptionType.group);
      if (subcommands.length === 0) return [{ name: command.name, description: command.description, options }];
      return subcommands.flatMap((sub) => {
        if (sub.type === OptionType.subcommand) {
          return [{ name: `${command.name} ${sub.name}`, description: sub.description, options: sub.options ?? [] }];
        }
        return (sub.options ?? []).map((inner: Json) => ({
          name: `${command.name} ${sub.name} ${inner.name}`,
          description: inner.description,
          options: inner.options ?? [],
        }));
      });
    });
}

interface ComposerProps {
  channelId: string | null;
  /** 返信先のメッセージ。 */
  replyTo?: Json | null;
  onCancelReply?: () => void;
  placeholder: string;
  state: Json;
  members: Json[];
  activeUser?: Json;
  resolveChannel: () => Promise<string>;
  onResult: (result: Json) => void;
  onError: (message: string) => void;
}

function OptionInput({ option, value, onChange, state, members, guildId }: {
  option: Json;
  value: string;
  onChange: (value: string) => void;
  state: Json;
  members: Json[];
  guildId?: string;
}) {
  const select = (items: { id: string; label: string }[]) => (
    <Select label={option.name} value={value} onChange={onChange} options={[
      { value: '', label: '選択' },
      ...items.map((item) => ({ value: item.id, label: item.label })),
    ]} />
  );
  if (option.choices?.length) {
    return select(option.choices.map((c: Json) => ({ id: String(c.value), label: c.name })));
  }
  if (option.type === OptionType.user || option.type === OptionType.mentionable) {
    return select(members.map((m) => ({ id: m.user.id, label: displayName(m.user) })));
  }
  if (option.type === OptionType.role) {
    const roles = (state.guilds[guildId ?? '']?.roles ?? []) as Json[];
    return select(roles.map((role) => ({ id: role.id, label: role.name })));
  }
  if (option.type === OptionType.channel) {
    const channels = Object.values<Json>(state.channels).filter((c) => c.guild_id === guildId);
    return select(channels.map((channel) => ({ id: channel.id, label: channel.name })));
  }
  if (option.type === OptionType.boolean) {
    return select([{ id: 'true', label: 'はい' }, { id: 'false', label: 'いいえ' }]);
  }
  return <input value={value} placeholder={option.description} onChange={(event) => onChange(event.target.value)} />;
}

function convertOption(option: Json, value: string): unknown {
  if (option.type === 4 || option.type === 10) return Number(value);
  if (option.type === OptionType.boolean) return value === 'true';
  return value;
}

export function Composer({ channelId, placeholder, state, members, activeUser, resolveChannel, replyTo, onCancelReply, onResult, onError }: ComposerProps) {
  const [text, setText] = useState('');
  const uploads = useUploads(onError);
  const fileInput = useRef<HTMLInputElement>(null);
  const [plusMenu, setPlusMenu] = useState<Anchor | null>(null);
  const [creatingPoll, setCreatingPoll] = useState(false);
  const [command, setCommand] = useState<CommandChoice | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [highlight, setHighlight] = useState(0);
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const channel = channelId ? state.channels[channelId] : undefined;
  const guildId = channel?.guild_id as string | undefined;
  const canSend = !guildId || !activeUser || hasChannelPermission(state, state.guilds[guildId], channel!, activeUser.id, Permission.sendMessages);

  const commands = useMemo(() => expandCommands(state.commands), [state.commands]);
  const mentionQuery = /(?:^|\s)@([^\s@]*)$/.exec(text)?.[1];

  const suggestions: { key: string; title: string; detail: string; apply: () => void }[] = useMemo(() => {
    if (command) return [];
    if (text.startsWith('/')) {
      const query = text.slice(1).toLowerCase();
      return commands
        .filter((c) => c.name.toLowerCase().startsWith(query))
        .map((c) => ({
          key: c.name,
          title: `/${c.name}`,
          detail: c.description,
          apply: () => {
            setCommand(c);
            setValues({});
            setText('');
            setHighlight(0);
          },
        }));
    }
    if (mentionQuery !== undefined) {
      return members
        .filter((m) => displayName(m.user).toLowerCase().startsWith(mentionQuery.toLowerCase()))
        .map((m) => ({
          key: m.user.id,
          title: `@${displayName(m.user)}`,
          detail: m.user.username,
          apply: () => {
            setText(`${text.slice(0, text.length - mentionQuery.length)}${displayName(m.user)} `);
            setHighlight(0);
            input.current?.focus();
          },
        }));
    }
    return [];
  }, [command, commands, members, mentionQuery, text]);

  /** 入力した `@名前` を Discord のメンション形式へ変換する。 */
  const encodeMentions = (content: string) =>
    members.reduce((result, m) => result.replaceAll(`@${displayName(m.user)}`, `<@${m.user.id}>`), content);

  const runCommand = async () => {
    if (!command) return;
    const missing = command.options.find((option) => option.required && !values[option.name]);
    if (missing) return onError(`${missing.name} を入力してください`);
    const options = Object.fromEntries(
      command.options
        .filter((option) => values[option.name])
        .map((option) => [option.name, convertOption(option, values[option.name]!)]),
    );
    const target = channelId ?? (await resolveChannel());
    const result = await api.post('/interact', {
      kind: 'command',
      userId: activeUser?.id,
      channelId: target,
      name: command.name,
      options,
    });
    setCommand(null);
    setValues({});
    onResult(result);
  };

  const sendMessage = async () => {
    const content = text.trim();
    if (!content && uploads.files.length === 0) return;
    const target = channelId ?? (await resolveChannel());
    const encoded = await encodeFiles(uploads.files);
    setText('');
    uploads.clear();
    onCancelReply?.();
    await api.post('/messages', { userId: activeUser?.id, channelId: target, content: encodeMentions(content), replyTo: replyTo?.id, files: encoded });
  };

  const submit = () => {
    if (busy || !activeUser) return;
    setBusy(true);
    (command ? runCommand() : sendMessage())
      .catch((error: Error) => onError(error.message))
      .finally(() => setBusy(false));
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (suggestions.length > 0) {
      if (event.key === 'ArrowDown') setHighlight((highlight + 1) % suggestions.length);
      if (event.key === 'ArrowUp') setHighlight((highlight - 1 + suggestions.length) % suggestions.length);
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') return event.preventDefault();
      if (event.key === 'Enter' || event.key === 'Tab') {
        event.preventDefault();
        suggestions[highlight]?.apply();
        return;
      }
    }
    if (event.key === 'Escape') setCommand(null);
    if (event.key === 'Enter') {
      event.preventDefault();
      submit();
    }
  };

  return (
    <div className="composer">
      {suggestions.length > 0 && (
        <div className="suggestions" role="listbox">
          <div className="suggestions-title">{text.startsWith('/') ? 'コマンド' : 'メンバー'}</div>
          {suggestions.slice(0, 10).map((item, index) => (
            <button key={item.key} className={index === highlight ? 'suggestion active' : 'suggestion'}
              onMouseEnter={() => setHighlight(index)} onClick={item.apply}>
              <strong>{item.title}</strong><span>{item.detail}</span>
            </button>
          ))}
        </div>
      )}
      {command ? (
        <div className="composer-box command">
          <span className="command-chip">/{command.name}</span>
          {command.options.map((option) => (
            <label key={option.name} className="command-option">
              <span>{option.name}{option.required ? ' *' : ''}</span>
              <OptionInput option={option} value={values[option.name] ?? ''} state={state} members={members} guildId={guildId}
                onChange={(value) => setValues({ ...values, [option.name]: value })} />
            </label>
          ))}
          <button className="button primary" disabled={busy} onClick={submit}>送信</button>
          <button className="button secondary" onClick={() => setCommand(null)}>取消</button>
        </div>
      ) : (
        <div className={replyTo ? 'composer-box replying' : 'composer-box'}>
          {replyTo && (
            <div className="reply-bar">
              <span><strong>{displayName(replyTo.author)}</strong> に返信</span>
              <button aria-label="返信を取り消す" title="返信を取り消す" onClick={onCancelReply}>×</button>
            </div>
          )}
          <UploadList files={uploads.files} onRemove={uploads.remove} />
          <button className="composer-plus" aria-label="ファイルや投票を追加" aria-haspopup="menu" disabled={!activeUser || !canSend}
            onClick={(event) => {
              const { left, top } = event.currentTarget.getBoundingClientRect();
              setPlusMenu(pointAnchor(left, top));
            }}>
            <PlusIcon />
          </button>
          <input ref={fileInput} type="file" multiple hidden aria-label="ファイルをアップロード"
            onChange={(event) => {
              uploads.add([...(event.target.files ?? [])]);
              event.target.value = '';
            }} />
          <input ref={input} onPaste={uploads.onPaste} value={text} placeholder={canSend ? placeholder : 'このチャンネルではメッセージを送信できません'}
            disabled={!activeUser || !canSend} aria-label="メッセージを入力"
            onChange={(event) => { setText(event.target.value); setHighlight(0); }} onKeyDown={onKeyDown} />
        </div>
      )}
      {plusMenu && (
        <ContextMenu anchor={plusMenu} label="追加するもの" onClose={() => setPlusMenu(null)} entries={[
          { label: 'ファイルをアップロード', onSelect: () => fileInput.current?.click() },
          { label: '投票を作成', onSelect: () => setCreatingPoll(true) },
        ]} />
      )}
      {creatingPoll && (
        <PollDialog onClose={() => setCreatingPoll(false)} onSubmit={(poll) => {
          void (async () => {
            const target = channelId ?? (await resolveChannel());
            await api.post('/messages', { userId: activeUser?.id, channelId: target, content: '', poll });
          })().catch((error: Error) => onError(error.message));
        }} />
      )}
    </div>
  );
}
