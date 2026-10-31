import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { closeEngines, connection, db, runtime, snapshotEngines, StartupError, type TestClient } from '@dismock/client';
import { EXIT_STARTUP_FAILURE, MARK_LIST, MARK_READY } from './constants.js';
import { createSuite, setCurrentSuite, type HookFn, type Suite, type TestCase, type TestContext } from './index.js';

const DEFAULT_TIMEOUT_MS = 5000;
const LIVE_DB_INTERVAL_MS = 1000;

interface RunConfig {
  mode?: 'run' | 'list' | 'bot';
  files: string[];
  setup?: string;
  filter?: string;
  /** 画面で選択されたテストケース。 */
  ids?: string[];
  /** 結果を画面へ報告するときのプロジェクト名。 */
  project?: string;
}

const config = JSON.parse(process.env.DISMOCK_TEST_CONFIG ?? '{"files":[]}') as RunConfig;

interface Totals {
  passed: number;
  failed: number;
  skipped: number;
  failures: { title: string; error: unknown }[];
}

const totals: Totals = { passed: 0, failed: 0, skipped: 0, failures: [] };

let failCurrentTest: ((error: unknown) => void) | undefined;

/** Bot 内の未処理のエラーでランナーを止めず、実行中のテストの失敗として記録する。 */
function abortStartup(error: unknown): never {
  console.error(`起動エラー: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(EXIT_STARTUP_FAILURE);
}

function reportBotError(error: unknown): void {
  if (config.mode === 'bot') console.error(error);
  else if (failCurrentTest) failCurrentTest(error);
  else {
    totals.failed += 1;
    totals.failures.push({ title: 'テストの実行外で発生したエラー', error });
  }
}

async function withTimeout(action: () => unknown, timeoutMs: number): Promise<void> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`Test timed out in ${timeoutMs}ms`)), timeoutMs);
    failCurrentTest = reject;
  });
  try {
    await Promise.race([action(), timeout]);
  } finally {
    clearTimeout(timer);
    failCurrentTest = undefined;
  }
}

function ancestors(suite: Suite): Suite[] {
  return suite.parent ? [...ancestors(suite.parent), suite] : [suite];
}

function hasOnly(suite: Suite): boolean {
  return (
    suite.mode === 'only' || suite.tests.some((t) => t.mode === 'only') || suite.suites.some(hasOnly)
  );
}

function baseContext(): TestContext {
  const context = { db } as Partial<TestContext>;
  const bot = runtime.testClient as TestClient | undefined;
  if (bot) context.bot = bot;
  return context as TestContext;
}

function post(path: string, body: unknown): Promise<unknown> {
  const { url, token } = connection();
  return fetch(`${url}/api/mock${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bot ${token}` },
    body: JSON.stringify(body),
  });
}

interface TestReport {
  status: string;
  durationMs?: number;
  error?: string;
}

function report(id: string, result: TestReport): Promise<unknown> {
  if (!config.project) return Promise.resolve();
  return post('/tests/report', { project: config.project, id, result });
}

/** テストの結果に、終了時の DB の内容を添えて報告する。次のテストの前に DB は空になる。 */
async function reportFinished(id: string, result: TestReport): Promise<unknown> {
  if (!config.project) return;
  return post('/tests/report', { project: config.project, id, result, db: await snapshotEngines() });
}

/** 接続中の Bot の DB に変化があれば、DB Studio へ送る。 */
function publishLiveDb(): void {
  let last: string | undefined;
  const publish = async () => {
    const snapshot = JSON.stringify(await snapshotEngines());
    if (snapshot === last) return;
    last = snapshot;
    await post('/db/live', { project: config.project, db: JSON.parse(snapshot) });
  };
  const run = () => publish().catch((error: unknown) => console.error(error));
  void run();
  setInterval(run, LIVE_DB_INTERVAL_MS);
}

async function runTest(test: TestCase, suite: Suite, title: string, id: string, context: TestContext): Promise<void> {
  const chain = ancestors(suite);
  const startedAt = Date.now();
  await report(id, { status: 'running' });
  const timeoutMs = test.options.timeout ?? DEFAULT_TIMEOUT_MS;
  const hooks = async (select: (s: Suite) => HookFn[], order: Suite[], local: TestContext) => {
    for (const s of order) for (const hook of select(s)) await hook(local);
  };
  try {
    const prepared = await context.bot?.prepare({ ...test.options, label: title });
    const local = { ...context, ...prepared } as TestContext;
    await withTimeout(async () => {
      try {
        await hooks((s) => s.beforeEach, chain, local);
        await test.fn!(local);
      } finally {
        await hooks((s) => s.afterEach, [...chain].reverse(), local);
      }
    }, timeoutMs);
    totals.passed += 1;
    console.log(`  ✓ ${title}`);
    await reportFinished(id, { status: 'passed', durationMs: Date.now() - startedAt });
  } catch (error) {
    if (error instanceof StartupError) abortStartup(error);
    totals.failed += 1;
    totals.failures.push({ title, error });
    console.log(`  ✕ ${title}`);
    const message = error instanceof Error ? (error.stack ?? error.message) : String(error);
    await reportFinished(id, { status: 'failed', durationMs: Date.now() - startedAt, error: message });
  }
}

function shouldRun(test: TestCase, suite: Suite, onlyActive: boolean, filter?: RegExp, title = ''): boolean {
  if (test.mode === 'skip' || test.mode === 'todo' || !test.fn) return false;
  const chain = ancestors(suite);
  if (chain.some((s) => s.mode === 'skip')) return false;
  if (filter && !filter.test(title)) return false;
  if (!onlyActive) return true;
  return test.mode === 'only' || chain.some((s) => s.mode === 'only');
}

const testId = (file: string, title: string) => `${file} › ${title}`;

async function runSuite(file: string, suite: Suite, onlyActive: boolean, filter?: RegExp, prefix = ''): Promise<void> {
  const context = baseContext();
  const title = (name: string) => [prefix, name].filter(Boolean).join(' › ');
  const selected = config.ids && new Set(config.ids);
  const isSelected = (t: TestCase) => selected?.has(testId(file, title(t.name)));
  const runnable = suite.tests.filter((t) =>
    selected ? isSelected(t) && t.fn : shouldRun(t, suite, onlyActive, filter, title(t.name)),
  );
  try {
    for (const hook of suite.beforeAll) await hook(context);
    for (const test of suite.tests) {
      if (runnable.includes(test)) await runTest(test, suite, title(test.name), testId(file, title(test.name)), context);
      else totals.skipped += 1;
    }
    for (const child of suite.suites) await runSuite(file, child, onlyActive, filter, title(child.name));
  } catch (error) {
    totals.failed += 1;
    totals.failures.push({ title: `${prefix || 'file'} (hook)`, error });
  } finally {
    for (const hook of suite.afterAll) await hook(context);
  }
}

function printFailures(): void {
  for (const { title, error } of totals.failures) {
    console.log(`\n● ${title}\n`);
    console.log(error instanceof Error ? (error.stack ?? error.message) : error);
  }
}

/** テストファイルを実行せず、テストケースの一覧を集める。 */
function collect(file: string, suite: Suite, path: string[] = []): object[] {
  const name = suite.parent ? [...path, suite.name] : path;
  const tests = suite.tests.map((test) => ({
    id: testId(file, [...name, test.name].join(' › ')),
    file,
    suite: name,
    name: test.name,
    skipped: !test.fn || test.mode === 'skip' || ancestors(suite).some((s) => s.mode === 'skip'),
  }));
  return [...tests, ...suite.suites.flatMap((child) => collect(file, child, name))];
}

async function main(): Promise<number> {
  process.on('uncaughtException', reportBotError);
  process.on('unhandledRejection', reportBotError);
  const filter = config.filter ? new RegExp(config.filter) : undefined;
  if (config.setup) await import(pathToFileURL(resolve(config.setup)).href);
  const testClient = runtime.testClient as TestClient | undefined;
  await testClient?.connect();

  if (config.mode === 'bot') {
    if (!testClient) throw new StartupError('testClient.ts が見つかりません');
    await testClient.serve();
    publishLiveDb();
    console.log(MARK_READY);
    return new Promise<number>(() => {});
  }

  const files: { file: string; root: Suite }[] = [];
  for (const file of config.files) {
    const root = createSuite(file);
    setCurrentSuite(root);
    await import(pathToFileURL(resolve(file)).href);
    files.push({ file, root });
  }

  if (config.mode === 'list') {
    console.log(`${MARK_LIST}${JSON.stringify(files.flatMap(({ file, root }) => collect(file, root)))}`);
    return 0;
  }

  const onlyActive = files.some(({ root }) => hasOnly(root));
  await testClient?.beginTestSession();
  for (const { file, root } of files) {
    if (config.ids && !config.ids.some((id) => id.startsWith(`${file} › `))) continue;
    console.log(file);
    await runSuite(file, root, onlyActive, filter);
  }

  await testClient?.endTestSession();
  await testClient?.destroy();
  await closeEngines();
  printFailures();
  console.log(`\nTests: ${totals.failed} failed, ${totals.passed} passed, ${totals.skipped} skipped`);
  return totals.failed > 0 ? 1 : 0;
}

main().then((code) => process.exit(code), abortStartup);
