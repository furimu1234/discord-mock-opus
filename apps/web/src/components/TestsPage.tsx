import { useState } from 'react';
import { api, type Json } from '../api';

const STATUS_LABELS: Record<string, string> = {
  ready: 'READY',
  queued: 'QUEUED',
  running: 'RUNNING',
  passed: 'PASSED',
  failed: 'FAILED',
  skipped: 'SKIP',
};

export interface TestListProps {
  tests: Json | null;
  projectName: string | null;
  onProject: (name: string) => void;
  /** テストを実行するチャンネル。画面で開いているチャンネルを渡す。 */
  channelId: string | null;
  /** 右パネルに収める表示。 */
  compact?: boolean;
  onError: (message: string) => void;
  /** テスト終了時の DB を DB Studio で開く。 */
  onOpenDb: (project: string, id: string) => void;
}

interface TestCardProps {
  test: Json;
  result?: Json;
  running: boolean;
  onRun: () => void;
  onOpenDb: () => void;
}

function TestCard({ test, result, running, onRun, onOpenDb }: TestCardProps) {
  const [expanded, setExpanded] = useState(false);
  const disabled = running || test.skipped;
  const status = test.skipped ? 'skipped' : ((result?.status as string | undefined) ?? 'ready');
  const badge = test.suite.at(-1) ?? test.file.split('/').pop().replace(/\.test\.\w+$/, '');
  const stop = (action: () => void) => (event: React.MouseEvent) => {
    event.stopPropagation();
    action();
  };
  const run = () => {
    if (!disabled) onRun();
  };
  return (
    <article className={`test-card ${status}${disabled ? ' disabled' : ''}`} data-testid="test-case" tabIndex={disabled ? -1 : 0}
      onClick={run} onKeyDown={(event) => { if (event.key === 'Enter') run(); }}>
      <div className="test-card-header">
        <span className="test-badge">{badge}</span>
        <h3 className="test-title">{test.name}</h3>
        <span className={`status ${status}`}>{STATUS_LABELS[status]}</span>
      </div>
      <p className="test-description">{test.description ?? test.file}</p>
      <div className="test-card-footer">
        {result?.durationMs !== undefined && <small>{result.durationMs}ms</small>}
        {result?.status === 'failed' && (
          <button className="card-button secondary" onClick={stop(() => setExpanded(!expanded))}>エラー</button>
        )}
        {result?.hasDb && (
          <button className="card-button secondary" aria-label={`${test.name} の DB を開く`} onClick={stop(onOpenDb)}>DB</button>
        )}
        <button className="card-button" aria-label={`${test.name} を実行`} disabled={disabled} onClick={stop(onRun)}>▶ 実行</button>
      </div>
      {expanded && result?.error && <pre className="test-error" onClick={(event) => event.stopPropagation()}>{result.error}</pre>}
    </article>
  );
}

function TestList({ tests, projectName, onProject, channelId, compact = false, onError, onOpenDb }: TestListProps) {
  const projects = (tests?.projects ?? []) as Json[];
  const project = (projects.find((p) => p.name === projectName) ?? projects[0]) as Json;
  const results = (tests?.results?.[project?.name] ?? {}) as Record<string, Json>;
  const running = Boolean(tests?.runningProject);
  const cases = (project?.tests ?? []) as Json[];
  const runnable = cases.filter((test) => !test.skipped).map((test) => test.id as string);

  const counts = Object.values(results).reduce<Record<string, number>>((total, result) => {
    total[result.status] = (total[result.status] ?? 0) + 1;
    return total;
  }, {});

  const run = (ids: string[]) => {
    api
      .post('/tests/run', { project: project?.name, ids, channelId: channelId ?? undefined })
      .catch((error: Error) => onError(error.message));
  };

  if (!tests?.agentConnected) {
    return <div className="notice">testClient が起動していません。`pnpm test` を実行してください。</div>;
  }

  return (
    <div className={compact ? 'test-list compact' : 'test-list'}>
      <div className="test-controls">
        <label className="inline-field">
          <span>プロジェクト</span>
          <select aria-label="プロジェクト" value={project?.name ?? ''} onChange={(event) => onProject(event.target.value)}>
            {projects.map((p) => <option key={p.name} value={p.name}>{p.name}</option>)}
          </select>
        </label>
        <label className="inline-field">
          <span>接続する Bot</span>
          <select aria-label="接続する Bot" value={tests.activeBot ?? ''} disabled={running}
            onChange={(event) => api.post('/tests/bot', { project: event.target.value }).catch((error: Error) => onError(error.message))}>
            {!tests.activeBot && <option value="">なし</option>}
            {projects.map((p) => <option key={p.name} value={p.name}>{p.name}</option>)}
          </select>
        </label>
        <button className="button secondary" disabled={running}
          onClick={() => api.post('/tests/reload').catch((error: Error) => onError(error.message))}>一覧を更新</button>
      </div>

      <div className="test-header">
        <h2>テストケース</h2>
        <span className="test-summary">
          {Object.keys(results).length > 0 && (
            <>
              <span className="count passed">成功 {counts.passed ?? 0}</span>
              <span className="count failed">失敗 {counts.failed ?? 0}</span>
            </>
          )}
        </span>
        <button className="run-all" disabled={running || runnable.length === 0} onClick={() => run(runnable)}>
          {running ? '実行中…' : '▶ 全て実行'}
        </button>
      </div>

      <div className="test-cards">
        {cases.map((test) => (
          <TestCard key={test.id} test={test} result={results[test.id]} running={running}
            onRun={() => run([test.id])} onOpenDb={() => onOpenDb(project.name, test.id)} />
        ))}
      </div>
    </div>
  );
}

export function TestsPage(props: Omit<TestListProps, 'compact'>) {
  return (
    <main className="page tests-page">
      <h1>テスト</h1>
      <TestList {...props} />
    </main>
  );
}

export function TestsPanel(props: Omit<TestListProps, 'compact'>) {
  return <TestList {...props} compact />;
}
