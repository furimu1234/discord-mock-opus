import { useMemo, useState } from 'react';
import { api, type Json } from '../api';
import { ChevronIcon } from './Icons';

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
  /** 折り畳んでいるカテゴリーのキー。 */
  collapsed: Set<string>;
  onToggleCategory: (key: string) => void;
  /** テスト終了時の DB を DB Studio で開く。 */
  onOpenDb: (runId: string, id: string, label: string) => void;
  /** テストの実行結果を開く。 */
  onOpenRun: (runId: string, testId: string) => void;
}

interface Category {
  key: string;
  name: string;
  tests: Json[];
  children: Category[];
}

const fileLabel = (file: string) => file.split('/').pop()!.replace(/\.test\.\w+$/, '');

/** `describe` の階層をカテゴリーの木にする。`describe` の外のテストはファイルごとにまとめる。 */
function buildCategories(tests: Json[]): Category[] {
  const roots: Category[] = [];
  const find = (siblings: Category[], key: string, name: string) => {
    let found = siblings.find((category) => category.key === key);
    if (!found) {
      found = { key, name, tests: [], children: [] };
      siblings.push(found);
    }
    return found;
  };
  for (const test of tests) {
    const path = (test.suite.length > 0 ? test.suite : [fileLabel(test.file)]) as string[];
    let siblings = roots;
    let category: Category | undefined;
    path.forEach((name, depth) => {
      category = find(siblings, path.slice(0, depth + 1).join(' › '), name);
      siblings = category.children;
    });
    category!.tests.push(test);
  }
  return roots;
}

function categoryTests(category: Category): Json[] {
  return [...category.tests, ...category.children.flatMap(categoryTests)];
}

interface TestCardProps {
  test: Json;
  result?: Json;
  running: boolean;
  onRun: () => void;
  onOpenDb: () => void;
  onOpenRun: () => void;
}

function TestCard({ test, result, running, onRun, onOpenDb, onOpenRun }: TestCardProps) {
  const [expanded, setExpanded] = useState(false);
  const disabled = running || test.skipped;
  const status = test.skipped ? 'skipped' : ((result?.status as string | undefined) ?? 'ready');
  const badge = test.suite.at(-1) ?? fileLabel(test.file);
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
        {result?.runId && result.status !== 'queued' && result.status !== 'running' && (
          <button className="card-button secondary" aria-label={`${test.name} の実行結果を開く`} onClick={stop(onOpenRun)}>結果</button>
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

interface CategorySectionProps {
  category: Category;
  depth: number;
  results: Record<string, Json>;
  running: boolean;
  collapsed: Set<string>;
  onToggle: (key: string) => void;
  onRun: (ids: string[]) => void;
  renderCard: (test: Json) => React.ReactNode;
}

function CategorySection({ category, depth, results, running, collapsed, onToggle, onRun, renderCard }: CategorySectionProps) {
  const open = !collapsed.has(category.key);
  const all = categoryTests(category);
  const runnable = all.filter((test) => !test.skipped).map((test) => test.id as string);
  const passed = all.filter((test) => results[test.id]?.status === 'passed').length;
  const failed = all.filter((test) => results[test.id]?.status === 'failed').length;
  return (
    <section className="test-category" data-testid="test-category" style={{ marginLeft: depth === 0 ? 0 : 12 }}>
      <header className="test-category-header">
        <button className="category-toggle" aria-expanded={open} onClick={() => onToggle(category.key)}>
          <span className={open ? 'category-chevron' : 'category-chevron closed'}><ChevronIcon /></span>
          <span className="category-name">{category.name}</span>
          <span className="category-count">{all.length}</span>
          {passed > 0 && <span className="count passed">{passed}</span>}
          {failed > 0 && <span className="count failed">{failed}</span>}
        </button>
        <button className="card-button" aria-label={`${category.name} を実行`} disabled={running || runnable.length === 0}
          onClick={() => onRun(runnable)}>▶</button>
      </header>
      {open && (
        <>
          {category.tests.length > 0 && <div className="test-cards">{category.tests.map(renderCard)}</div>}
          {category.children.map((child) => (
            <CategorySection key={child.key} category={child} depth={depth + 1} results={results} running={running}
              collapsed={collapsed} onToggle={onToggle} onRun={onRun} renderCard={renderCard} />
          ))}
        </>
      )}
    </section>
  );
}

function TestList({ tests, projectName, onProject, channelId, compact = false, onError, collapsed, onToggleCategory, onOpenDb, onOpenRun }: TestListProps) {
  const projects = (tests?.projects ?? []) as Json[];
  const project = (projects.find((p) => p.name === projectName) ?? projects[0]) as Json;
  const results = (tests?.results?.[project?.name] ?? {}) as Record<string, Json>;
  const running = Boolean(tests?.runningProject);
  const cases = (project?.tests ?? []) as Json[];
  const runnable = cases.filter((test) => !test.skipped).map((test) => test.id as string);
  const categories = useMemo(() => buildCategories(cases), [cases]);

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

      {categories.map((category) => (
        <CategorySection key={category.key} category={category} depth={0} results={results} running={running}
          collapsed={collapsed} onToggle={onToggleCategory} onRun={run}
          renderCard={(test) => (
            <TestCard key={test.id} test={test} result={results[test.id]} running={running}
              onRun={() => run([test.id])}
              onOpenDb={() => onOpenDb(results[test.id]?.runId, test.id, test.name)}
              onOpenRun={() => onOpenRun(results[test.id]?.runId, test.id)} />
          )} />
      ))}
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
