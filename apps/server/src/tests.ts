import type { Json, Store } from './store.js';

export type TestStatus = 'queued' | 'running' | 'passed' | 'failed';

export interface TestCaseInfo {
  id: string;
  file: string;
  suite: string[];
  name: string;
  description?: string;
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
}

/**
 * 画面とエージェントの間でテストの一覧と結果を仲介する。
 * テストを実行するのはエージェントで、Mock はプロセスを起動しない。
 */
export class TestRegistry {
  projects: TestProject[] = [];
  results: Record<string, Record<string, TestResult>> = {};
  runningProject: string | null = null;
  activeBot: string | null = null;
  agentConnected = false;
  /** 接続中の Bot の DB。 */
  private liveDb: { project: string; db: Json[]; updatedAt: string } | null = null;
  /** テストケースごとの、終了時の DB。プロジェクトごとに直近の実行分だけを持つ。 */
  private testDb: Record<string, Record<string, Json[]>> = {};

  constructor(private readonly store: Store) {}

  private notify(): void {
    this.store.emit('ui', 'TEST_UPDATE', {});
  }

  snapshot(): Json {
    const { projects, results, runningProject, activeBot, agentConnected } = this;
    const liveDb = this.liveDb && { project: this.liveDb.project, updatedAt: this.liveDb.updatedAt };
    return { projects, results, runningProject, activeBot, agentConnected, liveDb };
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
    }
    this.notify();
  }

  /** `channelId` は画面で開いているチャンネルで、テストの実行先になる。 */
  requestRun(project: string, ids: string[], channelId?: string): void {
    if (!this.agentConnected) throw Object.assign(new Error('testClient が起動していません'), { status: 409 });
    if (this.runningProject) throw Object.assign(new Error('テストの実行中です'), { status: 409 });
    if (ids.length === 0) throw new Error('テストケースを選択してください');
    this.runningProject = project;
    this.results[project] = {
      ...this.results[project],
      ...Object.fromEntries(ids.map((id) => [id, { status: 'queued' as const }])),
    };
    this.notify();
    this.store.emit('ui', 'TEST_RUN', { project, ids, channelId });
  }

  report(project: string, id: string, result: TestResult, db?: Json[]): void {
    (this.results[project] ??= {})[id] = { ...result, hasDb: Boolean(db?.length) };
    if (db) (this.testDb[project] ??= {})[id] = db;
    this.notify();
  }

  publishLiveDb(project: string, db: Json[]): void {
    this.liveDb = { project, db, updatedAt: new Date().toISOString() };
    this.notify();
  }

  /** プロジェクトとテストケースを省略すると、接続中の Bot の DB を返す。 */
  readDb(project: string | null, id: string | null): Json[] {
    if (project && id) return this.testDb[project]?.[id] ?? [];
    return this.liveDb?.db ?? [];
  }

  finish(activeBot: string | null): void {
    const project = this.runningProject;
    for (const result of Object.values(this.results[project ?? ''] ?? {})) {
      if (result.status === 'queued' || result.status === 'running') {
        result.status = 'failed';
        result.error ??= 'テストが完了する前にプロセスが終了しました';
      }
    }
    this.runningProject = null;
    this.activeBot = activeBot;
    this.notify();
  }

  selectBot(project: string): void {
    if (this.runningProject) throw Object.assign(new Error('テストの実行中です'), { status: 409 });
    this.store.emit('ui', 'BOT_SELECT', { project });
  }

  reload(): void {
    this.store.emit('ui', 'TEST_RELOAD', {});
  }
}
