import { randomBytes } from 'node:crypto';
import type { IncomingMessage, Server } from 'node:http';
import type { Duplex } from 'node:stream';
import { WebSocketServer, type WebSocket } from 'ws';
import type { ApiRoute, RouteModule } from './routes.js';
import type { Json, Store } from './store.js';
import type { VoiceServer } from './voice.js';

const Op = {
  dispatch: 0,
  heartbeat: 1,
  identify: 2,
  presenceUpdate: 3,
  voiceStateUpdate: 4,
  resume: 6,
  reconnect: 7,
  requestGuildMembers: 8,
  invalidSession: 9,
  hello: 10,
  heartbeatAck: 11,
  requestSoundboardSounds: 31,
  requestChannelInfo: 43,
} as const;

/** Bot の Gateway の要求に、Mock の他のモジュールが答える。 */
export interface GatewayRequests {
  /** サーバーのサウンドボードの音声（`SOUNDBOARD_SOUNDS` の内容）。 */
  soundboardSounds(guildId: string): Json;
  /** サーバーのボイスチャンネルの情報（`CHANNEL_INFO` の内容）。 */
  channelInfo(guildId: string): Json;
  /** Bot のプレゼンスを記録し、`PRESENCE_UPDATE` を配信する。 */
  updatePresence(userId: string, presence: Json): void;
}

/** レート制限を試すときに、`RATE_LIMITED` で待たせる時間。 */
const RATE_LIMIT_RETRY_AFTER_SECONDS = 1;

const HEARTBEAT_INTERVAL = 45000;
const AUTHENTICATION_FAILED = 4004;

interface Session {
  socket: WebSocket;
  id: string;
  sequence: number;
  identified: boolean;
}

/** Discord Gateway の WebSocket エミュレータ。 */
export class Gateway implements RouteModule {
  private readonly wss = new WebSocketServer({ noServer: true });
  private readonly sessions = new Set<Session>();
  /** READY を送ったセッションの ID。再開（Resume）できるのは、このセッションだけ。 */
  private readonly resumable = new Set<string>();
  /** 次に `RATE_LIMITED` で断る Gateway の opcode。テストから指定する。 */
  private readonly rateLimited = new Set<number>();

  constructor(
    private readonly store: Store,
    private readonly url: () => string,
    private readonly voice: VoiceServer,
    private readonly requests: GatewayRequests,
  ) {
    store.on('dispatch', (event: string, data: Json) => this.broadcast(event, data));
  }

  routes(_api: ApiRoute): void {}

  /** Bot の再接続、セッションの無効化、レート制限への対応を試すためのルート。 */
  mockRoutes(mock: ApiRoute): void {
    const bots = () => [...this.sessions].filter((session) => session.identified);
    mock('POST', '/gateway/reconnect', () => {
      for (const session of bots()) this.send(session, Op.reconnect, null);
      return { ok: true };
    });
    mock('POST', '/gateway/invalid-session', ({ body }) => {
      const resumable = Boolean(body.resumable);
      for (const session of bots()) {
        if (!resumable) this.resumable.delete(session.id);
        this.send(session, Op.invalidSession, resumable);
      }
      return { ok: true };
    });
    mock('POST', '/gateway/rate-limit', ({ body }) => {
      this.rateLimited.add(Number(body.opcode ?? Op.requestGuildMembers));
      return { ok: true };
    });
  }

  attach(server: Server): void {
    server.on('upgrade', (req, socket, head) => this.upgrade(req, socket, head));
  }

  private upgrade(req: IncomingMessage, socket: Duplex, head: Buffer): void {
    // Bot の WebSocket に Origin は付かない。ブラウザからの接続はここで拒否する。
    if (req.headers.origin) socket.destroy();
    else if (req.url?.startsWith('/gateway')) this.wss.handleUpgrade(req, socket, head, (ws) => this.connected(ws));
    else if (req.url?.startsWith('/voice')) this.voice.upgrade(req, socket, head);
    else socket.destroy();
  }

  private connected(socket: WebSocket): void {
    const session: Session = {
      socket,
      id: randomBytes(16).toString('hex'),
      sequence: 0,
      identified: false,
    };
    this.sessions.add(session);
    socket.on('close', () => {
      this.sessions.delete(session);
      this.leaveVoice(session);
      this.store.emit('ui', 'STATE_SYNC', {});
    });
    socket.on('message', (raw) => this.received(session, JSON.parse(raw.toString())));
    this.send(session, Op.hello, { heartbeat_interval: HEARTBEAT_INTERVAL });
  }

  private received(session: Session, packet: Json): void {
    switch (packet.op) {
      case Op.heartbeat:
        this.send(session, Op.heartbeatAck, null);
        break;
      case Op.identify:
        if (this.authenticate(session, packet.d.token)) this.ready(session);
        break;
      case Op.resume:
        if (!this.authenticate(session, packet.d.token)) break;
        // 知らないセッションは再開できない。Bot は Identify からやり直す。
        if (!this.resumable.has(packet.d.session_id)) {
          this.send(session, Op.invalidSession, false);
          break;
        }
        session.id = packet.d.session_id;
        session.identified = true;
        this.dispatchTo(session, 'RESUMED', {});
        break;
      case Op.presenceUpdate:
        if (session.identified) this.requests.updatePresence(this.store.state.botUserId, packet.d);
        break;
      case Op.voiceStateUpdate:
        this.updateVoiceState(session, packet.d.guild_id, packet.d.channel_id);
        break;
      case Op.requestGuildMembers:
        if (this.limited(session, packet)) break;
        this.memberChunk(session, packet.d);
        break;
      case Op.requestSoundboardSounds:
        for (const guildId of packet.d.guild_ids ?? []) {
          if (this.store.state.guilds[guildId]) this.dispatchTo(session, 'SOUNDBOARD_SOUNDS', this.requests.soundboardSounds(guildId));
        }
        break;
      case Op.requestChannelInfo:
        if (this.store.state.guilds[packet.d.guild_id]) this.dispatchTo(session, 'CHANNEL_INFO', this.requests.channelInfo(packet.d.guild_id));
        break;
    }
  }

  /** テストで指定した opcode の要求を、一度だけ `RATE_LIMITED` で断る。 */
  private limited(session: Session, packet: Json): boolean {
    if (!this.rateLimited.delete(packet.op)) return false;
    this.dispatchTo(session, 'RATE_LIMITED', {
      opcode: packet.op,
      retry_after: RATE_LIMIT_RETRY_AFTER_SECONDS,
      meta: { guild_id: packet.d.guild_id, ...(packet.d.nonce ? { nonce: packet.d.nonce } : {}) },
    });
    return true;
  }

  private updateVoiceState(session: Session, guildId: string, channelId: string | null): void {
    const { store } = this;
    store.setVoiceState(guildId, store.state.botUserId, channelId, session.id);
    if (channelId) store.emit('dispatch', 'VOICE_SERVER_UPDATE', this.voice.open(guildId, channelId, session.id));
    else this.voice.leave(guildId);
  }

  /** 切断された Bot をボイスチャンネルに残さない。 */
  private leaveVoice(session: Session): void {
    for (const { guild_id, session_id } of Object.values(this.store.state.voiceStates)) {
      if (session_id === session.id) this.updateVoiceState(session, guild_id, null);
    }
  }

  private authenticate(session: Session, token: string): boolean {
    if (token === this.store.state.token) return true;
    session.socket.close(AUTHENTICATION_FAILED, 'Authentication failed');
    return false;
  }

  private ready(session: Session): void {
    const { store } = this;
    session.identified = true;
    this.resumable.add(session.id);
    store.emit('ui', 'STATE_SYNC', {});
    const guilds = Object.values(store.state.guilds);
    this.dispatchTo(session, 'READY', {
      v: 10,
      user: store.botUser,
      guilds: guilds.map((guild) => ({ id: guild.id, unavailable: true })),
      session_id: session.id,
      resume_gateway_url: this.url(),
      shard: [0, 1],
      application: { id: store.state.applicationId, flags: 0 },
    });
    for (const guild of guilds) {
      this.dispatchTo(session, 'GUILD_CREATE', store.guildCreatePayload(guild));
    }
  }

  private memberChunk(session: Session, data: Json): void {
    const guild = this.store.requireGuild(data.guild_id);
    this.dispatchTo(session, 'GUILD_MEMBERS_CHUNK', {
      guild_id: data.guild_id,
      members: Object.values(guild.members),
      chunk_index: 0,
      chunk_count: 1,
      nonce: data.nonce,
    });
  }

  private send(session: Session, op: number, d: unknown, extra: Json = {}): void {
    session.socket.send(JSON.stringify({ op, d, ...extra }));
  }

  private dispatchTo(session: Session, event: string, data: Json): void {
    session.sequence += 1;
    this.send(session, Op.dispatch, data, { t: event, s: session.sequence });
  }

  get hasBot(): boolean {
    return [...this.sessions].some((session) => session.identified);
  }

  broadcast(event: string, data: Json): void {
    for (const session of this.sessions) {
      if (session.identified) this.dispatchTo(session, event, data);
    }
  }

  /** Mock の終了を、再接続の要求（Reconnect）で Bot に知らせてから切断する。 */
  close(): void {
    for (const session of this.sessions) {
      if (session.identified) this.send(session, Op.reconnect, null);
      session.socket.removeAllListeners('close');
      session.socket.close();
    }
    this.wss.close();
  }
}
