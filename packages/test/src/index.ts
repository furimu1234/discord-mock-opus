import type { Actor, PrepareOptions, TestClient, TestSeed } from '@dismock/client';
import { db } from '@dismock/client';
import type { DEFAULT_USERS } from '@dismock/server/constants';

export { expect } from './expect.js';
export type { PollOptions } from './expect.js';
export { fn, spyOn } from 'jest-mock';

/**
 * 管理画面で追加したダミーユーザー（ユーザー名と ID）。
 * `pnpm test` / `pnpm app` の起動中に生成される `dismock-users.d.ts` が内容を追加する。
 */
export interface DummyUsers {}

type DefaultUser = (typeof DEFAULT_USERS)[number];

/** テストの `users` に指定できるダミーユーザーの ID またはユーザー名。 */
export type DummyUser = DefaultUser['id'] | DefaultUser['username'] | keyof DummyUsers | DummyUsers[keyof DummyUsers];

/** `'login'` はログイン中のユーザー。 */
export type TestUser = 'login' | DummyUser;

export interface TestContext {
  bot: TestClient;
  /** テストを実行するユーザー。リストを指定したときは先頭のユーザー。 */
  user: Record<string, any>;
  actor: Actor;
  /** `users` に指定したすべてのユーザーの `Actor`。 */
  actors: Actor[];
  guild: Record<string, any>;
  channel: Record<string, any>;
  seeded: Record<string, any>;
  db: typeof db;
}

export interface TestOptions extends Omit<PrepareOptions, 'users' | 'label' | 'channelId'> {
  /** テストを実行するユーザー。省略するとログイン中のユーザー。 */
  users?: TestUser | TestUser[];
  /** テストの制限時間。既定は 5000ms。 */
  timeout?: number;
  /** テストケースのカードに表示する説明。 */
  description?: string;
  seed?: TestSeed;
}

export type TestFn = (context: TestContext) => unknown;
export type HookFn = (context: TestContext) => unknown;

type Mode = 'run' | 'skip' | 'only' | 'todo';

export interface TestCase {
  name: string;
  fn?: TestFn;
  options: TestOptions;
  mode: Mode;
}

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

export function createSuite(name: string, mode: Mode = 'run', parent?: Suite): Suite {
  return { name, mode, parent, tests: [], suites: [], beforeAll: [], afterAll: [], beforeEach: [], afterEach: [] };
}

const KEY = Symbol.for('dismock.test.current');
type Global = typeof globalThis & { [KEY]?: Suite };

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

export const describe = Object.assign((name: string, body: () => void) => defineSuite(name, body, 'run'), {
  skip: (name: string, body: () => void) => defineSuite(name, body, 'skip'),
  only: (name: string, body: () => void) => defineSuite(name, body, 'only'),
});

function defineTest(name: string, second: TestOptions | TestFn | undefined, third: TestFn | undefined, mode: Mode): void {
  const options = typeof second === 'object' ? second : {};
  const fn = typeof second === 'function' ? second : third;
  currentSuite().tests.push({ name, fn, options, mode });
}

interface TestApi {
  (name: string, fn: TestFn): void;
  (name: string, options: TestOptions, fn: TestFn): void;
}

const modeTest =
  (mode: Mode): TestApi =>
  (name: string, second: TestOptions | TestFn, third?: TestFn) =>
    defineTest(name, second, third, mode);

function each<T>(cases: readonly T[]) {
  return (name: string, fn: (item: T, context: TestContext) => unknown, options: TestOptions = {}) => {
    cases.forEach((item, index) => {
      const title = name.replace('%s', String(item)).replace('%i', String(index));
      defineTest(title, options, (context) => fn(item, context), 'run');
    });
  };
}

export const test = Object.assign(modeTest('run'), {
  skip: modeTest('skip'),
  only: modeTest('only'),
  todo: (name: string) => defineTest(name, undefined, undefined, 'todo'),
  each,
});

export const it = test;

export const beforeAll = (fn: HookFn) => void currentSuite().beforeAll.push(fn);
export const afterAll = (fn: HookFn) => void currentSuite().afterAll.push(fn);
export const beforeEach = (fn: HookFn) => void currentSuite().beforeEach.push(fn);
export const afterEach = (fn: HookFn) => void currentSuite().afterEach.push(fn);
