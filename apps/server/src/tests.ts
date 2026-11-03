import { snowflake, type Json, type Store } from './store.js';

const MAX_RUNS = 100;
const MAX_TRAFFIC_PER_TEST = 500;
/** テストのコードから読める、直近の Bot の通信の件数。 */
const MAX_TRAFFIC_FEED = 2000;
const DM_REDACTED = '[DM の内容は表示できません]';

export type TestStatus = 'queued' | 'running' | 'passed' | 'failed';

export interface TestCaseInfo {
  id: string;
  file: string;
  suite: string[];
  name: string;
  description?: string;
  /** テストを実行するユーザーの指定。省略するとログイン中のユーザー。 */
  users?: string | string[];
  skipped: boolean;
}

export interface TestProject {
  name: string;
  tests: TestCaseInfo[];
}

export interface TestResult {
  status: TestStatus;
  durationMs?: number;
  error?: string;
  /** テスト終了時の DB の内容を DB Studio で見られる。 */
  hasDb?: boolean;
  /** このテストを最後に実行した履歴の ID。 */
  runId?: string;
}

/** テスト中の Bot の通信。`rest` は Bot からの API、`gateway` は Bot への配信。 */
export type TrafficEntry =
  | { kind: 'rest'; at: string; method: string; path: string; status: number; request: unknown; response: unknown }
  | { kind: 'gateway'; at: string; event: string; data: unknown };

/** `/api/mock/traffic` の結果。`cursor` を次の `after` に渡すと、それより後の通信だけを受け取れる。 */
export interface TrafficFeed {
  /** 最後に記録した通信の位置。 */
  cursor: number;
  /** `after` より後に記録した通信。古い順。 */
  entries: TrafficEntry[];
}

/** 最後に実行したテストのカバレッジ。要約は Bot のプロセスが作り、HTML は保存を選んだときに書き出す。 */
export interface CoverageReport {
  project: string;
  runId: string | null;
  summary: Json;
  /** 保存の指示を出して、書き出しを待っている。 */
  saving: boolean;
  /** 書き出した HTML のディレクトリ。 */
  savedDir: string | null;
}

interface RunTest extends TestResult {
  id: string;
  name: string;
  suite: string[];
  traffic: TrafficEntry[];
  db?: Json[];
}

interface TestRun {
  id: string;
  project: string;
  startedAt: string;
  finishedAt: string | null;
  tests: RunTest[];
}

/**
 * 画面とエージェントの間でテストの一覧と結果を仲介する。
 * テストを実行するのはエージェントで、Mock は Bot やテストのプロセスを直接起動しない。
 * 実行の履歴はメモリ上に保持し、Mock を再起動すると消える。
 */
export class TestRegistry {
  projects: TestProject[] = [];
  results: Record<string, Record<string, TestResult>> = {};
  runningProject: string | null = null;
  activeBot: string | null = null;
  agentConnected = false;
  /** 最後に実行したテストのカバレッジ。 */
  coverage: CoverageReport | null = null;
  /** 接続中の Bot の DB。 */
  private liveDb: { project: string; db: Json[]; updatedAt: string } | null = null;
  /** 新しい順に並べた実行の履歴。 */
  private runs: TestRun[] = [];
  /** Bot の通信を記録する、実行中のテスト。 */
  private activeTest: RunTest | null = null;
  /** 実行の方法によらず記録する、直近の Bot の通信。`seq` は記録した順の番号。 */
  private feed: { seq: number; entry: TrafficEntry }[] = [];
  private seq = 0;

  constructor(private readonly store: Store) {
    store.on('dispatch', (event: string, data: Json) => this.recordGateway(event, data));
  }

  private notify(): void {
    this.store.emit('ui', 'TEST_UPDATE', {});
  }

  snapshot(): Json {
    const { projects, results, runningProject, activeBot, agentConnected, coverage } = this;
    const liveDb = this.liveDb && { project: this.liveDb.project, updatedAt: this.liveDb.updatedAt };
    return { projects, results, runningProject, activeBot, agentConnected, liveDb, coverage };
  }

  register(projects: TestProject[], activeBot: string | null): void {
    this.projects = projects;
    this.activeBot = activeBot;
    this.notify();
  }

  setAgentConnected(connected: boolean): void {
    this.agentConnected = connected;
    if (!connected) {
      this.runningProject = null;
      this.activeBot = null;
      this.liveDb = null;
      this.closeRun();
    }
    this.notify();
  }

  /** `channelId` は画面で開いているチャンネルで、テストの実行先になる。 */
  requestRun(project: string, ids: string[], channelId?: string): void {
    if (!this.agentConnected) throw Object.assign(new Error('testClient が起動していません'), { status: 409 });
    if (this.runningProject) throw Object.assign(new Error('テストの実行中です'), { status: 409 });
    if (ids.length === 0) throw new Error('テストケースを選択してください');
    this.runningProject = project;
    const run = this.createRun(project, ids);
    this.results[project] = {
      ...this.results[project],
      ...Object.fromEntries(ids.map((id) => [id, { status: 'queued' as const, runId: run.id }])),
    };
    this.notify();
    this.store.emit('ui', 'TEST_RUN', { project, ids, channelId });
  }

  private createRun(project: string, ids: string[]): TestRun {
    const cases = this.projects.find((p) => p.name === project)?.tests ?? [];
    const run: TestRun = {
      id: snowflake(),
      project,
      startedAt: new Date().toISOString(),
      finishedAt: null,
      tests: ids.map((id) => {
        const info = cases.find((test) => test.id === id);
        return { id, name: info?.name ?? id, suite: info?.suite ?? [], status: 'queued', traffic: [] };
      }),
    };
    this.runs = [run, ...this.runs].slice(0, MAX_RUNS);
    return run;
  }

  report(project: string, id: string, result: TestResult, db?: Json[]): void {
    const run = this.runs.find((r) => r.project === project && r.finishedAt === null);
    const entry = run?.tests.find((test) => test.id === id);
    const finished = { ...result, hasDb: Boolean(db?.length), runId: run?.id };
    (this.results[project] ??= {})[id] = finished;
    if (entry) {
      Object.assign(entry, finished);
      entry.db = db;
    }
    this.activeTest = result.status === 'running' ? (entry ?? null) : null;
    this.notify();
  }

  finish(activeBot: string | null, coverage: Json | null = null): void {
    const project = this.runningProject;
    const runId = this.runs.find((r) => r.finishedAt === null)?.id ?? null;
    this.coverage = project && coverage ? { project, runId, summary: coverage, saving: false, savedDir: null } : null;
    for (const result of Object.values(this.results[project ?? ''] ?? {})) {
      if (result.status === 'queued' || result.status === 'running') {
        result.status = 'failed';
        result.error ??= 'テストが完了する前にプロセスが終了しました';
      }
    }
    this.closeRun();
    this.runningProject = null;
    this.activeBot = activeBot;
    this.notify();
  }

  /** 未完了のテストを失敗として履歴を閉じる。 */
  private closeRun(): void {
    this.activeTest = null;
    const run = this.runs.find((r) => r.finishedAt === null);
    if (!run) return;
    run.finishedAt = new Date().toISOString();
    for (const test of run.tests) {
      if (test.status !== 'queued' && test.status !== 'running') continue;
      test.status = 'failed';
      test.error ??= 'テストが完了する前にプロセスが終了しました';
    }
  }

  private isDirectMessage(channelId: unknown): boolean {
    return this.store.state.channels[channelId as string]?.recipients !== undefined;
  }

  private record(entry: TrafficEntry): void {
    // メッセージは後から編集されるため、この時点の内容を残す。
    const snapshot = structuredClone(entry);
    this.seq += 1;
    this.feed.push({ seq: this.seq, entry: snapshot });
    if (this.feed.length > MAX_TRAFFIC_FEED) this.feed.shift();
    const { activeTest } = this;
    if (activeTest && activeTest.traffic.length < MAX_TRAFFIC_PER_TEST) activeTest.traffic.push(snapshot);
  }

  /** `after` より後に記録した通信を返す。`after` を省略すると、今の位置だけを返す。 */
  traffic(after: number | null): TrafficFeed {
    const entries = after === null ? [] : this.feed.filter((item) => item.seq > after).map((item) => item.entry);
    return { cursor: this.seq, entries };
  }

  /** Bot が呼び出した REST API を記録する。DM の内容は宛先のログインでしか見られないため伏せる。 */
  recordRest(method: string, path: string, status: number, request: unknown, response: unknown): void {
    const channelId = /\/channels\/(\d+)/.exec(path)?.[1];
    const responseChannel = (response as Json | null | undefined)?.channel_id;
    const hidden = this.isDirectMessage(channelId) || this.isDirectMessage(responseChannel);
    this.record({
      kind: 'rest',
      at: new Date().toISOString(),
      method,
      path,
      status,
      request: hidden ? DM_REDACTED : request,
      response: hidden ? DM_REDACTED : response,
    });
  }

  private recordGateway(event: string, data: Json): void {
    const hidden = this.isDirectMessage(data.channel_id);
    this.record({ kind: 'gateway', at: new Date().toISOString(), event, data: hidden ? DM_REDACTED : data });
  }

  /** 履歴の一覧を返す。通信と DB は `readRun` で取得する。 */
  listRuns(): Json[] {
    return this.runs.map(({ tests, ...run }) => ({
      ...run,
      total: tests.length,
      passed: tests.filter((test) => test.status === 'passed').length,
      failed: tests.filter((test) => test.status === 'failed').length,
    }));
  }

  readRun(id: string): Json {
    const run = this.runs.find((r) => r.id === id);
    if (!run) throw Object.assign(new Error('実行結果が見つかりません'), { status: 404 });
    return { ...run, tests: run.tests.map(({ db, ...test }) => test) };
  }

  publishLiveDb(project: string, db: Json[]): void {
    this.liveDb = { project, db, updatedAt: new Date().toISOString() };
    this.notify();
  }

  /** 履歴とテストケースを省略すると、接続中の Bot の DB を返す。 */
  readDb(runId: string | null, id: string | null): Json[] {
    if (runId && id) return this.runs.find((run) => run.id === runId)?.tests.find((test) => test.id === id)?.db ?? [];
    return this.liveDb?.db ?? [];
  }

  selectBot(project: string): void {
    if (this.runningProject) throw Object.assign(new Error('テストの実行中です'), { status: 409 });
    this.store.emit('ui', 'BOT_SELECT', { project });
  }

  /** 接続中の Bot だけを止める。エージェントは残るので、テストの一覧は消えない。 */
  stopBot(): void {
    if (this.runningProject) throw Object.assign(new Error('テストの実行中です'), { status: 409 });
    this.activeBot = null;
    this.liveDb = null;
    this.notify();
    this.store.emit('ui', 'BOT_STOP', {});
  }

  /** カバレッジの HTML の書き出しを、エージェントに指示する。書き出すのは Bot のプロセス。 */
  saveCoverage(): void {
    const { coverage } = this;
    if (!coverage) throw Object.assign(new Error('保存できるカバレッジがありません'), { status: 404 });
    if (!this.agentConnected) throw Object.assign(new Error('testClient が起動していません'), { status: 409 });
    coverage.saving = true;
    this.notify();
    this.store.emit('ui', 'COVERAGE_SAVE', { project: coverage.project });
  }

  coverageSaved(project: string, dir: string | null): void {
    if (this.coverage?.project !== project) return;
    this.coverage.saving = false;
    this.coverage.savedDir = dir;
    this.notify();
  }

  reload(): void {
    this.store.emit('ui', 'TEST_RELOAD', {});
  }
}
