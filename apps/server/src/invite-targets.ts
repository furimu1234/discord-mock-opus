import { NO_CONTENT, Binary, type ApiRoute, type RouteModule } from './routes.js';
import { BadRequest, type Json, type Store } from './store.js';
import type { Integrations } from './integrations.js';

/** Discord の公開ドキュメントの上限と値。 */
const MAX_BULK_USERS = 1000;
const JobStatus = { completed: 2 } as const;
const SNOWFLAKE = /^\d{17,20}$/;
const ErrorCode = { invalidForm: 50035 };

/** 招待を使えるユーザーの指定。Mock は CSV を同期的に処理するので、ジョブはすぐ完了する。 */
export class InviteTargets implements RouteModule {
  /** 招待のコードごとの、最後のジョブ。 */
  private readonly jobs = new Map<string, Json>();

  constructor(
    private readonly store: Store,
    private readonly integrations: Integrations,
  ) {}

  routes(api: ApiRoute): void {
    api('GET', '/invites/:code/target-users/job-status', ({ params }) => {
      this.integrations.requireInvite(params.code!);
      return this.jobs.get(params.code!) ?? { status: 0, total_users: 0, processed_users: 0, created_at: null, completed_at: null, error_message: null };
    });
    api('GET', '/invites/:code/target-users', ({ params }) =>
      new Binary('text/csv', Buffer.from(['user_id', ...this.targets(params.code!)].join('\n'))),
    );
    // CSV のファイルで、対象のユーザーをまとめて置き換える。
    api('PUT', '/invites/:code/target-users', ({ params, body }) => {
      const file = (body.uploads as { data: Buffer }[] | undefined)?.[0];
      if (!file) throw new BadRequest('target_users_file を指定してください', ErrorCode.invalidForm);
      this.replace(params.code!, this.parseCsv(file.data.toString('utf8')));
      return NO_CONTENT;
    });
    api('POST', '/invites/:code/target-users/bulk-add', ({ params, body }) => {
      this.replace(params.code!, [...this.targets(params.code!), ...this.userIds(body.user_ids)]);
      return NO_CONTENT;
    });
    api('POST', '/invites/:code/target-users/bulk-delete', ({ params, body }) => {
      const removed = new Set(this.userIds(body.user_ids));
      this.replace(params.code!, this.targets(params.code!).filter((id) => !removed.has(id)));
      return NO_CONTENT;
    });
    api('PUT', '/invites/:code/target-users/:user', ({ params }) => {
      this.replace(params.code!, [...this.targets(params.code!), params.user!]);
      return NO_CONTENT;
    });
    api('DELETE', '/invites/:code/target-users/:user', ({ params }) => {
      this.replace(params.code!, this.targets(params.code!).filter((id) => id !== params.user));
      return NO_CONTENT;
    });
  }

  private targets(code: string): string[] {
    this.integrations.requireInvite(code);
    return this.store.state.inviteTargets[code] ?? [];
  }

  private userIds(value: unknown): string[] {
    if (!Array.isArray(value) || value.length > MAX_BULK_USERS) {
      throw new BadRequest(`user_ids は ${MAX_BULK_USERS} 件までの配列で指定してください`, ErrorCode.invalidForm);
    }
    return value.map(String);
  }

  /** 1 列目にユーザーの ID が並ぶ CSV。見出しの行はあってもなくてもよい。 */
  private parseCsv(text: string): string[] {
    const lines = text.split(/\r?\n/).map((line) => line.split(',')[0]!.trim()).filter(Boolean);
    const ids = lines[0] === 'user_id' ? lines.slice(1) : lines;
    const invalid = ids.map((id, index) => ({ id, line: index + 1 })).filter(({ id }) => !SNOWFLAKE.test(id));
    if (invalid.length > 0) {
      throw new BadRequest(invalid.map(({ line }) => `Line ${line}: invalid user ID - must be a valid Discord snowflake`).join('\n'), ErrorCode.invalidForm);
    }
    return ids;
  }

  private replace(code: string, ids: string[]): void {
    const unique = [...new Set(ids)];
    this.store.state.inviteTargets[code] = unique;
    const now = new Date().toISOString();
    this.jobs.set(code, { status: JobStatus.completed, total_users: unique.length, processed_users: unique.length, created_at: now, completed_at: now, error_message: null });
    this.store.changed();
  }
}
