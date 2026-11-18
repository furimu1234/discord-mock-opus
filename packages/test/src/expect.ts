import { expect as jestExpect } from 'expect';

const DEFAULT_TIMEOUT_MS = 2000;
const DEFAULT_INTERVAL_MS = 20;
const DEFAULT_STABLE_DURATION_MS = 1000;
const DEFAULT_STABLE_TIMEOUT_MS = 3000;

/** `expect.poll` のオプション。 */
export interface PollOptions {
  /** 待つ時間。既定は 2000ms。 */
  timeout?: number;
  /** 評価する間隔。既定は 20ms。 */
  interval?: number;
}

/** `expect.stable` のオプション。 */
export interface StableOptions extends PollOptions {
  /** 変わらないことを確認する時間。既定は 1000ms。 */
  duration?: number;
  /** 値が落ち着くまで待つ時間。既定は 3000ms。 */
  timeout?: number;
}

/** `expect.poll` が返すマッチャー。 */
export type Matchers = ReturnType<typeof jestExpect>;

/** {@link expect} に追加した機能。 */
export interface PollApi {
  /**
   * 値がマッチャーを満たすまで繰り返し評価する。
   *
   * @param actual - 値を返す関数。
   * @param options - 待つ時間と間隔。
   */
  poll(actual: () => unknown, options?: PollOptions): Matchers;
  /**
   * 値が変わらなくなることを確認する。一定時間のうちに落ち着かなければ失敗する。
   *
   * @remarks
   * Bot が返信しないことや、処理が止まったことの確認に使う。値は JSON にして比較する。
   *
   * @param actual - 値を返す関数。
   * @param options - 確認する時間、待つ時間、間隔。
   *
   * @example
   * ```ts
   * await actor.sendMessage('hello');
   * await expect.stable(async () => (await bot.botMessages(channel.id)).length);
   * ```
   */
  stable(actual: () => unknown, options?: StableOptions): Promise<void>;
}

/** `actual` の値がマッチャーを満たすまで繰り返し評価する。 */
function pollMatchers(actual: () => unknown, options: PollOptions, negate: boolean): Matchers {
  const timeout = options.timeout ?? DEFAULT_TIMEOUT_MS;
  const interval = options.interval ?? DEFAULT_INTERVAL_MS;
  return new Proxy({} as Matchers, {
    get(_target, key) {
      if (key === 'not') return pollMatchers(actual, options, !negate);
      return async (...args: unknown[]) => {
        const deadline = Date.now() + timeout;
        for (;;) {
          try {
            const value = await actual();
            const matcher = negate ? jestExpect(value).not : jestExpect(value);
            return (matcher as unknown as Record<string, (...a: unknown[]) => unknown>)[key as string]!(...args);
          } catch (error) {
            if (Date.now() >= deadline) throw error;
            await new Promise((done) => setTimeout(done, interval));
          }
        }
      };
    },
  });
}

async function waitUntilStable(actual: () => unknown, options: StableOptions): Promise<void> {
  const duration = options.duration ?? DEFAULT_STABLE_DURATION_MS;
  const timeout = options.timeout ?? DEFAULT_STABLE_TIMEOUT_MS;
  const interval = options.interval ?? DEFAULT_INTERVAL_MS;
  const deadline = Date.now() + timeout;
  let value = JSON.stringify(await actual());
  let changedAt = Date.now();
  while (Date.now() - changedAt < duration) {
    if (Date.now() >= deadline) throw new Error(`dismock: 値が ${timeout}ms 以内に落ち着きませんでした`);
    await new Promise((done) => setTimeout(done, interval));
    const next = JSON.stringify(await actual());
    if (next !== value) {
      value = next;
      changedAt = Date.now();
    }
  }
}

/**
 * Jest の `expect` に、非同期の処理を待つ `expect.poll` と `expect.stable` を追加したもの。
 *
 * @example
 * ```ts
 * await expect.poll(() => db.pg().rows('visits')).toHaveLength(1);
 * ```
 *
 * Bot が `visits` に行を追加するまで待つ。
 *
 * 実行前（`visits`、0 行）
 *
 * ```table
 * | name |
 * |---|
 * ```
 *
 * 実行後（`visits`）
 *
 * ```table
 * | name |
 * |---|
 * | alice |
 * ```
 */
export const expect: typeof jestExpect & PollApi = Object.assign(jestExpect, {
  poll: (actual: () => unknown, options: PollOptions = {}) => pollMatchers(actual, options, false),
  stable: (actual: () => unknown, options: StableOptions = {}) => waitUntilStable(actual, options),
});
