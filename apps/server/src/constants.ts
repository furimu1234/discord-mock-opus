export const DEFAULT_HOST = '127.0.0.1';
export const DEFAULT_PORT = 6470;

/**
 * 既定のダミーユーザー。テストの `users` で指定できるよう ID を固定する。
 * `alice` は管理者、`bob` は権限のないユーザー。
 */
export const DEFAULT_USERS = [
  { id: '1000000000000000101', username: 'alice' },
  { id: '1000000000000000102', username: 'bob' },
] as const;
