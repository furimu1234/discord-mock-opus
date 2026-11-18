import { VOICE_REGIONS } from './guild-actions.js';
import { NO_CONTENT, type ApiRoute, type RouteModule } from './routes.js';
import { BadRequest, NotFound, snowflake, type Json, type Store } from './store.js';

/** Discord の公開ドキュメントの既定値と上限。 */
const DEFAULT_GUILD_LIMIT = 200;
const MAX_APPLICATION_EMOJIS = 2000;
const MAX_ROLE_CONNECTION_METADATA = 5;
const MAX_EMOJI_BYTES = 256 * 1024;
const EMOJI_NAME = /^[\w]{2,32}$/;
const APPLICATION_FIELDS = [
  'description', 'interactions_endpoint_url', 'role_connections_verification_url', 'install_params', 'integration_types_config',
  'flags', 'tags', 'custom_install_url', 'event_webhooks_url', 'event_webhooks_status', 'event_webhooks_types',
];
const ErrorCode = { unknownEmoji: 10014, unknownVoiceState: 10065, invalidForm: 50035, maxEmojis: 30008 };

const dataSize = (data: string) => Buffer.byteLength(data.slice(data.indexOf(',') + 1), 'base64');

/** Bot のユーザー、アプリケーション、アプリケーションの絵文字、ロール連携、スタンプパック、ボイス、アクティビティ。 */
export class ApplicationActions implements RouteModule {
  /** インスタンスの ID ごとの、起動中のアクティビティ。画面やテストから登録する。 */
  private readonly activities = new Map<string, Json>();

  constructor(private readonly store: Store) {}

  private dispatch(event: string, data: Json): void {
    this.store.emit('dispatch', event, data);
  }

  routes(api: ApiRoute): void {
    const { store } = this;
    const bot = () => store.state.botUserId;
    api('PATCH', '/users/@me', ({ body }) => this.updateCurrentUser(body));
    api('GET', '/users/@me/guilds', ({ query }) => this.currentUserGuilds(query));
    api('GET', '/users/@me/guilds/:guild/member', ({ params }) => store.requireMember(params.guild!, bot()));
    api('DELETE', '/users/@me/guilds/:guild', ({ params }) => {
      const guild = store.requireGuild(params.guild!);
      if (guild.owner_id === bot()) throw new BadRequest('サーバーの所有者は退出できません');
      store.removeMember(params.guild!, bot());
      this.dispatch('GUILD_DELETE', { id: params.guild!, unavailable: false });
      return NO_CONTENT;
    });
    // Mock の Bot には外部サービスの接続がない。
    api('GET', '/users/@me/connections', () => []);
    api('GET', '/users/@me/applications/:app/role-connection', ({ params }) => this.roleConnection(params.app!));
    api('PUT', '/users/@me/applications/:app/role-connection', ({ params, body }) => this.updateRoleConnection(params.app!, body));
    api('DELETE', '/users/@me/applications/:app/role-connection', ({ params }) => {
      delete store.state.roleConnections[params.app!];
      store.changed();
      return NO_CONTENT;
    });

    api('GET', '/applications/@me', () => this.application());
    api('PATCH', '/applications/@me', ({ body }) => this.updateApplication(body));
    api('GET', '/applications/:app/activity-instances/:instance', ({ params }) => {
      const instance = this.activities.get(params.instance!);
      if (!instance) throw new NotFound('Unknown Activity Instance');
      return instance;
    });
    api('GET', '/applications/:app/role-connections/metadata', () => store.state.roleConnectionMetadata);
    api('PUT', '/applications/:app/role-connections/metadata', ({ body }) => {
      if (!Array.isArray(body) || body.length > MAX_ROLE_CONNECTION_METADATA) {
        throw new BadRequest(`メタデータは ${MAX_ROLE_CONNECTION_METADATA} 件までの配列で指定してください`, ErrorCode.invalidForm);
      }
      store.state.roleConnectionMetadata = body;
      store.changed();
      return body;
    });

    api('GET', '/applications/:app/emojis', () => ({ items: store.state.applicationEmojis }));
    api('GET', '/applications/:app/emojis/:emoji', ({ params }) => this.requireEmoji(params.emoji!));
    api('POST', '/applications/:app/emojis', ({ body }) => this.createEmoji(body));
    api('PATCH', '/applications/:app/emojis/:emoji', ({ params, body }) => {
      const emoji = this.requireEmoji(params.emoji!);
      if (body.name !== undefined) emoji.name = this.emojiName(body.name);
      store.changed();
      return emoji;
    });
    api('DELETE', '/applications/:app/emojis/:emoji', ({ params }) => {
      this.requireEmoji(params.emoji!);
      store.state.applicationEmojis = store.state.applicationEmojis.filter((emoji) => emoji.id !== params.emoji);
      delete store.state.media[params.emoji!];
      store.changed();
      return NO_CONTENT;
    });

    // Mock には Discord のスタンプパックがない。
    api('GET', '/sticker-packs', () => ({ sticker_packs: [] }));
    api('GET', '/sticker-packs/:pack', () => {
      throw new NotFound('Unknown Sticker Pack');
    });

    api('GET', '/voice/regions', () => VOICE_REGIONS);
    api('GET', '/guilds/:guild/voice-states/@me', ({ params }) => this.voiceState(params.guild!, bot()));
    api('GET', '/guilds/:guild/voice-states/:user', ({ params }) => this.voiceState(params.guild!, params.user!));
  }

  mockRoutes(mock: ApiRoute): void {
    // ボイスチャンネルでアクティビティを起動したことにする。
    mock('POST', '/activity-instances', ({ body }) => {
      const channel = this.store.requireChannel(body.channelId);
      const instance = {
        application_id: this.store.state.applicationId,
        instance_id: snowflake(),
        launch_id: snowflake(),
        location: { id: snowflake(), kind: channel.guild_id ? 'gc' : 'pc', channel_id: channel.id, ...(channel.guild_id ? { guild_id: channel.guild_id } : {}) },
        users: (body.userIds ?? []) as string[],
      };
      this.activities.set(instance.instance_id, instance);
      return instance;
    });
  }

  application(): Json {
    const { store } = this;
    return {
      id: store.state.applicationId,
      name: store.botUser.username,
      icon: null,
      description: '',
      bot_public: true,
      bot_require_code_grant: false,
      verify_key: '',
      flags: 0,
      tags: [],
      bot: store.botUser,
      approximate_guild_count: Object.keys(store.state.guilds).length,
      ...store.state.application,
    };
  }

  updateApplication(body: Json): Json {
    const { store } = this;
    for (const key of APPLICATION_FIELDS) {
      if (body[key] !== undefined) store.state.application[key] = body[key];
    }
    for (const key of ['icon', 'cover_image'] as const) {
      if (body[key] !== undefined) store.state.application[key] = store.storeImage(body[key]);
    }
    store.changed();
    return this.application();
  }

  /** Bot の名前とアバターを変える。連携の名前も Bot の名前なので、`INTEGRATION_UPDATE` も配信する。 */
  updateCurrentUser(body: Json): Json {
    const { store } = this;
    const patch: Json = {};
    if (body.username !== undefined) patch.username = body.username;
    if (body.avatar !== undefined) patch.avatar = store.storeImage(body.avatar);
    const user = store.updateUser(store.state.botUserId, patch);
    if (body.banner !== undefined) user.banner = store.storeImage(body.banner);
    this.dispatch('USER_UPDATE', user);
    for (const guildId of Object.keys(store.state.guilds)) {
      this.dispatch('INTEGRATION_UPDATE', {
        id: store.state.applicationId,
        name: user.username,
        type: 'discord',
        enabled: true,
        account: { id: user.id, name: user.username },
        guild_id: guildId,
      });
    }
    return user;
  }

  currentUserGuilds(query: URLSearchParams): Json[] {
    const { store } = this;
    const before = query.get('before');
    const after = query.get('after');
    const limit = Number(query.get('limit') ?? DEFAULT_GUILD_LIMIT);
    const withCounts = query.get('with_counts') === 'true';
    return Object.values(store.state.guilds)
      .filter((guild) => guild.members[store.state.botUserId])
      .filter((guild) => (!before || BigInt(guild.id) < BigInt(before)) && (!after || BigInt(guild.id) > BigInt(after)))
      .sort((a, b) => (BigInt(a.id) < BigInt(b.id) ? -1 : 1))
      .slice(0, limit)
      .map((guild) => ({
        id: guild.id,
        name: guild.name,
        icon: guild.icon ?? null,
        banner: null,
        owner: guild.owner_id === store.state.botUserId,
        permissions: store.memberPermissions(guild.id, store.state.botUserId),
        features: store.guildPayload(guild).features,
        ...(withCounts ? { approximate_member_count: Object.keys(guild.members).length, approximate_presence_count: Object.keys(guild.members).length } : {}),
      }));
  }

  roleConnection(applicationId: string): Json {
    return this.store.state.roleConnections[applicationId] ?? { platform_name: null, platform_username: null, metadata: {} };
  }

  updateRoleConnection(applicationId: string, body: Json): Json {
    const connection = { ...this.roleConnection(applicationId) };
    for (const key of ['platform_name', 'platform_username', 'metadata']) {
      if (body[key] !== undefined) connection[key] = body[key];
    }
    this.store.state.roleConnections[applicationId] = connection;
    this.store.changed();
    return connection;
  }

  private emojiName(name: unknown): string {
    if (!EMOJI_NAME.test(String(name ?? ''))) throw new BadRequest('名前は 2〜32 文字の英数字と _ で指定してください', ErrorCode.invalidForm);
    return String(name);
  }

  requireEmoji(emojiId: string): Json {
    const emoji = this.store.state.applicationEmojis.find((candidate) => candidate.id === emojiId);
    if (!emoji) throw new NotFound('Unknown Emoji', ErrorCode.unknownEmoji);
    return emoji;
  }

  createEmoji(body: Json): Json {
    const { store } = this;
    if (store.state.applicationEmojis.length >= MAX_APPLICATION_EMOJIS) throw new BadRequest('絵文字の上限に達しています', ErrorCode.maxEmojis);
    const name = this.emojiName(body.name);
    if (typeof body.image !== 'string' || !body.image.startsWith('data:image/') || dataSize(body.image) > MAX_EMOJI_BYTES) {
      throw new BadRequest('画像は 256KB 以下の data URI で指定してください', ErrorCode.invalidForm);
    }
    const id = snowflake();
    store.state.media[id] = body.image;
    const emoji = { id, name, roles: [], user: store.botUser, require_colons: true, managed: false, animated: body.image.startsWith('data:image/gif'), available: true };
    store.state.applicationEmojis.push(emoji);
    store.changed();
    return emoji;
  }

  voiceState(guildId: string, userId: string): Json {
    this.store.requireGuild(guildId);
    const state = this.store.state.voiceStates[`${guildId}:${userId}`];
    if (!state) throw new NotFound('Unknown Voice State', ErrorCode.unknownVoiceState);
    return state;
  }
}
