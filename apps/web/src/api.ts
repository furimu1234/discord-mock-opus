import { useCallback, useEffect, useRef, useState } from 'react';

export type Json = Record<string, any>;

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

async function request<T = any>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`/api/mock${path}`, {
    ...init,
    headers: { ...init.headers, authorization: `Bot ${token}` },
  });
  const data = (await response.json().catch(() => ({}))) as T & { message?: string };
  if (!response.ok) throw new Error(data.message ?? response.statusText);
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

async function streamEvents(signal: AbortSignal, onEvent: (type: string) => void): Promise<void> {
  const response = await fetch('/api/mock/events', { signal, headers: { authorization: `Bot ${token}` } });
  let buffer = '';
  for await (const chunk of response.body!.pipeThrough(new TextDecoderStream()) as unknown as AsyncIterable<string>) {
    buffer += chunk;
    const events = buffer.split('\n\n');
    buffer = events.pop() ?? '';
    for (const event of events) {
      if (event.startsWith('data: ')) onEvent((JSON.parse(event.slice(6)) as { type: string }).type);
    }
  }
}

export interface MockData {
  state: Json | null;
  tests: Json | null;
  dms: Json[];
  connected: boolean;
  refresh: () => void;
}

/** イベントを受け取るたびに状態を取り直す。テスト実行中の連続した更新はまとめる。 */
export function useMockData(): MockData {
  const [state, setState] = useState<Json | null>(null);
  const [tests, setTests] = useState<Json | null>(null);
  const [dms, setDms] = useState<Json[]>([]);
  const [connected, setConnected] = useState(false);
  const timer = useRef<number | undefined>(undefined);

  const load = useCallback(async () => {
    const [nextState, nextTests, nextDms] = await Promise.all([api.get('/state'), api.get('/tests'), api.get('/dms')]);
    setState(nextState);
    setTests(nextTests);
    setDms(nextDms);
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
          await streamEvents(controller.signal, refresh);
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

  return { state, tests, dms, connected, refresh };
}
