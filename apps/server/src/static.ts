import { createReadStream, existsSync, statSync } from 'node:fs';
import type { ServerResponse } from 'node:http';
import { extname, join, normalize, sep } from 'node:path';

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

function resolveFile(root: string, path: string): string | undefined {
  const target = normalize(join(root, decodeURIComponent(path)));
  if (target !== root && !target.startsWith(root + sep)) return undefined;
  return existsSync(target) && statSync(target).isFile() ? target : undefined;
}

/** Web UI のビルド結果を配信する。パスがなければ `index.html` を返す。 */
export function serveStatic(root: string, path: string, res: ServerResponse): void {
  const file = resolveFile(root, path) ?? resolveFile(root, '/index.html');
  if (!file) {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('Web UI がビルドされていません。`pnpm build` を実行してください');
    return;
  }
  res.writeHead(200, {
    ...SECURITY_HEADERS,
    'content-type': CONTENT_TYPES[extname(file)] ?? 'application/octet-stream',
  });
  createReadStream(file).pipe(res);
}
