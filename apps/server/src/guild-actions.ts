import { AuditLogEvent, ChannelType } from './constants.js';
import { Permission } from './permissions.js';
import { Binary, NO_CONTENT, type ApiRoute, type RouteModule } from './routes.js';
import { BadRequest, Forbidden, NotFound, snowflake, type GuildRecord, type Json, type Store } from './store.js';

/** Discord の公開ドキュメントの既定値と上限。 */
const DEFAULT_MEMBER_SEARCH_LIMIT = 1;
const MAX_MEMBER_SEARCH_LIMIT = 1000;
const DEFAULT_PRUNE_DAYS = 7;
const MAX_PRUNE_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;
const ErrorCode = { unknownRole: 10011, unknownIntegration: 10005, widgetDisabled: 50004, invalidForm: 50035 };

/** Mock が返すボイスリージョン。Mock の音声はリージョンによらず同じ場所で動く。 */
export const VOICE_REGIONS = [{ id: 'japan', name: 'Japan', optimal: true, deprecated: false, custom: false }];

/** ウィジェットの画像。Mock は図柄を描かず、1 ピクセルの透明な PNG を返す。 */
const WIDGET_IMAGE = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGBgAAAABQABpfZFQAAAAABJRU5ErkJggg==', 'base64');

/** Mock のメンバーはすべてオンラインとして扱う。 */
const WIDGET_STATUS = 'online';

/** サーバーの設定のうち、このモジュールが持つもの。サーバーのリセットで消す。 */
interface GuildExtras {
  widget?: { enabled: boolean; channel_id: string | null };
  welcome_screen?: Json;
  onboarding?: Json;
  incidents_data?: Json;
  /** Bot の連携を削除したか。 */
  integration_removed?: boolean;
}
const EXTRA_KEYS: (keyof GuildExtras)[] = ['widget', 'welcome_screen', 'onboarding', 'incidents_data', 'integration_removed'];

type Guild = GuildRecord & GuildExtras;

/** サーバーの設定、メンバー、ロール、プルーン、連携、ウィジェット、ウェルカム画面、オンボーディング。 */
export class GuildActions implements RouteModule {
  constructor(private readonly store: Store) {
    store.on('guild-cleared', (guildId: string) => {
      const guild = store.state.guilds[guildId] as Guild | undefined;
      for (const key of EXTRA_KEYS) if (guild) delete guild[key];
    });
    // Bot がサーバーに参加したときは、Bot の連携も作られる。
    store.on('dispatch', (event: string, data: Json) => {
      if (event === 'GUILD_CREATE') this.dispatch('INTEGRATION_CREATE', { ...this.botIntegration(), guild_id: data.id });
    });
  }

  private dispatch(event: string, data: Json): void {
    this.store.emit('dispatch', event, data);
  }

  private guild(guildId: string): Guild {
    return this.store.requireGuild(guildId) as Guild;
  }

  routes(api: ApiRoute): void {
    const { store } = this;
    const bot = () => store.state.botUserId;
    api('GET', '/guilds/:guild/preview', ({ params }) => this.preview(params.guild!));
    api('GET', '/guilds/:guild/members/search', ({ params, query }) => this.searchMembers(params.guild!, query));
    api('PATCH', '/guilds/:guild/members/@me/nick', ({ params, body }) => ({ nick: store.updateMember(params.guild!, bot(), { nick: body.nick ?? null }).nick }));
    api('PATCH', '/guilds/:guild/members/@me', ({ params, body }) => this.updateCurrentMember(params.guild!, body));
    // Mock に OAuth はないので、`access_token` は使わずダミーユーザーを参加させる。
    api('PUT', '/guilds/:guild/members/:user', ({ params, body }) => {
      if (this.guild(params.guild!).members[params.user!]) return NO_CONTENT;
      const member = store.addMember(params.guild!, params.user!, body.roles ?? [], body.nick ?? undefined);
      return body.mute || body.deaf ? store.updateMember(params.guild!, params.user!, { mute: body.mute, deaf: body.deaf }) : member;
    });
    api('GET', '/guilds/:guild/permissions/member/:user', ({ params }) => ({ permissions: store.memberPermissions(params.guild!, params.user!) }));
    api('GET', '/guilds/:guild/permissions/role/:role', ({ params }) => this.rolePermissions(params.guild!, params.role!));

    api('GET', '/guilds/:guild/roles/member-counts', ({ params }) => this.roleMemberCounts(params.guild!));
    api('GET', '/guilds/:guild/roles/:role', ({ params }) => this.requireRole(params.guild!, params.role!));
    api('PATCH', '/guilds/:guild/roles/:role', ({ params, body }) => this.updateRole(params.guild!, params.role!, body));
    api('DELETE', '/guilds/:guild/roles/:role', ({ params }) => {
      this.requireRole(params.guild!, params.role!);
      store.deleteRole(params.guild!, params.role!);
      return NO_CONTENT;
    });

    api('GET', '/guilds/:guild/prune', ({ params, query }) => ({ pruned: this.pruneTargets(params.guild!, query.get('days'), query.get('include_roles')).length }));
    api('POST', '/guilds/:guild/prune', ({ params, body }) => this.prune(params.guild!, body));
    api('GET', '/guilds/:guild/regions', ({ params }) => {
      store.requireGuild(params.guild!);
      return VOICE_REGIONS;
    });

    api('GET', '/guilds/:guild/integrations', ({ params }) => (this.guild(params.guild!).integration_removed ? [] : [this.botIntegration()]));
    api('DELETE', '/guilds/:guild/integrations/:integration', ({ params }) => {
      this.deleteIntegration(params.guild!, params.integration!);
      return NO_CONTENT;
    });

    api('GET', '/guilds/:guild/widget.json', ({ params }) => this.widgetJson(params.guild!));
    api('GET', '/guilds/:guild/widget.png', ({ params }) => {
      this.requireWidget(params.guild!);
      return new Binary('image/png', WIDGET_IMAGE);
    });
    api('GET', '/guilds/:guild/widget', ({ params }) => this.widgetSettings(params.guild!));
    api('PATCH', '/guilds/:guild/widget', ({ params, body }) => this.updateWidget(params.guild!, body));
    // Mock のサーバーにはバニティ URL がない。
    api('GET', '/guilds/:guild/vanity-url', ({ params }) => {
      store.requireGuild(params.guild!);
      return { code: null, uses: 0 };
    });

    api('GET', '/guilds/:guild/welcome-screen', ({ params }) => this.welcomeScreen(params.guild!));
    api('PATCH', '/guilds/:guild/welcome-screen', ({ params, body }) => this.updateWelcomeScreen(params.guild!, body));
    api('GET', '/guilds/:guild/onboarding', ({ params }) => this.onboarding(params.guild!));
    api('PUT', '/guilds/:guild/onboarding', ({ params, body }) => this.updateOnboarding(params.guild!, body));
    api('PUT', '/guilds/:guild/incident-actions', ({ params, body }) => this.updateIncidents(params.guild!, body));
  }

  /** Bot のアプリケーションの連携。 */
  botIntegration(): Json {
    const { store } = this;
    const bot = store.botUser;
    return {
      id: store.state.applicationId,
      name: bot.username,
      type: 'discord',
      enabled: true,
      account: { id: bot.id, name: bot.username },
      application: { id: store.state.applicationId, name: bot.username, icon: null, description: store.state.application.description ?? '', bot },
      scopes: ['bot', 'applications.commands'],
    };
  }

  preview(guildId: string): Json {
    const guild = this.guild(guildId);
    const payload = this.store.guildPayload(guild);
    return {
      id: guild.id,
      name: guild.name,
      icon: payload.icon,
      splash: null,
      discovery_splash: null,
      emojis: payload.emojis,
      features: payload.features,
      approximate_member_count: Object.keys(guild.members).length,
      approximate_presence_count: Object.keys(guild.members).length,
      description: payload.description,
      stickers: payload.stickers,
    };
  }

  /** ユーザー名またはニックネームが `query` で始まるメンバー。 */
  searchMembers(guildId: string, query: URLSearchParams): Json[] {
    const text = (query.get('query') ?? '').toLowerCase();
    const limit = Math.min(Number(query.get('limit') ?? DEFAULT_MEMBER_SEARCH_LIMIT), MAX_MEMBER_SEARCH_LIMIT);
    return Object.values(this.guild(guildId).members)
      .filter((member) => [member.user.username, member.user.global_name, member.nick].some((name) => typeof name === 'string' && name.toLowerCase().startsWith(text)))
      .slice(0, limit);
  }

  updateCurrentMember(guildId: string, body: Json): Json {
    const { store } = this;
    const member = store.requireMember(guildId, store.state.botUserId);
    for (const key of ['avatar', 'banner'] as const) {
      if (body[key] !== undefined) member[key] = store.storeImage(body[key]);
    }
    if (body.bio !== undefined) member.bio = body.bio;
    return body.nick !== undefined ? store.updateMember(guildId, store.state.botUserId, { nick: body.nick }) : member;
  }

  rolePermissions(guildId: string, roleId: string): Json {
    return { permissions: this.store.rolePermissions(guildId, roleId) };
  }

  requireRole(guildId: string, roleId: string): Json {
    const role = this.guild(guildId).roles.find((candidate) => candidate.id === roleId);
    if (!role) throw new NotFound('Unknown Role', ErrorCode.unknownRole);
    return role;
  }

  updateRole(guildId: string, roleId: string, body: Json): Json {
    const role = this.requireRole(guildId, roleId);
    const color = body.colors?.primary_color ?? body.color;
    for (const key of ['icon', 'unicode_emoji'] as const) {
      if (body[key] !== undefined) role[key] = key === 'icon' ? this.store.storeImage(body.icon) : body[key];
    }
    if (body.colors) role.colors = { ...role.colors, ...body.colors };
    return this.store.updateRole(guildId, roleId, { ...body, ...(color !== undefined ? { color } : {}) });
  }

  /** ロールごとのメンバーの数。`@everyone` は含めない。 */
  roleMemberCounts(guildId: string): Json {
    const guild = this.guild(guildId);
    const members = Object.values(guild.members);
    return Object.fromEntries(
      guild.roles.filter((role) => role.id !== guildId).map((role) => [role.id, members.filter((member) => member.roles.includes(role.id)).length]),
    );
  }

  /**
   * プルーンの対象。`days` 日のあいだ発言も参加もしていない、ロールのないメンバー。
   * `include_roles` のロールだけを持つメンバーも対象にする。Bot とサーバーの所有者は対象にしない。
   */
  private pruneTargets(guildId: string, daysValue: unknown, includeRoles: unknown): string[] {
    const { store } = this;
    const guild = this.guild(guildId);
    const days = daysValue === null || daysValue === undefined ? DEFAULT_PRUNE_DAYS : Number(daysValue);
    if (!Number.isInteger(days) || days < 1 || days > MAX_PRUNE_DAYS) throw new BadRequest(`days は 1〜${MAX_PRUNE_DAYS} で指定してください`, ErrorCode.invalidForm);
    const included = new Set(Array.isArray(includeRoles) ? includeRoles.map(String) : String(includeRoles ?? '').split(',').filter(Boolean));
    const since = Date.now() - days * DAY_MS;
    const lastActive = new Map<string, number>();
    for (const channel of store.guildChannels(guildId).concat(store.guildThreads(guildId))) {
      for (const message of store.state.messages[channel.id] ?? []) {
        const time = Date.parse(message.timestamp);
        lastActive.set(message.author.id, Math.max(lastActive.get(message.author.id) ?? 0, time));
      }
    }
    return Object.entries(guild.members)
      .filter(([userId, member]) => userId !== store.state.botUserId && userId !== guild.owner_id && !member.user.bot)
      .filter(([, member]) => (member.roles as string[]).every((role) => included.has(role)))
      .filter(([userId, member]) => Math.max(lastActive.get(userId) ?? 0, Date.parse(member.joined_at)) < since)
      .map(([userId]) => userId);
  }

  prune(guildId: string, body: Json): Json {
    const { store } = this;
    const targets = this.pruneTargets(guildId, body.days, body.include_roles);
    for (const userId of targets) store.removeMember(guildId, userId);
    store.audit(guildId, AuditLogEvent.memberPrune, null, [], { delete_member_days: String(body.days ?? DEFAULT_PRUNE_DAYS), members_removed: String(targets.length) });
    return { pruned: body.compute_prune_count === false ? null : targets.length };
  }

  deleteIntegration(guildId: string, integrationId: string): void {
    const guild = this.guild(guildId);
    if (guild.integration_removed || integrationId !== this.store.state.applicationId) throw new NotFound('Unknown Integration', ErrorCode.unknownIntegration);
    guild.integration_removed = true;
    this.store.changed();
    this.dispatch('INTEGRATION_DELETE', { id: integrationId, guild_id: guildId, application_id: this.store.state.applicationId });
    this.dispatch('GUILD_INTEGRATIONS_UPDATE', { guild_id: guildId });
    this.store.audit(guildId, AuditLogEvent.integrationDelete, integrationId, [], { integration_type: 'discord' });
  }

  widgetSettings(guildId: string): { enabled: boolean; channel_id: string | null } {
    return this.guild(guildId).widget ?? { enabled: false, channel_id: null };
  }

  updateWidget(guildId: string, body: Json): Json {
    const guild = this.guild(guildId);
    const widget = { ...this.widgetSettings(guildId) };
    if (body.enabled !== undefined) widget.enabled = Boolean(body.enabled);
    if (body.channel_id !== undefined) widget.channel_id = body.channel_id;
    guild.widget = widget;
    this.notifyGuild(guild);
    return widget;
  }

  private requireWidget(guildId: string): Guild {
    const guild = this.guild(guildId);
    if (!guild.widget?.enabled) throw Object.assign(new Forbidden('Widget Disabled'), { code: ErrorCode.widgetDisabled });
    return guild;
  }

  widgetJson(guildId: string): Json {
    const { store } = this;
    const guild = this.requireWidget(guildId);
    // `@everyone` が見られるボイスチャンネルを載せる。
    const visible = (channel: Json) => (BigInt(store.rolePermissions(guildId, guildId, channel.permission_overwrites)) & Permission.viewChannel) !== 0n;
    const channels = store.guildChannels(guildId).filter((channel) => channel.type === ChannelType.voice && visible(channel));
    const members = Object.values(guild.members).map((member) => member.user);
    return {
      id: guild.id,
      name: guild.name,
      instant_invite: null,
      channels: channels.map(({ id, name, position }) => ({ id, name, position })),
      members: members.map((user, index) => ({ id: String(index), username: user.username, discriminator: '0000', avatar: null, status: WIDGET_STATUS, avatar_url: '' })),
      presence_count: members.length,
    };
  }

  welcomeScreen(guildId: string): Json {
    return this.guild(guildId).welcome_screen ?? { description: null, welcome_channels: [] };
  }

  updateWelcomeScreen(guildId: string, body: Json): Json {
    const guild = this.guild(guildId);
    const screen: Json = { enabled: false, ...this.welcomeScreen(guildId) };
    for (const key of ['enabled', 'description', 'welcome_channels']) {
      if (body[key] !== undefined) screen[key] = body[key];
    }
    for (const channel of screen.welcome_channels as Json[]) this.store.requireChannel(channel.channel_id);
    guild.welcome_screen = screen;
    this.notifyGuild(guild);
    const { enabled: _enabled, ...payload } = screen;
    return payload;
  }

  onboarding(guildId: string): Json {
    return this.guild(guildId).onboarding ?? { guild_id: guildId, prompts: [], default_channel_ids: [], enabled: false, mode: 0 };
  }

  updateOnboarding(guildId: string, body: Json): Json {
    const guild = this.guild(guildId);
    const onboarding = { ...this.onboarding(guildId) };
    for (const key of ['prompts', 'default_channel_ids', 'enabled', 'mode']) {
      if (body[key] !== undefined) onboarding[key] = body[key];
    }
    for (const channelId of onboarding.default_channel_ids as string[]) this.store.requireChannel(channelId);
    onboarding.prompts = (onboarding.prompts as Json[]).map((prompt) => ({
      ...prompt,
      id: prompt.id ?? snowflake(),
      options: (prompt.options ?? []).map((option: Json) => ({ ...option, id: option.id ?? snowflake() })),
    }));
    guild.onboarding = onboarding;
    this.store.changed();
    return onboarding;
  }

  updateIncidents(guildId: string, body: Json): Json {
    const guild = this.guild(guildId);
    guild.incidents_data = {
      invites_disabled_until: body.invites_disabled_until ?? null,
      dms_disabled_until: body.dms_disabled_until ?? null,
      dm_spam_detected_at: null,
      raid_detected_at: null,
    };
    this.notifyGuild(guild);
    return guild.incidents_data;
  }

  private notifyGuild(guild: Guild): void {
    this.store.changed();
    this.dispatch('GUILD_UPDATE', this.store.guildPayload(guild));
  }
}
