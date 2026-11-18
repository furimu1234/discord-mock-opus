/**
 * 配布版のウインドウと画面の間の取り決め。画面（apps/web）、preload、メインのプロセスが読み込む。
 * ブラウザで開いた画面には `window[DESKTOP_BRIDGE_KEY]` がないので、ウインドウの設定を表示しない。
 */

/** 画面の `window` に置く、ウインドウを操作する API の名前。 */
export const DESKTOP_BRIDGE_KEY = 'dismockDesktop';

/** preload とメインのプロセスの間の IPC のチャンネル。 */
export const DesktopChannel = {
  displays: 'desktop:displays',
  moveToDisplay: 'desktop:move-to-display',
  resetPosition: 'desktop:reset-position',
  displaysChanged: 'desktop:displays-changed',
  checkUpdate: 'desktop:check-update',
  installUpdate: 'desktop:install-update',
  updateProgress: 'desktop:update-progress',
  terminalData: 'terminal:data',
  terminalHistory: 'terminal:history',
} as const;

export interface DesktopDisplay {
  id: number;
  /** OS が付けた名前。名前がないときは番号。 */
  label: string;
  width: number;
  height: number;
  primary: boolean;
  /** 画面のウインドウがあるディスプレイ。 */
  current: boolean;
}

/** GitHub の Releases の最新版と、今の版との比較。 */
export interface DesktopUpdate {
  current: string;
  latest: string;
  /** 最新版が今の版より新しい。 */
  available: boolean;
  /** Release の説明（Markdown）。 */
  notes: string;
  /** Release のページ。 */
  url: string;
  /** この PC の配布物があり、画面から差し替えられる（Windows だけ）。それ以外は Release のページから入手する。 */
  installable: boolean;
}

/** アップデートのダウンロードの進み具合（バイト）。 */
export interface DesktopUpdateProgress {
  received: number;
  total: number;
}

/** 画面から使う、ウインドウの操作。 */
export interface DesktopBridge {
  displays(): Promise<DesktopDisplay[]>;
  /** 2 つのウインドウを、指定したディスプレイの既定の位置へ移す。 */
  moveToDisplay(id: number): Promise<void>;
  /** 保存した位置を消し、2 つのウインドウをメインのディスプレイの既定の位置へ戻す。 */
  resetPosition(): Promise<void>;
  /** ディスプレイの増減や、ウインドウの移動を知らせる。戻り値で解除する。 */
  onDisplaysChanged(listener: () => void): () => void;
  /** GitHub の Releases に最新版を問い合わせる。押したときだけ呼び、自動では問い合わせない。 */
  checkUpdate(): Promise<DesktopUpdate>;
  /** 最新版をダウンロードして照合し、dismock を終了して差し替え、起動し直す。 */
  installUpdate(): Promise<void>;
  /** ダウンロードの進み具合を知らせる。戻り値で解除する。 */
  onUpdateProgress(listener: (progress: DesktopUpdateProgress) => void): () => void;
}

/**
 * Mock の出力の一部。`end` はこの出力までに書いた文字数の合計。
 * 履歴の取り出しと出力の通知は届く順番が決まっていないので、履歴より前の通知を捨てるのに使う。
 */
export interface TerminalChunk {
  data: string;
  end: number;
}

/** ターミナルのウインドウから使う、Mock の出力の受け取り。 */
export interface TerminalBridge {
  /** これまでの出力。 */
  history(): Promise<TerminalChunk>;
  onData(listener: (chunk: TerminalChunk) => void): void;
}

/** ターミナルのウインドウの `window` に置く API の名前。 */
export const TERMINAL_BRIDGE_KEY = 'dismockTerminal';
