import { createDecipheriv, randomBytes } from 'node:crypto';
import { createSocket, type RemoteInfo, type Socket } from 'node:dgram';
import type { AddressInfo } from 'node:net';
import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import OpusScript from 'opusscript';
import { WebSocketServer, type WebSocket } from 'ws';
import { VOICE_CHANNELS, VOICE_SAMPLE_RATE } from './constants.js';
import type { Store } from './store.js';

const Op = {
  identify: 0,
  selectProtocol: 1,
  ready: 2,
  heartbeat: 3,
  sessionDescription: 4,
  heartbeatAck: 6,
  hello: 8,
} as const;

const HEARTBEAT_INTERVAL = 13750;
const AUTHENTICATION_FAILED = 4004;
const ENCRYPTION_MODE = 'aead_aes256_gcm_rtpsize';
/** Mock は音声を受け取って再生するので、E2EE（DAVE）は使わない。 */
const DAVE_DISABLED = 0;

const SECRET_KEY_SIZE = 32;
const DISCOVERY_REQUEST = 1;
const DISCOVERY_RESPONSE = 2;
const DISCOVERY_SIZE = 74;
const DISCOVERY_LENGTH = 70;
const DISCOVERY_SSRC_OFFSET = 4;
const DISCOVERY_ADDRESS_OFFSET = 8;

const RTP_HEADER_SIZE = 12;
const RTP_SSRC_OFFSET = 8;
const AUTH_TAG_SIZE = 16;
const NONCE_SUFFIX_SIZE = 4;
const NONCE_SIZE = 12;

interface VoiceConnection {
  guildId: string;
  channelId: string;
  sessionId: string;
  token: string;
  ssrc: number;
  secretKey: Buffer;
  decoder?: OpusScript;
  socket?: WebSocket;
  ready: boolean;
  frames: number;
  audibleFrames: number;
}

/** Bot のボイスチャンネルへの接続状態。 */
export interface VoiceStatus {
  /** Bot が接続しているボイスチャンネルの ID。 */
  channelId: string;
  /** Bot が音声を送信できる状態か。 */
  ready: boolean;
  /** Mock が受信した音声のフレーム数。 */
  frames: number;
  /** ログイン中のユーザーが同じチャンネルにいる間に受信したフレーム数。 */
  audibleFrames: number;
}

/** インターリーブされた 16 ビットの PCM を受け取る。 */
type AudioListener = (pcm: Buffer) => void;

/** Bot の音声を受信する Voice Gateway と UDP のエミュレータ。 */
export class VoiceServer {
  private readonly wss = new WebSocketServer({ noServer: true });
  private readonly udp: Socket = createSocket('udp4');
  private readonly connections = new Map<string, VoiceConnection>();
  private readonly listeners = new Set<AudioListener>();
  private host = '';

  constructor(
    private readonly store: Store,
    private readonly endpoint: () => string,
  ) {
    this.udp.on('message', (packet, sender) => this.received(packet, sender));
  }

  /** UDP の受信を開始する。Mock と同じアドレスにだけバインドする。 */
  async listen(host: string): Promise<void> {
    this.host = host;
    await new Promise<void>((resolve, reject) => {
      this.udp.once('error', reject);
      this.udp.bind(0, host, resolve);
    });
  }

  /** Bot の接続を受け付け、`VOICE_SERVER_UPDATE` の内容を返す。 */
  open(guildId: string, channelId: string, sessionId: string): { token: string; guild_id: string; endpoint: string } {
    this.leave(guildId);
    const token = randomBytes(16).toString('hex');
    this.connections.set(guildId, {
      guildId,
      channelId,
      sessionId,
      token,
      ssrc: randomBytes(4).readUInt32BE(),
      secretKey: randomBytes(SECRET_KEY_SIZE),
      ready: false,
      frames: 0,
      audibleFrames: 0,
    });
    return { token, guild_id: guildId, endpoint: this.endpoint() };
  }

  leave(guildId: string): void {
    const connection = this.connections.get(guildId);
    connection?.socket?.close();
    connection?.decoder?.delete();
    this.connections.delete(guildId);
  }

  status(guildId: string): VoiceStatus | null {
    const connection = this.connections.get(guildId);
    if (!connection) return null;
    const { channelId, ready, frames, audibleFrames } = connection;
    return { channelId, ready, frames, audibleFrames };
  }

  /** 画面へ流す音声を受け取る。戻り値の関数で解除する。 */
  onAudio(listener: AudioListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  upgrade(req: IncomingMessage, socket: Duplex, head: Buffer): void {
    this.wss.handleUpgrade(req, socket, head, (ws) => this.connected(ws));
  }

  private connected(socket: WebSocket): void {
    const send = (op: number, d: unknown) => socket.send(JSON.stringify({ op, d }));
    let connection: VoiceConnection | undefined;
    socket.on('close', () => {
      if (connection) connection.ready = false;
    });
    socket.on('message', (raw) => {
      const packet = JSON.parse(raw.toString()) as { op: number; d: Record<string, any> };
      if (packet.op === Op.heartbeat) send(Op.heartbeatAck, { t: packet.d.t });
      if (packet.op === Op.identify) {
        connection = this.identify(socket, packet.d);
        if (!connection) return;
        const { port } = this.udp.address() as AddressInfo;
        send(Op.ready, { ssrc: connection.ssrc, ip: this.host, port, modes: [ENCRYPTION_MODE] });
      }
      if (packet.op === Op.selectProtocol && connection) {
        connection.ready = true;
        send(Op.sessionDescription, {
          mode: ENCRYPTION_MODE,
          secret_key: [...connection.secretKey],
          dave_protocol_version: DAVE_DISABLED,
        });
      }
    });
    send(Op.hello, { heartbeat_interval: HEARTBEAT_INTERVAL });
  }

  private identify(socket: WebSocket, data: Record<string, any>): VoiceConnection | undefined {
    const connection = this.connections.get(data.server_id);
    const valid =
      connection?.token === data.token &&
      connection?.sessionId === data.session_id &&
      data.user_id === this.store.state.botUserId;
    if (!valid) {
      socket.close(AUTHENTICATION_FAILED, 'Authentication failed');
      return undefined;
    }
    connection!.socket = socket;
    return connection;
  }

  private received(packet: Buffer, sender: RemoteInfo): void {
    if (packet.length === DISCOVERY_SIZE && packet.readUInt16BE(0) === DISCOVERY_REQUEST) {
      this.discover(packet, sender);
    } else if (packet.length > RTP_HEADER_SIZE + AUTH_TAG_SIZE + NONCE_SUFFIX_SIZE) {
      this.receiveAudio(packet);
    }
  }

  /** Bot の UDP のアドレスとポートを返す（IP Discovery）。 */
  private discover(packet: Buffer, sender: RemoteInfo): void {
    const ssrc = packet.readUInt32BE(DISCOVERY_SSRC_OFFSET);
    if (![...this.connections.values()].some((connection) => connection.ssrc === ssrc)) return;
    const response = Buffer.alloc(DISCOVERY_SIZE);
    response.writeUInt16BE(DISCOVERY_RESPONSE, 0);
    response.writeUInt16BE(DISCOVERY_LENGTH, 2);
    response.writeUInt32BE(ssrc, DISCOVERY_SSRC_OFFSET);
    response.write(sender.address, DISCOVERY_ADDRESS_OFFSET);
    response.writeUInt16BE(sender.port, DISCOVERY_SIZE - 2);
    this.udp.send(response, sender.port, sender.address);
  }

  private receiveAudio(packet: Buffer): void {
    const ssrc = packet.readUInt32BE(RTP_SSRC_OFFSET);
    const connection = [...this.connections.values()].find((candidate) => candidate.ssrc === ssrc);
    if (!connection?.ready) return;
    const opus = this.decrypt(packet, connection.secretKey);
    if (!opus) return;
    connection.frames += 1;
    if (!this.audible(connection)) return;
    connection.audibleFrames += 1;
    if (this.listeners.size === 0) return;
    const pcm = this.decode(connection, opus);
    if (pcm) for (const listener of this.listeners) listener(pcm);
  }

  /** 画面が対応しているコーデックに依存しないよう、Mock で PCM にデコードする。 */
  private decode(connection: VoiceConnection, opus: Buffer): Buffer | undefined {
    connection.decoder ??= new OpusScript(VOICE_SAMPLE_RATE, VOICE_CHANNELS);
    try {
      return connection.decoder.decode(opus);
    } catch {
      return undefined;
    }
  }

  private decrypt(packet: Buffer, secretKey: Buffer): Buffer | undefined {
    const nonce = Buffer.alloc(NONCE_SIZE);
    packet.copy(nonce, 0, packet.length - NONCE_SUFFIX_SIZE);
    const tagStart = packet.length - NONCE_SUFFIX_SIZE - AUTH_TAG_SIZE;
    const decipher = createDecipheriv('aes-256-gcm', secretKey, nonce);
    decipher.setAAD(packet.subarray(0, RTP_HEADER_SIZE));
    decipher.setAuthTag(packet.subarray(tagStart, tagStart + AUTH_TAG_SIZE));
    try {
      return Buffer.concat([decipher.update(packet.subarray(RTP_HEADER_SIZE, tagStart)), decipher.final()]);
    } catch {
      return undefined;
    }
  }

  /** 音声は、Bot とログイン中のユーザーが同じチャンネルにいるときだけ流す。 */
  private audible({ guildId, channelId }: VoiceConnection): boolean {
    const { activeUserId, voiceStates } = this.store.state;
    return voiceStates[`${guildId}:${activeUserId}`]?.channel_id === channelId;
  }

  close(): void {
    for (const connection of this.connections.values()) {
      connection.socket?.terminate();
      connection.decoder?.delete();
    }
    this.wss.close();
    if (this.host) this.udp.close();
  }
}
