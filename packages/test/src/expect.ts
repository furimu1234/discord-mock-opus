import { expect as jestExpect } from 'expect';

const DEFAULT_TIMEOUT_MS = 2000;
const DEFAULT_INTERVAL_MS = 20;

export interface PollOptions {
  timeout?: number;
  interval?: number;
}

type Matchers = ReturnType<typeof jestExpect>;

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

export const expect = Object.assign(jestExpect, {
  poll: (actual: () => unknown, options: PollOptions = {}) => pollMatchers(actual, options, false),
});
