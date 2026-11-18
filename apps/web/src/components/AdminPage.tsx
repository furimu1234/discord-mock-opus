import { useCallback, useState, type FormEvent } from 'react';
import { api, LEGAL_NOTICE, type Json } from '../api';
import { canStartProjects, isActiveProject } from '../projects';
import { ConfirmDialog } from './ConfirmDialog';
import { DesktopSection } from './DesktopSection';
import { FolderDialog } from './FolderDialog';
import { Select } from './Select';

interface AdminPageProps {
  state: Json;
  tests: Json | null;
  onError: (message: string) => void;
  /** サーバーの画面へ移動する。 */
  onOpenGuild: (guildId: string) => void;
}

interface Confirmation {
  title: string;
  message: string;
  confirmLabel: string;
  path?: string;
  /** 確認した後に実行する処理。省略すると `path` を削除する。 */
  action?: () => Promise<unknown>;
}

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

function ProjectsSection({ state, tests, call, onConfirm }: {
  state: Json;
  tests: Json | null;
  call: (action: Promise<unknown>) => Promise<unknown>;
  onConfirm: (confirmation: Confirmation) => void;
}) {
  const [label, setLabel] = useState('');
  const [dir, setDir] = useState('');
  const [browsing, setBrowsing] = useState(false);
  const closeBrowsing = useCallback(() => setBrowsing(false), []);
  const projects = state.projects as Json[];
  const launcher = (tests?.launcher ?? {}) as Json;
  const connected = Boolean(tests?.agentConnected);
  const startable = canStartProjects(tests);
  const status = !connected
    ? (launcher.running ? '起動中…' : '停止中')
    : (launcher.running ? '起動済み' : '`pnpm test` の testClient が接続中');

  const add = (event: FormEvent) => {
    event.preventDefault();
    if (!label.trim() || !dir.trim()) return;
    onConfirm({
      title: 'Bot プロジェクトの追加',
      message: `起動するとこのフォルダーのコードを PC 上で実行します。信頼できるフォルダーだけを追加してください（${dir.trim()}）`,
      confirmLabel: '追加',
      action: () => api.post('/projects', { label, dir }).then(() => {
        setLabel('');
        setDir('');
      }),
    });
  };

  return (
    <section className="admin-section">
      <div className="admin-section-header">
        <h2>Bot プロジェクト</h2>
        <small>{status}</small>
        <button className="button primary" disabled={!startable || projects.length === 0}
          onClick={() => void call(api.post('/projects/start'))}>全起動</button>
        <button className="button secondary" disabled={!launcher.running || Boolean(tests?.runningProject)}
          onClick={() => void call(api.post('/projects/stop'))}>全停止</button>
      </div>
      {launcher.enabled === false && <div className="notice">127.0.0.1 で起動した Mock でのみ使えます。</div>}
      {launcher.error && <div className="notice">{launcher.error}</div>}
      <form className="add-form" onSubmit={add}>
        <input className="project-label" value={label} placeholder="ラベル" aria-label="ラベル" onChange={(event) => setLabel(event.target.value)} />
        <input value={dir} placeholder="フォルダーの絶対パス" aria-label="フォルダーの絶対パス" onChange={(event) => setDir(event.target.value)} />
        <button type="button" className="button secondary" disabled={launcher.enabled === false} onClick={() => setBrowsing(true)}>参照</button>
        <button className="button primary" disabled={launcher.enabled === false}>追加</button>
      </form>
      <ul className="admin-list">
        {projects.map((project) => {
          const active = isActiveProject(tests, project);
          return (
            <li key={project.id}>
              <button className="project-delete" aria-label={`${project.label} を削除`} title="削除" disabled={Boolean(launcher.running)}
                onClick={() => onConfirm({
                  title: 'Bot プロジェクトの削除',
                  message: `「${project.label}」を一覧から削除しますか？フォルダーは削除しません。`,
                  confirmLabel: '削除',
                  path: `/projects/${project.id}`,
                })}>×</button>
              <span>{project.label}</span>
              {active && <small>接続中</small>}
              <code className="project-dir">{project.dir}</code>
              <button className="card-button" aria-label={`${project.label} を起動`} disabled={!startable || active}
                onClick={() => void call(api.post('/projects/start', { id: project.id }))}>起動</button>
              <button className="card-button secondary" aria-label={`${project.label} を停止`}
                disabled={!launcher.running || !active || Boolean(tests?.runningProject)}
                onClick={() => void call(api.post('/projects/stop', { id: project.id }))}>停止</button>
            </li>
          );
        })}
      </ul>
      {browsing && (
        <FolderDialog initialPath={dir.trim()} onClose={closeBrowsing} onSelect={(path) => {
          setDir(path);
          setBrowsing(false);
        }} />
      )}
    </section>
  );
}

export function AdminPage({ state, tests, onError, onOpenGuild }: AdminPageProps) {
  const guilds = Object.values<Json>(state.guilds);
  const [guildId, setGuildId] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const closeConfirmation = useCallback(() => setConfirmation(null), []);
  const guild = guilds.find((g) => g.id === guildId) ?? guilds[0];
  const users = Object.values<Json>(state.users).filter((u) => u.id !== state.botUserId);

  const call = (action: Promise<unknown>) => action.catch((error: Error) => onError(error.message));

  /** 確認してから、ダミーデータを削除する。 */
  const confirmDelete = (kind: string, name: string, path: string) =>
    setConfirmation({ title: `${kind}の削除`, message: `「${name}」を削除しますか？元に戻せません。`, confirmLabel: '削除', path });

  const rename = (user: Json) => {
    const username = window.prompt('ユーザー名', user.username);
    if (username) void call(api.patch(`/users/${user.id}`, { username }));
  };

  return (
    <main className="page admin-page">
      <header className="page-header">
        <h1>管理</h1>
        <div className="page-actions">
          <button className="button danger" disabled={Boolean(tests?.runningProject)} onClick={() => setConfirmation({
            title: 'すべてリセット',
            message: 'すべてのダミーデータを削除しますか？元に戻せません。',
            confirmLabel: 'リセット',
          })}>すべてリセット</button>
        </div>
      </header>

      <ProjectsSection state={state} tests={tests} call={call} onConfirm={setConfirmation} />
      <DesktopSection onError={onError} />

      <section className="admin-section">
        <h2>サーバー</h2>
        <AddForm placeholder="サーバー名" onSubmit={(name) => call(api.post('/seed', { guilds: [{ name }] }))} />
        <ul className="admin-list">
          {guilds.map((g) => (
            <li key={g.id}>
              <span>{g.name}</span><code>{g.id}</code>
              <button className="card-button" onClick={() => onOpenGuild(g.id)}>サーバーへ移動</button>
              <button className="link-danger" onClick={() => confirmDelete('サーバー', g.name, `/guilds/${g.id}`)}>削除</button>
            </li>
          ))}
        </ul>
      </section>

      <section className="admin-section">
        <h2>ユーザー</h2>
        <AddForm placeholder="ユーザー名" onSubmit={(username) => call(api.post('/seed', { users: [{ username, guild: guild?.id }] }))}>
          <Select label="追加先のサーバー" value={guild?.id ?? ''} onChange={setGuildId} options={guilds.map((g) => ({ value: g.id, label: g.name }))} />
        </AddForm>
        <table className="admin-table">
          <thead><tr><th>名前</th><th>ID</th><th>Bot</th><th /></tr></thead>
          <tbody>
            {users.map((user) => (
              <tr key={user.id}>
                <td><button className="link" onClick={() => rename(user)}>{user.username}</button></td>
                <td><code>{user.id}</code></td>
                <td><input type="checkbox" aria-label={`${user.username} は Bot`} checked={user.bot}
                  onChange={(event) => void call(api.patch(`/users/${user.id}`, { bot: event.target.checked }))} /></td>
                <td><button className="link-danger" onClick={() => confirmDelete('ユーザー', user.username, `/users/${user.id}`)}>削除</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {confirmation && (
        <ConfirmDialog {...confirmation} onClose={closeConfirmation} onConfirm={() => {
          const { action, path } = confirmation;
          void call(action ? action() : path ? api.delete(path) : api.post('/reset'));
        }} />
      )}
      <p className="legal-notice">{LEGAL_NOTICE}</p>
    </main>
  );
}
