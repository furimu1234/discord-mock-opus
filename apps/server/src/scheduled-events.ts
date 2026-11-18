import { AuditLogEvent, ChannelType } from './constants.js';
import { NO_CONTENT, type ApiRoute, type RouteModule } from './routes.js';
import { auditChanges, BadRequest, NotFound, snowflake, type Json, type Store } from './store.js';

/** Discord の公開ドキュメントの値。 */
export const EventStatus = { scheduled: 1, active: 2, completed: 3, canceled: 4 } as const;
export const EventEntityType = { stageInstance: 1, voice: 2, external: 3 } as const;
const GUILD_ONLY = 2;
const DEFAULT_USER_LIMIT = 100;
const MAX_USER_LIMIT = 100;
const EVENT_FIELDS = [
  'channel_id', 'entity_metadata', 'name', 'privacy_level', 'scheduled_start_time', 'scheduled_end_time', 'description', 'entity_type', 'status', 'recurrence_rule',
];
/** 状態の変更として許される組み合わせ。 */
const TRANSITIONS: Record<number, number[]> = {
  [EventStatus.scheduled]: [EventStatus.active, EventStatus.canceled],
  [EventStatus.active]: [EventStatus.completed],
};
const ErrorCode = { unknownEvent: 10070, invalidForm: 50035 };

/** サーバーのイベントと、興味ありのユーザー。 */
export class ScheduledEvents implements RouteModule {
  constructor(private readonly store: Store) {
    store.on('guild-cleared', (guildId: string) => {
      for (const event of this.list(guildId)) this.remove(event);
    });
  }

  private dispatch(event: string, data: Json): void {
    this.store.emit('dispatch', event, data);
  }

  routes(api: ApiRoute): void {
    api('GET', '/guilds/:guild/scheduled-events', ({ params, query }) =>
      this.list(params.guild!).map((event) => this.payload(event, query.get('with_user_count') === 'true')),
    );
    api('POST', '/guilds/:guild/scheduled-events', ({ params, body }) => this.create(params.guild!, body));
    api('GET', '/guilds/:guild/scheduled-events/:event/users', ({ params, query }) => this.users(params.guild!, params.event!, query));
    api('GET', '/guilds/:guild/scheduled-events/:event', ({ params, query }) =>
      this.payload(this.require(params.guild!, params.event!), query.get('with_user_count') === 'true'),
    );
    api('PATCH', '/guilds/:guild/scheduled-events/:event', ({ params, body }) => this.update(params.guild!, params.event!, body));
    api('DELETE', '/guilds/:guild/scheduled-events/:event', ({ params }) => {
      const event = this.require(params.guild!, params.event!);
      this.remove(event);
      this.store.audit(event.guild_id, AuditLogEvent.guildScheduledEventDelete, event.id, auditChanges(event, {}, EVENT_FIELDS));
      return NO_CONTENT;
    });
  }

  mockRoutes(mock: ApiRoute): void {
    // 画面とテストのユーザーが、イベントに「興味あり」を付ける、外す。
    mock('PUT', '/guilds/:guild/scheduled-events/:event/users/:user', ({ params }) => {
      this.subscribe(params.guild!, params.event!, params.user!);
      return { ok: true };
    });
    mock('DELETE', '/guilds/:guild/scheduled-events/:event/users/:user', ({ params }) => {
      this.unsubscribe(params.guild!, params.event!, params.user!);
      return { ok: true };
    });
  }

  list(guildId: string): Json[] {
    this.store.requireGuild(guildId);
    return Object.values(this.store.state.scheduledEvents).filter((event) => event.guild_id === guildId);
  }

  require(guildId: string, eventId: string): Json {
    const event = this.store.state.scheduledEvents[eventId];
    if (!event || event.guild_id !== guildId) throw new NotFound('Unknown Guild Scheduled Event', ErrorCode.unknownEvent);
    return event;
  }

  private payload(event: Json, withUserCount = false): Json {
    return withUserCount ? { ...event, user_count: this.store.state.scheduledEventUsers[event.id]?.length ?? 0 } : event;
  }

  /** 開催場所の指定を確かめる。外部のイベントは場所と終了時刻が要り、ボイスとステージはそのチャンネルが要る。 */
  private validate(guildId: string, event: Json): void {
    if (!event.name) throw new BadRequest('name を指定してください', ErrorCode.invalidForm);
    if (!event.scheduled_start_time) throw new BadRequest('scheduled_start_time を指定してください', ErrorCode.invalidForm);
    if (event.entity_type === EventEntityType.external) {
      if (!event.entity_metadata?.location) throw new BadRequest('entity_metadata.location を指定してください', ErrorCode.invalidForm);
      if (!event.scheduled_end_time) throw new BadRequest('scheduled_end_time を指定してください', ErrorCode.invalidForm);
      if (event.channel_id) throw new BadRequest('外部のイベントに channel_id は指定できません', ErrorCode.invalidForm);
      return;
    }
    const expected = event.entity_type === EventEntityType.stageInstance ? ChannelType.stage : ChannelType.voice;
    const channel = this.store.requireChannel(String(event.channel_id ?? ''));
    if (channel.guild_id !== guildId || channel.type !== expected) throw new BadRequest('channel_id の種類が entity_type と合いません', ErrorCode.invalidForm);
  }

  create(guildId: string, body: Json): Json {
    const { store } = this;
    store.requireGuild(guildId);
    const creator = store.state.users[store.actor?.userId ?? store.state.botUserId]!;
    const event: Json = {
      id: snowflake(),
      guild_id: guildId,
      channel_id: body.channel_id ?? null,
      creator_id: creator.id,
      name: body.name,
      description: body.description ?? null,
      scheduled_start_time: body.scheduled_start_time,
      scheduled_end_time: body.scheduled_end_time ?? null,
      privacy_level: body.privacy_level ?? GUILD_ONLY,
      status: EventStatus.scheduled,
      entity_type: body.entity_type,
      entity_id: null,
      entity_metadata: body.entity_metadata ?? null,
      creator,
      image: body.image ? store.storeImage(body.image) : null,
      recurrence_rule: body.recurrence_rule ?? null,
    };
    this.validate(guildId, event);
    store.state.scheduledEvents[event.id] = event;
    store.changed();
    this.dispatch('GUILD_SCHEDULED_EVENT_CREATE', event);
    store.audit(guildId, AuditLogEvent.guildScheduledEventCreate, event.id, auditChanges({}, event, EVENT_FIELDS));
    return event;
  }

  update(guildId: string, eventId: string, body: Json): Json {
    const { store } = this;
    const event = this.require(guildId, eventId);
    const before = structuredClone(event);
    if (body.status !== undefined && body.status !== event.status && !TRANSITIONS[event.status]?.includes(body.status)) {
      throw new BadRequest('この状態には変更できません', ErrorCode.invalidForm);
    }
    const next = { ...event };
    for (const key of EVENT_FIELDS) {
      if (body[key] !== undefined) next[key] = body[key];
    }
    // 外部のイベントに変えるときは、チャンネルを外す。
    if (body.entity_type === EventEntityType.external && body.channel_id === undefined) next.channel_id = null;
    this.validate(guildId, next);
    if (body.image !== undefined) next.image = store.storeImage(body.image);
    Object.assign(event, next);
    store.changed();
    this.dispatch('GUILD_SCHEDULED_EVENT_UPDATE', event);
    store.audit(guildId, AuditLogEvent.guildScheduledEventUpdate, eventId, auditChanges(before, event, EVENT_FIELDS));
    // 終了と中止のイベントは一覧に残らない。
    if (event.status === EventStatus.completed || event.status === EventStatus.canceled) this.remove(event, false);
    return event;
  }

  private remove(event: Json, notify = true): void {
    delete this.store.state.scheduledEvents[event.id];
    delete this.store.state.scheduledEventUsers[event.id];
    this.store.changed();
    if (notify) this.dispatch('GUILD_SCHEDULED_EVENT_DELETE', event);
  }

  users(guildId: string, eventId: string, query: URLSearchParams): Json[] {
    const { store } = this;
    this.require(guildId, eventId);
    const before = query.get('before');
    const after = query.get('after');
    const limit = Math.min(Number(query.get('limit') ?? DEFAULT_USER_LIMIT), MAX_USER_LIMIT);
    const withMember = query.get('with_member') === 'true';
    const guild = store.requireGuild(guildId);
    return (store.state.scheduledEventUsers[eventId] ?? [])
      .filter((id) => (!before || BigInt(id) < BigInt(before)) && (!after || BigInt(id) > BigInt(after)))
      .sort((a, b) => (BigInt(a) < BigInt(b) ? -1 : 1))
      .slice(0, limit)
      .map((id) => {
        const member = guild.members[id];
        const { user: _user, ...partial } = member ?? {};
        return { guild_scheduled_event_id: eventId, user: store.requireUser(id), ...(withMember && member ? { member: partial } : {}) };
      });
  }

  subscribe(guildId: string, eventId: string, userId: string): void {
    this.require(guildId, eventId);
    this.store.requireMember(guildId, userId);
    const users = (this.store.state.scheduledEventUsers[eventId] ??= []);
    if (users.includes(userId)) return;
    users.push(userId);
    this.store.changed();
    this.dispatch('GUILD_SCHEDULED_EVENT_USER_ADD', { guild_scheduled_event_id: eventId, user_id: userId, guild_id: guildId });
  }

  unsubscribe(guildId: string, eventId: string, userId: string): void {
    this.require(guildId, eventId);
    const users = this.store.state.scheduledEventUsers[eventId] ?? [];
    if (!users.includes(userId)) return;
    this.store.state.scheduledEventUsers[eventId] = users.filter((id) => id !== userId);
    this.store.changed();
    this.dispatch('GUILD_SCHEDULED_EVENT_USER_REMOVE', { guild_scheduled_event_id: eventId, user_id: userId, guild_id: guildId });
  }
}
