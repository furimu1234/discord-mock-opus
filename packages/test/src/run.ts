import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { closeEngines, db, runtime, StartupError, type TestClient } from '@dismock/client';
import { createSuite, setCurrentSuite, type HookFn, type Suite, type TestCase, type TestContext } from './index.js';

const DEFAULT_TIMEOUT_MS = 5000;
/** テストの失敗（1）と区別する終了コード。`pnpm app` はこれを見て Mock も止める。 */
const EXIT_STARTUP_FAILURE = 2;

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
  if (failCurrentTest) failCurrentTest(error);
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

async function runTest(test: TestCase, suite: Suite, title: string, context: TestContext): Promise<void> {
  const chain = ancestors(suite);
  const timeoutMs = test.options.timeout ?? DEFAULT_TIMEOUT_MS;
  const hooks = async (select: (s: Suite) => HookFn[], order: Suite[], local: TestContext) => {
    for (const s of order) for (const hook of select(s)) await hook(local);
  };
  try {
    const prepared = await context.bot?.prepare(test.options);
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
  } catch (error) {
    if (error instanceof StartupError) abortStartup(error);
    totals.failed += 1;
    totals.failures.push({ title, error });
    console.log(`  ✕ ${title}`);
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

async function runSuite(suite: Suite, onlyActive: boolean, filter?: RegExp, prefix = ''): Promise<void> {
  const context = baseContext();
  const title = (name: string) => [prefix, name].filter(Boolean).join(' › ');
  const runnable = suite.tests.filter((t) => shouldRun(t, suite, onlyActive, filter, title(t.name)));
  try {
    for (const hook of suite.beforeAll) await hook(context);
    for (const test of suite.tests) {
      if (runnable.includes(test)) await runTest(test, suite, title(test.name), context);
      else totals.skipped += 1;
    }
    for (const child of suite.suites) await runSuite(child, onlyActive, filter, title(child.name));
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

async function main(): Promise<number> {
  process.on('uncaughtException', reportBotError);
  process.on('unhandledRejection', reportBotError);
  const config = JSON.parse(process.env.DISMOCK_TEST_CONFIG ?? '{}') as {
    files: string[];
    setup?: string;
    filter?: string;
  };
  const filter = config.filter ? new RegExp(config.filter) : undefined;
  if (config.setup) await import(pathToFileURL(resolve(config.setup)).href);
  await (runtime.testClient as TestClient | undefined)?.connect();

  const files: { file: string; root: Suite }[] = [];
  for (const file of config.files) {
    const root = createSuite(file);
    setCurrentSuite(root);
    await import(pathToFileURL(resolve(file)).href);
    files.push({ file, root });
  }

  const onlyActive = files.some(({ root }) => hasOnly(root));
  for (const { file, root } of files) {
    console.log(file);
    await runSuite(root, onlyActive, filter);
  }

  await (runtime.testClient as TestClient | undefined)?.destroy();
  await closeEngines();
  printFailures();
  console.log(`\nTests: ${totals.failed} failed, ${totals.passed} passed, ${totals.skipped} skipped`);
  return totals.failed > 0 ? 1 : 0;
}

main().then((code) => process.exit(code), abortStartup);
