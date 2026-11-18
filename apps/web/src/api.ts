import { AUDIO_LENGTH_SIZE, WEB_ORIGIN, WEB_ORIGIN_HEADER } from '@dismock/server/constants';
import { useCallback, useEffect, useRef, useState } from 'react';

export type Json = Record<string, any>;

export { LEGAL_NOTICE } from '@dismock/server/constants';

export { ChannelType as ChannelKind } from '@dismock/server/constants';

const STORAGE_KEY = 'dismock-token';

/** URL のフラグメントのトークンを保存し、アドレスバーからは消す。 */
function readToken(): string | null {
  const match = /#token=(.+)$/.exec(location.hash);
  if (match) {
    sessionStorage.setItem(STORAGE_KEY, match[1]!);
    history.replaceState(null, '', location.pathname);
  }
  return sessionStorage.getItem(STORAGE_KEY);
}

export const token = readToken();

/** Mock の API のエラー。`status` は HTTP のステータス。 */
export class ApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

async function request<T = any>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`/api/mock${path}`, {
    ...init,
    // 画面で作ったものは、Mock を起動し直しても残す。
    headers: { ...init.headers, authorization: `Bot ${token}`, [WEB_ORIGIN_HEADER]: WEB_ORIGIN },
  });
  const data = (await response.json().catch(() => ({}))) as T & { message?: string };
  if (!response.ok) throw new ApiError(data.message ?? response.statusText, response.status);
  return data;
}

const send = (method: string) => (path: string, body: unknown = {}) =>
  request(path, {
    method,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

export const api = {
  get: request,
  post: send('POST'),
  put: send('PUT'),
  patch: send('PATCH'),
  delete: (path: string) => request(path, { method: 'DELETE' }),
};

/** Mock から画面へのイベント。ほとんどは更新があったことだけを伝え、`data` は空。 */
export type MockEventListener = (type: string, data: Json) => void;

async function streamEvents(signal: AbortSignal, onEvent: MockEventListener): Promise<void> {
  const response = await fetch('/api/mock/events', { signal, headers: { authorization: `Bot ${token}` } });
  let buffer = '';
  for await (const chunk of response.body!.pipeThrough(new TextDecoderStream()) as unknown as AsyncIterable<string>) {
    buffer += chunk;
    const events = buffer.split('\n\n');
    buffer = events.pop() ?? '';
    for (const event of events) {
      if (!event.startsWith('data: ')) continue;
      const { type, data } = JSON.parse(event.slice(6)) as { type: string; data: Json };
      onEvent(type, data);
    }
  }
}

/** Mock から PCM のフレームを受け取る。形式は長さ（2 バイト）とフレームの繰り返し。 */
export async function streamAudio(signal: AbortSignal, onFrame: (pcm: DataView) => void): Promise<void> {
  const response = await fetch('/api/mock/voice/audio', { signal, headers: { authorization: `Bot ${token}` } });
  let buffer = new Uint8Array();
  for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
    const joined = new Uint8Array(buffer.length + chunk.length);
    joined.set(buffer);
    joined.set(chunk, buffer.length);
    let offset = 0;
    while (offset + AUDIO_LENGTH_SIZE <= joined.length) {
      const length = new DataView(joined.buffer, joined.byteOffset + offset).getUint16(0);
      const end = offset + AUDIO_LENGTH_SIZE + length;
      if (end > joined.length) break;
      onFrame(new DataView(joined.buffer, joined.byteOffset + offset + AUDIO_LENGTH_SIZE, length));
      offset = end;
    }
    buffer = joined.subarray(offset);
  }
}

export interface MockData {
  state: Json | null;
  tests: Json | null;
  dms: Json[];
  /** ログイン中のユーザーのグループ DM。チャンネルとメッセージの組。 */
  groupDms: Json[];
  connected: boolean;
  refresh: () => void;
}

/**
 * イベントを受け取るたびに状態を取り直す。テスト実行中の連続した更新はまとめる。
 * `onEvent` には、状態の取り直しとは別に、イベントの種類と内容を渡す。
 */
export function useMockData(onEvent?: MockEventListener): MockData {
  const listener = useRef(onEvent);
  listener.current = onEvent;
  const [state, setState] = useState<Json | null>(null);
  const [tests, setTests] = useState<Json | null>(null);
  const [dms, setDms] = useState<Json[]>([]);
  const [groupDms, setGroupDms] = useState<Json[]>([]);
  const [connected, setConnected] = useState(false);
  const timer = useRef<number | undefined>(undefined);

  const load = useCallback(async () => {
    const [nextState, nextTests, nextDms, nextGroupDms] = await Promise.all([
      api.get('/state'), api.get('/tests'), api.get('/dms'), api.get('/dms/groups'),
    ]);
    setState(nextState);
    setTests(nextTests);
    setDms(nextDms);
    setGroupDms(nextGroupDms);
  }, []);

  const refresh = useCallback(() => {
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => void load().catch(() => {}), 30);
  }, [load]);

  useEffect(() => {
    if (!token) return;
    const controller = new AbortController();
    const connect = async () => {
      while (!controller.signal.aborted) {
        try {
          setConnected(true);
          refresh();
          await streamEvents(controller.signal, (type, data) => {
            refresh();
            listener.current?.(type, data);
          });
        } catch {
          // 再接続する。
        }
        setConnected(false);
        await new Promise((done) => setTimeout(done, 1000));
      }
    };
    void connect();
    return () => controller.abort();
  }, [refresh]);

  return { state, tests, dms, groupDms, connected, refresh };
}
