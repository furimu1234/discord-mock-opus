import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { isForumType, isThreadType, isVoiceType, isWithoutMessages, MessageFlag } from '@dismock/server/constants';
import { api, ChannelKind, LEGAL_NOTICE, token, useMockData, type Json } from './api';
import { DEFAULT_VOLUME, useVoiceAudio, useVolumes } from './audio';
import { canViewChannel } from './permissions';
import { latestFromOthers, MarkRead, useUnread } from './unread';
import { type ChannelLinkTarget, DM_GUILD, OpenLinkContext } from './links';
import { DRAG_TYPE, isLowerHalf, moveItem, type DropTarget } from './reorder';
import { AdminPage } from './components/AdminPage';
import { Avatar, colorOf, displayName } from './components/Avatar';
import { ChannelCreateDialog, FollowDialog, ThreadCreateDialog } from './components/ChannelDialog';
import { ChannelSettings } from './components/ChannelSettings';
import { Composer } from './components/Composer';
import { ConfirmDialog } from './components/ConfirmDialog';
import { ContextMenu, pointAnchor, type Anchor } from './components/ContextMenu';
import { ForumView } from './components/ForumView';
import {
  BeakerIcon, ChannelIcon, ChatIcon, ChevronIcon, DatabaseIcon, GearIcon, ListIcon, HangUpIcon, PlusIcon, UsersIcon,
} from './components/Icons';
import { ChannelMenu, MemberMenu } from './components/Menus';
import { Message } from './components/Message';
import { ModalDialog } from './components/ModalDialog';
import { ProfileCard } from './components/ProfileCard';
import { RunsPage, type RunSelection } from './components/RunsPage';
import { ServerSettings } from './components/ServerSettings';
import { StudioPage, type StudioSource } from './components/StudioPage';
import { selectedProject, TestsPage, TestsPanel, type TestListProps } from './components/TestsPage';

type View = { kind: 'guild'; guildId: string } | { kind: 'dm'; channelId?: string } | { kind: 'tests' } | { kind: 'runs' } | { kind: 'studio' } | { kind: 'admin' };
type PanelTab = 'members' | 'tests';
type Popup =
  | { kind: 'channel'; channelId: string; anchor: Anchor }
  | { kind: 'guild'; anchor: Anchor }
  | { kind: 'channel-list'; anchor: Anchor }
  | { kind: 'member' | 'profile'; userId: string; anchor: Anchor };

/** コンテキストメニューとプロフィールを開く操作。 */
interface PopupHandlers {
  onChannelMenu: (event: React.MouseEvent, channelId: string) => void;
  onMemberMenu: (event: React.MouseEvent, userId: string) => void;
  onProfile: (event: React.MouseEvent, userId: string) => void;
}

const POPUP_GAP = 8;
const { text: TEXT, category: CATEGORY, directory: DIRECTORY } = ChannelKind;
const EPHEMERAL = MessageFlag.ephemeral;

function ServerRail({ view, guilds, media, onSelect }: { view: View; guilds: Json[]; media: Record<string, string>; onSelect: (view: View) => void }) {
  const railButton = (key: string, label: string, active: boolean, target: View, content: React.ReactNode, color?: string) => (
    <div key={key} className={active ? 'rail-item active' : 'rail-item'}>
      <span className="rail-pill" />
      <button className="rail-button" style={color ? { background: active ? color : undefined } : undefined}
        aria-label={label} title={label} onClick={() => onSelect(target)}>
        {content}
      </button>
    </div>
  );
  return (
    <nav className="rail" aria-label="サーバー">
      {railButton('home', 'ダイレクトメッセージ', view.kind === 'dm', { kind: 'dm' }, <ChatIcon />)}
      <div className="rail-separator" />
      {guilds.map((guild) =>
        railButton(guild.id, guild.name, view.kind === 'guild' && view.guildId === guild.id,
          { kind: 'guild', guildId: guild.id },
          guild.icon && media[guild.icon] ? <img className="rail-icon" src={media[guild.icon]} alt="" /> : guild.name.slice(0, 2), colorOf(guild.id)),
      )}
      {railButton('add', 'サーバーを追加', false, { kind: 'admin' }, <PlusIcon />)}
      <div className="rail-spacer" />
      <div className="rail-separator" />
      {railButton('tests', 'テスト', view.kind === 'tests', { kind: 'tests' }, <BeakerIcon />)}
      {railButton('runs', '実行結果', view.kind === 'runs', { kind: 'runs' }, <ListIcon />)}
      {railButton('studio', 'DB Studio', view.kind === 'studio', { kind: 'studio' }, <DatabaseIcon />)}
      {railButton('admin', '管理', view.kind === 'admin', { kind: 'admin' }, <GearIcon />)}
    </nav>
  );
}

function VoiceUsers({ channelId, state, onMemberMenu, onProfile }: { channelId: string; state: Json } & PopupHandlers) {
  const voices = Object.values<Json>(state.voiceStates).filter((voice) => voice.channel_id === channelId);
  if (voices.length === 0) return null;
  return (
    <div className="voice-users">
      {voices.map((voice) => (
        <button key={voice.user_id} className="voice-user" onClick={(event) => onProfile(event, voice.user_id)}
          onContextMenu={(event) => onMemberMenu(event, voice.user_id)}>
          <Avatar user={state.users[voice.user_id]} size={22} />
          {displayName(state.users[voice.user_id])}
        </button>
      ))}
    </div>
  );
}

interface ChannelListProps extends PopupHandlers {
  guild: Json;
  state: Json;
  channelId: string | null;
  collapsed: Set<string>;
  unread: (channelId: string) => boolean;
  onSelect: (id: string) => void;
  onVoice: (id: string) => void;
  onToggleCategory: (id: string) => void;
  onListMenu: (event: React.MouseEvent) => void;
  /** ドラッグで並び替えた結果。Modify Guild Channel Positions と同じ形。 */
  onReorder: (entries: Json[]) => void;
}

/** 並び替えた一覧を、0 から振った位置にする。 */
const toPositions = (items: Json[], moved: Json, parentId: string | null): Json[] =>
  items.map((item, position) => ({ id: item.id, position, ...(item.id === moved.id ? { parent_id: parentId } : {}) }));

function ChannelList({ guild, state, channelId, collapsed, unread, onSelect, onVoice, onToggleCategory, onListMenu, onReorder, ...handlers }: ChannelListProps) {
  const [dragging, setDragging] = useState<Json | null>(null);
  const [drop, setDrop] = useState<DropTarget | null>(null);
  const visible = Object.values<Json>(state.channels)
    .filter((channel) => channel.guild_id === guild.id && canViewChannel(state, guild, channel, state.activeUserId));
  const channels = visible.filter((channel) => !isThreadType(channel.type)).sort((a, b) => a.position - b.position);
  const categories = channels.filter((channel) => channel.type === CATEGORY);
  // フォーラムの投稿は開いているものだけを表示する。一覧はフォーラムの画面にある。
  const threadsOf = (parent: Json) => visible.filter((thread) => thread.parent_id === parent.id && isThreadType(thread.type)
    && (isForumType(parent.type) ? thread.id === channelId : !thread.thread_metadata.archived || thread.id === channelId));
  // カテゴリーはカテゴリーの間で、チャンネルはチャンネルの間かカテゴリーの中へ動かせる。スレッドは動かせない。
  const canDrop = (target: Json) => {
    if (!dragging || dragging.id === target.id) return false;
    return dragging.type === CATEGORY ? target.type === CATEGORY : true;
  };
  /** 別のカテゴリーへ移すときは、移動先の権限に同期するかを選んでから並び替える。 */
  const [pendingMove, setPendingMove] = useState<{ channel: Json; category: Json; entries: Json[] } | null>(null);
  const closePendingMove = useCallback(() => setPendingMove(null), []);
  const commit = (moved: Json, parentId: string | null, entries: Json[]) => {
    const category = parentId ? channels.find((channel) => channel.id === parentId) : undefined;
    if (category && (moved.parent_id ?? null) !== parentId) setPendingMove({ channel: moved, category, entries });
    else onReorder(entries);
  };
  const dropOn = (target: Json, after: boolean) => {
    if (!dragging) return;
    if (dragging.type === CATEGORY) {
      onReorder(toPositions(moveItem(categories, dragging, target.id, after), dragging, null));
    } else if (target.type === CATEGORY) {
      // カテゴリーの見出しに落とすと、そのカテゴリーの先頭に入れる。
      const children = channels.filter((channel) => channel.parent_id === target.id && channel.id !== dragging.id);
      commit(dragging, target.id, toPositions([dragging, ...children], dragging, target.id));
    } else {
      const parentId = (target.parent_id as string | undefined) ?? null;
      const siblings = channels.filter((channel) => channel.type !== CATEGORY && (channel.parent_id ?? null) === parentId);
      commit(dragging, parentId, toPositions(moveItem(siblings, dragging, target.id, after), dragging, parentId));
    }
  };
  const dragProps = (channel: Json) => ({
    draggable: true,
    onDragStart: (event: React.DragEvent<HTMLElement>) => {
      event.dataTransfer.setData(DRAG_TYPE, channel.id);
      event.dataTransfer.effectAllowed = 'move';
      setDragging(channel);
    },
    onDragOver: (event: React.DragEvent<HTMLElement>) => {
      if (!canDrop(channel)) return;
      event.preventDefault();
      const into = dragging?.type !== CATEGORY && channel.type === CATEGORY;
      const after = !into && isLowerHalf(event);
      if (!drop || drop.id !== channel.id || drop.after !== after) setDrop({ id: channel.id, after, into });
    },
    onDrop: (event: React.DragEvent<HTMLElement>) => {
      if (!canDrop(channel)) return;
      event.preventDefault();
      dropOn(channel, !(dragging?.type !== CATEGORY && channel.type === CATEGORY) && isLowerHalf(event));
      setDragging(null);
      setDrop(null);
    },
    onDragEnd: () => {
      setDragging(null);
      setDrop(null);
    },
  });
  const dropClass = (channel: Json) =>
    !drop || drop.id !== channel.id ? '' : drop.into ? ' drop-into' : drop.after ? ' drop-after' : ' drop-before';
  const button = (channel: Json) => (
    <button key={channel.id} className={(channel.id === channelId ? 'channel active' : unread(channel.id) ? 'channel unread' : 'channel') + dropClass(channel)}
      onClick={() => onSelect(channel.id)}
      onContextMenu={(event) => handlers.onChannelMenu(event, channel.id)}
      {...(isThreadType(channel.type) ? {} : dragProps(channel))}>
      <ChannelIcon type={channel.type} /><span>{channel.name}</span>
    </button>
  );
  const rows = (items: Json[]) =>
    items.map((channel) =>
      isVoiceType(channel.type) ? (
        <div key={channel.id}>
          <button className={`channel${dropClass(channel)}`} onClick={() => onVoice(channel.id)}
            onContextMenu={(event) => handlers.onChannelMenu(event, channel.id)} {...dragProps(channel)}>
            <ChannelIcon type={channel.type} /><span>{channel.name}</span>
          </button>
          <VoiceUsers channelId={channel.id} state={state} {...handlers} />
        </div>
      ) : (
        <div key={channel.id}>
          {button(channel)}
          <div className="channel-threads">{threadsOf(channel).map(button)}</div>
        </div>
      ),
    );
  const ungrouped = channels.filter((channel) => channel.type !== CATEGORY && !channel.parent_id);
  return (
    <div className="channel-list" onContextMenu={onListMenu}>
      {rows(ungrouped)}
      {categories.map((category) => {
        const closed = collapsed.has(category.id);
        return (
          <div key={category.id}>
            <button className={(closed ? 'category closed' : 'category') + dropClass(category)} aria-expanded={!closed}
              onClick={() => onToggleCategory(category.id)}
              onContextMenu={(event) => handlers.onChannelMenu(event, category.id)} {...dragProps(category)}>
              <ChevronIcon />{category.name}
            </button>
            {!closed && rows(channels.filter((channel) => channel.parent_id === category.id))}
          </div>
        );
      })}
      {pendingMove && (
        <SyncPermissionsDialog channel={pendingMove.channel} category={pendingMove.category} onClose={closePendingMove}
          onMove={(sync) => onReorder(pendingMove.entries.map((entry) =>
            entry.id === pendingMove.channel.id ? { ...entry, lock_permissions: sync } : entry))} />
      )}
    </div>
  );
}

/** チャンネルを別のカテゴリーへ移すときに、移動先の権限に同期するかを選ぶ。 */
function SyncPermissionsDialog({ channel, category, onMove, onClose }: {
  channel: Json;
  category: Json;
  onMove: (sync: boolean) => void;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);
  const choose = (sync: boolean) => {
    onMove(sync);
    onClose();
  };
  return (
    <div className="overlay" onClick={onClose}>
      <div className="dialog" role="alertdialog" aria-label="権限を同期しますか？" onClick={(event) => event.stopPropagation()}>
        <h2>権限を同期しますか？</h2>
        <p className="dialog-message">
          「{channel.name}」を「{category.name}」に移動します。チャンネルの権限を、移動先のカテゴリーの権限に合わせますか？
        </p>
        <div className="dialog-actions">
          <button className="button secondary" onClick={onClose}>キャンセル</button>
          <button className="button secondary" onClick={() => choose(false)}>同期せずに移動</button>
          <button className="button primary" autoFocus onClick={() => choose(true)}>同期して移動</button>
        </div>
      </div>
    </div>
  );
}

function UserPanel({ state, activeUser, voice, onLeaveVoice, onError }: {
  state: Json;
  activeUser?: Json;
  voice?: Json;
  onLeaveVoice: () => void;
  onError: (message: string) => void;
}) {
  const [open, setOpen] = useState(!state.activeUserId);
  const users = Object.values<Json>(state.users).filter((user) => user.id !== state.botUserId);
  const login = (userId: string) => {
    setOpen(false);
    api.post('/switch-user', { userId }).catch((error: Error) => onError(error.message));
  };
  return (
    <div className="user-area">
      {voice && (
        <div className="voice-panel">
          <div><strong>ボイス接続中</strong><span>{state.channels[voice.channel_id]?.name}</span></div>
          <button aria-label="切断" title="切断" onClick={onLeaveVoice}><HangUpIcon /></button>
        </div>
      )}
      {open && (
        <div className="login-menu" role="menu">
          <div className="login-title">ログインするユーザー</div>
          {users.map((user) => (
            <button key={user.id} className={user.id === activeUser?.id ? 'login-user active' : 'login-user'} onClick={() => login(user.id)}>
              <Avatar user={user} size={28} />{displayName(user)}
            </button>
          ))}
          {users.length === 0 && <div className="login-empty">管理画面でユーザーを追加してください</div>}
        </div>
      )}
      <button className="user-panel" aria-label="ログインするユーザーを切り替える" onClick={() => setOpen(!open)}>
        <Avatar user={activeUser} size={32} online />
        <span className="user-names">
          <strong>{activeUser ? displayName(activeUser) : '未ログイン'}</strong>
          <small>{activeUser ? activeUser.username : 'ユーザーを選択'}</small>
        </span>
      </button>
    </div>
  );
}

function SidePanel({ tab, onTab, guild, state, testList, handlers }: {
  tab: PanelTab;
  onTab: (tab: PanelTab) => void;
  guild?: Json;
  state: Json;
  testList: TestListProps;
  handlers: PopupHandlers;
}) {
  // DM にメンバーの一覧はないため、テストケースだけを表示する。
  const active = guild ? tab : 'tests';
  const project = selectedProject(testList.tests, testList.projectName);
  const tabButton = (id: PanelTab, label: string, count: number) => (
    <button role="tab" className={active === id ? 'panel-tab active' : 'panel-tab'} aria-selected={active === id}
      disabled={id === 'members' && !guild} onClick={() => onTab(id)}>
      {label}<span className="tab-count">{count}</span>
    </button>
  );
  return (
    <aside className={active === 'tests' ? 'side-panel wide' : 'side-panel'}>
      <div className="panel-tabs" role="tablist" aria-label="右パネル">
        {tabButton('members', 'メンバー', Object.keys(guild?.members ?? {}).length)}
        {tabButton('tests', 'テストケース', project?.tests.length ?? 0)}
      </div>
      <div className="panel-body" role="tabpanel">
        {active === 'members' && guild
          ? <MemberList guild={guild} state={state} {...handlers} />
          : <TestsPanel {...testList} />}
      </div>
    </aside>
  );
}

function MemberList({ guild, state, onMemberMenu, onProfile }: { guild: Json; state: Json } & PopupHandlers) {
  const members = Object.values<Json>(guild.members);
  const hoisted = (guild.roles as Json[]).filter((role) => role.hoist).sort((a, b) => b.position - a.position);
  const placed = new Set<string>();
  const sections = hoisted.map((role) => {
    const items = members.filter((m) => !placed.has(m.user.id) && m.roles.includes(role.id));
    items.forEach((m) => placed.add(m.user.id));
    return { title: role.name, items };
  });
  sections.push({ title: 'オンライン', items: members.filter((m) => !placed.has(m.user.id)) });
  return (
    <div className="members" aria-label="メンバー">
      {sections.filter((section) => section.items.length > 0).map((section) => (
        <div key={section.title}>
          <h3>{section.title} — {section.items.length}</h3>
          {section.items.map((member) => {
            const isBot = member.user.id === state.botUserId;
            return (
              <button key={member.user.id} className={isBot && !state.botConnected ? 'member offline' : 'member'}
                onClick={(event) => onProfile(event, member.user.id)} onContextMenu={(event) => onMemberMenu(event, member.user.id)}>
                <Avatar user={member.user} size={32} online={!isBot || state.botConnected} />
                <span>{member.nick ?? displayName(member.user)}</span>
                {member.user.bot && <span className="bot-tag">BOT</span>}
              </button>
            );
          })}
        </div>
      ))}
    </div>
  );
}

function ChatArea({ title, icon, actions, onCreateThread, messages, channelId, guild, state, activeUser, placeholder, resolveChannel, onResult, onError, panel, showPanel, onTogglePanel }: {
  /** ヘッダーの右に置くボタン。 */
  actions?: React.ReactNode;
  /** メッセージからスレッドを作る。スレッドを作れないチャンネルでは省略する。 */
  onCreateThread?: (message: Json) => void;
  title: string;
  icon: React.ReactNode;
  messages: Json[];
  channelId: string | null;
  guild?: Json;
  state: Json;
  activeUser?: Json;
  placeholder: string;
  resolveChannel: () => Promise<string>;
  onResult: (result: Json, channelId: string | null) => void;
  onError: (message: string) => void;
  panel: React.ReactNode;
  showPanel: boolean;
  onTogglePanel: () => void;
}) {
  const list = useRef<HTMLDivElement>(null);
  const members = useMemo(() => Object.values<Json>(guild?.members ?? {}), [guild]);

  const visible = messages.filter((message) => {
    if (!((message.flags ?? 0) & EPHEMERAL)) return true;
    return message.interaction_metadata?.user?.id === activeUser?.id;
  });

  useEffect(() => {
    list.current?.scrollTo({ top: list.current.scrollHeight });
  }, [visible.length, channelId]);

  const handleResult = (result: Json) => onResult(result, channelId);
  const [replyTo, setReplyTo] = useState<Json | null>(null);
  // 別のチャンネルに移ったときや、返信先が消えたときは返信をやめる。
  const replying = replyTo && replyTo.channel_id === channelId && messages.some((message) => message.id === replyTo.id) ? replyTo : null;

  return (
    <section className="chat">
      <header className="chat-header">
        <span className="chat-header-icon">{icon}</span>
        <h1>{title}</h1>
        <div className="chat-header-actions">
          {actions}
          <span className={state.botConnected ? 'bot-status online' : 'bot-status'}>
            {state.botConnected ? 'Bot 接続中' : 'Bot 未接続'}
          </span>
          <button aria-label="右パネル" title="右パネル" aria-pressed={showPanel} onClick={onTogglePanel}>
            <UsersIcon />
          </button>
        </div>
      </header>
      <div className="chat-body">
        <div className="chat-column">
          <div className="messages" ref={list} aria-label="メッセージ">
            <div className="channel-intro">
              <span className="intro-icon">{icon}</span>
              <h2>{title} へようこそ！</h2>
              <p>ここがこのチャンネルの先頭です。</p>
            </div>
            {visible.map((message, index) => (
              <Message key={message.id} message={message} previous={visible[index - 1]} state={state}
                activeUser={activeUser} onResult={handleResult} onError={onError} onReply={setReplyTo} onCreateThread={onCreateThread} />
            ))}
          </div>
          <Composer channelId={channelId} placeholder={placeholder} state={state} members={members} activeUser={activeUser}
            replyTo={replying} onCancelReply={() => setReplyTo(null)}
            resolveChannel={resolveChannel} onResult={handleResult} onError={onError} />
        </div>
        {showPanel && panel}
      </div>
    </section>
  );
}

/** リンクで開いたチャンネルが描かれるのを待ってから、メッセージまで動かす。 */
const LINK_SCROLL_DELAY_MS = 100;
/** リンクで開いたメッセージを目立たせておく時間。 */
const LINK_HIGHLIGHT_MS = 2000;

/** テストが送信した値を読めるように、送信の後も表示しておく時間。 */
const WATCHED_MODAL_AFTER_SUBMIT_MS = 1000;

interface WatchedModal {
  modal: Json;
  channelId: string;
  closeAt: number;
  values?: Record<string, string>;
}

export function App() {
  const [watchedModal, setWatchedModal] = useState<WatchedModal | null>(null);
  const watchedTimer = useRef<number | undefined>(undefined);
  const onMockEvent = useCallback((type: string, data: Json) => {
    const closeWatchedAt = (closeAt: number) => {
      window.clearTimeout(watchedTimer.current);
      watchedTimer.current = window.setTimeout(() => setWatchedModal(null), closeAt - Date.now());
    };
    if (type === 'MODAL_OPEN') {
      // テストの watchModal で指定した時間だけ表示する。
      const closeAt = Date.now() + data.durationMs;
      closeWatchedAt(closeAt);
      setWatchedModal({ modal: data.modal, channelId: data.channelId, closeAt });
    } else if (type === 'MODAL_SUBMIT') {
      setWatchedModal((current) => {
        if (!current || current.modal.custom_id !== data.customId) return current;
        const closeAt = Math.max(current.closeAt, Date.now() + WATCHED_MODAL_AFTER_SUBMIT_MS);
        closeWatchedAt(closeAt);
        return { ...current, closeAt, values: data.fields };
      });
    }
  }, []);
  const { state, tests, dms, groupDms, connected } = useMockData(onMockEvent);
  const unread = useUnread(state, state?.activeUserId);
  const [view, setView] = useState<View | null>(null);
  const [channels, setChannels] = useState<Record<string, string>>({});
  const [showPanel, setShowPanel] = useState(true);
  const [panelTab, setPanelTab] = useState<PanelTab>('members');
  const [projectName, setProjectName] = useState<string | null>(null);
  const lastChannelId = useRef<string | null>(null);
  const [studioSource, setStudioSource] = useState<StudioSource>(null);
  const [runSelection, setRunSelection] = useState<RunSelection>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [toast, setToast] = useState<string | null>(null);
  const [popup, setPopup] = useState<Popup | null>(null);
  const [editingChannelId, setEditingChannelId] = useState<string | null>(null);
  const [deletingChannelId, setDeletingChannelId] = useState<string | null>(null);
  const [settingsGuildId, setSettingsGuildId] = useState<string | null>(null);
  const [deletingGuildId, setDeletingGuildId] = useState<string | null>(null);
  const [creatingChannel, setCreatingChannel] = useState<{ guildId: string; type: string; parentId?: string } | null>(null);
  const [creatingThreadIn, setCreatingThreadIn] = useState<string | null>(null);
  const [followingChannelId, setFollowingChannelId] = useState<string | null>(null);
  const [threadFromMessage, setThreadFromMessage] = useState<Json | null>(null);
  const [closedCategories, setClosedCategories] = useState<Set<string>>(new Set());
  const [modal, setModal] = useState<{ modal: Json; channelId: string } | null>(null);
  const [volumes, setVolume] = useVolumes();
  // 本文のチャンネルとメッセージのリンクを押したら、そのチャンネルを開く。メッセージのリンクはそのメッセージまで動かす。
  const openLink = useCallback(({ guildId, channelId, messageId }: ChannelLinkTarget) => {
    if (guildId === DM_GUILD) {
      setView({ kind: 'dm', channelId });
    } else {
      setView({ kind: 'guild', guildId });
      setChannels((current) => ({ ...current, [guildId]: channelId }));
    }
    if (!messageId) return;
    window.setTimeout(() => {
      const target = document.querySelector<HTMLElement>(`[data-message-id="${CSS.escape(messageId)}"]`);
      if (!target) return;
      target.scrollIntoView({ block: 'center' });
      target.classList.add('highlighted');
      window.setTimeout(() => target.classList.remove('highlighted'), LINK_HIGHLIGHT_MS);
    }, LINK_SCROLL_DELAY_MS);
  }, []);
  const closePopup = useCallback(() => setPopup(null), []);
  const closeDeleting = useCallback(() => setDeletingChannelId(null), []);
  const closeSettings = useCallback(() => setSettingsGuildId(null), []);
  const closeDeletingGuild = useCallback(() => setDeletingGuildId(null), []);
  const closeCreating = useCallback(() => setCreatingChannel(null), []);
  const closeCreatingThread = useCallback(() => setCreatingThreadIn(null), []);
  const closeFollowing = useCallback(() => setFollowingChannelId(null), []);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 6000);
    return () => clearTimeout(timer);
  }, [toast]);

  const inVoice = Object.values<Json>(state?.voiceStates ?? {}).some((v) => v.user_id === state?.activeUserId);
  useVoiceAudio(inVoice, volumes[state?.botUserId] ?? DEFAULT_VOLUME, setToast);

  if (!token) {
    return (
      <div className="fullscreen">
        <h1>dismock</h1>
        <p>ターミナルに表示された URL を開いてください。</p>
        <p className="legal-notice">{LEGAL_NOTICE}</p>
      </div>
    );
  }
  if (!state) {
    return <div className="fullscreen"><div className="spinner" /><p>{connected ? '読み込み中…' : 'Mock に接続しています…'}</p></div>;
  }

  const guilds = Object.values<Json>(state.guilds);
  const activeUser = state.users[state.activeUserId ?? ''] as Json | undefined;
  const fallback: View = guilds[0] ? { kind: 'guild', guildId: guilds[0].id } : { kind: 'dm' };
  const isValid = view && (view.kind !== 'guild' || state.guilds[view.guildId]);
  const current: View = isValid ? view : fallback;
  const guild = current.kind === 'guild' ? (state.guilds[current.guildId] as Json) : undefined;

  const textChannels = guild
    ? Object.values<Json>(state.channels)
        .filter((c) => c.guild_id === guild.id && c.type === TEXT && canViewChannel(state, guild, c, state.activeUserId))
        .sort((a, b) => a.position - b.position)
    : [];
  const opened = guild ? (state.channels[channels[guild.id] ?? ''] as Json | undefined) : undefined;
  const canOpen = opened && guild && opened.guild_id === guild.id && canViewChannel(state, guild, opened, state.activeUserId);
  const channelId = guild ? ((canOpen ? opened.id : textChannels[0]?.id) ?? null) : null;
  const channel = channelId ? (state.channels[channelId] as Json) : undefined;
  // テストはメッセージを送信できるチャンネルで実行する。
  if (channel && !isWithoutMessages(channel.type)) lastChannelId.current = channel.id;

  const voice = activeUser
    ? Object.values<Json>(state.voiceStates).find((v) => v.user_id === activeUser.id)
    : undefined;

  const onError = (message: string) => setToast(message);
  const onResult = (result: Json, target: string | null) => {
    if (result.kind === 'modal') setModal({ modal: result.modal, channelId: target ?? '' });
  };
  const handlers: PopupHandlers = {
    onChannelMenu: (event, id) => {
      event.preventDefault();
      setPopup({ kind: 'channel', channelId: id, anchor: pointAnchor(event.clientX, event.clientY) });
    },
    onMemberMenu: (event, userId) => {
      event.preventDefault();
      setPopup({ kind: 'member', userId, anchor: pointAnchor(event.clientX, event.clientY) });
    },
    onProfile: (event, userId) => {
      const { left, right, top } = event.currentTarget.getBoundingClientRect();
      setPopup({ kind: 'profile', userId, anchor: { left: left - POPUP_GAP, right: right + POPUP_GAP, top } });
    },
  };

  const joinVoice = (target: string) => {
    if (!guild || !activeUser) return;
    api.post('/voice', { userId: activeUser.id, guildId: guild.id, channelId: target }).catch((error: Error) => onError(error.message));
  };
  const leaveVoice = () => {
    if (!voice) return;
    api.post('/voice', { userId: voice.user_id, guildId: voice.guild_id, channelId: null }).catch((error: Error) => onError(error.message));
  };
  const openDm = async () => (await api.post('/dm', { userId: activeUser?.id })).id as string;

  const showsChat = current.kind === 'guild' || current.kind === 'dm';
  const openGroup = current.kind === 'dm' ? groupDms.find((group) => group.channel.id === current.channelId) : undefined;
  const groupName = (group: Json) => (group.name as string | null) ?? (group.recipients as Json[]).map(displayName).join(', ');
  const toggleChannelCategory = (id: string) => {
    const next = new Set(closedCategories);
    if (!next.delete(id)) next.add(id);
    setClosedCategories(next);
  };
  const popupChannel = popup?.kind === 'channel' ? (state.channels[popup.channelId] as Json | undefined) : undefined;
  const settingsGuild = settingsGuildId ? (state.guilds[settingsGuildId] as Json | undefined) : undefined;
  const deletingGuild = deletingGuildId ? (state.guilds[deletingGuildId] as Json | undefined) : undefined;
  const popupUser = popup && (popup.kind === 'member' || popup.kind === 'profile') ? (state.users[popup.userId] as Json | undefined) : undefined;
  const editingChannel = editingChannelId ? (state.channels[editingChannelId] as Json | undefined) : undefined;
  const deletingChannel = deletingChannelId ? (state.channels[deletingChannelId] as Json | undefined) : undefined;
  const openDb = (runId: string, id: string, label: string) => {
    setStudioSource({ runId, id, label });
    setView({ kind: 'studio' });
  };
  const openRun = (runId: string, testId: string) => {
    setRunSelection({ runId, testId });
    setView({ kind: 'runs' });
  };
  const toggleCategory = (key: string) => {
    const next = new Set(collapsed);
    if (!next.delete(key)) next.add(key);
    setCollapsed(next);
  };
  const testList: TestListProps = {
    tests,
    projectName,
    onProject: setProjectName,
    channelId: lastChannelId.current,
    onError,
    collapsed,
    onToggleCategory: toggleCategory,
    onOpenDb: openDb,
    onOpenRun: openRun,
  };
  const panel = <SidePanel tab={panelTab} onTab={setPanelTab} guild={guild} state={state} testList={testList} handlers={handlers} />;
  const togglePanel = () => setShowPanel(!showPanel);

  return (
    <OpenLinkContext.Provider value={openLink}>
    <div className="app">
      <ServerRail view={current} guilds={guilds} media={state.media} onSelect={(next) => {
        // 左のアイコンから開いた DB Studio は、接続中の Bot の最新の DB を表示する。テストの DB は「DB」ボタンから開く。
        if (next.kind === 'studio') setStudioSource(null);
        setView(next);
      }} />
      {showsChat && (
        <aside className="sidebar">
          {guild ? (
            <button className="sidebar-header" aria-haspopup="menu" onClick={(event) => {
              const { left, bottom } = event.currentTarget.getBoundingClientRect();
              setPopup({ kind: 'guild', anchor: pointAnchor(left + POPUP_GAP, bottom) });
            }}>{guild.name}<ChevronIcon /></button>
          ) : <header className="sidebar-header">ダイレクトメッセージ</header>}
          {channelId && (
            <MarkRead channelId={channelId} latest={latestFromOthers(state, channelId, state.activeUserId)} onRead={unread.markRead} />
          )}
          {guild ? (
            <ChannelList guild={guild} state={state} channelId={channelId} collapsed={closedCategories} unread={unread.isUnread}
              onReorder={(entries) => void api.patch(`/guilds/${guild.id}/channels`, entries).catch((error: Error) => onError(error.message))}
              onSelect={(id) => setChannels({ ...channels, [guild.id]: id })} onVoice={joinVoice} onToggleCategory={toggleChannelCategory}
              onListMenu={(event) => {
                // チャンネルの行のメニューが開いているときは、一覧のメニューを重ねない。
                if (event.defaultPrevented) return;
                event.preventDefault();
                setPopup({ kind: 'channel-list', anchor: pointAnchor(event.clientX, event.clientY) });
              }} {...handlers} />
          ) : (
            <div className="channel-list">
              <button className={openGroup ? 'channel dm-entry' : 'channel active dm-entry'} onClick={() => setView({ kind: 'dm' })}>
                <Avatar user={state.users[state.botUserId]} size={32} online={state.botConnected} />
                <span>{displayName(state.users[state.botUserId])}</span>
              </button>
              {groupDms.map(({ channel: group }: Json) => (
                <button key={group.id} className={group.id === openGroup?.channel.id ? 'channel active dm-entry' : 'channel dm-entry'}
                  onClick={() => setView({ kind: 'dm', channelId: group.id })}>
                  <ChatIcon /><span>{groupName(group)}</span>
                </button>
              ))}
            </div>
          )}
          <UserPanel state={state} activeUser={activeUser} voice={voice} onLeaveVoice={leaveVoice} onError={onError} />
        </aside>
      )}
      {current.kind === 'guild' && (
        channel && isForumType(channel.type) ? (
          <ForumView channel={channel} state={state} activeUser={activeUser} onError={onError}
            onOpen={(id) => setChannels({ ...channels, [channel.guild_id]: id })} />
        ) : channel?.type === DIRECTORY ? (
          <section className="chat empty-chat">ディレクトリチャンネルにはメッセージを送信できません。</section>
        ) : channel ? (
          <ChatArea title={channel.name} icon={<ChannelIcon type={channel.type} />} channelId={channel.id} guild={guild} state={state}
            onCreateThread={(message) => setThreadFromMessage(message)}
            actions={channel.type === ChannelKind.announcement && (
              <button className="header-button" onClick={() => setFollowingChannelId(channel.id)}>フォロー</button>
            )}
            messages={state.messages[channel.id] ?? []} activeUser={activeUser} placeholder={`#${channel.name} へメッセージを送信`}
            resolveChannel={async () => channel.id} onResult={onResult} onError={onError} panel={panel} showPanel={showPanel} onTogglePanel={togglePanel} />
        ) : (
          <section className="chat empty-chat">テキストチャンネルがありません。チャンネルの一覧を右クリックして作成してください。</section>
        )
      )}
      {current.kind === 'dm' && openGroup && (
        <ChatArea title={groupName(openGroup.channel)} icon={<ChatIcon />} state={state} messages={openGroup.messages}
          channelId={openGroup.channel.id} activeUser={activeUser} placeholder="グループへメッセージを送信"
          resolveChannel={async () => openGroup.channel.id} onResult={onResult} onError={onError} panel={panel} showPanel={showPanel} onTogglePanel={togglePanel} />
      )}
      {current.kind === 'dm' && !openGroup && (
        <ChatArea title={displayName(state.users[state.botUserId])} icon={<ChatIcon />} state={state} messages={dms}
          channelId={dms[0]?.channel_id ?? null} activeUser={activeUser} placeholder="Bot へメッセージを送信"
          resolveChannel={openDm} onResult={onResult} onError={onError} panel={panel} showPanel={showPanel} onTogglePanel={togglePanel} />
      )}
      {current.kind === 'tests' && <TestsPage {...testList} />}
      {current.kind === 'runs' && (
        <RunsPage tests={tests} selection={runSelection} onSelect={setRunSelection} onError={onError} onOpenDb={openDb} />
      )}
      {current.kind === 'studio' && <StudioPage tests={tests} source={studioSource} onSource={setStudioSource} onError={onError} />}
      {current.kind === 'admin' && (
        <AdminPage state={state} tests={tests} onError={onError} onOpenGuild={(guildId) => setView({ kind: 'guild', guildId })} />
      )}
      {popup?.kind === 'guild' && guild && (
        <ContextMenu anchor={popup.anchor} label={`${guild.name} のメニュー`} onClose={closePopup}
          entries={[
            { label: 'チャンネルを作成', onSelect: () => setCreatingChannel({ guildId: guild.id, type: 'text' }) },
            { label: 'カテゴリーを作成', onSelect: () => setCreatingChannel({ guildId: guild.id, type: 'category' }) },
            { label: 'サーバー設定', onSelect: () => setSettingsGuildId(guild.id) },
          ]} />
      )}
      {popup?.kind === 'channel-list' && guild && (
        <ContextMenu anchor={popup.anchor} label="チャンネル一覧のメニュー" onClose={closePopup}
          entries={[
            { label: 'チャンネルを作成', onSelect: () => setCreatingChannel({ guildId: guild.id, type: 'text' }) },
            { label: 'カテゴリーを作成', onSelect: () => setCreatingChannel({ guildId: guild.id, type: 'category' }) },
          ]} />
      )}
      {popupChannel && popup && (
        <ChannelMenu channel={popupChannel} state={state} voiceChannelId={voice?.channel_id} collapsed={closedCategories.has(popupChannel.id)}
          anchor={popup.anchor} onClose={closePopup} onError={onError}
          onJoin={() => joinVoice(popupChannel.id)} onLeave={leaveVoice} onEdit={() => setEditingChannelId(popupChannel.id)}
          onDelete={() => setDeletingChannelId(popupChannel.id)} onToggle={() => toggleChannelCategory(popupChannel.id)}
          onCreate={(type, parentId) => setCreatingChannel({ guildId: popupChannel.guild_id, type, parentId })}
          onCreateThread={() => setCreatingThreadIn(popupChannel.id)} />
      )}
      {popup?.kind === 'member' && popupUser && guild && (
        <MemberMenu user={popupUser} guild={guild} state={state} tests={tests} activeUser={activeUser} channelId={channelId}
          volume={volumes[popupUser.id]} onVolume={(volume) => setVolume(popupUser.id, volume)}
          onResult={(result) => onResult(result, channelId)} anchor={popup.anchor} onClose={closePopup} onError={onError} />
      )}
      {popup?.kind === 'profile' && popupUser && guild?.members[popupUser.id] && (
        <ProfileCard user={popupUser} guild={guild} activeUser={activeUser} anchor={popup.anchor} onClose={closePopup} onError={onError} />
      )}
      {editingChannel && (
        <ChannelSettings key={editingChannel.id} channel={editingChannel} guild={state.guilds[editingChannel.guild_id]} state={state}
          onDelete={() => setDeletingChannelId(editingChannel.id)} onClose={() => setEditingChannelId(null)} onError={onError} />
      )}
      {deletingChannel && (
        <ConfirmDialog title="チャンネルの削除" message={`「${deletingChannel.name}」を削除しますか？メッセージも削除され、元に戻せません。`}
          confirmLabel="削除" onClose={closeDeleting}
          onConfirm={() => void api.delete(`/channels/${deletingChannel.id}`).catch((error: Error) => onError(error.message))} />
      )}
      {settingsGuild && (
        <ServerSettings key={settingsGuild.id} guild={settingsGuild} state={state} onClose={closeSettings} onError={onError}
          onDelete={() => setDeletingGuildId(settingsGuild.id)} />
      )}
      {deletingGuild && (
        <ConfirmDialog title="サーバーの削除" message={`「${deletingGuild.name}」を削除しますか？チャンネルとメッセージも削除され、元に戻せません。`}
          confirmLabel="削除" onClose={closeDeletingGuild}
          onConfirm={() => void api.delete(`/guilds/${deletingGuild.id}`).catch((error: Error) => onError(error.message))} />
      )}
      {creatingChannel && state.guilds[creatingChannel.guildId] && (
        <ChannelCreateDialog guild={state.guilds[creatingChannel.guildId]} initialType={creatingChannel.type} initialParent={creatingChannel.parentId}
          onClose={closeCreating} onError={onError}
          categories={Object.values<Json>(state.channels).filter((c) => c.guild_id === creatingChannel.guildId && c.type === CATEGORY)} />
      )}
      {followingChannelId && state.channels[followingChannelId] && (
        <FollowDialog channel={state.channels[followingChannelId]} state={state} onClose={closeFollowing} onError={onError} />
      )}
      {threadFromMessage && state.channels[threadFromMessage.channel_id] && activeUser && (
        <ThreadCreateDialog channel={state.channels[threadFromMessage.channel_id]} message={threadFromMessage} userId={activeUser.id}
          onClose={() => setThreadFromMessage(null)} onError={onError}
          onCreated={(thread) => setChannels({ ...channels, [thread.guild_id]: thread.id })} />
      )}
      {creatingThreadIn && state.channels[creatingThreadIn] && activeUser && (
        <ThreadCreateDialog channel={state.channels[creatingThreadIn]} userId={activeUser.id} onClose={closeCreatingThread} onError={onError} />
      )}
      {modal && (
        <ModalDialog modal={modal.modal} channelId={modal.channelId} userId={activeUser?.id}
          onClose={() => setModal(null)} onResult={(result) => onResult(result, modal.channelId)} onError={onError} />
      )}
      {watchedModal && !modal && (
        <ModalDialog modal={watchedModal.modal} channelId={watchedModal.channelId} watched={{ values: watchedModal.values }}
          onClose={() => setWatchedModal(null)} onResult={() => {}} onError={onError} />
      )}
      {toast && <div className="toast" role="alert">{toast}</div>}
      {!connected && <div className="toast warning" role="status">Mock との接続が切れました。再接続しています…</div>}
    </div>
    </OpenLinkContext.Provider>
  );
}
