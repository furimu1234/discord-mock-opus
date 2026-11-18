import { AsyncLocalStorage } from 'node:async_hooks';

/** `watchModal` の中で、開いたモーダルを画面に表示しておく時間。 */
const watching = new AsyncLocalStorage<number>();

/**
 * `fn` の中の操作で開いたモーダルを、テスト画面に `durationMs` だけ表示する。
 *
 * @remarks
 * `watchModal` で囲まない操作のモーダルは、画面に表示しない。
 * 表示は画面だけのもので、テストは表示の終わりを待たずに進む。
 * `fn` の中で `submitModal` も行うと、送信した値を画面のモーダルに入れて表示する。
 *
 * @param fn - モーダルを開く操作。
 * @param durationMs - モーダルを画面に表示しておく時間。
 * @returns `fn` の戻り値。
 *
 * @example
 * ```ts
 * test('新規作成でモーダルが開く', {}, async ({ actor }) => {
 *   const clicked = await watchModal(() => actor.click(panel, 'add'), 2_500);
 *   expect(clicked.modal?.title).toBe('設定名入力');
 * });
 * ```
 */
export const watchModal = <T>(fn: () => T | Promise<T>, durationMs: number): Promise<T> =>
  watching.run(durationMs, async () => await fn());

/** @internal */
export const watchModalMs = (): number | undefined => watching.getStore();
