import { useEffect, useState } from 'react';
import { api, type Json } from '../api';

interface RunsPageProps {
  tests: Json | null;
  selection: RunSelection;
  onSelect: (selection: RunSelection) => void;
  onError: (message: string) => void;
  onOpenDb: (runId: string, id: string, label: string) => void;
}

/** 開いている実行結果と、その中で開いているテストケース。 */
export type RunSelection = { runId: string; testId?: string } | null;

const dateTime = (value: string) => new Date(value).toLocaleString('ja-JP');

function runStatus(run: Json): string {
  if (!run.finishedAt) return 'running';
  return run.failed > 0 ? 'failed' : 'passed';
}

const STATUS_LABELS: Record<string, string> = {
  queued: 'QUEUED',
  running: 'RUNNING',
  passed: 'PASSED',
  failed: 'FAILED',
};

function JsonBlock({ title, value }: { title: string; value: unknown }) {
  const text = typeof value === 'string' ? value : JSON.stringify(value ?? null, null, 2);
  return (
    <div className="json-block">
      <div className="json-title">{title}</div>
      <pre>{text}</pre>
    </div>
  );
}

function TrafficRow({ entry, startedAt }: { entry: Json; startedAt: number }) {
  const [open, setOpen] = useState(false);
  const offset = Date.parse(entry.at) - startedAt;
  const failed = entry.kind === 'rest' && entry.status >= 400;
  return (
    <li className="traffic" data-testid="traffic">
      <button className="traffic-row" aria-expanded={open} onClick={() => setOpen(!open)}>
        <span className="traffic-time">+{offset}ms</span>
        {entry.kind === 'rest' ? (
          <>
            <span className={`traffic-method ${entry.method.toLowerCase()}`}>{entry.method}</span>
            <span className="traffic-path">{entry.path.replace('/api/v10', '')}</span>
            <span className={failed ? 'traffic-status failed' : 'traffic-status'}>{entry.status}</span>
          </>
        ) : (
          <>
            <span className="traffic-method gateway">GATEWAY</span>
            <span className="traffic-path">{entry.event}</span>
          </>
        )}
      </button>
      {open && entry.kind === 'rest' && (
        <div className="json-pair">
          <JsonBlock title="リクエスト" value={entry.request} />
          <JsonBlock title="レスポンス" value={entry.response} />
        </div>
      )}
      {open && entry.kind === 'gateway' && (
        <div className="json-pair">
          <JsonBlock title="イベント" value={entry.data} />
        </div>
      )}
    </li>
  );
}

function TestResultRow({ test, runId, startedAt, opened, onToggle, onOpenDb }: {
  test: Json;
  runId: string;
  startedAt: number;
  opened: boolean;
  onToggle: () => void;
  onOpenDb: RunsPageProps['onOpenDb'];
}) {
  const label = [...test.suite, test.name].join(' › ');
  return (
    <section className={`run-test ${test.status}`} data-testid="run-test">
      <button className="run-test-header" aria-expanded={opened} onClick={onToggle}>
        <span className={`status ${test.status}`}>{STATUS_LABELS[test.status]}</span>
        <span className="run-test-name">{label}</span>
        {test.durationMs !== undefined && <small>{test.durationMs}ms</small>}
        <small>{test.traffic.length} 件の通信</small>
      </button>
      {opened && (
        <div className="run-test-body">
          {test.error && <pre className="test-error">{test.error}</pre>}
          {test.hasDb && (
            <button className="card-button secondary" onClick={() => onOpenDb(runId, test.id, test.name)}>終了時の DB を開く</button>
          )}
          {test.traffic.length > 0 ? (
            <ol className="traffic-list">
              {test.traffic.map((entry: Json, index: number) => (
                <TrafficRow key={index} entry={entry} startedAt={startedAt} />
              ))}
            </ol>
          ) : (
            <p className="run-empty">Bot の通信はありません</p>
          )}
        </div>
      )}
    </section>
  );
}

export function RunsPage({ tests, selection, onSelect, onError, onOpenDb }: RunsPageProps) {
  const [runs, setRuns] = useState<Json[]>([]);
  const [detail, setDetail] = useState<Json | null>(null);
  const [onlyFailed, setOnlyFailed] = useState(false);

  const runId = selection?.runId ?? runs[0]?.id;

  useEffect(() => {
    api.get('/runs').then(setRuns, (error: Error) => onError(error.message));
  }, [tests]);

  useEffect(() => {
    if (!runId) return setDetail(null);
    api.get(`/runs/${runId}`).then(setDetail, (error: Error) => onError(error.message));
  }, [runId, tests]);

  const visible = ((detail?.tests ?? []) as Json[]).filter((test) => !onlyFailed || test.status === 'failed');

  return (
    <main className="runs">
      <aside className="runs-list" aria-label="実行結果の一覧">
        <h1>実行結果</h1>
        {runs.length === 0 && <p className="run-empty">まだテストを実行していません</p>}
        {runs.map((run) => (
          <button key={run.id} className={run.id === runId ? 'run-item active' : 'run-item'} data-testid="run-item"
            onClick={() => onSelect({ runId: run.id })}>
            <span className={`status ${runStatus(run)}`}>{STATUS_LABELS[runStatus(run)]}</span>
            <span className="run-item-main">
              <strong>{run.project}</strong>
              <small>{dateTime(run.startedAt)}</small>
            </span>
            <span className="run-item-count">
              <span className="count passed">{run.passed}</span> / <span className="count failed">{run.failed}</span> / {run.total}
            </span>
          </button>
        ))}
      </aside>
      <section className="run-detail">
        {detail ? (
          <>
            <header className="run-detail-header">
              <div>
                <h2>{detail.project}</h2>
                <small>{dateTime(detail.startedAt)}{detail.finishedAt && ` 〜 ${dateTime(detail.finishedAt)}`}</small>
              </div>
              <label className="check-label">
                <input type="checkbox" checked={onlyFailed} onChange={(event) => setOnlyFailed(event.target.checked)} />
                失敗のみ
              </label>
            </header>
            {visible.map((test) => (
              <TestResultRow key={test.id} test={test} runId={detail.id} startedAt={Date.parse(detail.startedAt)}
                opened={selection?.testId === test.id}
                onToggle={() => onSelect({ runId: detail.id, testId: selection?.testId === test.id ? undefined : test.id })}
                onOpenDb={onOpenDb} />
            ))}
            {visible.length === 0 && <p className="run-empty">該当するテストはありません</p>}
          </>
        ) : (
          <div className="studio-empty">テストを実行すると、ここに結果が表示されます</div>
        )}
      </section>
    </main>
  );
}
