import { createHmac } from 'node:crypto';
import { mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { extname, join } from 'node:path';
import { MAX_ATTACHMENT_BYTES, MAX_ATTACHMENTS } from './constants.js';
import { BadRequest, snowflake, type Json } from './store.js';

const ErrorCode = { tooLarge: 40005, invalidForm: 50035 };
/** DM はサーバーがないので、Discord の URL と同じく `@me` に置く。 */
const DM_FOLDER = '@me';
const ID = /^\d+$/;
const EXTENSION = /^\.[a-z0-9]{1,10}$/i;
/** 画面と同じ場所で開いても安全な形式。これ以外はダウンロードとして返す。 */
const INLINE_TYPES: Record<string, string> = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp',
  '.mp4': 'video/mp4', '.webm': 'video/webm', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.wav': 'audio/wav', '.txt': 'text/plain; charset=utf-8',
};

export interface Upload {
  filename: string;
  contentType: string;
  data: Buffer;
}

export interface ServedFile {
  data: Buffer;
  contentType: string;
  /** 画面で開かず、ダウンロードさせる。 */
  download: boolean;
  filename: string;
}

/**
 * メッセージの添付ファイルを `<dir>/<サーバーID>/<チャンネルID>/<添付ID>.<拡張子>` に保存する。
 * `dir` を省略するとメモリーに保持する。URL には Mock のトークンから作った署名を付け、推測されないようにする。
 */
export class Attachments {
  private readonly memory = new Map<string, Buffer>();

  constructor(
    private readonly dir: string | undefined,
    private readonly secret: () => string,
    private readonly baseUrl: () => string,
  ) {}

  private folder(channel: Json): string {
    return join(channel.guild_id ?? DM_FOLDER, channel.id);
  }

  private fileName(id: string, filename: string): string {
    const extension = extname(filename);
    return `${id}${EXTENSION.test(extension) ? extension.toLowerCase() : ''}`;
  }

  private sign(channelId: string, id: string): string {
    return createHmac('sha256', this.secret()).update(`${channelId}/${id}`).digest('hex');
  }

  private write(path: string, data: Buffer): void {
    if (!this.dir) return void this.memory.set(path, data);
    const full = join(this.dir, path);
    mkdirSync(join(full, '..'), { recursive: true });
    writeFileSync(full, data);
  }

  private remove(path: string): void {
    if (!this.dir) {
      for (const key of [...this.memory.keys()]) if (key === path || key.startsWith(`${path}/`)) this.memory.delete(key);
      return;
    }
    rmSync(join(this.dir, path), { recursive: true, force: true });
  }

  /** 保存して、メッセージの `attachments` の要素を返す。 */
  save(channel: Json, uploads: Upload[]): Json[] {
    if (uploads.length > MAX_ATTACHMENTS) throw new BadRequest(`添付は ${MAX_ATTACHMENTS} 個までです`, ErrorCode.invalidForm);
    const tooLarge = uploads.find((upload) => upload.data.length > MAX_ATTACHMENT_BYTES);
    if (tooLarge) throw Object.assign(new Error(`${tooLarge.filename} は 10MB を超えています`), { status: 413, code: ErrorCode.tooLarge });
    return uploads.map((upload) => {
      const id = snowflake();
      this.write(join(this.folder(channel), this.fileName(id, upload.filename)), upload.data);
      const url = `${this.baseUrl()}/attachments/${channel.id}/${id}/${encodeURIComponent(upload.filename)}?hm=${this.sign(channel.id, id)}`;
      return { id, filename: upload.filename, size: upload.data.length, content_type: upload.contentType || 'application/octet-stream', url, proxy_url: url };
    });
  }

  /** 署名が一致したときだけ返す。 */
  read(channel: Json, id: string, filename: string, signature: string | null): ServedFile | undefined {
    if (!ID.test(id) || signature !== this.sign(channel.id, id)) return undefined;
    const path = join(this.folder(channel), this.fileName(id, filename));
    const data = this.dir ? (statSync(join(this.dir, path), { throwIfNoEntry: false }) && readFileSync(join(this.dir, path))) : this.memory.get(path);
    if (!data) return undefined;
    const inline = INLINE_TYPES[extname(filename).toLowerCase()];
    return { data, contentType: inline ?? 'application/octet-stream', download: !inline, filename };
  }

  /** メッセージの添付を消す。 */
  removeFrom(channel: Json, attachments: Json[] = []): void {
    for (const attachment of attachments) {
      if (ID.test(String(attachment.id))) this.remove(join(this.folder(channel), this.fileName(attachment.id, attachment.filename)));
    }
  }

  removeChannel(channel: Json): void {
    if (ID.test(String(channel.id))) this.remove(this.folder(channel));
  }

  removeGuild(guildId: string): void {
    if (ID.test(guildId)) this.remove(guildId);
  }

  /** 保存したすべての添付を消す。消すのは自分で作ったサーバーと DM のフォルダーだけ。 */
  clear(): void {
    if (!this.dir) return void this.memory.clear();
    const entries = statSync(this.dir, { throwIfNoEntry: false }) ? readdirSync(this.dir) : [];
    for (const name of entries) if (ID.test(name) || name === DM_FOLDER) this.remove(name);
  }
}
