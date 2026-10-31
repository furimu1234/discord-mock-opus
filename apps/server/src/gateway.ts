import { randomBytes } from 'node:crypto';
import type { IncomingMessage, Server } from 'node:http';
import type { Duplex } from 'node:stream';
import { WebSocketServer, type WebSocket } from 'ws';
import type { Json, Store } from './store.js';

const Op = {
  dispatch: 0,
  heartbeat: 1,
  identify: 2,
  voiceStateUpdate: 4,
  resume: 6,
  requestGuildMembers: 8,
  hello: 10,
  heartbeatAck: 11,
} as const;

const HEARTBEAT_INTERVAL = 45000;
const AUTHENTICATION_FAILED = 4004;

interface Session {
  socket: WebSocket;
  id: string;
  sequence: number;
  identified: boolean;
}

/** Discord Gateway の WebSocket エミュレータ。 */
export class Gateway {
  private readonly wss = new WebSocketServer({ noServer: true });
  private readonly sessions = new Set<Session>();

  constructor(
    private readonly store: Store,
    private readonly url: () => string,
  ) {
    store.on('dispatch', (event: string, data: Json) => this.broadcast(event, data));
  }

  attach(server: Server): void {
    server.on('upgrade', (req, socket, head) => this.upgrade(req, socket, head));
  }

  private upgrade(req: IncomingMessage, socket: Duplex, head: Buffer): void {
    // Bot の WebSocket に Origin は付かない。ブラウザからの接続はここで拒否する。
    if (!req.url?.startsWith('/gateway') || req.headers.origin) {
      socket.destroy();
      return;
    }
    this.wss.handleUpgrade(req, socket, head, (ws) => this.connected(ws));
  }

  private connected(socket: WebSocket): void {
    const session: Session = {
      socket,
      id: randomBytes(16).toString('hex'),
      sequence: 0,
      identified: false,
    };
    this.sessions.add(session);
    socket.on('close', () => this.sessions.delete(session));
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
        session.identified = true;
        this.dispatchTo(session, 'RESUMED', {});
        break;
      case Op.voiceStateUpdate:
        this.store.setVoiceState(
          packet.d.guild_id,
          this.store.state.botUserId,
          packet.d.channel_id,
          session.id,
        );
        break;
      case Op.requestGuildMembers:
        this.memberChunk(session, packet.d);
        break;
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

  broadcast(event: string, data: Json): void {
    for (const session of this.sessions) {
      if (session.identified) this.dispatchTo(session, event, data);
    }
  }

  close(): void {
    for (const session of this.sessions) session.socket.terminate();
    this.wss.close();
  }
}
