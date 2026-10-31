import { expect as jestExpect } from 'expect';

const DEFAULT_TIMEOUT_MS = 2000;
const DEFAULT_INTERVAL_MS = 20;

/** `expect.poll` のオプション。 */
export interface PollOptions {
  /** 待つ時間。既定は 2000ms。 */
  timeout?: number;
  /** 評価する間隔。既定は 20ms。 */
  interval?: number;
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

/**
 * Jest の `expect` に、非同期の処理を待つ `expect.poll` を追加したもの。
 *
 * @example
 * ```ts
 * await expect.poll(() => db.pg().rows('visits')).toHaveLength(1);
 * ```
 */
export const expect: typeof jestExpect & PollApi = Object.assign(jestExpect, {
  poll: (actual: () => unknown, options: PollOptions = {}) => pollMatchers(actual, options, false),
});
