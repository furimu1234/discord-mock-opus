import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { STARTUP_ERROR_PREFIX } from './constants.js';
import type { Json, Store } from './store.js';
import type { TestRegistry } from './tests.js';

const LOOPBACK_HOSTS = ['127.0.0.1', '::1', 'localhost'];
const AGENT_PATH = 'node_modules/@dismock/test/bin/dismock.js';
const HIDDEN_FOLDERS = /^(\.|node_modules$)/;
/**
 * エージェントを動かす Node。配布版のウインドウの `process.execPath` は Electron で、
 * Bot のプロジェクトの Node の版とも合わないので、インストールされた Node を使う。
 */
const NODE = process.versions.electron ? 'node' : process.execPath;

const conflict = (message: string) => Object.assign(new Error(message), { status: 409 });

const isDirectory = (path: string) => statSync(path, { throwIfNoEntry: false })?.isDirectory() ?? false;

/** プロジェクトにインストールされた `@dismock/test` のエージェントを親へ順に探す。 */
function findAgent(dir: string): string | undefined {
  for (let current = dir; ; current = dirname(current)) {
    const agent = join(current, AGENT_PATH);
    if (existsSync(agent)) return agent;
    if (dirname(current) === current) return undefined;
  }
}

/**
 * 登録したフォルダーの testClient のエージェントを起動する。
 * 実行されるのはフォルダーのコードなので、外部に公開した Mock では登録も起動もできないようにする。
 */
export class ProjectLauncher {
  private agent: ChildProcess | null = null;
  /** 起動中のエージェントが扱うプロジェクトのラベル。 */
  private started: string[] = [];
  private stopping = false;
  private error: string | null = null;
  private readonly enabled: boolean;
  private readonly kill = () => this.agent?.kill();

  constructor(
    private readonly store: Store,
    private readonly tests: TestRegistry,
    host: string,
    private readonly url: () => string,
  ) {
    this.enabled = LOOPBACK_HOSTS.includes(host);
    // どのような理由で終了しても、エージェントと Bot を残さない。
    process.on('exit', this.kill);
  }

  private notify(): void {
    this.store.emit('ui', 'TEST_UPDATE', {});
  }

  private assertEnabled(): void {
    if (!this.enabled) {
      throw Object.assign(new Error('Bot プロジェクトは 127.0.0.1 で起動した Mock でのみ使えます'), { status: 403 });
    }
  }

  snapshot(): Json {
    return { enabled: this.enabled, running: this.agent !== null, error: this.error };
  }

  /** フォルダーの選択画面のために、子のフォルダーの名前だけを返す。ファイルの名前と内容は返さない。 */
  folders(path: string | null): Json {
    this.assertEnabled();
    const dir = path ?? homedir();
    if (!isAbsolute(dir)) throw new Error('フォルダーは絶対パスで入力してください');
    const resolved = resolve(dir);
    if (!isDirectory(resolved)) throw new Error(`フォルダーが見つかりません: ${resolved}`);
    const entries = (() => {
      try {
        return readdirSync(resolved, { withFileTypes: true });
      } catch {
        throw new Error(`フォルダーを開けません: ${resolved}`);
      }
    })();
    const folders = entries
      .filter((entry) => entry.isDirectory() && !HIDDEN_FOLDERS.test(entry.name))
      .map((entry) => ({ name: entry.name, path: join(resolved, entry.name) }))
      .sort((a, b) => a.name.localeCompare(b.name));
    const parent = dirname(resolved);
    return { path: resolved, parent: parent === resolved ? null : parent, folders, installed: Boolean(findAgent(resolved)) };
  }

  add(label: string, path: string): Json {
    this.assertEnabled();
    const name = String(label ?? '').trim();
    const dir = String(path ?? '').trim();
    if (!name) throw new Error('ラベルを入力してください');
    if (!isAbsolute(dir)) throw new Error('フォルダーは絶対パスで入力してください');
    const resolved = resolve(dir);
    if (!isDirectory(resolved)) throw new Error(`フォルダーが見つかりません: ${resolved}`);
    if (!findAgent(resolved)) throw new Error(`@dismock/test がインストールされていません: ${resolved}`);
    const { projects } = this.store.state;
    if (projects.some((project) => project.label === name)) throw new Error(`ラベルが重複しています: ${name}`);
    if (projects.some((project) => project.dir === resolved)) throw new Error(`追加済みのフォルダーです: ${resolved}`);
    return this.store.addProject(name, resolved);
  }

  remove(id: string): void {
    if (this.agent) throw conflict('Bot を停止してから削除してください');
    this.store.removeProject(id);
  }

  /**
   * `id` を省略すると、登録したすべてのプロジェクトの一覧を出し、先頭の Bot を接続する。
   * 起動中の testClient が扱うプロジェクトなら Bot だけを切り替える。それ以外は止めてから起動し直す。
   */
  async start(id?: string): Promise<void> {
    this.assertEnabled();
    if (this.tests.agentConnected && !this.agent) throw conflict('別の testClient が接続しています');
    if (this.agent && !this.tests.agentConnected) throw conflict('testClient の起動中です');
    if (this.tests.runningProject) throw conflict('テストの実行中です');
    const { projects } = this.store.state;
    const targets = id ? projects.filter((project) => project.id === id) : projects;
    const [first] = targets;
    if (!first) throw new Error('起動する Bot プロジェクトがありません');
    const missing = targets.find((project) => !isDirectory(project.dir));
    if (missing) throw new Error(`フォルダーが見つかりません: ${missing.dir}`);
    const agent = findAgent(first.dir);
    if (!agent) throw new Error(`@dismock/test がインストールされていません: ${first.dir}`);
    if (id && this.tests.activeBot === first.label) throw conflict('すでに接続しています');
    if (id && this.started.includes(first.label)) return this.tests.selectBot(first.label);
    await this.halt();

    const args = [agent, 'agent', ...targets.flatMap((project) => ['--label', project.label]), ...targets.map((project) => project.dir)];
    const child = spawn(NODE, args, {
      cwd: first.dir,
      stdio: ['ignore', 'inherit', 'pipe'],
      env: { ...process.env, DISMOCK_URL: this.url(), DISMOCK_TOKEN: this.store.state.token },
    });
    this.agent = child;
    this.started = targets.map((project) => project.label);
    this.stopping = false;
    this.error = null;
    let startupError: string | undefined;
    child.stderr!.on('data', (chunk: Buffer) => {
      process.stderr.write(chunk);
      const line = chunk.toString().split('\n').find((text) => text.startsWith(STARTUP_ERROR_PREFIX));
      if (line) startupError = line.slice(STARTUP_ERROR_PREFIX.length);
    });
    const finished = (failure: string | undefined) => {
      if (this.agent !== child) return;
      this.agent = null;
      this.started = [];
      if (!this.stopping && failure) this.error = failure;
      this.notify();
    };
    child.once('error', (error: NodeJS.ErrnoException) =>
      finished(error.code === 'ENOENT' ? 'Bot の実行に Node.js が必要です。Node.js をインストールしてください' : error.message),
    );
    child.once('exit', (code) => finished(code ? (startupError ?? `testClient が終了しました（終了コード ${code}）`) : undefined));
    this.notify();
  }

  private async halt(): Promise<void> {
    const child = this.agent;
    if (!child) return;
    this.stopping = true;
    const stopped = once(child, 'exit');
    child.kill();
    await stopped;
  }

  /** `id` を指定すると、そのプロジェクトの Bot だけを止める。省略すると testClient ごと止める。 */
  async stop(id?: string): Promise<void> {
    if (!this.agent) throw conflict('画面から起動した testClient はありません');
    if (this.tests.runningProject) throw conflict('テストの実行中です');
    if (!id) return this.halt();
    const project = this.store.state.projects.find((candidate) => candidate.id === id);
    if (!project || this.tests.activeBot !== project.label) throw conflict('接続していません');
    this.tests.stopBot();
  }

  close(): void {
    this.stopping = true;
    this.agent?.kill();
    process.off('exit', this.kill);
  }
}
