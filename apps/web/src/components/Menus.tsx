import { hasThreads, INVITE_URL, isForumType, isInvitable, isThreadType, isVoiceType, USER_COMMAND_TYPE } from '@dismock/server/constants';
import { api, ChannelKind, type Json } from '../api';
import { DEFAULT_VOLUME, MAX_VOLUME } from '../audio';
import { channelUrl } from '../links';
import { canStartProjects, isActiveProject } from '../projects';
import { displayName } from './Avatar';
import { ContextMenu, type Anchor, type MenuEntry } from './ContextMenu';

/** `navigator.clipboard` が使えない画面（埋め込みのブラウザなど）では、選択範囲のコピーを使う。 */
export async function copyText(text: string): Promise<void> {
  const copied = await navigator.clipboard?.writeText(text).then(() => true, () => false);
  if (copied) return;
  const input = document.createElement('textarea');
  input.value = text;
  document.body.append(input);
  input.select();
  const succeeded = document.execCommand('copy');
  input.remove();
  if (!succeeded) throw new Error('クリップボードにコピーできません');
}

interface MenuProps {
  anchor: Anchor;
  onClose: () => void;
  onError: (message: string) => void;
}

const copyEntry = (id: string, onError: (message: string) => void): MenuEntry => ({
  label: 'ID をコピー',
  onSelect: () => void copyText(id).catch((error: Error) => onError(error.message)),
});


export function ChannelMenu({ channel, state, voiceChannelId, collapsed, onJoin, onLeave, onEdit, onDelete, onCreate, onCreateThread, onToggle, anchor, onClose, onError }: MenuProps & {
  channel: Json;
  state: Json;
  voiceChannelId?: string;
  collapsed: boolean;
  onJoin: () => void;
  onLeave: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onCreate: (type: string, parentId?: string) => void;
  onCreateThread: () => void;
  onToggle: () => void;
}) {
  const fail = (error: Error) => onError(error.message);
  const patch = (body: Json) => () => void api.patch(`/channels/${channel.id}`, body).catch(fail);
  const copyLink: MenuEntry = {
    label: 'リンクをコピー',
    onSelect: () => void copyText(channelUrl({ guildId: channel.guild_id, channelId: channel.id })).catch(fail),
  };
  const remove = (label: string): MenuEntry => ({ label, danger: true, onSelect: onDelete });

  const categoryEntries = (): MenuEntry[] => [
    { label: collapsed ? 'カテゴリーを展開' : 'カテゴリーを折りたたむ', onSelect: onToggle },
    'separator',
    { label: 'カテゴリーを編集', onSelect: onEdit },
    { label: 'チャンネルを作成', onSelect: () => onCreate('text', channel.id) },
    { label: 'カテゴリーを作成', onSelect: () => onCreate('category') },
    'separator',
    remove('カテゴリーを削除'),
  ];

  const threadEntries = (): MenuEntry[] => {
    const { archived, locked } = channel.thread_metadata as Json;
    const userId = state.activeUserId as string | null;
    const joined = (state.threadMembers[channel.id] as Json[] | undefined)?.some((member) => member.user_id === userId);
    const members = `/channels/${channel.id}/thread-members/${userId}`;
    return [
      {
        label: joined ? 'スレッドから退出' : 'スレッドに参加',
        disabled: !userId,
        onSelect: () => void (joined ? api.delete(members) : api.put(members)).catch(fail),
      },
      'separator',
      { label: 'スレッドを編集', onSelect: onEdit },
      { label: archived ? 'アーカイブを解除' : 'スレッドをアーカイブ', onSelect: patch({ archived: !archived }) },
      { label: locked ? 'ロックを解除' : 'スレッドをロック', onSelect: patch({ locked: !locked }) },
      copyLink,
      'separator',
      remove('スレッドを削除'),
    ];
  };

  const channelEntries = (): MenuEntry[] => {
    const joined = channel.id === voiceChannelId;
    return [
      ...(isVoiceType(channel.type)
        ? [{ label: joined ? '切断' : '接続', onSelect: joined ? onLeave : onJoin }, 'separator' as const]
        : []),
      ...(hasThreads(channel.type) && !isForumType(channel.type) ? [{ label: 'スレッドを作成', onSelect: onCreateThread }, 'separator' as const] : []),
      ...(isInvitable(channel.type)
        ? [{
            label: '招待を作成',
            disabled: !state.activeUserId,
            onSelect: () => void api.post(`/channels/${channel.id}/invites`, { userId: state.activeUserId })
              .then((invite: Json) => copyText(`${INVITE_URL}/${invite.code}`)).catch(fail),
          }]
        : []),
      { label: 'チャンネルを編集', onSelect: onEdit },
      { label: 'チャンネルを複製', onSelect: () => void api.post(`/channels/${channel.id}/clone`).catch(fail) },
      { label: 'チャンネルを作成', onSelect: () => onCreate('text', channel.parent_id ?? undefined) },
      copyLink,
      'separator',
      remove('チャンネルを削除'),
    ];
  };

  const entries: MenuEntry[] = [
    ...(channel.type === ChannelKind.category ? categoryEntries() : isThreadType(channel.type) ? threadEntries() : channelEntries()),
    'separator',
    copyEntry(channel.id, onError),
  ];
  return <ContextMenu anchor={anchor} label={`${channel.name} のメニュー`} entries={entries} onClose={onClose} />;
}

export function MemberMenu({ user, guild, state, tests, activeUser, channelId, volume, onVolume, onResult, anchor, onClose, onError }: MenuProps & {
  user: Json;
  guild: Json;
  state: Json;
  tests: Json | null;
  activeUser?: Json;
  channelId: string | null;
  volume?: number;
  onVolume: (volume: number) => void;
  onResult: (result: Json) => void;
}) {
  const isSelf = user.id === activeUser?.id;
  const isBot = user.id === state.botUserId;
  const commands = (state.commands as Json[]).filter(
    (command) => command.type === USER_COMMAND_TYPE && (command.guild_id === undefined || command.guild_id === guild.id),
  );
  const run = (name: string) => {
    api
      .post('/interact', { kind: 'command', userId: activeUser?.id, channelId, name, targetId: user.id })
      .then(onResult, (error: Error) => onError(error.message));
  };
  const projects = state.projects as Json[];
  const startable = canStartProjects(tests);
  // Bot は管理画面に登録したプロジェクトから選んで起動する。管理画面の行の「起動」と同じ。
  const botEntries: MenuEntry[] = isBot
    ? [{
        label: 'Bot を起動',
        disabled: !startable || projects.length === 0,
        submenu: projects.map((project) => {
          const active = isActiveProject(tests, project);
          return {
            label: active ? `${project.label}（接続中）` : (project.label as string),
            disabled: active,
            onSelect: () => void api.post('/projects/start', { id: project.id }).catch((error: Error) => onError(error.message)),
          };
        }),
      }]
    : [];
  const inVoice = Object.values<Json>(state.voiceStates).some((voice) => voice.user_id === user.id);
  const current = volume ?? DEFAULT_VOLUME;
  const entries: MenuEntry[] = [
    ...(inVoice && !isSelf
      ? [{
          content: (
            <label className="menu-volume">
              <span>ユーザーの音量</span>
              <output>{current}%</output>
              <input type="range" min={0} max={MAX_VOLUME} value={current} aria-label={`${displayName(user)} の音量`}
                onKeyDown={(event) => event.stopPropagation()}
                onChange={(event) => onVolume(Number(event.target.value))} />
            </label>
          ),
        }, 'separator' as const]
      : []),
    ...botEntries,
    {
      label: isSelf ? 'ログイン中' : 'このユーザーでログイン',
      disabled: isSelf || isBot,
      onSelect: () => void api.post('/switch-user', { userId: user.id }).catch((error: Error) => onError(error.message)),
    },
    {
      label: 'アプリ',
      disabled: commands.length === 0 || !activeUser || !channelId,
      submenu: commands.map((command) => ({ label: command.name as string, onSelect: () => run(command.name as string) })),
    },
    'separator',
    copyEntry(user.id, onError),
  ];
  return <ContextMenu anchor={anchor} label={`${displayName(user)} のメニュー`} entries={entries} onClose={onClose} />;
}
