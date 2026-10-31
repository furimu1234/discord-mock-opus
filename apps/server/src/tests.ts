import type { Json, Store } from './store.js';

export type TestStatus = 'queued' | 'running' | 'passed' | 'failed';

export interface TestCaseInfo {
  id: string;
  file: string;
  suite: string[];
  name: string;
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

  constructor(private readonly store: Store) {}

  private notify(): void {
    this.store.emit('ui', 'TEST_UPDATE', {});
  }

  snapshot(): Json {
    const { projects, results, runningProject, activeBot, agentConnected } = this;
    return { projects, results, runningProject, activeBot, agentConnected };
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
    }
    this.notify();
  }

  requestRun(project: string, ids: string[]): void {
    if (!this.agentConnected) throw Object.assign(new Error('testClient が起動していません'), { status: 409 });
    if (this.runningProject) throw Object.assign(new Error('テストの実行中です'), { status: 409 });
    if (ids.length === 0) throw new Error('テストケースを選択してください');
    this.runningProject = project;
    this.results[project] = Object.fromEntries(ids.map((id) => [id, { status: 'queued' }]));
    this.notify();
    this.store.emit('ui', 'TEST_RUN', { project, ids });
  }

  report(project: string, id: string, result: TestResult): void {
    (this.results[project] ??= {})[id] = result;
    this.notify();
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
