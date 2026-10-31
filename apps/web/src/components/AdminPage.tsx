import { useState, type FormEvent } from 'react';
import { api, type Json } from '../api';

interface AdminPageProps {
  state: Json;
  tests: Json | null;
  onError: (message: string) => void;
}

const CHANNEL_TYPES: Record<number, string> = { 0: 'テキスト', 2: 'ボイス', 4: 'カテゴリ' };

function AddForm({ placeholder, onSubmit, children }: {
  placeholder: string;
  onSubmit: (name: string) => Promise<unknown>;
  children?: React.ReactNode;
}) {
  const [name, setName] = useState('');
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!name.trim()) return;
    void onSubmit(name.trim()).then(() => setName(''));
  };
  return (
    <form className="add-form" onSubmit={submit}>
      <input value={name} placeholder={placeholder} aria-label={placeholder} onChange={(event) => setName(event.target.value)} />
      {children}
      <button className="button primary">追加</button>
    </form>
  );
}

export function AdminPage({ state, tests, onError }: AdminPageProps) {
  const guilds = Object.values<Json>(state.guilds);
  const [guildId, setGuildId] = useState<string | null>(null);
  const [channelType, setChannelType] = useState('text');
  const [parent, setParent] = useState('');
  const guild = guilds.find((g) => g.id === guildId) ?? guilds[0];
  const channels = Object.values<Json>(state.channels).filter((c) => c.guild_id === guild?.id);
  const users = Object.values<Json>(state.users).filter((u) => u.id !== state.botUserId);
  const roles = ((guild?.roles ?? []) as Json[]).filter((role) => role.id !== guild?.id);

  const call = (action: Promise<unknown>) => action.catch((error: Error) => onError(error.message));

  const toggleRole = (user: Json, roleId: string, enabled: boolean) => {
    const current = (guild?.members[user.id]?.roles ?? []) as string[];
    const next = enabled ? [...current, roleId] : current.filter((id) => id !== roleId);
    void call(api.put(`/guilds/${guild?.id}/members/${user.id}`, { roles: next }));
  };

  const rename = (user: Json) => {
    const username = window.prompt('ユーザー名', user.username);
    if (username) void call(api.patch(`/users/${user.id}`, { username }));
  };

  return (
    <main className="page admin-page">
      <header className="page-header">
        <h1>管理</h1>
        <div className="page-actions">
          <label className="inline-field">
            <span>サーバー</span>
            <select value={guild?.id ?? ''} onChange={(event) => setGuildId(event.target.value)}>
              {guilds.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
            </select>
          </label>
          <button className="button danger" disabled={Boolean(tests?.runningProject)} onClick={() => {
            if (window.confirm('すべてのダミーデータを削除しますか？')) void call(api.post('/reset'));
          }}>すべてリセット</button>
        </div>
      </header>

      <section className="admin-section">
        <h2>サーバー</h2>
        <AddForm placeholder="サーバー名" onSubmit={(name) => call(api.post('/seed', { guilds: [{ name }] }))} />
        <ul className="admin-list">
          {guilds.map((g) => (
            <li key={g.id}>
              <span>{g.name}</span><code>{g.id}</code>
              <button className="link-danger" onClick={() => call(api.delete(`/guilds/${g.id}`))}>削除</button>
            </li>
          ))}
        </ul>
      </section>

      <section className="admin-section">
        <h2>チャンネル</h2>
        <AddForm placeholder="チャンネル名" onSubmit={(name) => call(api.post('/seed', {
          channels: [{ name, guild: guild?.id, type: channelType, parent: parent || undefined }],
        }))}>
          <select aria-label="チャンネルの種類" value={channelType} onChange={(event) => setChannelType(event.target.value)}>
            <option value="text">テキスト</option>
            <option value="voice">ボイス</option>
            <option value="category">カテゴリ</option>
          </select>
          <select aria-label="カテゴリ" value={parent} onChange={(event) => setParent(event.target.value)}>
            <option value="">カテゴリなし</option>
            {channels.filter((c) => c.type === 4).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </AddForm>
        <ul className="admin-list">
          {channels.map((channel) => (
            <li key={channel.id}>
              <span>{channel.name}</span><small>{CHANNEL_TYPES[channel.type]}</small><code>{channel.id}</code>
              <button className="link-danger" onClick={() => call(api.delete(`/channels/${channel.id}`))}>削除</button>
            </li>
          ))}
        </ul>
      </section>

      <section className="admin-section">
        <h2>ロール</h2>
        <AddForm placeholder="ロール名" onSubmit={(name) => call(api.post('/seed', { roles: [{ name, guild: guild?.id }] }))} />
        <ul className="admin-list">
          {roles.map((role) => (
            <li key={role.id}>
              <span>{role.name}</span><code>{role.id}</code>
              <button className="link-danger" onClick={() => call(api.delete(`/guilds/${guild?.id}/roles/${role.id}`))}>削除</button>
            </li>
          ))}
        </ul>
      </section>

      <section className="admin-section">
        <h2>ユーザー</h2>
        <AddForm placeholder="ユーザー名" onSubmit={(username) => call(api.post('/seed', { users: [{ username, guild: guild?.id }] }))} />
        <table className="admin-table">
          <thead><tr><th>名前</th><th>ID</th><th>Bot</th><th>ロール</th><th /></tr></thead>
          <tbody>
            {users.map((user) => (
              <tr key={user.id}>
                <td><button className="link" onClick={() => rename(user)}>{user.username}</button></td>
                <td><code>{user.id}</code></td>
                <td><input type="checkbox" aria-label={`${user.username} は Bot`} checked={user.bot}
                  onChange={(event) => void call(api.patch(`/users/${user.id}`, { bot: event.target.checked }))} /></td>
                <td className="role-checks">
                  {roles.map((role) => (
                    <label key={role.id} className="check-label">
                      <input type="checkbox" checked={guild?.members[user.id]?.roles.includes(role.id) ?? false}
                        onChange={(event) => toggleRole(user, role.id, event.target.checked)} />
                      {role.name}
                    </label>
                  ))}
                </td>
                <td><button className="link-danger" onClick={() => call(api.delete(`/users/${user.id}`))}>削除</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </main>
  );
}
