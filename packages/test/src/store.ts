/**
 * テストの間で値を受け渡す入れ物。
 *
 * @remarks
 * Bot のプロセスのメモリに保存する。画面から別々に実行したテストの間でも残り、Bot を起動し直すと消える。
 */
export interface TestStore {
  /**
   * 値を保存する。同じキーの値は置き換える。
   *
   * @param key - 値の名前。
   * @param value - 保存する値。
   */
  push(key: string, value: unknown): void;
  /**
   * 保存した値を返す。
   *
   * @param key - 値の名前。
   * @returns 保存した値。保存していなければ `undefined`。
   */
  get<T = unknown>(key: string): T | undefined;
}

const values = new Map<string, unknown>();

/**
 * テストの間で値を受け渡す。
 *
 * @example
 * ```ts
 * test('パネルを送る', {}, async ({ actor }) => {
 *   store.push('panel', await actor.command('募集設定'));
 * });
 *
 * test('新規作成ボタンを押す', {}, async ({ actor }) => {
 *   const panel = store.get<MockMessage>('panel');
 *   if (!panel) throw new Error('先に「パネルを送る」を実行してください');
 *   await actor.click(panel, 'recruit_setting_panel_add');
 * });
 * ```
 */
export const store: TestStore = {
  push(key, value) {
    values.set(key, value);
  },
  get<T = unknown>(key: string) {
    return values.get(key) as T | undefined;
  },
};
