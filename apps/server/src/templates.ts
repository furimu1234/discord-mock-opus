import { randomBytes } from 'node:crypto';
import type { ApiRoute, RouteModule } from './routes.js';
import { BadRequest, NotFound, type Json, type Store } from './store.js';

/** Discord の公開ドキュメントの上限。 */
const MAX_TEMPLATES_PER_GUILD = 1;
const MAX_NAME_LENGTH = 100;
const MAX_DESCRIPTION_LENGTH = 120;
const ErrorCode = { unknownTemplate: 10057, maxTemplates: 30031, invalidForm: 50035 };

/** サーバーテンプレート。作成した時点のサーバーの設定、ロール、チャンネルを持つ。 */
export class Templates implements RouteModule {
  constructor(private readonly store: Store) {
    store.on('guild-cleared', (guildId: string) => {
      for (const template of this.list(guildId)) delete store.state.templates[template.code];
    });
  }

  routes(api: ApiRoute): void {
    api('GET', '/guilds/templates/:code', ({ params }) => this.require(params.code!));
    api('GET', '/guilds/:guild/templates', ({ params }) => this.list(params.guild!));
    api('POST', '/guilds/:guild/templates', ({ params, body }) => this.create(params.guild!, body));
    api('PUT', '/guilds/:guild/templates/:code', ({ params }) => this.sync(params.guild!, params.code!));
    api('PATCH', '/guilds/:guild/templates/:code', ({ params, body }) => this.update(params.guild!, params.code!, body));
    api('DELETE', '/guilds/:guild/templates/:code', ({ params }) => {
      const template = this.requireIn(params.guild!, params.code!);
      delete this.store.state.templates[template.code];
      this.store.changed();
      return template;
    });
  }

  list(guildId: string): Json[] {
    this.store.requireGuild(guildId);
    return Object.values(this.store.state.templates).filter((template) => template.source_guild_id === guildId);
  }

  require(code: string): Json {
    const template = this.store.state.templates[code];
    if (!template) throw new NotFound('Unknown Guild Template', ErrorCode.unknownTemplate);
    return template;
  }

  private requireIn(guildId: string, code: string): Json {
    const template = this.require(code);
    if (template.source_guild_id !== guildId) throw new NotFound('Unknown Guild Template', ErrorCode.unknownTemplate);
    return template;
  }

  private checkFields(body: Json): void {
    if (body.name !== undefined && (String(body.name).length < 1 || String(body.name).length > MAX_NAME_LENGTH)) {
      throw new BadRequest(`name は 1〜${MAX_NAME_LENGTH} 文字で指定してください`, ErrorCode.invalidForm);
    }
    if (body.description && String(body.description).length > MAX_DESCRIPTION_LENGTH) {
      throw new BadRequest(`description は ${MAX_DESCRIPTION_LENGTH} 文字以内で指定してください`, ErrorCode.invalidForm);
    }
  }

  /** テンプレートに入れるサーバーの内容。ID は Discord と同じく、テンプレートの中だけの番号に置き換える。 */
  private snapshot(guildId: string): Json {
    const { store } = this;
    const guild = store.guildPayload(store.requireGuild(guildId));
    const ids = new Map<string, number>();
    const local = (id: string | null | undefined) => {
      if (!id) return null;
      if (!ids.has(id)) ids.set(id, ids.size);
      return ids.get(id)!;
    };
    const roles = [...(guild.roles as Json[])]
      .filter((role) => !role.managed)
      .sort((a, b) => a.position - b.position)
      .map((role) => ({ id: local(role.id), name: role.name, color: role.color, hoist: role.hoist, mentionable: role.mentionable, permissions: role.permissions }));
    const channels = store.guildChannels(guildId).map((channel) => ({
      id: local(channel.id),
      type: channel.type,
      name: channel.name,
      position: channel.position,
      topic: channel.topic ?? null,
      nsfw: channel.nsfw ?? false,
      rate_limit_per_user: channel.rate_limit_per_user ?? 0,
      parent_id: local(channel.parent_id),
      permission_overwrites: (channel.permission_overwrites as Json[]).map((overwrite) => ({ ...overwrite, id: local(overwrite.id) })),
    }));
    return {
      name: guild.name,
      description: guild.description,
      verification_level: guild.verification_level,
      default_message_notifications: guild.default_message_notifications,
      explicit_content_filter: guild.explicit_content_filter,
      preferred_locale: guild.preferred_locale,
      afk_timeout: guild.afk_timeout,
      system_channel_flags: guild.system_channel_flags,
      afk_channel_id: local(guild.afk_channel_id),
      system_channel_id: local(guild.system_channel_id),
      roles,
      channels,
    };
  }

  create(guildId: string, body: Json): Json {
    const { store } = this;
    if (this.list(guildId).length >= MAX_TEMPLATES_PER_GUILD) throw new BadRequest('テンプレートの上限に達しています', ErrorCode.maxTemplates);
    if (body.name === undefined) throw new BadRequest('name を指定してください', ErrorCode.invalidForm);
    this.checkFields(body);
    const creator = store.state.users[store.actor?.userId ?? store.state.botUserId]!;
    const now = new Date().toISOString();
    const template = {
      code: randomBytes(9).toString('base64url'),
      name: String(body.name),
      description: body.description ?? null,
      usage_count: 0,
      creator_id: creator.id,
      creator,
      created_at: now,
      updated_at: now,
      source_guild_id: guildId,
      serialized_source_guild: this.snapshot(guildId),
      is_dirty: null,
    };
    store.state.templates[template.code] = template;
    store.changed();
    return template;
  }

  /** テンプレートを今のサーバーの内容で作り直す。 */
  sync(guildId: string, code: string): Json {
    const template = this.requireIn(guildId, code);
    template.serialized_source_guild = this.snapshot(guildId);
    template.updated_at = new Date().toISOString();
    template.is_dirty = null;
    this.store.changed();
    return template;
  }

  update(guildId: string, code: string, body: Json): Json {
    const template = this.requireIn(guildId, code);
    this.checkFields(body);
    if (body.name !== undefined) template.name = String(body.name);
    if (body.description !== undefined) template.description = body.description;
    this.store.changed();
    return template;
  }
}
