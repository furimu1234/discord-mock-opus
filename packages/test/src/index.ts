import type { Actor, TestClient, TestSeed } from '@dismock/client';
import { db } from '@dismock/client';
import type { DEFAULT_USERS } from '@dismock/server/constants';

export { expect } from './expect.js';
export type { Matchers, PollApi, PollOptions } from './expect.js';
export { fn, spyOn } from 'jest-mock';

/**
 * 管理画面で追加したダミーユーザー（ユーザー名と ID）。
 * `pnpm test` / `pnpm app` の起動中に生成される `dismock-users.d.ts` が内容を追加する。
 */
export interface DummyUsers {}

/** 既定のダミーユーザー。`alice` は管理者、`bob` は権限なし。 */
export type DefaultUser = (typeof DEFAULT_USERS)[number];

/** テストの `users` に指定できるダミーユーザーの ID またはユーザー名。 */
export type DummyUser = DefaultUser['id'] | DefaultUser['username'] | keyof DummyUsers | DummyUsers[keyof DummyUsers];

/** `'login'` はログイン中のユーザー。 */
export type TestUser = 'login' | DummyUser;

/**
 * テスト関数とフックに渡す値。
 *
 * @remarks
 * `beforeAll` と `afterAll` に渡すのは `bot` と `db` だけで、それ以外はテストごとに決まる。
 */
export interface TestContext {
  /** testClient。 */
  bot: TestClient;
  /** テストを実行するユーザー。リストを指定したときは先頭のユーザー。 */
  user: Record<string, any>;
  /** `user` として操作する {@link @dismock/client#Actor}。 */
  actor: Actor;
  /** `users` に指定したすべてのユーザーの {@link @dismock/client#Actor}。 */
  actors: Actor[];
  /** テストを実行するサーバー。 */
  guild: Record<string, any>;
  /** テストを実行するチャンネル。画面で開いているチャンネルで、`seed` で追加したときはそのチャンネル。 */
  channel: Record<string, any>;
  /** `seed` で追加したデータ。 */
  seeded: Record<string, any>;
  /** インメモリ DB。 */
  db: typeof db;
}

/** テストのオプション。 */
export interface TestOptions {
  /** テストを実行するユーザー。省略するとログイン中のユーザー。 */
  users?: TestUser | TestUser[];
  /** テストの制限時間。既定は 5000ms。 */
  timeout?: number;
  /** テストケースのカードに表示する説明。 */
  description?: string;
  /** テストの前に投入する初期データ。 */
  seed?: TestSeed;
}

/** テスト関数。 */
export type TestFn = (context: TestContext) => unknown;
/** フックの関数。 */
export type HookFn = (context: TestContext) => unknown;

/** @internal */
export type Mode = 'run' | 'skip' | 'only' | 'todo';

/** @internal */
export interface TestCase {
  name: string;
  fn?: TestFn;
  options: TestOptions;
  mode: Mode;
}

/** @internal */
export interface Suite {
  name: string;
  mode: Mode;
  parent?: Suite;
  tests: TestCase[];
  suites: Suite[];
  beforeAll: HookFn[];
  afterAll: HookFn[];
  beforeEach: HookFn[];
  afterEach: HookFn[];
}

/** @internal */
export function createSuite(name: string, mode: Mode = 'run', parent?: Suite): Suite {
  return { name, mode, parent, tests: [], suites: [], beforeAll: [], afterAll: [], beforeEach: [], afterEach: [] };
}

const KEY = Symbol.for('dismock.test.current');
type Global = typeof globalThis & { [KEY]?: Suite };

/** @internal */
export function setCurrentSuite(suite: Suite): void {
  (globalThis as Global)[KEY] = suite;
}

function currentSuite(): Suite {
  const suite = (globalThis as Global)[KEY];
  if (!suite) throw new Error('@dismock/test: テストは `dismock test` で実行してください');
  return suite;
}

function defineSuite(name: string, body: () => void, mode: Mode): void {
  const parent = currentSuite();
  const suite = createSuite(name, mode, parent);
  parent.suites.push(suite);
  setCurrentSuite(suite);
  try {
    body();
  } finally {
    setCurrentSuite(parent);
  }
}

/** テストをまとめる関数。 */
export type SuiteDefinition = (name: string, body: () => void) => void;

/** {@link describe} の型。 */
export interface DescribeApi extends SuiteDefinition {
  /** テストをスキップする。 */
  skip: SuiteDefinition;
  /** このまとまりのテストだけを実行する。 */
  only: SuiteDefinition;
}

/**
 * テストをまとめる。入れ子にでき、テスト画面ではカテゴリーとして表示する。
 *
 * @example
 * ```ts
 * describe('レベル', () => {
 *   describe('XP', () => {
 *     test('発言すると増える', async ({ actor }) => {
 *       await actor.sendMessage('hello');
 *     });
 *   });
 * });
 * ```
 */
export const describe: DescribeApi = Object.assign((name: string, body: () => void) => defineSuite(name, body, 'run'), {
  skip: (name: string, body: () => void) => defineSuite(name, body, 'skip'),
  only: (name: string, body: () => void) => defineSuite(name, body, 'only'),
});

function defineTest(name: string, second: TestOptions | TestFn | undefined, third: TestFn | undefined, mode: Mode): void {
  const options = typeof second === 'object' ? second : {};
  const fn = typeof second === 'function' ? second : third;
  currentSuite().tests.push({ name, fn, options, mode });
}

/** テストを定義する関数。 */
export interface TestDefinition {
  /**
   * @param name - テストの名前。
   * @param fn - テスト関数。
   */
  (name: string, fn: TestFn): void;
  /**
   * @param name - テストの名前。
   * @param options - テストのオプション。
   * @param fn - テスト関数。
   */
  (name: string, options: TestOptions, fn: TestFn): void;
}

/** `test.each` で 1 件ごとのテストを定義する関数。名前の `%s` は値に、`%i` は番号に置き換える。 */
export type EachDefinition<T> = (
  name: string,
  fn: (item: T, context: TestContext) => unknown,
  options?: TestOptions,
) => void;

/** {@link test} の型。 */
export interface TestApi extends TestDefinition {
  /** テストをスキップする。 */
  skip: TestDefinition;
  /** このテストだけを実行する。 */
  only: TestDefinition;
  /** 未実装のテストとして記録する。 */
  todo(name: string): void;
  /** 値ごとに同じ内容のテストを定義する。 */
  each<T>(cases: readonly T[]): EachDefinition<T>;
}

const modeTest =
  (mode: Mode): TestDefinition =>
  (name: string, second: TestOptions | TestFn, third?: TestFn) =>
    defineTest(name, second, third, mode);

function each<T>(cases: readonly T[]): EachDefinition<T> {
  return (name, fn, options = {}) => {
    cases.forEach((item, index) => {
      const title = name.replace('%s', String(item)).replace('%i', String(index));
      defineTest(title, options, (context) => fn(item, context), 'run');
    });
  };
}

/**
 * テストを定義する。テストは今のデータの上で実行し、テストごとの初期化は行わない。
 *
 * @example
 * ```ts
 * test('発言すると XP が増える', async ({ actor }) => {
 *   await actor.sendMessage('hello');
 * });
 *
 * test('管理者だけが実行できる', { users: 'alice' }, async ({ actor }) => {
 *   await actor.command('admin');
 * });
 * ```
 */
export const test: TestApi = Object.assign(modeTest('run'), {
  skip: modeTest('skip'),
  only: modeTest('only'),
  todo: (name: string) => defineTest(name, undefined, undefined, 'todo'),
  each,
});

/** {@link test} の別名。 */
export const it: TestApi = test;

/** このまとまりの最初のテストの前に実行する。 */
export const beforeAll = (fn: HookFn) => void currentSuite().beforeAll.push(fn);
/** このまとまりの最後のテストの後に実行する。 */
export const afterAll = (fn: HookFn) => void currentSuite().afterAll.push(fn);
/** それぞれのテストの前に実行する。 */
export const beforeEach = (fn: HookFn) => void currentSuite().beforeEach.push(fn);
/** それぞれのテストの後に実行する。 */
export const afterEach = (fn: HookFn) => void currentSuite().afterEach.push(fn);
