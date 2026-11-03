import { useEffect, useMemo, useState } from 'react';
import { api, type Json } from '../api';
import { Select } from './Select';

const PAGE_SIZE = 50;

/** `null` は接続中の Bot の DB、それ以外はテスト終了時の DB を表す。 */
export type StudioSource = { runId: string; id: string; label: string } | null;

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

/** PostgreSQL の既定のスキーマ。あれば最初に選ぶ。 */
const DEFAULT_SCHEMA = 'public';

/** スキーマの名前を除いたテーブル名。 */
const shortName = (table: Json) => (table.schema && table.name.startsWith(`${table.schema}.`) ? table.name.slice(table.schema.length + 1) : table.name);

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
function testSources(tests: Json | null): NonNullable<StudioSource>[] {
  const projects = (tests?.projects ?? []) as Json[];
  return projects.flatMap((project) =>
    Object.entries<Json>(tests?.results?.[project.name] ?? {})
      .filter(([, result]) => result.hasDb)
      .map(([id, result]) => {
        const test = (project.tests as Json[]).find((t) => t.id === id);
        return { runId: result.runId as string, id, label: `${project.name}: ${test?.name ?? id}` };
      }),
  );
}

export function StudioPage({ tests, source, onSource, onError }: StudioPageProps) {
  const [snapshot, setSnapshot] = useState<Json[]>([]);
  const [tableKey, setTableKey] = useState<string | null>(null);
  const [filter, setFilter] = useState('');
  const [sort, setSort] = useState<Sort | null>(null);
  const [page, setPage] = useState(0);
  /** DB の種類ごとに選んだスキーマ。 */
  const [schemas, setSchemas] = useState<Record<string, string>>({});

  const sources = testSources(tests);
  const liveUpdatedAt = tests?.liveDb?.updatedAt as string | undefined;
  const sourceKey = source ? `${source.runId}\n${source.id}` : '';

  /** 更新ボタンを押した回数。押すたびに読み直す。 */
  const [reloads, setReloads] = useState(0);
  const [loading, setLoading] = useState(false);

  // 画面を開いたとき、表示するデータを変えたとき、接続中の Bot の DB が変わったとき、更新ボタンで読み直す。
  useEffect(() => {
    const query = source ? `?run=${source.runId}&id=${encodeURIComponent(source.id)}` : '';
    setLoading(true);
    api
      .get(`/db${query}`)
      .then(setSnapshot, (error: Error) => onError(error.message))
      .finally(() => setLoading(false));
  }, [source, liveUpdatedAt, reloads]);

  /** スキーマのある DB（PostgreSQL）の、スキーマの一覧と選択中のスキーマ。 */
  const schemaChoices = useMemo(() => {
    const choices: Record<string, { names: string[]; selected: string }> = {};
    for (const engine of snapshot) {
      const names = [...new Set((engine.tables as Json[]).flatMap((table) => (table.schema ? [table.schema as string] : [])))];
      if (names.length === 0) continue;
      const chosen = schemas[engine.kind];
      const selected = chosen && names.includes(chosen) ? chosen : names.includes(DEFAULT_SCHEMA) ? DEFAULT_SCHEMA : names[0]!;
      choices[engine.kind] = { names, selected };
    }
    return choices;
  }, [snapshot, schemas]);

  const tables = useMemo(
    () =>
      snapshot.flatMap((engine) =>
        (engine.tables as Json[])
          .filter((table) => !table.schema || table.schema === schemaChoices[engine.kind]?.selected)
          .map((table): Json => ({ ...table, kind: engine.kind, key: `${engine.kind}/${table.name}` })),
      ),
    [snapshot, schemaChoices],
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
    onSource(sources.find((s) => `${s.runId}\n${s.id}` === value) ?? null);
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
            <Select label="表示するデータ" value={sourceKey} onChange={selectSource} options={[
              { value: '', label: `接続中の Bot${tests?.liveDb ? `（${tests.liveDb.project}）` : ''}` },
              ...(source && !sources.some((s) => s.runId === source.runId && s.id === source.id)
                ? [{ value: sourceKey, label: source.label }]
                : []),
              ...sources.map((s) => ({ value: `${s.runId}\n${s.id}`, label: s.label })),
            ]} />
          </label>
          {source && <small className="studio-note">テストの終了時の DB です。その後の変更は「接続中の Bot」で見られます。</small>}
          <button className="button secondary studio-reload" disabled={loading} onClick={() => setReloads(reloads + 1)}>
            {loading ? '更新中…' : '更新'}
          </button>
        </div>
        <div className="studio-tables">
          {snapshot.map((engine) => {
            const choice = schemaChoices[engine.kind];
            return (
              <div key={engine.kind}>
                <div className="studio-engine">{ENGINE_LABELS[engine.kind] ?? engine.kind}</div>
                {choice && (
                  <div className="studio-schema">
                    <Select label="スキーマ" value={choice.selected} options={choice.names.map((name) => ({ value: name, label: name }))}
                      onChange={(name) => {
                        setSchemas({ ...schemas, [engine.kind]: name });
                        setTableKey(null);
                        setSort(null);
                      }} />
                  </div>
                )}
                {tables.filter((t) => t.kind === engine.kind).map((t) => (
                  <button key={t.key} className={t.key === table?.key ? 'studio-table active' : 'studio-table'} title={t.name}
                    onClick={() => { setTableKey(t.key); setSort(null); }}>
                    <span>{shortName(t)}</span><small>{t.total}</small>
                  </button>
                ))}
              </div>
            );
          })}
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
