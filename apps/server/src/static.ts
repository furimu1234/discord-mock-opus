import { existsSync, readFileSync, statSync } from 'node:fs';
import type { ServerResponse } from 'node:http';
import { extname, join, posix } from 'node:path';

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json',
};

// 外部の CDN には接続しない。Bot の投稿もすべて同一オリジンの画面内で描画する。
const SECURITY_HEADERS = {
  'content-security-policy':
    "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
  'referrer-policy': 'no-referrer',
  'x-content-type-options': 'nosniff',
};

/**
 * Web UI のビルド結果を読む。`path` は `/` から始まる、`..` を含まないパス。ファイルがなければ `undefined`。
 * ディレクトリのほか、単一実行ファイルに埋め込んだファイルからも読めるようにするため、関数で受け取る。
 */
export type WebFiles = (path: string) => Buffer | undefined;

/** ディレクトリに置いた Web UI のビルド結果。 */
export function webDirectory(root: string): WebFiles {
  return (path) => {
    const target = join(root, path);
    return existsSync(target) && statSync(target).isFile() ? readFileSync(target) : undefined;
  };
}

/** URL のパスを、`/` 区切りの絶対パスにする。`..` はルートより上に出ないので、ルートの外は読めない。 */
const safePath = (path: string) => posix.normalize(`/${decodeURIComponent(path).replaceAll('\\', '/')}`);

/** Web UI のビルド結果を配信する。パスがなければ `index.html` を返す。 */
export function serveStatic(files: WebFiles, path: string, res: ServerResponse): void {
  const requested = safePath(path);
  const found = requested === '/' ? undefined : files(requested);
  const file = found ? requested : '/index.html';
  const body = found ?? files(file);
  if (!body) {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('Web UI がビルドされていません。`pnpm build` を実行してください');
    return;
  }
  res.writeHead(200, {
    ...SECURITY_HEADERS,
    'content-type': CONTENT_TYPES[extname(file)] ?? 'application/octet-stream',
  });
  res.end(body);
}
