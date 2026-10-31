import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Interactions, InteractRequest } from './interactions.js';
import { serveStatic } from './static.js';
import type { TestRegistry } from './tests.js';
import { snowflake, type Json, type Store } from './store.js';

interface Context {
  params: Record<string, string>;
  query: URLSearchParams;
  body: Json;
}

type Handler = (ctx: Context) => unknown;

interface Route {
  method: string;
  pattern: RegExp;
  keys: string[];
  handler: Handler;
}

const NO_CONTENT = Symbol('no-content');
const PUBLIC_PATHS = [/^\/api\/v10\/gateway$/, /^\/api\/v10\/interactions\//, /^\/api\/v10\/webhooks\//];

function compile(path: string): Pick<Route, 'pattern' | 'keys'> {
  const keys: string[] = [];
  const source = path.replace(/:(\w+)/g, (_match, key: string) => {
    keys.push(key);
    return '([^/]+)';
  });
  return { pattern: new RegExp(`^${source}$`), keys };
}

/** REST API v10 と `/api/mock` のルーティング。 */
export class Rest {
  private readonly routes: Route[] = [];

  constructor(
    private readonly store: Store,
    private readonly interactions: Interactions,
    private readonly tests: TestRegistry,
    private readonly gatewayUrl: () => string,
    private readonly botConnected: () => boolean,
    private readonly webDir?: string,
  ) {
    this.discordRoutes();
    this.mockRoutes();
  }

  private route(method: string, path: string, handler: Handler): void {
    this.routes.push({ method, ...compile(path), handler });
  }

  private discordRoutes(): void {
    const { store, interactions } = this;
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
    api('POST', '/users/@me/channels', ({ body }) => store.dmChannel(body.recipient_id));

    api('GET', '/applications/@me', () => ({
      id: store.state.applicationId,
      name: store.botUser.username,
      flags: 0,
      bot: store.botUser,
    }));
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
    api('GET', '/guilds/:guild/channels', ({ params }) => store.guildChannels(params.guild!));
    api('POST', '/guilds/:guild/channels', ({ params, body }) =>
      store.createChannel(params.guild!, { ...body, parent: body.parent_id } as never),
    );
    api('GET', '/guilds/:guild/roles', ({ params }) => store.requireGuild(params.guild!).roles);
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
    api('GET', '/channels/:channel/messages', ({ params, query }) => {
      store.requireChannel(params.channel!);
      const limit = Number(query.get('limit') ?? 50);
      return (store.state.messages[params.channel!] ?? []).slice(-limit).reverse();
    });
    api('POST', '/channels/:channel/messages', ({ params, body }) =>
      store.createMessage(params.channel!, store.botUser, body),
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
      const withResponse = query.get('with_response') === 'true';
      return interactions.callback(params.id!, params.token!, body, withResponse) ?? NO_CONTENT;
    });
    api('GET', '/webhooks/:app/:token/messages/@original', ({ params }) =>
      interactions.originalMessage(params.token!),
    );
    api('PATCH', '/webhooks/:app/:token/messages/@original', ({ params, body }) =>
      interactions.editOriginal(params.token!, body),
    );
    api('DELETE', '/webhooks/:app/:token/messages/@original', ({ params }) => {
      interactions.deleteOriginal(params.token!);
      return NO_CONTENT;
    });
    api('POST', '/webhooks/:app/:token', ({ params, body }) =>
      interactions.followUp(params.token!, body),
    );
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
    mock('POST', '/interact', ({ body }) => interactions.interact(body as InteractRequest));
    mock('POST', '/commands', ({ body }) => store.setCommands(body as Json[]));
    mock('POST', '/messages', ({ body }) => {
      const author = store.requireUser(body.userId);
      return store.createMessage(body.channelId, author, { content: body.content });
    });
    mock('POST', '/reactions', ({ body }) => {
      store.addReaction(body.channelId, body.messageId, body.userId, body.emoji);
      return { ok: true };
    });
    mock('POST', '/voice', ({ body }) =>
      store.setVoiceState(body.guildId, body.userId, body.channelId, snowflake()),
    );
    mock('GET', '/messages', ({ query }) => this.visibleMessages(query.get('channelId')));
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
    mock('DELETE', '/guilds/:guild', ({ params }) => {
      store.deleteGuild(params.guild!);
      return { ok: true };
    });
    mock('DELETE', '/guilds/:guild/roles/:role', ({ params }) => {
      store.deleteRole(params.guild!, params.role!);
      return { ok: true };
    });
    mock('DELETE', '/channels/:channel', ({ params }) => {
      store.deleteChannel(params.channel!);
      return { ok: true };
    });

    const { tests } = this;
    mock('GET', '/tests', () => tests.snapshot());
    mock('POST', '/tests/register', ({ body }) => {
      tests.register(body.projects, body.activeBot ?? null);
      return { ok: true };
    });
    mock('POST', '/tests/run', ({ body }) => {
      tests.requestRun(body.project, body.ids);
      return { ok: true };
    });
    mock('POST', '/tests/report', ({ body }) => {
      tests.report(body.project, body.id, body.result);
      return { ok: true };
    });
    mock('POST', '/tests/finish', ({ body }) => {
      store.endTestSession();
      tests.finish(body.activeBot ?? null);
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
    mock('POST', '/tests/session/begin', () => {
      store.beginTestSession();
      return { ok: true };
    });
    mock('POST', '/tests/session/end', () => {
      store.endTestSession();
      return { ok: true };
    });
  }

  /** DM は宛先のログインが必要なため、ここからは取得できない。 */
  private visibleMessages(channelId: string | null): Json[] {
    const { store } = this;
    if (channelId) {
      const channel = store.requireChannel(channelId);
      if (channel.recipients) return store.dmsFor(channel.recipients[0].id);
      return store.state.messages[channelId] ?? [];
    }
    return Object.entries(store.state.messages)
      .filter(([id]) => !store.state.channels[id]?.recipients)
      .flatMap(([, messages]) => messages);
  }

  async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    try {
      const url = new URL(req.url ?? '/', 'http://localhost');
      if (!url.pathname.startsWith('/api/')) {
        if (this.webDir) return serveStatic(this.webDir, url.pathname, res);
        return this.json(res, 404, { message: '404: Not Found', code: 0 });
      }
      // discord.js は `@original` を `%40original` として送る。
      const path = url.pathname.replaceAll('%40', '@');
      if (path === '/api/mock/events') return this.events(req, res, url.searchParams.get('role'));
      const route = this.find(req.method ?? 'GET', path);
      if (!route) {
        console.warn(`[dismock] 未対応のルート: ${req.method} ${path}`);
        return this.json(res, 404, { message: '404: Not Found', code: 0 });
      }
      if (path.startsWith('/api/mock') && !this.allowed(req)) {
        return this.json(res, 415, { message: 'application/json が必要です', code: 0 });
      }
      if (!this.authenticated(req, path)) {
        return this.json(res, 401, { message: '401: Unauthorized', code: 0 });
      }
      const params = Object.fromEntries(
        route.keys.map((key, i) => [key, decodeURIComponent(route.match[i + 1]!)]),
      );
      const body = await this.readBody(req);
      const result = await route.handler({ params, query: url.searchParams, body });
      if (result === NO_CONTENT) {
        res.writeHead(204).end();
        return;
      }
      this.json(res, 200, result);
    } catch (error) {
      const failure = error as Error & { status?: number; code?: number };
      this.json(res, failure.status ?? 400, { message: failure.message, code: failure.code ?? 0 });
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
    const files = [...form.entries()].flatMap(([, value]) => (typeof value === 'string' ? [] : [value]));
    body.attachments = files.map((file) => ({
      id: snowflake(),
      filename: file.name,
      size: file.size,
      content_type: file.type,
      url: `attachment://${file.name}`,
      proxy_url: `attachment://${file.name}`,
    }));
    return body;
  }

  private json(res: ServerResponse, status: number, data: unknown): void {
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(data));
  }
}
