const RealDate = globalThis.Date;

/** 偽の時刻。`base` は設定した時刻、`setAt` は設定したときの本当の時刻。 */
let fixed: { base: number; setAt: number } | null = null;

/** 偽の時刻を有効にしているあいだの現在時刻。設定した時刻から、本当の時間と同じ速さで進む。 */
const now = () => (fixed ? fixed.base + (RealDate.now() - fixed.setAt) : RealDate.now());

/** 引数のない `new Date()` と `Date.now()` だけを偽の時刻にする。 */
class FakeDate extends RealDate {
  constructor(...args: ConstructorParameters<typeof Date> | []) {
    if (args.length === 0) super(now());
    else super(...(args as ConstructorParameters<typeof Date>));
  }

  static override now() {
    return now();
  }

  /** 偽の時刻にする前に作った日時も、`instanceof Date` で日時として扱う。 */
  static [Symbol.hasInstance](value: unknown) {
    return value instanceof RealDate;
  }
}

/** `Date()` を関数として呼んだときも、偽の時刻の文字列を返す。 */
const FakeDateFunction = new Proxy(FakeDate, {
  apply: () => new FakeDate().toString(),
}) as unknown as DateConstructor;

const RealSetTimeout = globalThis.setTimeout;
/** Node の `setTimeout` が受け付ける最長の待ち時間。超えると 1ms に縮める。 */
const MAX_TIMEOUT_MS = 2 ** 31 - 1;

/**
 * 時刻を過去に戻すと、インメモリ DB（PGlite）が本当の時刻で予約したタイマーまでの待ち時間が上限を超える。
 * Node はそれを 1ms に縮めるので、1ms ごとに呼び直し続ける。偽の時刻のあいだは、上限を超える待ち時間を上限にする。
 */
const clampedSetTimeout = Object.assign(
  (handler: TimerHandler, timeout?: number, ...args: unknown[]) =>
    RealSetTimeout(handler as () => void, typeof timeout === 'number' && timeout > MAX_TIMEOUT_MS ? MAX_TIMEOUT_MS : timeout, ...args),
  RealSetTimeout,
) as typeof setTimeout;

const install = (base: number) => {
  fixed = { base, setAt: RealDate.now() };
  globalThis.Date = FakeDateFunction;
  globalThis.setTimeout = clampedSetTimeout;
};

/** {@link clock} の操作。 */
export interface Clock {
  /**
   * テストの中の現在時刻を設定する。時刻は止まらず、設定した時刻から進む。
   *
   * @param time - 設定する時刻。タイムゾーンを含めて書くと、実行する環境によらず同じ時刻になる（例: `'2023-01-01T09:00:00+09:00'`）。
   */
  set(time: Date | number | string): void;
  /** 本当の時刻に戻す。テストが終わるとランナーが自動で戻すので、テストの途中で戻すときに使う。 */
  reset(): void;
  /** `set` で時刻を設定しているか。 */
  isSet(): boolean;
  /** 時刻を設定していても、本当の現在時刻（ミリ秒）を返す。 */
  realNow(): number;
}

/**
 * テストの中の現在時刻を操作する。昼と夜で動きが変わる Bot などのテストに使う。
 *
 * @remarks
 * テストは Bot と同じプロセスで動くので、設定した時刻は Bot の `new Date()` と `Date.now()` にも効く。
 * Bot の Gateway の接続や discord.js の処理を止めないよう、変えるのは `Date` だけで、`setTimeout` などのタイマーは本物のまま動く。
 * また、時刻は止めずに、設定した時刻から本当の時間と同じ速さで進む。
 * テストが終わると、ランナーが本当の時刻に戻す。
 *
 * @example
 * ```ts
 * test('深夜は深夜投稿チャンネルに投稿する', {}, async ({ actor }) => {
 *   clock.set('2023-01-01T02:00:00+09:00');
 *   // ...
 * });
 * ```
 */
export const clock: Clock = {
  set(time) {
    install(new RealDate(time).getTime());
  },
  reset() {
    fixed = null;
    globalThis.Date = RealDate;
    globalThis.setTimeout = RealSetTimeout;
  },
  isSet() {
    return fixed !== null;
  },
  realNow() {
    return RealDate.now();
  },
};
