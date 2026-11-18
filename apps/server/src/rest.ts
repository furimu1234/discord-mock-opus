import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Attachments, Upload } from './attachments.js';
import type { Expressions } from './expressions.js';
import type { Integrations } from './integrations.js';
import type { Moderation } from './moderation.js';
import type { Polls } from './polls.js';
import type { Interactions, InteractRequest } from './interactions.js';
import type { ProjectLauncher } from './projects.js';
import { Binary, NO_CONTENT, type Handler, type RouteModule } from './routes.js';
import { serveStatic, type WebFiles } from './static.js';
import type { TestRegistry } from './tests.js';
import { AUDIO_LENGTH_SIZE, ChannelType, creatableMessageFlags, WEB_ORIGIN, WEB_ORIGIN_HEADER } from './constants.js';
import type { VoiceServer } from './voice.js';
import { snowflake, type Json, type Store } from './store.js';

interface Route {
  method: string;
  pattern: RegExp;
  keys: string[];
  handler: Handler;
}

/** Bot には 204 を返し、テストの通信の記録にだけ `data` を残す。 */
class RecordOnly {
  constructor(readonly data: unknown) {}
}
// ウェブフックはトークンの付いた URL だけを公開する。トークンのない取得や変更には Bot の認証が要る。
// サーバーのウィジェットは、有効にしたサーバーなら誰でも読める。
const PUBLIC_PATHS = [
  /^\/api\/v10\/gateway$/,
  /^\/api\/v10\/interactions\//,
  /^\/api\/v10\/webhooks\/[^/]+\/[^/]+/,
  /^\/api\/v10\/guilds\/[^/]+\/widget\.(json|png)$/,
];

function compile(path: string): Pick<Route, 'pattern' | 'keys'> {
  const keys: string[] = [];
  const source = path.replace(/:(\w+)/g, (_match, key: string) => {
    keys.push(key);
    return '([^/]+)';
  });
  return { pattern: new RegExp(`^${source}$`), keys };
}

/** 画面はファイルを base64 で送る。CSRF を防ぐため、/api/mock は JSON だけを受け付ける。 */
function toUploads(files: Json[] | undefined): Upload[] {
  return (files ?? []).map((file) => ({
    filename: String(file.filename),
    contentType: String(file.contentType ?? ''),
    data: Buffer.from(String(file.data ?? ''), 'base64'),
  }));
}

/** REST API v10 と `/api/mock` のルーティング。 */
export class Rest {
  private readonly routes: Route[] = [];

  constructor(
    private readonly store: Store,
    private readonly interactions: Interactions,
    private readonly integrations: Integrations,
    private readonly moderation: Moderation,
    private readonly expressions: Expressions,
    private readonly attachments: Attachments,
    private readonly polls: Polls,
    private readonly tests: TestRegistry,
    private readonly projects: ProjectLauncher,
    private readonly voice: VoiceServer,
    private readonly gatewayUrl: () => string,
    private readonly botConnected: () => boolean,
    modules: RouteModule[] = [],
    private readonly webFiles?: WebFiles,
  ) {
    // モジュールの具体的なパス（`members/search` など）を、`:id` で受けるルートより先に登録する。
    for (const module of modules) {
      module.routes((method, path, handler) => this.route(method, `/api/v10${path}`, handler));
      module.mockRoutes?.((method, path, handler) => this.route(method, `/api/mock${path}`, handler));
    }
    this.discordRoutes();
    this.mockRoutes();
  }

  private route(method: string, path: string, handler: Handler): void {
    this.routes.push({ method, ...compile(path), handler });
  }

  private discordRoutes(): void {
    const { store, interactions, integrations, moderation, expressions } = this;
    const api = (method: string, path: string, handler: Handler) =>
      this.route(method, `/api/v10${path}`, handler);
    const gateway = () => ({
      url: this.gatewayUrl(),
      shards: 1,
      session_start_limit: { total: 1000, remaining: 1000, reset_after: 0, max_concurrency: 1 },
    });

    api('GET', '/gateway', gateway);
    api('GET', '/gateway/bot', gateway);

    api('GET', '/users/@me', () => store.botUser);
    api('GET', '/users/:id', ({ params }) => store.requireUser(params.id!));
    // Mock に OAuth はないので、グループ DM の `access_tokens` にはダミーユーザーの ID を渡す。
    api('POST', '/users/@me/channels', ({ body }) =>
      body.access_tokens ? store.createGroupDm(body.access_tokens) : store.dmChannel(body.recipient_id),
    );

    const commands = (guildId?: string) =>
      store.state.commands.filter((c) => (c.guild_id ?? undefined) === guildId);
    api('GET', '/applications/:app/commands', () => commands());
    api('PUT', '/applications/:app/commands', ({ body }) => store.setCommands(body as Json[]));
    api('POST', '/applications/:app/commands', ({ body }) => store.addCommand(body));
    api('GET', '/applications/:app/guilds/:guild/commands', ({ params }) => commands(params.guild));
    api('PUT', '/applications/:app/guilds/:guild/commands', ({ params, body }) =>
      store.setCommands(body as Json[], params.guild),
    );
    api('POST', '/applications/:app/guilds/:guild/commands', ({ params, body }) =>
      store.addCommand(body, params.guild),
    );

    api('GET', '/guilds/:guild', ({ params }) => store.guildPayload(store.requireGuild(params.guild!)));
    api('PATCH', '/guilds/:guild', ({ params, body }) => store.updateGuild(params.guild!, body));
    api('GET', '/guilds/:guild/audit-logs', ({ params, query }) => moderation.auditLog(params.guild!, query));
    api('PATCH', '/guilds/:guild/members/:user', ({ params, body }) => store.updateMember(params.guild!, params.user!, body));
    api('DELETE', '/guilds/:guild/members/:user', ({ params }) => {
      moderation.kick(params.guild!, params.user!);
      return NO_CONTENT;
    });
    api('GET', '/guilds/:guild/bans', ({ params }) => moderation.bans(params.guild!));
    api('GET', '/guilds/:guild/bans/:user', ({ params }) => moderation.requireBan(params.guild!, params.user!));
    api('PUT', '/guilds/:guild/bans/:user', ({ params, body }) => {
      moderation.ban(params.guild!, params.user!, body);
      return NO_CONTENT;
    });
    api('DELETE', '/guilds/:guild/bans/:user', ({ params }) => {
      moderation.unban(params.guild!, params.user!);
      return NO_CONTENT;
    });
    api('POST', '/guilds/:guild/bulk-ban', ({ params, body }) => moderation.bulkBan(params.guild!, body));
    api('GET', '/guilds/:guild/auto-moderation/rules', ({ params }) => moderation.rules(params.guild!));
    api('GET', '/guilds/:guild/auto-moderation/rules/:rule', ({ params }) => moderation.requireRule(params.guild!, params.rule!));
    api('POST', '/guilds/:guild/auto-moderation/rules', ({ params, body }) => moderation.createRule(params.guild!, body));
    api('PATCH', '/guilds/:guild/auto-moderation/rules/:rule', ({ params, body }) =>
      moderation.updateRule(params.guild!, params.rule!, body),
    );
    api('DELETE', '/guilds/:guild/auto-moderation/rules/:rule', ({ params }) => {
      moderation.deleteRule(params.guild!, params.rule!);
      return NO_CONTENT;
    });
    api('GET', '/guilds/:guild/emojis', ({ params }) => expressions.emojis(params.guild!));
    api('GET', '/guilds/:guild/emojis/:emoji', ({ params }) => expressions.requireEmoji(params.guild!, params.emoji!));
    api('POST', '/guilds/:guild/emojis', ({ params, body }) => expressions.createEmoji(params.guild!, body));
    api('PATCH', '/guilds/:guild/emojis/:emoji', ({ params, body }) => expressions.updateEmoji(params.guild!, params.emoji!, body));
    api('DELETE', '/guilds/:guild/emojis/:emoji', ({ params }) => {
      expressions.deleteEmoji(params.guild!, params.emoji!);
      return NO_CONTENT;
    });
    api('GET', '/guilds/:guild/stickers', ({ params }) => expressions.stickers(params.guild!));
    api('GET', '/guilds/:guild/stickers/:sticker', ({ params }) => expressions.requireSticker(params.sticker!, params.guild!));
    api('POST', '/guilds/:guild/stickers', ({ params, body }) => expressions.createSticker(params.guild!, body));
    api('PATCH', '/guilds/:guild/stickers/:sticker', ({ params, body }) =>
      expressions.updateSticker(params.guild!, params.sticker!, body),
    );
    api('DELETE', '/guilds/:guild/stickers/:sticker', ({ params }) => {
      expressions.deleteSticker(params.guild!, params.sticker!);
      return NO_CONTENT;
    });
    api('GET', '/stickers/:sticker', ({ params }) => expressions.requireSticker(params.sticker!));
    api('GET', '/guilds/:guild/channels', ({ params }) => store.guildChannels(params.guild!));
    api('POST', '/guilds/:guild/channels', ({ params, body }) =>
      store.createChannel(params.guild!, { ...body, parent: body.parent_id } as never),
    );
    api('PATCH', '/guilds/:guild/channels', ({ params, body }) => {
      store.reorderChannels(params.guild!, body as never);
      return NO_CONTENT;
    });
    api('GET', '/guilds/:guild/threads/active', ({ params }) => store.activeThreads(params.guild!));
    api('PATCH', '/guilds/:guild/voice-states/@me', ({ params, body }) =>
      store.updateVoiceState(params.guild!, store.state.botUserId, body),
    );
    api('PATCH', '/guilds/:guild/voice-states/:user', ({ params, body }) =>
      store.updateVoiceState(params.guild!, params.user!, body),
    );
    api('GET', '/guilds/:guild/roles', ({ params }) => store.requireGuild(params.guild!).roles);
    api('PATCH', '/guilds/:guild/roles', ({ params, body }) => store.reorderRoles(params.guild!, body as never));
    api('POST', '/guilds/:guild/roles', ({ params, body }) =>
      store.createRole(params.guild!, { ...body, name: body.name ?? 'new role' } as never),
    );
    api('GET', '/guilds/:guild/members', ({ params }) =>
      Object.values(store.requireGuild(params.guild!).members),
    );
    api('GET', '/guilds/:guild/members/:user', ({ params }) =>
      store.requireMember(params.guild!, params.user!),
    );
    api('PUT', '/guilds/:guild/members/:user/roles/:role', ({ params }) => {
      const member = store.requireMember(params.guild!, params.user!);
      store.setMemberRoles(params.guild!, params.user!, [...new Set([...member.roles, params.role!])]);
      return NO_CONTENT;
    });
    api('DELETE', '/guilds/:guild/members/:user/roles/:role', ({ params }) => {
      const member = store.requireMember(params.guild!, params.user!);
      const roles = member.roles.filter((role: string) => role !== params.role);
      store.setMemberRoles(params.guild!, params.user!, roles);
      return NO_CONTENT;
    });

    api('GET', '/channels/:channel', ({ params }) => store.requireChannel(params.channel!));
    api('PATCH', '/channels/:channel', ({ params, body }) => store.updateChannel(params.channel!, body));
    api('DELETE', '/channels/:channel', ({ params }) => {
      const channel = store.requireChannel(params.channel!);
      store.deleteChannel(params.channel!);
      return channel;
    });
    api('GET', '/channels/:channel/polls/:message/answers/:answer', ({ params, query }) =>
      this.polls.voters(params.channel!, params.message!, Number(params.answer), query),
    );
    api('POST', '/channels/:channel/polls/:message/expire', ({ params }) => this.polls.expire(params.channel!, params.message!));
    api('POST', '/channels/:channel/followers', ({ params, body }) =>
      integrations.followChannel(params.channel!, body.webhook_channel_id, store.state.botUserId),
    );
    api('POST', '/channels/:channel/messages/:message/crosspost', ({ params }) =>
      integrations.crosspost(params.channel!, params.message!),
    );
    api('POST', '/channels/:channel/invites', ({ params, body }) =>
      integrations.createInvite(params.channel!, store.state.botUserId, body),
    );
    api('GET', '/channels/:channel/invites', ({ params }) => integrations.channelInvites(params.channel!));
    api('GET', '/guilds/:guild/invites', ({ params }) => integrations.guildInvites(params.guild!));
    api('GET', '/invites/:code', ({ params }) => integrations.invitePayload(integrations.requireInvite(params.code!)));
    api('DELETE', '/invites/:code', ({ params }) => integrations.deleteInvite(params.code!));
    api('POST', '/channels/:channel/webhooks', ({ params, body }) =>
      integrations.createWebhook(params.channel!, store.state.botUserId, body),
    );
    api('GET', '/channels/:channel/webhooks', ({ params }) => integrations.channelWebhooks(params.channel!));
    api('GET', '/guilds/:guild/webhooks', ({ params }) => integrations.guildWebhooks(params.guild!));
    api('GET', '/webhooks/:webhook', ({ params }) => integrations.getWebhook(params.webhook!));
    api('PATCH', '/webhooks/:webhook', ({ params, body }) => integrations.updateWebhook(params.webhook!, body));
    api('DELETE', '/webhooks/:webhook', ({ params }) => {
      integrations.deleteWebhook(params.webhook!);
      return NO_CONTENT;
    });
    api('POST', '/channels/:channel/threads', ({ params, body }) =>
      store.createThread(params.channel!, body, store.state.botUserId),
    );
    api('POST', '/channels/:channel/messages/:message/threads', ({ params, body }) =>
      store.createThread(params.channel!, body, store.state.botUserId, params.message),
    );
    api('GET', '/channels/:channel/threads/archived/public', ({ params }) =>
      store.archivedThreads(params.channel!, ChannelType.public_thread),
    );
    api('GET', '/channels/:channel/threads/archived/private', ({ params }) =>
      store.archivedThreads(params.channel!, ChannelType.private_thread),
    );
    api('GET', '/channels/:channel/users/@me/threads/archived/private', ({ params }) =>
      store.archivedThreads(params.channel!, ChannelType.private_thread, true),
    );
    api('GET', '/channels/:channel/thread-members', ({ params }) => store.threadMembers(params.channel!));
    api('GET', '/channels/:channel/thread-members/:user', ({ params }) =>
      store.threadMember(params.channel!, params.user!),
    );
    const threadMember = (user: string) => (user === '@me' ? store.state.botUserId : user);
    api('PUT', '/channels/:channel/thread-members/:user', ({ params }) => {
      store.addThreadMember(params.channel!, threadMember(params.user!));
      return NO_CONTENT;
    });
    api('DELETE', '/channels/:channel/thread-members/:user', ({ params }) => {
      store.removeThreadMember(params.channel!, threadMember(params.user!));
      return NO_CONTENT;
    });
    api('POST', '/stage-instances', ({ body }) => store.openStage(body));
    api('GET', '/stage-instances/:channel', ({ params }) => store.requireStage(params.channel!));
    api('PATCH', '/stage-instances/:channel', ({ params, body }) => store.updateStage(params.channel!, body));
    api('DELETE', '/stage-instances/:channel', ({ params }) => {
      store.closeStage(params.channel!);
      return NO_CONTENT;
    });
    api('GET', '/channels/:channel/messages', ({ params, query }) => {
      store.requireChannel(params.channel!);
      const limit = Number(query.get('limit') ?? 50);
      return this.chatMessages(params.channel!).slice(-limit).reverse();
    });
    api('POST', '/channels/:channel/messages', ({ params, body }) =>
      store.createMessage(params.channel!, store.botUser, { ...body, flags: creatableMessageFlags(body.flags) }),
    );
    api('GET', '/channels/:channel/messages/:message', ({ params }) =>
      store.findMessage(params.channel!, params.message!),
    );
    api('PATCH', '/channels/:channel/messages/:message', ({ params, body }) =>
      store.editMessage(params.channel!, params.message!, body),
    );
    api('DELETE', '/channels/:channel/messages/:message', ({ params }) => {
      store.deleteMessage(params.channel!, params.message!);
      return NO_CONTENT;
    });
    api('PUT', '/channels/:channel/messages/:message/reactions/:emoji/@me', ({ params }) => {
      const emoji = decodeURIComponent(params.emoji!);
      store.addReaction(params.channel!, params.message!, store.state.botUserId, emoji);
      return NO_CONTENT;
    });
    api('POST', '/channels/:channel/typing', () => NO_CONTENT);

    api('POST', '/interactions/:id/:token/callback', ({ params, query, body }) => {
      // 作ったメッセージをテストの通信で確かめられるよう、`with_response` がなくても記録には残す。
      const response = interactions.callback(params.id!, params.token!, body);
      return query.get('with_response') === 'true' ? response : new RecordOnly(response);
    });
    // インタラクションの応答とウェブフックは同じ形の URL なので、アプリケーションの ID で振り分ける。
    const isInteraction = (id: string) => id === store.state.applicationId;
    api('GET', '/webhooks/:app/:token/messages/:message', ({ params }) =>
      isInteraction(params.app!)
        ? interactions.responseMessage(params.token!, params.message!)
        : integrations.webhookMessage(params.app!, params.token!, params.message!),
    );
    api('PATCH', '/webhooks/:app/:token/messages/:message', ({ params, body }) =>
      isInteraction(params.app!)
        ? interactions.editResponse(params.token!, params.message!, body)
        : integrations.editWebhookMessage(params.app!, params.token!, params.message!, body),
    );
    api('DELETE', '/webhooks/:app/:token/messages/:message', ({ params }) => {
      if (isInteraction(params.app!)) interactions.deleteResponse(params.token!, params.message!);
      else integrations.deleteWebhookMessage(params.app!, params.token!, params.message!);
      return NO_CONTENT;
    });
    api('POST', '/webhooks/:app/:token', ({ params, query, body }) => {
      if (isInteraction(params.app!)) return interactions.followUp(params.token!, body);
      const message = integrations.executeWebhook(params.app!, params.token!, body, query.get('thread_id') ?? undefined);
      return query.get('wait') === 'true' ? message : NO_CONTENT;
    });
    api('GET', '/webhooks/:webhook/:token', ({ params }) => integrations.getWebhook(params.webhook!, params.token!));
    api('PATCH', '/webhooks/:webhook/:token', ({ params, body }) =>
      integrations.updateWebhook(params.webhook!, body, params.token!),
    );
    api('DELETE', '/webhooks/:webhook/:token', ({ params }) => {
      integrations.deleteWebhook(params.webhook!, params.token!);
      return NO_CONTENT;
    });
  }

  private mockRoutes(): void {
    const { store, interactions } = this;
    const mock = (method: string, path: string, handler: Handler) =>
      this.route(method, `/api/mock${path}`, handler);

    mock('GET', '/state', () => ({ ...store.publicState(), botConnected: this.botConnected() }));
    mock('POST', '/reset', () => {
      interactions.clear();
      store.reset();
      return { ok: true };
    });
    mock('POST', '/seed', ({ body }) => store.seed(body));
    mock('POST', '/switch-user', ({ body }) => {
      store.switchUser(body.userId);
      return { activeUserId: body.userId };
    });
    // 画面からの操作は画面がモーダルを表示する。テストの操作で開いたモーダルは、画面に見せるために配信する。
    mock('POST', '/interact', ({ body }) => interactions.interact(body as InteractRequest, store.actor?.keep !== true));
    mock('POST', '/commands', ({ body }) => store.setCommands(body as Json[]));
    mock('POST', '/messages', ({ body }) => {
      const author = store.requireUser(body.userId);
      const reference = body.replyTo ? { message_reference: { message_id: body.replyTo } } : {};
      return store.createMessage(body.channelId, author, { content: body.content, ...reference, poll: body.poll, uploads: toUploads(body.files) });
    });
    mock('PUT', '/channels/:channel/polls/:message/votes', ({ params, body }) =>
      this.polls.vote(params.channel!, params.message!, body.userId, (body.answerIds ?? []) as number[]),
    );
    mock('POST', '/channels/:channel/polls/:message/expire', ({ params }) => this.polls.expire(params.channel!, params.message!));
    mock('POST', '/guilds/:guild/reset', ({ params }) => {
      store.resetGuild(params.guild!);
      return { ok: true };
    });
    mock('POST', '/guilds/:guild/reset-messages', ({ params }) => {
      store.resetGuildMessages(params.guild!);
      return { ok: true };
    });
    mock('PATCH', '/channels/:channel/messages/:message', ({ params, body }) =>
      store.editMessage(params.channel!, params.message!, { content: body.content }),
    );
    mock('DELETE', '/channels/:channel/messages/:message', ({ params }) => {
      store.deleteMessage(params.channel!, params.message!);
      return { ok: true };
    });
    mock('POST', '/channels/:channel/messages/:message/threads', ({ params, body }) =>
      store.createThread(params.channel!, body, body.userId, params.message),
    );
    mock('POST', '/reactions', ({ body }) => {
      store.addReaction(body.channelId, body.messageId, body.userId, body.emoji);
      return { ok: true };
    });
    mock('POST', '/voice', ({ body }) =>
      store.setVoiceState(body.guildId, body.userId, body.channelId, snowflake()),
    );
    mock('GET', '/voice', ({ query }) => this.voice.status(query.get('guildId') ?? ''));
    mock('GET', '/messages', ({ query }) => this.visibleMessages(query.get('channelId')));
    mock('GET', '/dms/groups', ({ query }) => {
      const userId = query.get('userId') ?? store.state.activeUserId;
      return userId ? store.groupDmsFor(userId) : [];
    });
    mock('GET', '/dms', ({ query }) => {
      // userId を省略すると、ログイン中のユーザーの DM を返す。
      const userId = query.get('userId') ?? store.state.activeUserId;
      return userId ? store.dmsFor(userId) : [];
    });
    mock('POST', '/dm', ({ body }) => store.dmChannel(body.userId));
    mock('PATCH', '/users/:id', ({ params, body }) => store.updateUser(params.id!, body));
    mock('DELETE', '/users/:id', ({ params }) => {
      store.deleteUser(params.id!);
      return { ok: true };
    });
    mock('PUT', '/guilds/:guild/members/:user', ({ params, body }) => {
      const member = store.requireGuild(params.guild!).members[params.user!];
      if (member) return store.setMemberRoles(params.guild!, params.user!, body.roles ?? []);
      return store.addMember(params.guild!, params.user!, body.roles ?? []);
    });
    mock('PATCH', '/guilds/:guild', ({ params, body }) => store.updateGuild(params.guild!, body));
    mock('POST', '/guilds/:guild/roles', ({ params, body }) => store.createRole(params.guild!, body as never));
    // 画面のドラッグでの並び替え。Bot の API と同じ形（配列）で受け取る。
    mock('PATCH', '/guilds/:guild/channels', ({ params, body }) => {
      store.reorderChannels(params.guild!, body as never);
      return { ok: true };
    });
    mock('PATCH', '/guilds/:guild/roles', ({ params, body }) => store.reorderRoles(params.guild!, body as never));
    mock('PATCH', '/guilds/:guild/roles/:role', ({ params, body }) => store.updateRole(params.guild!, params.role!, body));
    mock('DELETE', '/guilds/:guild', ({ params }) => {
      store.deleteGuild(params.guild!);
      return { ok: true };
    });
    mock('DELETE', '/guilds/:guild/roles/:role', ({ params }) => {
      store.deleteRole(params.guild!, params.role!);
      return { ok: true };
    });
    mock('PATCH', '/channels/:channel', ({ params, body }) => store.updateChannel(params.channel!, body));
    mock('GET', '/guilds/:guild/audit-logs', ({ params, query }) => this.moderation.auditLog(params.guild!, query));
    mock('DELETE', '/guilds/:guild/members/:user', ({ params }) => {
      this.moderation.kick(params.guild!, params.user!);
      return { ok: true };
    });
    mock('PUT', '/guilds/:guild/bans/:user', ({ params, body }) => {
      this.moderation.ban(params.guild!, params.user!, body);
      return { ok: true };
    });
    mock('DELETE', '/guilds/:guild/bans/:user', ({ params }) => {
      this.moderation.unban(params.guild!, params.user!);
      return { ok: true };
    });
    mock('POST', '/guilds/:guild/auto-moderation/rules', ({ params, body }) => this.moderation.createRule(params.guild!, body));
    mock('PATCH', '/guilds/:guild/auto-moderation/rules/:rule', ({ params, body }) =>
      this.moderation.updateRule(params.guild!, params.rule!, body),
    );
    mock('DELETE', '/guilds/:guild/auto-moderation/rules/:rule', ({ params }) => {
      this.moderation.deleteRule(params.guild!, params.rule!);
      return { ok: true };
    });
    mock('POST', '/guilds/:guild/emojis', ({ params, body }) => this.expressions.createEmoji(params.guild!, body));
    mock('PATCH', '/guilds/:guild/emojis/:emoji', ({ params, body }) =>
      this.expressions.updateEmoji(params.guild!, params.emoji!, body),
    );
    mock('DELETE', '/guilds/:guild/emojis/:emoji', ({ params }) => {
      this.expressions.deleteEmoji(params.guild!, params.emoji!);
      return { ok: true };
    });
    mock('POST', '/guilds/:guild/stickers', ({ params, body }) => this.expressions.createSticker(params.guild!, body));
    mock('DELETE', '/guilds/:guild/stickers/:sticker', ({ params }) => {
      this.expressions.deleteSticker(params.guild!, params.sticker!);
      return { ok: true };
    });
    mock('POST', '/channels/:channel/invites', ({ params, body }) =>
      this.integrations.createInvite(params.channel!, body.userId, body),
    );
    mock('DELETE', '/invites/:code', ({ params }) => this.integrations.deleteInvite(params.code!));
    mock('POST', '/invites/:code/accept', ({ params, body }) => this.integrations.acceptInvite(params.code!, body.userId));
    mock('POST', '/channels/:channel/webhooks', ({ params, body }) =>
      this.integrations.createWebhook(params.channel!, body.userId, body),
    );
    mock('PATCH', '/webhooks/:webhook', ({ params, body }) => this.integrations.updateWebhook(params.webhook!, body));
    mock('DELETE', '/webhooks/:webhook', ({ params }) => {
      this.integrations.deleteWebhook(params.webhook!);
      return { ok: true };
    });
    mock('POST', '/channels/:channel/messages/:message/crosspost', ({ params }) =>
      this.integrations.crosspost(params.channel!, params.message!),
    );
    mock('POST', '/channels/:channel/followers', ({ params, body }) =>
      this.integrations.followChannel(body.sourceId, params.channel!, body.userId),
    );
    mock('POST', '/channels/:channel/clone', ({ params }) => store.cloneChannel(params.channel!));
    mock('POST', '/channels/:channel/threads', ({ params, body }) => {
      const message = body.message ? { ...body.message, uploads: toUploads(body.message.files) } : undefined;
      return store.createThread(params.channel!, { ...body, message }, body.userId);
    });
    mock('PUT', '/channels/:channel/thread-members/:user', ({ params }) =>
      store.addThreadMember(params.channel!, params.user!),
    );
    mock('DELETE', '/channels/:channel/thread-members/:user', ({ params }) => {
      store.removeThreadMember(params.channel!, params.user!);
      return { ok: true };
    });
    mock('DELETE', '/channels/:channel', ({ params }) => {
      store.deleteChannel(params.channel!);
      return { ok: true };
    });

    const { tests, projects } = this;
    mock('GET', '/tests', () => ({ ...tests.snapshot(), launcher: projects.snapshot() }));
    mock('POST', '/tests/register', ({ body }) => {
      tests.register(body.projects, body.activeBot ?? null);
      return { ok: true };
    });
    mock('POST', '/tests/run', ({ body }) => {
      tests.requestRun(body.project, body.ids, body.channelId);
      return { ok: true };
    });
    mock('POST', '/tests/report', ({ body }) => {
      tests.report(body.project, body.id, body.result, body.db);
      return { ok: true };
    });
    mock('POST', '/db/live', ({ body }) => {
      tests.publishLiveDb(body.project, body.db);
      return { ok: true };
    });
    mock('GET', '/db', ({ query }) => tests.readDb(query.get('run'), query.get('id')));
    mock('GET', '/traffic', ({ query }) => {
      const after = query.get('after');
      return tests.traffic(after === null ? null : Number(after));
    });
    mock('GET', '/runs', () => tests.listRuns());
    mock('GET', '/runs/:id', ({ params }) => tests.readRun(params.id!));
    mock('POST', '/tests/finish', ({ body }) => {
      tests.finish(body.activeBot ?? null, body.coverage ?? null);
      return { ok: true };
    });
    mock('POST', '/tests/coverage/save', () => {
      tests.saveCoverage();
      return { ok: true };
    });
    mock('POST', '/tests/coverage/saved', ({ body }) => {
      tests.coverageSaved(body.project, body.files ?? null, body.dir ?? null);
      return { ok: true };
    });
    mock('POST', '/tests/reload', () => {
      tests.reload();
      return { ok: true };
    });
    mock('POST', '/tests/bot', ({ body }) => {
      tests.selectBot(body.project);
      return { ok: true };
    });
    mock('GET', '/folders', ({ query }) => projects.folders(query.get('path')));
    mock('POST', '/projects', ({ body }) => projects.add(body.label, body.dir));
    mock('DELETE', '/projects/:id', ({ params }) => {
      projects.remove(params.id!);
      return { ok: true };
    });
    mock('POST', '/projects/start', async ({ body }) => {
      await projects.start(body.id);
      return { ok: true };
    });
    mock('POST', '/projects/stop', async ({ body }) => {
      await projects.stop(body.id);
      return { ok: true };
    });
    mock('POST', '/tests/mark', ({ body }) => {
      store.addTestDivider(body.channelId, body.label);
      return { ok: true };
    });
  }

  /** DM は宛先のログインが必要なため、ここからは取得できない。 */
  private visibleMessages(channelId: string | null): Json[] {
    const { store } = this;
    if (channelId) {
      const channel = store.requireChannel(channelId);
      if (channel.recipients) return store.dmsFor(channel.recipients[0].id);
      return this.chatMessages(channelId);
    }
    return Object.keys(store.state.messages)
      .filter((id) => !store.state.channels[id]?.recipients)
      .flatMap((id) => this.chatMessages(id));
  }

  /** テストの区切りは画面だけのもので、Bot やテストのメッセージには含めない。 */
  private chatMessages(channelId: string): Json[] {
    return (this.store.state.messages[channelId] ?? []).filter((message) => message.dismock_test === undefined);
  }

  async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const method = req.method ?? 'GET';
    let path = '';
    let body: Json | null = null;
    const reply = (status: number, data: unknown) => {
      if (path.startsWith('/api/v10')) this.tests.recordRest(method, path, status, body, data);
      this.json(res, status, data);
    };
    try {
      const url = new URL(req.url ?? '/', 'http://localhost');
      // 添付は署名付きの URL で、Mock のトークンなしで読める。Discord の CDN と同じ。
      if (url.pathname.startsWith('/attachments/')) return this.serveAttachment(url, res);
      if (!url.pathname.startsWith('/api/')) {
        if (this.webFiles) return serveStatic(this.webFiles, url.pathname, res);
        return this.json(res, 404, { message: '404: Not Found', code: 0 });
      }
      // discord.js は `@original` を `%40original` として送る。
      path = url.pathname.replaceAll('%40', '@');
      if (path === '/api/mock/events') return this.events(req, res, url.searchParams.get('role'));
      if (path === '/api/mock/voice/audio') return this.audio(req, res);
      const route = this.find(method, path);
      if (!route) {
        console.warn(`[dismock] 未対応のルート: ${method} ${path}`);
        return reply(404, { message: '404: Not Found', code: 0 });
      }
      if (path.startsWith('/api/mock') && !this.allowed(req)) {
        return reply(415, { message: 'application/json が必要です', code: 0 });
      }
      if (!this.authenticated(req, path)) {
        return reply(401, { message: '401: Unauthorized', code: 0 });
      }
      const params = Object.fromEntries(
        route.keys.map((key, i) => [key, decodeURIComponent(route.match[i + 1]!)]),
      );
      body = await this.readBody(req);
      // API は Bot、画面とテストの操作は指定のユーザーかログイン中のユーザーを、監査ログの操作者にする。
      const { store } = this;
      const reason = req.headers['x-audit-log-reason'];
      // 画面からの操作で作ったものは、Mock を起動し直しても残す。テストの SDK はこのヘッダーを送らない。
      store.actor = path.startsWith('/api/mock')
        ? { userId: body.userId ?? store.state.activeUserId ?? store.state.botUserId, keep: req.headers[WEB_ORIGIN_HEADER] === WEB_ORIGIN }
        : { userId: store.state.botUserId, ...(typeof reason === 'string' ? { reason: decodeURIComponent(reason) } : {}) };
      const result = await Promise.resolve(route.handler({ params, query: url.searchParams, body, headers: req.headers })).finally(() => {
        store.actor = null;
      });
      if (result === NO_CONTENT || result instanceof RecordOnly) {
        const recorded = result instanceof RecordOnly ? result.data : null;
        if (path.startsWith('/api/v10')) this.tests.recordRest(method, path, 204, body, recorded);
        res.writeHead(204).end();
        return;
      }
      if (result instanceof Binary) {
        if (path.startsWith('/api/v10')) this.tests.recordRest(method, path, 200, body, null);
        res.writeHead(200, { 'content-type': result.contentType }).end(result.data);
        return;
      }
      reply(200, result);
    } catch (error) {
      const failure = error as Error & { status?: number; code?: number };
      reply(failure.status ?? 400, { message: failure.message, code: failure.code ?? 0 });
    }
  }

  /** Discord と同じく、Gateway の URL の取得とインタラクションの応答には認証が不要。 */
  private authenticated(req: IncomingMessage, path: string): boolean {
    if (PUBLIC_PATHS.some((pattern) => pattern.test(path))) return true;
    return req.headers.authorization?.replace(/^Bot\s+/i, '') === this.store.state.token;
  }

  /** 他サイトのページからの呼び出しを拒否する。画面は同一オリジンなので通過する。 */
  private allowed(req: IncomingMessage): boolean {
    const { origin, host } = req.headers;
    if (origin && new URL(origin).host !== host) return false;
    if (req.method === 'GET' || req.method === 'DELETE') return true;
    return req.headers['content-type']?.startsWith('application/json') === true;
  }

  /** 画面へ PCM のフレームを、長さ（2 バイト）を付けて配信する。 */
  private audio(req: IncomingMessage, res: ServerResponse): void {
    if (!this.allowed(req) || !this.authenticated(req, '/api/mock/voice/audio')) {
      return this.json(res, 401, { message: '401: Unauthorized', code: 0 });
    }
    res.writeHead(200, { 'content-type': 'application/octet-stream', 'cache-control': 'no-store' });
    res.flushHeaders();
    const stop = this.voice.onAudio((pcm) => {
      const length = Buffer.alloc(AUDIO_LENGTH_SIZE);
      length.writeUInt16BE(pcm.length);
      res.write(Buffer.concat([length, pcm]));
    });
    req.on('close', stop);
  }

  /** 画面とエージェントへイベントを配信する Server-Sent Events。 */
  private events(req: IncomingMessage, res: ServerResponse, role: string | null): void {
    if (!this.allowed(req) || !this.authenticated(req, '/api/mock/events')) {
      return this.json(res, 401, { message: '401: Unauthorized', code: 0 });
    }
    const { store, tests } = this;
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store' });
    // 状態の内容は流さず、更新があったことだけを伝える。DM もここからは見えない。
    const send = (type: string, data: Json) => res.write(`data: ${JSON.stringify({ type, data })}\n\n`);
    const keepAlive = setInterval(() => res.write(': keep-alive\n\n'), 15000);
    store.on('ui', send);
    if (role === 'agent') tests.setAgentConnected(true);
    send('CONNECTED', {});
    req.on('close', () => {
      clearInterval(keepAlive);
      store.off('ui', send);
      if (role === 'agent') tests.setAgentConnected(false);
    });
  }

  private find(method: string, path: string) {
    for (const route of this.routes) {
      if (route.method !== method) continue;
      const match = route.pattern.exec(path);
      if (match) return { ...route, match };
    }
    return undefined;
  }

  private async readBody(req: IncomingMessage): Promise<Json> {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    const raw = Buffer.concat(chunks);
    if (raw.length === 0) return {};
    const contentType = req.headers['content-type'] ?? '';
    if (contentType.startsWith('multipart/form-data')) return this.readMultipart(raw, contentType);
    return JSON.parse(raw.toString('utf8'));
  }

  /** ファイル付きのメッセージ。添付の中身は保存せず、メタデータだけを保持する。 */
  private async readMultipart(raw: Buffer, contentType: string): Promise<Json> {
    const form = await new Response(new Uint8Array(raw), {
      headers: { 'content-type': contentType },
    }).formData();
    const payload = form.get('payload_json');
    const body: Json = typeof payload === 'string' ? JSON.parse(payload) : {};
    // スタンプなどはフォームの項目で送られる。`file` はスタンプの画像で、data URI で保持する。
    // メッセージのファイル（`files[n]`）は `uploads` に入れ、メッセージの作成時に保存する。
    const uploads: Upload[] = [];
    for (const [key, value] of form.entries()) {
      if (key === 'payload_json') continue;
      if (typeof value === 'string') body[key] = value;
      else if (key === 'file') body.file = `data:${value.type};base64,${Buffer.from(await value.arrayBuffer()).toString('base64')}`;
      else uploads.push({ filename: value.name, contentType: value.type, data: Buffer.from(await value.arrayBuffer()) });
    }
    if (uploads.length > 0) body.uploads = uploads;
    return body;
  }

  private serveAttachment(url: URL, res: ServerResponse): void {
    const [, , channelId, id, filename] = url.pathname.split('/');
    const channel = this.store.state.channels[channelId ?? ''];
    const file = channel && id && filename ? this.attachments.read(channel, id, decodeURIComponent(filename), url.searchParams.get('hm')) : undefined;
    if (!file) return this.json(res, 404, { message: '404: Not Found', code: 0 });
    res.writeHead(200, {
      'content-type': file.contentType,
      'content-length': file.data.length,
      'x-content-type-options': 'nosniff',
      'content-security-policy': "default-src 'none'",
      ...(file.download ? { 'content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent(file.filename)}` } : {}),
    });
    res.end(file.data);
  }

  private json(res: ServerResponse, status: number, data: unknown): void {
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(data));
  }
}
