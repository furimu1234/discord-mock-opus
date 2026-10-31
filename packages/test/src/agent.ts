import type { ChildProcess } from 'node:child_process';
import { basename, resolve } from 'node:path';
import { connection, StartupError } from '@dismock/client';
import { EXIT_STARTUP_FAILURE, MARK_LIST, MARK_READY } from './constants.js';
import { findSetup, findTests, spawnRunner } from './spawn.js';

const RECONNECT_INTERVAL_MS = 500;

interface Project {
  name: string;
  dir: string;
}

interface AgentEvent {
  type: string;
  data: { project?: string; ids?: string[]; channelId?: string };
}

let bot: { project: string; child: ChildProcess } | undefined;

function post(path: string, body: unknown = {}): Promise<Response> {
  const { url, token } = connection();
  return fetch(`${url}/api/mock${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bot ${token}` },
    body: JSON.stringify(body),
  });
}

function exited(child: ChildProcess): Promise<number> {
  return new Promise((done) => child.once('exit', (code) => done(code ?? 1)));
}

function readLines(child: ChildProcess, onLine: (line: string) => void): void {
  let buffer = '';
  child.stdout?.on('data', (chunk: Buffer) => {
    buffer += chunk.toString();
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    lines.forEach(onLine);
  });
}

function config(project: Project) {
  return { files: findTests(project.dir), setup: findSetup(project.dir) };
}

/** テストケースの一覧を取得する。同時に testClient が接続できることも確認する。 */
async function listTests(project: Project): Promise<unknown[]> {
  const child = spawnRunner(project.dir, { ...config(project), mode: 'list' }, 'pipe');
  let tests: unknown[] | undefined;
  readLines(child, (line) => {
    if (line.startsWith(MARK_LIST)) tests = JSON.parse(line.slice(MARK_LIST.length));
    else console.log(line);
  });
  const code = await exited(child);
  if (code !== 0 || !tests) throw new StartupError(`${project.name} のテストを読み込めません`);
  return tests;
}

async function registerAll(projects: Project[]): Promise<void> {
  const listed = [];
  for (const project of projects) listed.push({ name: project.name, tests: await listTests(project) });
  await post('/tests/register', { projects: listed, activeBot: bot?.project ?? null });
}

/** Bot を起動して、接続が完了するまで待つ。 */
function startBot(project: Project): Promise<void> {
  const child = spawnRunner(project.dir, { ...config(project), mode: 'bot', project: project.name }, 'pipe');
  bot = { project: project.name, child };
  return new Promise((ready, failed) => {
    readLines(child, (line) => {
      if (line === MARK_READY) ready();
      else console.log(line);
    });
    void exited(child).then((code) => {
      if (bot?.child === child) bot = undefined;
      failed(new StartupError(`${project.name} の Bot が停止しました（終了コード ${code}）`));
    });
  });
}

async function stopBot(): Promise<void> {
  const child = bot?.child;
  bot = undefined;
  if (!child) return;
  const stopped = exited(child);
  child.kill();
  await stopped;
}

async function switchBot(project: Project): Promise<void> {
  await stopBot();
  await startBot(project).catch((error: Error) => console.error(error.message));
}

/** Bot のプロセスの中でテストを実行する。DB を引き継ぐため、そのプロジェクトの Bot に接続する。 */
async function runTests(project: Project, ids: string[], channelId?: string): Promise<void> {
  if (bot?.project !== project.name) await switchBot(project);
  const child = bot?.child;
  if (child) {
    await new Promise<void>((done) => {
      child.once('message', () => done());
      child.once('exit', () => done());
      child.send({ ids, files: findTests(project.dir), channelId });
    });
  }
  if (!bot) await switchBot(project);
  await post('/tests/finish', { activeBot: bot?.project ?? null });
  await registerAll(projects);
}

async function subscribe(onEvent: (event: AgentEvent) => void): Promise<void> {
  const { url, token } = connection();
  const response = await fetch(`${url}/api/mock/events?role=agent`, {
    headers: { authorization: `Bot ${token}` },
  });
  let buffer = '';
  for await (const chunk of response.body!.pipeThrough(new TextDecoderStream())) {
    buffer += chunk;
    const events = buffer.split('\n\n');
    buffer = events.pop() ?? '';
    for (const event of events) {
      if (event.startsWith('data: ')) onEvent(JSON.parse(event.slice(6)) as AgentEvent);
    }
  }
}

let projects: Project[] = [];

/** Mock が再び起動するまで待つ。 */
async function waitForMock(): Promise<void> {
  const { url } = connection();
  for (;;) {
    const response = await fetch(`${url}/api/v10/gateway`).catch(() => undefined);
    if (response?.ok) return;
    await new Promise((done) => setTimeout(done, RECONNECT_INTERVAL_MS));
  }
}

/** 画面からの指示を待ち、テストの実行と Bot の起動を行う。 */
export async function runAgent(dirs: string[]): Promise<void> {
  // エージェントが終了するときは、Bot とテストのプロセスを残さない。
  process.once('exit', () => {
    bot?.child.kill();
  });
  for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => process.exit(0));

  projects = dirs.map((dir) => ({ name: basename(resolve(dir)), dir: resolve(dir) }));
  const find = (name?: string) => projects.find((project) => project.name === name);

  // 実行とBotの切り替えが重ならないよう、指示は順番に処理する。
  let queue = Promise.resolve();
  const enqueue = (task: () => Promise<void>) => {
    queue = queue.then(task).catch((error: Error) => console.error(error.message));
  };
  const onEvent = (event: AgentEvent) => {
    const project = find(event.data.project);
    if (event.type === 'TEST_RUN' && project) enqueue(() => runTests(project, event.data.ids ?? [], event.data.channelId));
    if (event.type === 'BOT_SELECT' && project) enqueue(() => switchBot(project).then(() => registerAll(projects)));
    if (event.type === 'TEST_RELOAD') enqueue(() => registerAll(projects));
  };

  // Mock が再起動すると、Bot も起動し直して DB を空にする。
  let active = projects[0]!;
  for (;;) {
    try {
      await startBot(active);
      await registerAll(projects);
    } catch (error) {
      console.error(`起動エラー: ${(error as Error).message}`);
      process.exit(EXIT_STARTUP_FAILURE);
    }
    console.log(`testClient: ${projects.map((project) => project.name).join(', ')}`);
    await subscribe(onEvent).catch(() => {});
    active = find(bot?.project) ?? active;
    await stopBot();
    console.error('Mock との接続が切れました。再接続を待っています');
    await waitForMock();
  }
}
