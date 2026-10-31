import { useEffect, useMemo, useState } from 'react';
import { api, type Json } from '../api';

const PAGE_SIZE = 50;

/** `null` は接続中の Bot の DB、それ以外はテスト終了時の DB を表す。 */
export type StudioSource = { project: string; id: string } | null;

interface StudioPageProps {
  tests: Json | null;
  source: StudioSource;
  onSource: (source: StudioSource) => void;
  onError: (message: string) => void;
}

interface Sort {
  column: string;
  descending: boolean;
}

const ENGINE_LABELS: Record<string, string> = {
  pg: 'PostgreSQL',
  mysql: 'MySQL',
  sqlite: 'SQLite',
  sheets: 'スプレッドシート',
};

function formatCell(value: unknown): string {
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

function compareCells(a: unknown, b: unknown): number {
  if (a === null || a === undefined) return b === null || b === undefined ? 0 : -1;
  if (b === null || b === undefined) return 1;
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  return String(a).localeCompare(String(b), 'ja', { numeric: true });
}

/** 画面の選択肢に使う、DB の内容が残っているテストケースの一覧。 */
function testSources(tests: Json | null): { project: string; id: string; label: string }[] {
  const projects = (tests?.projects ?? []) as Json[];
  return projects.flatMap((project) =>
    Object.entries<Json>(tests?.results?.[project.name] ?? {})
      .filter(([, result]) => result.hasDb)
      .map(([id]) => {
        const test = (project.tests as Json[]).find((t) => t.id === id);
        return { project: project.name, id, label: `${project.name}: ${test?.name ?? id}` };
      }),
  );
}

export function StudioPage({ tests, source, onSource, onError }: StudioPageProps) {
  const [snapshot, setSnapshot] = useState<Json[]>([]);
  const [tableKey, setTableKey] = useState<string | null>(null);
  const [filter, setFilter] = useState('');
  const [sort, setSort] = useState<Sort | null>(null);
  const [page, setPage] = useState(0);

  const sources = testSources(tests);
  const liveUpdatedAt = tests?.liveDb?.updatedAt as string | undefined;
  const sourceKey = source ? `${source.project}\n${source.id}` : '';

  useEffect(() => {
    const query = source ? `?project=${encodeURIComponent(source.project)}&id=${encodeURIComponent(source.id)}` : '';
    api.get(`/db${query}`).then(setSnapshot, (error: Error) => onError(error.message));
  }, [source, liveUpdatedAt]);

  const tables = useMemo(
    () =>
      snapshot.flatMap((engine) =>
        (engine.tables as Json[]).map((table): Json => ({ ...table, kind: engine.kind, key: `${engine.kind}/${table.name}` })),
      ),
    [snapshot],
  );
  const table = tables.find((t) => t.key === tableKey) ?? tables.find((t) => t.rows.length > 0) ?? tables[0];

  const rows = useMemo(() => {
    const query = filter.trim().toLowerCase();
    const matched = ((table?.rows ?? []) as Json[]).filter(
      (row) => !query || Object.values(row).some((value) => value !== null && formatCell(value).toLowerCase().includes(query)),
    );
    if (!sort) return matched;
    const direction = sort.descending ? -1 : 1;
    return [...matched].sort((a, b) => direction * compareCells(a[sort.column], b[sort.column]));
  }, [table, filter, sort]);

  useEffect(() => setPage(0), [tableKey, filter, sort, sourceKey]);

  const pageCount = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const start = page * PAGE_SIZE;
  const visible = rows.slice(start, start + PAGE_SIZE);

  const toggleSort = (column: string) => {
    if (sort?.column !== column) setSort({ column, descending: false });
    else if (!sort.descending) setSort({ column, descending: true });
    else setSort(null);
  };

  const selectSource = (value: string) => {
    const [project, id] = value.split('\n');
    onSource(project && id ? { project, id } : null);
  };

  const emptyMessage = source
    ? 'このテストの終了時に DB のデータはありません'
    : tests?.liveDb
      ? `${tests.liveDb.project} はまだ DB を使っていません`
      : 'Bot が接続していません。`pnpm test` または `pnpm app` を実行してください';

  return (
    <main className="studio">
      <aside className="studio-sidebar">
        <div className="studio-source">
          <label>
            表示するデータ
            <select aria-label="表示するデータ" value={sourceKey} onChange={(event) => selectSource(event.target.value)}>
              <option value="">接続中の Bot{tests?.liveDb ? `（${tests.liveDb.project}）` : ''}</option>
              {source && !sources.some((s) => s.id === source.id) && <option value={sourceKey}>{source.id}</option>}
              {sources.map((s) => <option key={`${s.project}\n${s.id}`} value={`${s.project}\n${s.id}`}>{s.label}</option>)}
            </select>
          </label>
        </div>
        <div className="studio-tables">
          {snapshot.map((engine) => (
            <div key={engine.kind}>
              <div className="studio-engine">{ENGINE_LABELS[engine.kind] ?? engine.kind}</div>
              {(engine.tables as Json[]).map((t) => {
                const key = `${engine.kind}/${t.name}`;
                return (
                  <button key={key} className={key === table?.key ? 'studio-table active' : 'studio-table'} title={t.name}
                    onClick={() => { setTableKey(key); setSort(null); }}>
                    <span>{t.name}</span><small>{t.total}</small>
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      </aside>
      <section className="studio-main">
        {table ? (
          <>
            <header className="studio-toolbar">
              <h1>{table.name}</h1>
              <input value={filter} placeholder="行を検索" aria-label="行を検索" onChange={(event) => setFilter(event.target.value)} />
            </header>
            <div className="studio-grid">
              <table>
                <thead>
                  <tr>
                    {(table.columns as Json[]).map((column) => (
                      <th key={column.name} aria-sort={sort?.column === column.name ? (sort?.descending ? 'descending' : 'ascending') : undefined}>
                        <button onClick={() => toggleSort(column.name)}>
                          <span className="column-name">
                            {column.primaryKey && '🔑 '}{column.name}
                            {sort?.column === column.name && (sort?.descending ? ' ▼' : ' ▲')}
                          </span>
                          <span className="column-type">{column.type}</span>
                        </button>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {visible.map((row, index) => (
                    <tr key={start + index} data-testid="db-row">
                      {(table.columns as Json[]).map((column) => {
                        const value = row[column.name];
                        const isNull = value === null || value === undefined;
                        return (
                          <td key={column.name} title={isNull ? undefined : formatCell(value)} className={isNull ? 'cell-null' : undefined}>
                            {isNull ? 'NULL' : formatCell(value)}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
              {visible.length === 0 && <div className="studio-empty">{filter ? '一致する行がありません' : 'このテーブルに行はありません'}</div>}
            </div>
            <footer className="studio-footer">
              <span>
                {rows.length} 行{filter && ` / ${table.rows.length} 行中`}
                {table.total > table.rows.length && `（全 ${table.total} 行のうち先頭 ${table.rows.length} 行を表示）`}
              </span>
              <span className="studio-pager">
                <button className="button secondary" disabled={page === 0} onClick={() => setPage(page - 1)}>前へ</button>
                {page + 1} / {pageCount}
                <button className="button secondary" disabled={page + 1 >= pageCount} onClick={() => setPage(page + 1)}>次へ</button>
              </span>
            </footer>
          </>
        ) : (
          <div className="studio-empty">{emptyMessage}</div>
        )}
      </section>
    </main>
  );
}
