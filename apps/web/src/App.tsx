import { useEffect, useMemo, useRef, useState } from 'react';
import { api, token, useMockData, type Json } from './api';
import { AdminPage } from './components/AdminPage';
import { Avatar, colorOf, displayName } from './components/Avatar';
import { Composer } from './components/Composer';
import {
  BeakerIcon, ChatIcon, ChevronIcon, GearIcon, HangUpIcon, HashIcon, PlusIcon, SpeakerIcon, UsersIcon,
} from './components/Icons';
import { Message } from './components/Message';
import { ModalDialog } from './components/ModalDialog';
import { TestsPage } from './components/TestsPage';

type View = { kind: 'guild'; guildId: string } | { kind: 'dm' } | { kind: 'tests' } | { kind: 'admin' };

const TEXT = 0;
const VOICE = 2;
const CATEGORY = 4;
const EPHEMERAL = 64;

function ServerRail({ view, guilds, onSelect }: { view: View; guilds: Json[]; onSelect: (view: View) => void }) {
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
          { kind: 'guild', guildId: guild.id }, guild.name.slice(0, 2), colorOf(guild.id)),
      )}
      {railButton('add', 'サーバーを追加', false, { kind: 'admin' }, <PlusIcon />)}
      <div className="rail-spacer" />
      <div className="rail-separator" />
      {railButton('tests', 'テスト', view.kind === 'tests', { kind: 'tests' }, <BeakerIcon />)}
      {railButton('admin', '管理', view.kind === 'admin', { kind: 'admin' }, <GearIcon />)}
    </nav>
  );
}

function VoiceUsers({ channelId, state }: { channelId: string; state: Json }) {
  const voices = Object.values<Json>(state.voiceStates).filter((voice) => voice.channel_id === channelId);
  if (voices.length === 0) return null;
  return (
    <div className="voice-users">
      {voices.map((voice) => (
        <div key={voice.user_id} className="voice-user">
          <Avatar user={state.users[voice.user_id]} size={22} />
          {displayName(state.users[voice.user_id])}
        </div>
      ))}
    </div>
  );
}

interface ChannelListProps {
  guild: Json;
  state: Json;
  channelId: string | null;
  onSelect: (id: string) => void;
  onVoice: (id: string) => void;
}

function ChannelList({ guild, state, channelId, onSelect, onVoice }: ChannelListProps) {
  const channels = Object.values<Json>(state.channels)
    .filter((channel) => channel.guild_id === guild.id)
    .sort((a, b) => a.position - b.position);
  const categories = channels.filter((channel) => channel.type === CATEGORY);
  const rows = (items: Json[]) =>
    items.map((channel) =>
      channel.type === VOICE ? (
        <div key={channel.id}>
          <button className="channel" onClick={() => onVoice(channel.id)}><SpeakerIcon /><span>{channel.name}</span></button>
          <VoiceUsers channelId={channel.id} state={state} />
        </div>
      ) : (
        <button key={channel.id} className={channel.id === channelId ? 'channel active' : 'channel'} onClick={() => onSelect(channel.id)}>
          <HashIcon /><span>{channel.name}</span>
        </button>
      ),
    );
  const ungrouped = channels.filter((channel) => channel.type !== CATEGORY && !channel.parent_id);
  return (
    <div className="channel-list">
      {rows(ungrouped)}
      {categories.map((category) => (
        <div key={category.id}>
          <div className="category"><ChevronIcon />{category.name}</div>
          {rows(channels.filter((channel) => channel.parent_id === category.id))}
        </div>
      ))}
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

function MemberList({ guild, state }: { guild: Json; state: Json }) {
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
    <aside className="members" aria-label="メンバー">
      {sections.filter((section) => section.items.length > 0).map((section) => (
        <div key={section.title}>
          <h3>{section.title} — {section.items.length}</h3>
          {section.items.map((member) => {
            const isBot = member.user.id === state.botUserId;
            return (
              <div key={member.user.id} className={isBot && !state.botConnected ? 'member offline' : 'member'}>
                <Avatar user={member.user} size={32} online={!isBot || state.botConnected} />
                <span>{member.nick ?? displayName(member.user)}</span>
                {member.user.bot && <span className="bot-tag">BOT</span>}
              </div>
            );
          })}
        </div>
      ))}
    </aside>
  );
}

function ChatArea({ title, icon, messages, channelId, guild, state, activeUser, placeholder, resolveChannel, onError, showMembers, onToggleMembers }: {
  title: string;
  icon: React.ReactNode;
  messages: Json[];
  channelId: string | null;
  guild?: Json;
  state: Json;
  activeUser?: Json;
  placeholder: string;
  resolveChannel: () => Promise<string>;
  onError: (message: string) => void;
  showMembers: boolean;
  onToggleMembers: () => void;
}) {
  const [modal, setModal] = useState<{ modal: Json; channelId: string } | null>(null);
  const list = useRef<HTMLDivElement>(null);
  const members = useMemo(() => Object.values<Json>(guild?.members ?? {}), [guild]);

  const visible = messages.filter((message) => {
    if (!((message.flags ?? 0) & EPHEMERAL)) return true;
    return message.interaction_metadata?.user?.id === activeUser?.id;
  });

  useEffect(() => {
    list.current?.scrollTo({ top: list.current.scrollHeight });
  }, [visible.length, channelId]);

  const onResult = (result: Json) => {
    if (result.kind === 'modal') setModal({ modal: result.modal, channelId: channelId ?? '' });
  };

  return (
    <section className="chat">
      <header className="chat-header">
        <span className="chat-header-icon">{icon}</span>
        <h1>{title}</h1>
        <div className="chat-header-actions">
          <span className={state.botConnected ? 'bot-status online' : 'bot-status'}>
            {state.botConnected ? 'Bot 接続中' : 'Bot 未接続'}
          </span>
          {guild && (
            <button aria-label="メンバーリスト" title="メンバーリスト" aria-pressed={showMembers} onClick={onToggleMembers}>
              <UsersIcon />
            </button>
          )}
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
                activeUser={activeUser} onResult={onResult} onError={onError} />
            ))}
          </div>
          <Composer channelId={channelId} placeholder={placeholder} state={state} members={members} activeUser={activeUser}
            resolveChannel={resolveChannel} onResult={onResult} onError={onError} />
        </div>
        {guild && showMembers && <MemberList guild={guild} state={state} />}
      </div>
      {modal && (
        <ModalDialog modal={modal.modal} channelId={modal.channelId} userId={activeUser?.id}
          onClose={() => setModal(null)} onResult={onResult} onError={onError} />
      )}
    </section>
  );
}

export function App() {
  const { state, tests, dms, connected } = useMockData();
  const [view, setView] = useState<View | null>(null);
  const [channels, setChannels] = useState<Record<string, string>>({});
  const [showMembers, setShowMembers] = useState(true);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 6000);
    return () => clearTimeout(timer);
  }, [toast]);

  if (!token) {
    return <div className="fullscreen"><h1>Discord Mock</h1><p>ターミナルに表示された URL を開いてください。</p></div>;
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
    ? Object.values<Json>(state.channels).filter((c) => c.guild_id === guild.id && c.type === TEXT).sort((a, b) => a.position - b.position)
    : [];
  const channelId = guild
    ? (textChannels.find((c) => c.id === channels[guild.id])?.id ?? textChannels[0]?.id ?? null)
    : null;
  const channel = channelId ? (state.channels[channelId] as Json) : undefined;

  const voice = activeUser
    ? Object.values<Json>(state.voiceStates).find((v) => v.user_id === activeUser.id)
    : undefined;

  const onError = (message: string) => setToast(message);

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

  return (
    <div className="app">
      <ServerRail view={current} guilds={guilds} onSelect={setView} />
      {showsChat && (
        <aside className="sidebar">
          <header className="sidebar-header">{guild ? <>{guild.name}<ChevronIcon /></> : 'ダイレクトメッセージ'}</header>
          {guild ? (
            <ChannelList guild={guild} state={state} channelId={channelId}
              onSelect={(id) => setChannels({ ...channels, [guild.id]: id })} onVoice={joinVoice} />
          ) : (
            <div className="channel-list">
              <button className="channel active dm-entry">
                <Avatar user={state.users[state.botUserId]} size={32} online={state.botConnected} />
                <span>{displayName(state.users[state.botUserId])}</span>
              </button>
            </div>
          )}
          <UserPanel state={state} activeUser={activeUser} voice={voice} onLeaveVoice={leaveVoice} onError={onError} />
        </aside>
      )}
      {current.kind === 'guild' && (
        channel ? (
          <ChatArea title={channel.name} icon={<HashIcon />} channelId={channel.id} guild={guild} state={state}
            messages={state.messages[channel.id] ?? []} activeUser={activeUser} placeholder={`#${channel.name} へメッセージを送信`}
            resolveChannel={async () => channel.id} onError={onError} showMembers={showMembers}
            onToggleMembers={() => setShowMembers(!showMembers)} />
        ) : (
          <section className="chat empty-chat">テキストチャンネルがありません。管理画面から追加してください。</section>
        )
      )}
      {current.kind === 'dm' && (
        <ChatArea title={displayName(state.users[state.botUserId])} icon={<ChatIcon />} state={state} messages={dms}
          channelId={dms[0]?.channel_id ?? null} activeUser={activeUser} placeholder="Bot へメッセージを送信"
          resolveChannel={openDm} onError={onError} showMembers={false} onToggleMembers={() => {}} />
      )}
      {current.kind === 'tests' && <TestsPage tests={tests} onError={onError} />}
      {current.kind === 'admin' && <AdminPage state={state} tests={tests} onError={onError} />}
      {toast && <div className="toast" role="alert">{toast}</div>}
      {!connected && <div className="toast warning" role="status">Mock との接続が切れました。再接続しています…</div>}
    </div>
  );
}
