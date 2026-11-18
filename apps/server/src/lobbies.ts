import { randomBytes } from 'node:crypto';
import { NO_CONTENT, type ApiRoute, type RouteModule } from './routes.js';
import { BadRequest, NotFound, snowflake, type Json, type Store } from './store.js';

/** Discord の公開ドキュメントの上限と既定値。 */
const MAX_MEMBERS = 1000;
const DEFAULT_IDLE_TIMEOUT_SECONDS = 300;
const DEFAULT_MESSAGE_LIMIT = 50;
const MAX_MESSAGE_LIMIT = 200;
const ErrorCode = { invalidForm: 50035 };

/** ロビー。Bot のトークンで作る、ゲームの中のグループのチャット。 */
export class Lobbies implements RouteModule {
  /** `PUT /lobbies` のシークレットごとのロビーの ID。 */
  private readonly secrets = new Map<string, string>();

  constructor(private readonly store: Store) {}

  routes(api: ApiRoute): void {
    const { store } = this;
    const bot = () => store.state.botUserId;
    api('POST', '/lobbies', ({ body }) => this.create(body));
    // シークレットが同じロビーがあれば参加し、なければ作る。
    api('PUT', '/lobbies', ({ body }) => {
      const secret = String(body.secret ?? '');
      if (!secret) throw new BadRequest('secret を指定してください', ErrorCode.invalidForm);
      const existing = this.secrets.get(secret);
      if (existing && store.state.lobbies[existing]) {
        this.addMember(existing, bot(), { metadata: body.member_metadata });
        return this.require(existing);
      }
      const lobby = this.create({ ...body, members: [{ id: bot(), metadata: body.member_metadata }] });
      this.secrets.set(secret, lobby.id);
      return lobby;
    });
    api('POST', '/lobbies/:lobby/members/bulk', ({ params, body }) => this.bulkUpdate(params.lobby!, body));
    api('POST', '/lobbies/:lobby/members/@me/invites', ({ params }) => this.invite(params.lobby!, bot()));
    api('POST', '/lobbies/:lobby/members/:user/invites', ({ params }) => this.invite(params.lobby!, params.user!));
    api('DELETE', '/lobbies/:lobby/members/@me', ({ params }) => {
      this.removeMember(params.lobby!, bot());
      return NO_CONTENT;
    });
    api('PUT', '/lobbies/:lobby/members/:user', ({ params, body }) => this.addMember(params.lobby!, params.user!, body));
    api('DELETE', '/lobbies/:lobby/members/:user', ({ params }) => {
      this.removeMember(params.lobby!, params.user!);
      return NO_CONTENT;
    });
    // `channel_id` を指定すると連携し、省略すると連携を外す。
    api('PATCH', '/lobbies/:lobby/channel-linking', ({ params, body }) => this.linkChannel(params.lobby!, body.channel_id ?? null));
    api('POST', '/lobbies/:lobby/messages', ({ params, body }) => this.sendMessage(params.lobby!, body));
    api('GET', '/lobbies/:lobby/messages', ({ params, query }) => this.messages(params.lobby!, query));
    api('PUT', '/lobbies/:lobby/messages/:message/moderation-metadata', ({ params, body }) => {
      const message = this.requireMessage(params.lobby!, params.message!);
      message.moderation_metadata = body;
      store.changed();
      return message;
    });
    api('GET', '/lobbies/:lobby', ({ params }) => this.require(params.lobby!));
    api('PATCH', '/lobbies/:lobby', ({ params, body }) => this.update(params.lobby!, body));
    api('DELETE', '/lobbies/:lobby', ({ params }) => {
      this.require(params.lobby!);
      delete store.state.lobbies[params.lobby!];
      delete store.state.lobbyMessages[params.lobby!];
      store.changed();
      return NO_CONTENT;
    });
  }

  require(lobbyId: string): Json {
    const lobby = this.store.state.lobbies[lobbyId];
    if (!lobby) throw new NotFound('Unknown Lobby');
    return lobby;
  }

  private member(input: Json): Json {
    this.store.requireUser(String(input.id));
    return { id: String(input.id), metadata: input.metadata ?? null, flags: input.flags ?? 0 };
  }

  create(body: Json): Json {
    const members = ((body.members ?? []) as Json[]).map((member) => this.member(member));
    if (members.length > MAX_MEMBERS) throw new BadRequest(`メンバーは ${MAX_MEMBERS} 人までです`, ErrorCode.invalidForm);
    const lobby = {
      id: snowflake(),
      application_id: this.store.state.applicationId,
      metadata: body.metadata ?? null,
      members,
      linked_channel: null,
      idle_timeout_seconds: body.idle_timeout_seconds ?? DEFAULT_IDLE_TIMEOUT_SECONDS,
    };
    this.store.state.lobbies[lobby.id] = lobby;
    this.store.changed();
    return lobby;
  }

  update(lobbyId: string, body: Json): Json {
    const lobby = this.require(lobbyId);
    if (body.metadata !== undefined) lobby.metadata = body.metadata;
    if (body.idle_timeout_seconds !== undefined) lobby.idle_timeout_seconds = body.idle_timeout_seconds;
    if (body.members !== undefined) lobby.members = (body.members as Json[]).map((member) => this.member(member));
    this.store.changed();
    return lobby;
  }

  addMember(lobbyId: string, userId: string, body: Json): Json {
    const lobby = this.require(lobbyId);
    const member = this.member({ ...body, id: userId });
    lobby.members = [...(lobby.members as Json[]).filter((candidate) => candidate.id !== userId), member];
    this.store.changed();
    return member;
  }

  removeMember(lobbyId: string, userId: string): void {
    const lobby = this.require(lobbyId);
    lobby.members = (lobby.members as Json[]).filter((member) => member.id !== userId);
    this.store.changed();
  }

  /** `remove_member` が真のメンバーは外し、それ以外は追加または更新する。 */
  bulkUpdate(lobbyId: string, body: unknown): Json[] {
    if (!Array.isArray(body)) throw new BadRequest('メンバーの配列で指定してください', ErrorCode.invalidForm);
    for (const entry of body as Json[]) {
      if (entry.remove_member) this.removeMember(lobbyId, String(entry.id));
      else this.addMember(lobbyId, String(entry.id), entry);
    }
    return this.require(lobbyId).members;
  }

  linkChannel(lobbyId: string, channelId: string | null): Json {
    const lobby = this.require(lobbyId);
    if (channelId) {
      const channel = this.store.requireChannel(channelId);
      lobby.linked_channel = { id: channel.id, type: channel.type, guild_id: channel.guild_id ?? null, name: channel.name ?? null };
    } else {
      lobby.linked_channel = null;
    }
    this.store.changed();
    return lobby;
  }

  invite(lobbyId: string, userId: string): Json {
    const lobby = this.require(lobbyId);
    if (!(lobby.members as Json[]).some((member) => member.id === userId)) throw new BadRequest('ロビーのメンバーではありません', ErrorCode.invalidForm);
    return { code: randomBytes(6).toString('base64url') };
  }

  sendMessage(lobbyId: string, body: Json): Json {
    const { store } = this;
    this.require(lobbyId);
    const message = {
      id: snowflake(),
      type: 0,
      content: String(body.content ?? ''),
      lobby_id: lobbyId,
      channel_id: lobbyId,
      author: store.botUser,
      metadata: body.metadata ?? null,
      moderation_metadata: null,
      flags: body.flags ?? 0,
      application_id: store.state.applicationId,
    };
    (store.state.lobbyMessages[lobbyId] ??= []).push(message);
    store.changed();
    return message;
  }

  messages(lobbyId: string, query: URLSearchParams): Json[] {
    this.require(lobbyId);
    const limit = Math.min(Number(query.get('limit') ?? DEFAULT_MESSAGE_LIMIT), MAX_MESSAGE_LIMIT);
    return [...(this.store.state.lobbyMessages[lobbyId] ?? [])].reverse().slice(0, limit);
  }

  private requireMessage(lobbyId: string, messageId: string): Json {
    const message = (this.store.state.lobbyMessages[lobbyId] ?? []).find((candidate) => candidate.id === messageId);
    if (!message) throw new NotFound('Unknown Message', 10008);
    return message;
  }
}
