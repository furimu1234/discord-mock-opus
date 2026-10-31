import { useEffect, useMemo, useRef, useState } from 'react';
import { api, type Json } from '../api';

const STATUS_LABELS: Record<string, string> = {
  queued: '待機中',
  running: '実行中',
  passed: '成功',
  failed: '失敗',
};

export interface TestSelection {
  projectName: string | null;
  setProjectName: (name: string) => void;
  selected: Set<string>;
  setSelected: (ids: Set<string>) => void;
}

/** 右パネルとテスト画面で、選択中のテストケースを共有する。 */
export function useTestSelection(): TestSelection {
  const [projectName, setProjectName] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  return { projectName, setProjectName, selected, setSelected };
}

interface TestListProps {
  tests: Json | null;
  selection: TestSelection;
  /** 右パネルに収める表示。 */
  compact?: boolean;
  onError: (message: string) => void;
}

interface TestGroup {
  key: string;
  file: string;
  suite: string;
  tests: Json[];
}

function groupTests(tests: Json[]): TestGroup[] {
  const groups = new Map<string, TestGroup>();
  for (const test of tests) {
    const suite = test.suite.join(' › ') as string;
    const key = `${test.file}\n${suite}`;
    if (!groups.has(key)) groups.set(key, { key, file: test.file, suite, tests: [] });
    groups.get(key)!.tests.push(test);
  }
  return [...groups.values()];
}

function GroupCheckbox({ checked, indeterminate, disabled, onChange, label }: {
  checked: boolean;
  indeterminate: boolean;
  disabled: boolean;
  onChange: (checked: boolean) => void;
  label: string;
}) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = indeterminate;
  }, [indeterminate]);
  return (
    <input ref={ref} type="checkbox" aria-label={label} checked={checked} disabled={disabled}
      onChange={(event) => onChange(event.target.checked)} />
  );
}

function TestList({ tests, selection, compact = false, onError }: TestListProps) {
  const { projectName, setProjectName, selected, setSelected } = selection;
  const projects = (tests?.projects ?? []) as Json[];
  const [expanded, setExpanded] = useState<string | null>(null);

  const project = projects.find((p) => p.name === projectName) ?? projects[0];
  const results = (tests?.results?.[project?.name] ?? {}) as Record<string, Json>;
  const running = Boolean(tests?.runningProject);
  const groups = useMemo(() => groupTests(project?.tests ?? []), [project]);
  const runnable = useMemo(() => ((project?.tests ?? []) as Json[]).filter((t) => !t.skipped), [project]);

  const counts = Object.values(results).reduce<Record<string, number>>((total, result) => {
    total[result.status] = (total[result.status] ?? 0) + 1;
    return total;
  }, {});

  const setMany = (ids: string[], checked: boolean) => {
    const next = new Set(selected);
    for (const id of ids) {
      if (checked) next.add(id);
      else next.delete(id);
    }
    setSelected(next);
  };

  const run = () => {
    const ids = runnable.filter((t) => selected.has(t.id)).map((t) => t.id);
    api.post('/tests/run', { project: project?.name, ids }).catch((error: Error) => onError(error.message));
  };

  const selectedCount = runnable.filter((t) => selected.has(t.id)).length;

  if (!tests?.agentConnected) {
    return <div className="notice">testClient が起動していません。`pnpm test` を実行してください。</div>;
  }

  const runButton = (
    <button className="button success" disabled={running || selectedCount === 0} onClick={run}>
      {running ? '実行中…' : `選択した ${selectedCount} 件を実行`}
    </button>
  );

  return (
    <div className={compact ? 'test-list compact' : 'test-list'}>
      <div className="test-controls">
        <label className="inline-field">
          <span>プロジェクト</span>
          <select value={project?.name ?? ''} onChange={(event) => { setProjectName(event.target.value); setSelected(new Set()); }}>
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
        {!compact && runButton}
      </div>

      <div className="tests-toolbar">
        <label className="check-label">
          <GroupCheckbox label="すべて選択" disabled={running}
            checked={runnable.length > 0 && selectedCount === runnable.length}
            indeterminate={selectedCount > 0 && selectedCount < runnable.length}
            onChange={(checked) => setMany(runnable.map((t) => t.id), checked)} />
          すべて選択（{runnable.length} 件）
        </label>
        <span className="test-summary">
          {Object.keys(results).length > 0 && (
            <>
              <span className="count passed">成功 {counts.passed ?? 0}</span>
              <span className="count failed">失敗 {counts.failed ?? 0}</span>
              {(counts.queued ?? 0) + (counts.running ?? 0) > 0 && (
                <span className="count">残り {(counts.queued ?? 0) + (counts.running ?? 0)}</span>
              )}
            </>
          )}
        </span>
      </div>

      <div className="test-groups">
        {groups.map((group) => {
          const ids = group.tests.filter((t) => !t.skipped).map((t) => t.id as string);
          const count = ids.filter((id) => selected.has(id)).length;
          return (
            <section key={group.key} className="test-group">
              <label className="test-group-header">
                <GroupCheckbox label={`${group.suite || group.file} を選択`} disabled={running || ids.length === 0}
                  checked={ids.length > 0 && count === ids.length} indeterminate={count > 0 && count < ids.length}
                  onChange={(checked) => setMany(ids, checked)} />
                <span className="test-group-title">{group.suite || group.file}</span>
                {!compact && <small>{group.file}</small>}
              </label>
              {group.tests.map((test) => {
                const result = results[test.id];
                const failed = result?.status === 'failed';
                return (
                  <div key={test.id} className="test-case" data-testid="test-case">
                    <div className="test-row">
                      <input type="checkbox" aria-label={test.name} checked={selected.has(test.id)}
                        disabled={running || test.skipped} onChange={(event) => setMany([test.id], event.target.checked)} />
                      <button className="test-name" disabled={!failed}
                        onClick={() => setExpanded(expanded === test.id ? null : test.id)}>
                        {test.name}
                      </button>
                      {test.skipped && <span className="status skipped">スキップ</span>}
                      {result && <span className={`status ${result.status}`}>{STATUS_LABELS[result.status]}</span>}
                      {result?.durationMs !== undefined && <small>{result.durationMs}ms</small>}
                    </div>
                    {failed && expanded === test.id && <pre className="test-error">{result.error}</pre>}
                  </div>
                );
              })}
            </section>
          );
        })}
      </div>
      {compact && <div className="test-footer">{runButton}</div>}
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
