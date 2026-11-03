import type { DragEvent } from 'react';

/** ドラッグ中の項目を落とす位置。`after` は対象の下。`into` はカテゴリーの中（先頭）。 */
export interface DropTarget {
  id: string;
  after: boolean;
  into?: boolean;
}

/** ポインターが対象の下半分にあれば、対象の下に落とす。 */
export const isLowerHalf = (event: DragEvent<HTMLElement>): boolean => {
  const rect = event.currentTarget.getBoundingClientRect();
  return event.clientY > rect.top + rect.height / 2;
};

/** `moved` を取り除き、`targetId` の前（`after` なら後ろ）に入れた並びを返す。 */
export function moveItem<T extends { id?: unknown }>(items: T[], moved: T, targetId: string, after: boolean): T[] {
  const rest = items.filter((item) => item.id !== moved.id);
  const index = rest.findIndex((item) => item.id === targetId);
  if (index < 0) return [...rest, moved];
  rest.splice(after ? index + 1 : index, 0, moved);
  return rest;
}

/** ドラッグで運ぶデータの種類。ほかのドラッグ（ファイルなど）と区別する。 */
export const DRAG_TYPE = 'application/x-dismock-reorder';
