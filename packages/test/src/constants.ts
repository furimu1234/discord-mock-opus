/** テストの失敗（1）と区別する終了コード。`pnpm app` はこれを見て Mock も止める。 */
export const EXIT_STARTUP_FAILURE = 2;

/** ランナーからエージェントへ、標準出力で結果を伝えるときの目印。 */
export const MARK_LIST = '__DISMOCK_LIST__';
export const MARK_READY = '__DISMOCK_READY__';
