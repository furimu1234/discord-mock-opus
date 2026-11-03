import { AuditLogEvent } from './constants.js';
import { NO_CONTENT, type ApiRoute, type RouteModule } from './routes.js';
import { BadRequest, NotFound, type Json, type Store } from './store.js';

/** Discord の公開ドキュメントの上限。 */
const MAX_PINS = 50;
const BULK_DELETE_MIN = 2;
const BULK_DELETE_MAX = 100;
const BULK_DELETE_MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;
const DEFAULT_REACTION_LIMIT = 25;
const DEFAULT_PIN_LIMIT = 50;
const DEFAULT_SEARCH_LIMIT = 25;
const CHANNEL_PINNED_MESSAGE = 6;
const ErrorCode = { maxPins: 30003, tooOldToBulkDelete: 50034, invalidForm: 50035, unknownMessage: 10008 };

const DISCORD_EPOCH = 1420070400000n;
const snowflakeTime = (id: string) => Number((BigInt(id) >> 22n) + DISCORD_EPOCH);

/** リアクション、ピン留め、メッセージの一括削除と検索。 */
export class MessageActions implements RouteModule {
  constructor(private readonly store: Store) {}

  private dispatch(event: string, data: Json): void {
    this.store.emit('dispatch', event, data);
  }

  routes(api: ApiRoute): void {
    const { store } = this;
    const bot = () => store.state.botUserId;
    api('GET', '/guilds/:guild/messages/search', ({ params, query }) => this.search(params.guild!, query));
    api('POST', '/channels/:channel/messages/bulk-delete', ({ params, body }) => {
      this.bulkDelete(params.channel!, body.messages);
      return NO_CONTENT;
    });

    api('GET', '/channels/:channel/messages/pins', ({ params, query }) => this.pins(params.channel!, query));
    api('PUT', '/channels/:channel/messages/pins/:message', ({ params }) => {
      this.pin(params.channel!, params.message!);
      return NO_CONTENT;
    });
    api('DELETE', '/channels/:channel/messages/pins/:message', ({ params }) => {
      this.unpin(params.channel!, params.message!);
      return NO_CONTENT;
    });
    // 非推奨の古いパス。
    api('GET', '/channels/:channel/pins', ({ params }) =>
      (this.pins(params.channel!, new URLSearchParams()).items as Json[]).map((item) => item.message),
    );
    api('PUT', '/channels/:channel/pins/:message', ({ params }) => {
      this.pin(params.channel!, params.message!);
      return NO_CONTENT;
    });
    api('DELETE', '/channels/:channel/pins/:message', ({ params }) => {
      this.unpin(params.channel!, params.message!);
      return NO_CONTENT;
    });

    const emoji = (params: Record<string, string>) => decodeURIComponent(params.emoji!);
    api('DELETE', '/channels/:channel/messages/:message/reactions/:emoji/@me', ({ params }) => {
      store.removeReaction(params.channel!, params.message!, bot(), emoji(params));
      return NO_CONTENT;
    });
    api('DELETE', '/channels/:channel/messages/:message/reactions/:emoji/:user', ({ params }) => {
      store.removeReaction(params.channel!, params.message!, params.user!, emoji(params));
      return NO_CONTENT;
    });
    api('GET', '/channels/:channel/messages/:message/reactions/:emoji', ({ params, query }) =>
      this.reactionUsers(params.channel!, params.message!, emoji(params), query),
    );
    api('DELETE', '/channels/:channel/messages/:message/reactions/:emoji', ({ params }) => {
      store.removeAllReactions(params.channel!, params.message!, emoji(params));
      return NO_CONTENT;
    });
    api('DELETE', '/channels/:channel/messages/:message/reactions', ({ params }) => {
      store.removeAllReactions(params.channel!, params.message!);
      return NO_CONTENT;
    });
  }

  /** リアクションを付けたユーザー。`after` より後の ID を、ID の順に返す。 */
  reactionUsers(channelId: string, messageId: string, emoji: string, query: URLSearchParams): Json[] {
    const after = query.get('after');
    const limit = Number(query.get('limit') ?? DEFAULT_REACTION_LIMIT);
    return this.store
      .reactionUserIds(channelId, messageId, emoji)
      .filter((id) => !after || BigInt(id) > BigInt(after))
      .sort((a, b) => (BigInt(a) < BigInt(b) ? -1 : 1))
      .slice(0, limit)
      .map((id) => this.store.requireUser(id));
  }

  bulkDelete(channelId: string, ids: unknown): void {
    if (!Array.isArray(ids) || ids.length < BULK_DELETE_MIN || ids.length > BULK_DELETE_MAX) {
      throw new BadRequest(`messages は ${BULK_DELETE_MIN}〜${BULK_DELETE_MAX} 件で指定してください`, ErrorCode.invalidForm);
    }
    const unique = [...new Set(ids.map(String))];
    if (unique.some((id) => Date.now() - snowflakeTime(id) > BULK_DELETE_MAX_AGE_MS)) {
      throw new BadRequest('14 日より前のメッセージは一括で削除できません', ErrorCode.tooOldToBulkDelete);
    }
    this.store.deleteMessages(channelId, unique);
  }

  pins(channelId: string, query: URLSearchParams): Json {
    this.store.requireChannel(channelId);
    const before = query.get('before');
    const limit = Number(query.get('limit') ?? DEFAULT_PIN_LIMIT);
    const pins = (this.store.state.pins[channelId] ?? []).filter((pin) => !before || pin.pinned_at < before);
    return {
      items: pins.slice(0, limit).map((pin) => ({ pinned_at: pin.pinned_at, message: this.store.findMessage(channelId, pin.message_id) })),
      has_more: pins.length > limit,
    };
  }

  pin(channelId: string, messageId: string): void {
    const { store } = this;
    const message = store.findMessage(channelId, messageId);
    if (message.pinned) return;
    const pins = (store.state.pins[channelId] ??= []);
    if (pins.length >= MAX_PINS) throw new BadRequest('ピン留めの上限に達しています', ErrorCode.maxPins);
    const pinnedAt = new Date().toISOString();
    pins.unshift({ message_id: messageId, pinned_at: pinnedAt });
    message.pinned = true;
    this.dispatch('MESSAGE_UPDATE', message);
    this.notifyPins(channelId);
    const actor = store.state.users[store.actor?.userId ?? store.state.botUserId]!;
    store.createMessage(channelId, actor, {}, { type: CHANNEL_PINNED_MESSAGE, message_reference: { message_id: messageId, channel_id: channelId, guild_id: message.guild_id } });
    store.audit(message.guild_id, AuditLogEvent.messagePin, message.author.id, [], { channel_id: channelId, message_id: messageId });
  }

  unpin(channelId: string, messageId: string): void {
    const { store } = this;
    const message = store.findMessage(channelId, messageId);
    if (!message.pinned) throw new NotFound('Unknown Message', ErrorCode.unknownMessage);
    store.state.pins[channelId] = (store.state.pins[channelId] ?? []).filter((pin) => pin.message_id !== messageId);
    message.pinned = false;
    this.dispatch('MESSAGE_UPDATE', message);
    this.notifyPins(channelId);
    store.audit(message.guild_id, AuditLogEvent.messageUnpin, message.author.id, [], { channel_id: channelId, message_id: messageId });
  }

  private notifyPins(channelId: string): void {
    const channel = this.store.requireChannel(channelId);
    this.store.changed();
    this.dispatch('CHANNEL_PINS_UPDATE', {
      ...(channel.guild_id ? { guild_id: channel.guild_id } : {}),
      channel_id: channelId,
      last_pin_timestamp: this.store.state.pins[channelId]?.[0]?.pinned_at ?? null,
    });
  }

  /** サーバーのメッセージを検索する。本文の部分一致と、投稿者、チャンネル、メンション、ピン留めで絞り込む。 */
  search(guildId: string, query: URLSearchParams): Json {
    const { store } = this;
    store.requireGuild(guildId);
    const content = query.get('content')?.toLowerCase();
    const authors = query.getAll('author_id');
    const channels = query.getAll('channel_id');
    const mentions = query.getAll('mentions');
    const pinned = query.get('pinned');
    const ascending = query.get('sort_order') === 'asc';
    const limit = Number(query.get('limit') ?? DEFAULT_SEARCH_LIMIT);
    const offset = Number(query.get('offset') ?? 0);
    const matched = Object.values(store.state.channels)
      .filter((channel) => channel.guild_id === guildId && (channels.length === 0 || channels.includes(channel.id)))
      .flatMap((channel) => store.state.messages[channel.id] ?? [])
      .filter((message) => message.dismock_test === undefined)
      .filter((message) => !content || String(message.content).toLowerCase().includes(content))
      .filter((message) => authors.length === 0 || authors.includes(message.author.id))
      .filter((message) => mentions.length === 0 || (message.mentions as Json[]).some((user) => mentions.includes(user.id)))
      .filter((message) => pinned === null || message.pinned === (pinned === 'true'))
      .sort((a, b) => (BigInt(a.id) < BigInt(b.id) ? 1 : -1) * (ascending ? -1 : 1));
    return {
      doing_deep_historical_index: false,
      total_results: matched.length,
      messages: matched.slice(offset, offset + limit).map((message) => [message]),
      threads: [],
      members: [],
    };
  }
}
