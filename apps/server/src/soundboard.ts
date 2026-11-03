import { AuditLogEvent, isVoiceType } from './constants.js';
import { NO_CONTENT, type ApiRoute, type RouteModule } from './routes.js';
import { auditChanges, BadRequest, NotFound, snowflake, type Json, type Store } from './store.js';

/** Discord の公開ドキュメントの上限（ブーストなしのサーバー）。 */
export const GUILD_SOUND_LIMIT = 8;
const MAX_SOUND_BYTES = 512 * 1024;
const SOUND_TYPES = /^data:audio\/(mpeg|mp3|ogg);base64,/;
const SOUND_FIELDS = ['name', 'volume', 'emoji_id', 'emoji_name'];
const ErrorCode = { unknownSound: 10097, maxSounds: 30045, invalidForm: 50035, notConnected: 40032 };

/** Mock が持つ既定のサウンド。音声のデータは持たない。 */
export const DEFAULT_SOUNDS: Json[] = [
  { name: 'quack', sound_id: '1', volume: 1, emoji_id: null, emoji_name: '🦆', available: true },
  { name: 'airhorn', sound_id: '2', volume: 1, emoji_id: null, emoji_name: '🔊', available: true },
  { name: 'cricket', sound_id: '3', volume: 1, emoji_id: null, emoji_name: '🦗', available: true },
];

const dataSize = (data: string) => Buffer.byteLength(data.slice(data.indexOf(',') + 1), 'base64');

/** サウンドボード。サーバーの音声の管理と、ボイスチャンネルでの再生。 */
export class Soundboard implements RouteModule {
  constructor(private readonly store: Store) {
    store.on('guild-cleared', (guildId: string) => {
      const sounds = this.guildSounds(guildId);
      if (sounds.length === 0) return;
      for (const sound of sounds) this.removeSound(sound);
      this.dispatch('GUILD_SOUNDBOARD_SOUNDS_UPDATE', { guild_id: guildId, soundboard_sounds: [] });
    });
  }

  private dispatch(event: string, data: Json): void {
    this.store.emit('dispatch', event, data);
  }

  routes(api: ApiRoute): void {
    api('POST', '/channels/:channel/send-soundboard-sound', ({ params, body }) => {
      this.send(params.channel!, body);
      return NO_CONTENT;
    });
    api('GET', '/soundboard-default-sounds', () => DEFAULT_SOUNDS);
    api('GET', '/guilds/:guild/soundboard-sounds', ({ params }) => ({ items: this.guildSounds(params.guild!) }));
    api('GET', '/guilds/:guild/soundboard-sounds/:sound', ({ params }) => this.require(params.guild!, params.sound!));
    api('POST', '/guilds/:guild/soundboard-sounds', ({ params, body }) => this.create(params.guild!, body));
    api('PATCH', '/guilds/:guild/soundboard-sounds/:sound', ({ params, body }) => this.update(params.guild!, params.sound!, body));
    api('DELETE', '/guilds/:guild/soundboard-sounds/:sound', ({ params }) => {
      const sound = this.require(params.guild!, params.sound!);
      this.removeSound(sound);
      this.dispatch('GUILD_SOUNDBOARD_SOUND_DELETE', { sound_id: sound.sound_id, guild_id: sound.guild_id });
      this.store.audit(sound.guild_id, AuditLogEvent.soundboardSoundDelete, sound.sound_id, auditChanges(sound, {}, SOUND_FIELDS));
      return NO_CONTENT;
    });
  }

  guildSounds(guildId: string): Json[] {
    this.store.requireGuild(guildId);
    return Object.values(this.store.state.soundboardSounds).filter((sound) => sound.guild_id === guildId);
  }

  require(guildId: string, soundId: string): Json {
    const sound = this.store.state.soundboardSounds[soundId];
    if (!sound || sound.guild_id !== guildId) throw new NotFound('Unknown Soundboard Sound', ErrorCode.unknownSound);
    return sound;
  }

  private checkFields(body: Json): void {
    if (body.name !== undefined && (String(body.name).length < 2 || String(body.name).length > 32)) {
      throw new BadRequest('名前は 2〜32 文字で指定してください', ErrorCode.invalidForm);
    }
    if (body.volume !== undefined && body.volume !== null && (Number(body.volume) < 0 || Number(body.volume) > 1)) {
      throw new BadRequest('volume は 0〜1 で指定してください', ErrorCode.invalidForm);
    }
  }

  create(guildId: string, body: Json): Json {
    const { store } = this;
    if (this.guildSounds(guildId).length >= GUILD_SOUND_LIMIT) throw new BadRequest('サウンドの上限に達しています', ErrorCode.maxSounds);
    if (body.name === undefined) throw new BadRequest('name を指定してください', ErrorCode.invalidForm);
    this.checkFields(body);
    if (typeof body.sound !== 'string' || !SOUND_TYPES.test(body.sound) || dataSize(body.sound) > MAX_SOUND_BYTES) {
      throw new BadRequest('音声は 512KB 以下の MP3 か OGG の data URI で指定してください', ErrorCode.invalidForm);
    }
    const id = snowflake();
    store.state.media[id] = body.sound;
    const sound = {
      name: String(body.name),
      sound_id: id,
      volume: body.volume ?? 1,
      emoji_id: body.emoji_id ?? null,
      emoji_name: body.emoji_name ?? null,
      guild_id: guildId,
      available: true,
      user: store.state.users[store.actor?.userId ?? store.state.botUserId],
    };
    store.state.soundboardSounds[id] = sound;
    store.changed();
    this.dispatch('GUILD_SOUNDBOARD_SOUND_CREATE', sound);
    store.audit(guildId, AuditLogEvent.soundboardSoundCreate, id, auditChanges({}, sound, SOUND_FIELDS));
    return sound;
  }

  update(guildId: string, soundId: string, body: Json): Json {
    const sound = this.require(guildId, soundId);
    this.checkFields(body);
    const before = { ...sound };
    for (const key of SOUND_FIELDS) {
      if (body[key] !== undefined) sound[key] = body[key];
    }
    this.store.changed();
    this.dispatch('GUILD_SOUNDBOARD_SOUND_UPDATE', sound);
    this.store.audit(guildId, AuditLogEvent.soundboardSoundUpdate, soundId, auditChanges(before, sound, SOUND_FIELDS));
    return sound;
  }

  private removeSound(sound: Json): void {
    delete this.store.state.soundboardSounds[sound.sound_id];
    delete this.store.state.media[sound.sound_id];
    this.store.changed();
  }

  /** Bot が接続しているボイスチャンネルでサウンドを鳴らす。 */
  send(channelId: string, body: Json): void {
    const { store } = this;
    const channel = store.requireChannel(channelId);
    if (!isVoiceType(channel.type)) throw new BadRequest('ボイスチャンネルではありません', ErrorCode.invalidForm);
    const voice = store.state.voiceStates[`${channel.guild_id}:${store.state.botUserId}`];
    if (voice?.channel_id !== channelId) throw new BadRequest('Bot がこのボイスチャンネルに接続していません', ErrorCode.notConnected);
    const soundId = String(body.sound_id ?? '');
    const sound = body.source_guild_id
      ? this.require(String(body.source_guild_id), soundId)
      : (store.state.soundboardSounds[soundId] ?? DEFAULT_SOUNDS.find((candidate) => candidate.sound_id === soundId));
    if (!sound) throw new NotFound('Unknown Soundboard Sound', ErrorCode.unknownSound);
    this.dispatch('VOICE_CHANNEL_EFFECT_SEND', {
      channel_id: channelId,
      guild_id: channel.guild_id,
      user_id: store.state.botUserId,
      ...(sound.emoji_name || sound.emoji_id ? { emoji: { id: sound.emoji_id, name: sound.emoji_name } } : {}),
      sound_id: sound.sound_id,
      sound_volume: sound.volume,
    });
  }

  /** Gateway の Request Soundboard Sounds への応答。 */
  soundsPayload(guildId: string): Json {
    return { guild_id: guildId, soundboard_sounds: this.guildSounds(guildId) };
  }
}
