import type { IncomingHttpHeaders } from 'node:http';
import type { Json } from './store.js';

export interface Context {
  params: Record<string, string>;
  query: URLSearchParams;
  body: Json;
  headers: IncomingHttpHeaders;
}

export type Handler = (ctx: Context) => unknown;

/** `/api/v10` または `/api/mock` にルートを登録する。 */
export type ApiRoute = (method: string, path: string, handler: Handler) => void;

/** 本文のない 204 の応答。 */
export const NO_CONTENT = Symbol('no-content');

/** JSON ではない応答（ウィジェットの画像など）。 */
export class Binary {
  constructor(
    readonly contentType: string,
    readonly data: Buffer,
  ) {}
}

/** Discord の API のルートを持つモジュール。具体的なパスのルートを、`:id` で受けるルートより先に登録する。 */
export interface RouteModule {
  routes(api: ApiRoute): void;
  /** 画面とテストの SDK が使う `/api/mock` のルート。 */
  mockRoutes?(mock: ApiRoute): void;
}
