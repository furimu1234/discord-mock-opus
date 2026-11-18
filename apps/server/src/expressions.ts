import { AuditLogEvent, GUILD_EMOJI_LIMIT, GUILD_STICKER_LIMIT } from './constants.js';
import { auditChanges, BadRequest, NotFound, snowflake, type GuildRecord, type Json, type Store } from './store.js';

/** Discord の公開ドキュメントの上限（ブーストなしのサーバー）。 */
const MAX_EMOJI_BYTES = 256 * 1024;
const MAX_STICKER_BYTES = 512 * 1024;
const EMOJI_NAME = /^[\w]{2,32}$/;
const ErrorCode = { unknownEmoji: 10014, unknownSticker: 10060, maxEmojis: 30008, maxStickers: 30039, invalidForm: 50035 };
const STICKER_GUILD = 2;
const StickerFormat: Record<string, number> = { 'image/png': 1, 'image/apng': 2, 'application/json': 3, 'image/gif': 4 };
const EMOJI_FIELDS = ['name', 'roles'];
const STICKER_FIELDS = ['name', 'description', 'tags'];

const dataSize = (data: string) => Buffer.byteLength(data.slice(data.indexOf(',') + 1), 'base64');

/** サーバーの絵文字とスタンプを扱う。画像は Mock の中に data URI で保持する。 */
export class Expressions {
  constructor(private readonly store: Store) {}

  private dispatch(event: string, data: Json): void {
    this.store.emit('dispatch', event, data);
  }

  private notifyEmojis(guild: GuildRecord): void {
    this.store.changed();
    this.dispatch('GUILD_EMOJIS_UPDATE', { guild_id: guild.id, emojis: guild.emojis ?? [] });
  }

  private notifyStickers(guild: GuildRecord): void {
    this.store.changed();
    this.dispatch('GUILD_STICKERS_UPDATE', { guild_id: guild.id, stickers: guild.stickers ?? [] });
  }

  emojis(guildId: string): Json[] {
    return this.store.requireGuild(guildId).emojis ?? [];
  }

  requireEmoji(guildId: string, emojiId: string): Json {
    const emoji = this.emojis(guildId).find((candidate) => candidate.id === emojiId);
    if (!emoji) throw new NotFound('Unknown Emoji', ErrorCode.unknownEmoji);
    return emoji;
  }

  createEmoji(guildId: string, body: Json): Json {
    const guild = this.store.requireGuild(guildId);
    const emojis = (guild.emojis ??= []);
    if (emojis.length >= GUILD_EMOJI_LIMIT) throw new BadRequest('絵文字の上限に達しています', ErrorCode.maxEmojis);
    if (!EMOJI_NAME.test(String(body.name ?? ''))) throw new BadRequest('名前は 2〜32 文字の英数字と _ で指定してください', ErrorCode.invalidForm);
    if (typeof body.image !== 'string' || dataSize(body.image) > MAX_EMOJI_BYTES) throw new BadRequest('画像は 256KB 以下の data URI で指定してください', ErrorCode.invalidForm);
    const id = snowflake();
    this.store.state.media[id] = body.image;
    const emoji = {
      id,
      name: body.name,
      roles: body.roles ?? [],
      user: this.store.state.users[this.store.actor?.userId ?? this.store.state.botUserId],
      require_colons: true,
      managed: false,
      animated: body.image.startsWith('data:image/gif'),
      available: true,
    };
    emojis.push(emoji);
    this.store.markCreated(id);
    this.notifyEmojis(guild);
    this.store.audit(guildId, AuditLogEvent.emojiCreate, id, auditChanges({}, emoji, EMOJI_FIELDS));
    return emoji;
  }

  updateEmoji(guildId: string, emojiId: string, body: Json): Json {
    const emoji = this.requireEmoji(guildId, emojiId);
    const before = { ...emoji };
    if (body.name !== undefined) {
      if (!EMOJI_NAME.test(body.name)) throw new BadRequest('名前は 2〜32 文字の英数字と _ で指定してください', ErrorCode.invalidForm);
      emoji.name = body.name;
    }
    if (body.roles !== undefined) emoji.roles = body.roles;
    this.notifyEmojis(this.store.requireGuild(guildId));
    this.store.audit(guildId, AuditLogEvent.emojiUpdate, emojiId, auditChanges(before, emoji, EMOJI_FIELDS));
    return emoji;
  }

  deleteEmoji(guildId: string, emojiId: string): void {
    const emoji = this.requireEmoji(guildId, emojiId);
    const guild = this.store.requireGuild(guildId);
    guild.emojis = this.emojis(guildId).filter((candidate) => candidate.id !== emojiId);
    delete this.store.state.media[emojiId];
    this.notifyEmojis(guild);
    this.store.audit(guildId, AuditLogEvent.emojiDelete, emojiId, auditChanges(emoji, {}, EMOJI_FIELDS));
  }

  stickers(guildId: string): Json[] {
    return this.store.requireGuild(guildId).stickers ?? [];
  }

  requireSticker(stickerId: string, guildId?: string): Json {
    const guilds = guildId ? [this.store.requireGuild(guildId)] : Object.values(this.store.state.guilds);
    const sticker = guilds.flatMap((guild) => guild.stickers ?? []).find((candidate) => candidate.id === stickerId);
    if (!sticker) throw new NotFound('Unknown Sticker', ErrorCode.unknownSticker);
    return sticker;
  }

  /** `file` は data URI。API ではマルチパートのファイルを変換して渡す。 */
  createSticker(guildId: string, body: Json): Json {
    const guild = this.store.requireGuild(guildId);
    const stickers = (guild.stickers ??= []);
    if (stickers.length >= GUILD_STICKER_LIMIT) throw new BadRequest('スタンプの上限に達しています', ErrorCode.maxStickers);
    const name = String(body.name ?? '');
    if (name.length < 2 || name.length > 30) throw new BadRequest('名前は 2〜30 文字で指定してください', ErrorCode.invalidForm);
    const file = body.file as string | undefined;
    const type = file?.slice(5, file.indexOf(';')) ?? '';
    if (!file || !StickerFormat[type] || dataSize(file) > MAX_STICKER_BYTES) {
      throw new BadRequest('ファイルは 512KB 以下の PNG、APNG、GIF、Lottie で指定してください', ErrorCode.invalidForm);
    }
    const id = snowflake();
    this.store.state.media[id] = file;
    const sticker = {
      id,
      name,
      description: body.description ?? '',
      tags: String(body.tags ?? ''),
      type: STICKER_GUILD,
      format_type: StickerFormat[type],
      available: true,
      guild_id: guildId,
      user: this.store.state.users[this.store.actor?.userId ?? this.store.state.botUserId],
    };
    stickers.push(sticker);
    this.store.markCreated(id);
    this.notifyStickers(guild);
    this.store.audit(guildId, AuditLogEvent.stickerCreate, id, auditChanges({}, sticker, STICKER_FIELDS));
    return sticker;
  }

  updateSticker(guildId: string, stickerId: string, body: Json): Json {
    const sticker = this.requireSticker(stickerId, guildId);
    const before = { ...sticker };
    for (const key of STICKER_FIELDS) {
      if (body[key] !== undefined) sticker[key] = body[key];
    }
    this.notifyStickers(this.store.requireGuild(guildId));
    this.store.audit(guildId, AuditLogEvent.stickerUpdate, stickerId, auditChanges(before, sticker, STICKER_FIELDS));
    return sticker;
  }

  deleteSticker(guildId: string, stickerId: string): void {
    const sticker = this.requireSticker(stickerId, guildId);
    const guild = this.store.requireGuild(guildId);
    guild.stickers = this.stickers(guildId).filter((candidate) => candidate.id !== stickerId);
    delete this.store.state.media[stickerId];
    this.notifyStickers(guild);
    this.store.audit(guildId, AuditLogEvent.stickerDelete, stickerId, auditChanges(sticker, {}, STICKER_FIELDS));
  }
}
