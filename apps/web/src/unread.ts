import { isForumType } from '@dismock/server/constants';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { Json } from './api';

/** チャンネルごとの、最後に読んだメッセージの ID。ログインしたユーザーごとにこのブラウザに保存する。 */
type ReadMarks = Record<string, string>;

const storageKey = (userId: string) => `dismock:read:${userId}`;

function load(userId: string | undefined): ReadMarks {
  if (!userId) return {};
  try {
    return JSON.parse(localStorage.getItem(storageKey(userId)) ?? '{}') as ReadMarks;
  } catch {
    return {};
  }
}

function save(userId: string, marks: ReadMarks): void {
  try {
    localStorage.setItem(storageKey(userId), JSON.stringify(marks));
  } catch {
    // 保存できない画面では、開いている間だけ覚える。
  }
}

/** 自分以外が送った最新のメッセージの ID。自分のメッセージとテストの区切りは未読にしない。 */
export function latestFromOthers(state: Json, channelId: string, userId: string | undefined): string | undefined {
  const messages = (state.messages[channelId] ?? []) as Json[];
  return messages.findLast((message) => message.dismock_test === undefined && message.author?.id !== userId)?.id;
}

const isNewer = (id: string, than: string) => BigInt(id) > BigInt(than);

export interface UnreadTracker {
  /** 最後に読んだ後で、自分以外がメッセージを送ったか。フォーラムは投稿のどれかが未読なら未読。 */
  isUnread: (channelId: string) => boolean;
  /** チャンネルの最新のメッセージまでを読んだことにする。 */
  markRead: (channelId: string) => void;
}

/** 印のないチャンネルは、どのメッセージより前まで読んだことにする。 */
const NOTHING_READ = '0';

/**
 * 画面を開いたとき（ユーザーを切り替えたとき）にあるメッセージは読んだことにする。
 * その後で届いたメッセージは、メッセージのなかったチャンネルでも未読にする。
 */
export function useUnread(state: Json | null, userId: string | undefined): UnreadTracker {
  const [marks, setMarks] = useState<ReadMarks>(() => load(userId));
  const [baselineFor, setBaselineFor] = useState<string | undefined>(undefined);
  const stateRef = useRef(state);
  stateRef.current = state;

  useEffect(() => setMarks(load(userId)), [userId]);

  const update = useCallback((pick: (current: ReadMarks, state: Json) => ReadMarks | undefined) => {
    const current = stateRef.current;
    if (!current || !userId) return;
    setMarks((marks) => {
      const next = pick(marks, current);
      if (!next) return marks;
      save(userId, next);
      return next;
    });
  }, [userId]);

  useEffect(() => {
    if (!state || !userId || baselineFor === userId) return;
    setBaselineFor(userId);
    update((marks, current) => {
      let next: ReadMarks | undefined;
      for (const channelId of Object.keys(current.messages)) {
        const latest = latestFromOthers(current, channelId, userId);
        if (!latest || marks[channelId] !== undefined) continue;
        next ??= { ...marks };
        next[channelId] = latest;
      }
      return next;
    });
  }, [state, userId, baselineFor, update]);

  const markRead = useCallback((channelId: string) => update((marks, current) => {
    const latest = latestFromOthers(current, channelId, userId);
    if (!latest || !isNewer(latest, marks[channelId] ?? NOTHING_READ)) return undefined;
    return { ...marks, [channelId]: latest };
  }), [update, userId]);

  const isUnread = (channelId: string): boolean => {
    // 既読の基準を決める前は、すべてを未読にしてしまわないよう何も表示しない。
    if (!state || baselineFor !== userId) return false;
    const channel = state.channels[channelId] as Json | undefined;
    if (channel && isForumType(channel.type)) {
      return Object.values<Json>(state.channels).some((thread) => thread.parent_id === channelId && isUnread(thread.id));
    }
    const latest = latestFromOthers(state, channelId, userId);
    return latest !== undefined && isNewer(latest, marks[channelId] ?? NOTHING_READ);
  };
  return { isUnread, markRead };
}

/** 開いているチャンネルを、新しいメッセージが届くたびに読んだことにする。 */
export function MarkRead({ channelId, latest, onRead }: { channelId: string; latest?: string; onRead: (channelId: string) => void }): null {
  useEffect(() => onRead(channelId), [channelId, latest, onRead]);
  return null;
}
