import type { ApiRoute, RouteModule } from './routes.js';
import { BadRequest, type Json, type Store } from './store.js';

/** Discord の公開ドキュメントのステータス。 */
const STATUSES = ['online', 'dnd', 'idle', 'invisible', 'offline'];
const ErrorCode = { invalidForm: 50035 };

/** Bot とダミーユーザーのプレゼンス。 */
export class Presences implements RouteModule {
  constructor(private readonly store: Store) {}

  routes(_api: ApiRoute): void {}

  mockRoutes(mock: ApiRoute): void {
    // 画面とテストから、ダミーユーザーのステータスやアクティビティを変える。
    mock('PUT', '/users/:id/presence', ({ params, body }) => {
      this.updatePresence(params.id!, body);
      return this.store.state.presences[params.id!];
    });
  }

  /** プレゼンスを記録し、ユーザーがメンバーのサーバーごとに `PRESENCE_UPDATE` を配信する。`invisible` は他の人には `offline` に見える。 */
  updatePresence(userId: string, input: Json): void {
    const { store } = this;
    const user = store.requireUser(userId);
    const status = String(input.status ?? 'online');
    if (!STATUSES.includes(status)) throw new BadRequest(`status は ${STATUSES.join('、')} のいずれかで指定してください`, ErrorCode.invalidForm);
    const visible = status === 'invisible' ? 'offline' : status;
    const presence = {
      user: { id: user.id },
      status: visible,
      activities: (input.activities ?? []) as Json[],
      client_status: visible === 'offline' ? {} : { desktop: visible },
    };
    store.state.presences[userId] = presence;
    store.changed();
    for (const guild of Object.values(store.state.guilds)) {
      if (guild.members[userId]) store.emit('dispatch', 'PRESENCE_UPDATE', { ...presence, guild_id: guild.id });
    }
  }
}
