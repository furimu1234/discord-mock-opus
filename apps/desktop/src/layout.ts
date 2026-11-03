/** ウインドウの配置の計算。Electron に依存しない。 */

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface DisplayLike {
  id: number;
  label: string;
  bounds: Rect;
  workArea: Rect;
}

/** 保存する、最後に開いていたディスプレイとウインドウの位置。 */
export interface SavedLayout {
  display?: { id: number; label: string; bounds: Rect };
  main?: Rect;
  terminal?: Rect;
}

export interface Layout {
  main: Rect;
  terminal: Rect;
}

/** 画面とターミナルのウインドウの既定の大きさ。ディスプレイが小さいときは縮める。 */
export const MAIN_SIZE = { width: 1280, height: 820 };
export const TERMINAL_SIZE = { width: 760, height: 420 };
/** これより小さくはできない大きさ。 */
export const MAIN_MIN_SIZE = { width: 720, height: 480 };
export const TERMINAL_MIN_SIZE = { width: 360, height: 200 };
/** ディスプレイの端からの余白。 */
export const LAYOUT_MARGIN = 24;

const fit = (size: number, available: number) => Math.max(0, Math.min(size, available - 2 * LAYOUT_MARGIN));

/** 既定の配置。画面は左上、ターミナルは右下に置く。重なったときは、クリックしたほうが手前になる。 */
export function defaultLayout(workArea: Rect): Layout {
  const main = { width: fit(MAIN_SIZE.width, workArea.width), height: fit(MAIN_SIZE.height, workArea.height) };
  const terminal = { width: fit(TERMINAL_SIZE.width, workArea.width), height: fit(TERMINAL_SIZE.height, workArea.height) };
  return {
    main: { x: workArea.x + LAYOUT_MARGIN, y: workArea.y + LAYOUT_MARGIN, ...main },
    terminal: {
      x: workArea.x + workArea.width - LAYOUT_MARGIN - terminal.width,
      y: workArea.y + workArea.height - LAYOUT_MARGIN - terminal.height,
      ...terminal,
    },
  };
}

const sameRect = (a: Rect, b: Rect) => a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;

/**
 * 保存したディスプレイを探す。ID は OS を起動し直すと変わることがあるので、
 * 見つからなければ名前と位置が同じものを探す。どちらもなければ `undefined`。
 */
export function findSavedDisplay<D extends DisplayLike>(displays: D[], saved: SavedLayout['display']): D | undefined {
  if (!saved) return undefined;
  return displays.find((display) => display.id === saved.id) ?? displays.find((display) => display.label === saved.label && sameRect(display.bounds, saved.bounds));
}

/** ウインドウの中心がディスプレイの作業領域の中にあるか。外れたウインドウは操作できないので、既定の位置に戻す。 */
export function isOnDisplay(rect: Rect, workArea: Rect): boolean {
  const centerX = rect.x + rect.width / 2;
  const centerY = rect.y + rect.height / 2;
  return centerX >= workArea.x && centerX < workArea.x + workArea.width && centerY >= workArea.y && centerY < workArea.y + workArea.height;
}

/** 起動したときの配置。保存した位置がディスプレイの中にあれば使い、なければ既定の配置にする。 */
export function restoreLayout(display: DisplayLike, saved: SavedLayout): Layout {
  const fallback = defaultLayout(display.workArea);
  const restore = (rect: Rect | undefined, otherwise: Rect) => (rect && isOnDisplay(rect, display.workArea) ? rect : otherwise);
  return { main: restore(saved.main, fallback.main), terminal: restore(saved.terminal, fallback.terminal) };
}
