import type { InteractResult, Json } from '@dismock/server';
import type { MockApi } from './mock-api.js';

/** {@link Actor} の操作のオプション。 */
export interface ActionOptions {
  /** 操作するチャンネル。省略するとテストの既定のチャンネルを使う。 */
  channelId?: string;
  /** Bot の応答を待つ時間。既定は 3000ms。 */
  timeoutMs?: number;
}

/** 操作の対象のメッセージ。メッセージのオブジェクトまたは ID。 */
export type MessageRef = Json | string;

/**
 * ダミーユーザーとして操作する。
 *
 * @remarks
 * テストでは `actor` や `actors` として受け取り、別のユーザーの操作には {@link TestClient.as} を使う。
 *
 * @example
 * ```ts
 * test('挨拶を返す', async ({ actor }) => {
 *   const reply = await actor.command('hello');
 *   expect(reply.content).toContain(actor.user.username);
 * });
 * ```
 */
export class Actor {
  /** @internal */
  constructor(
    private readonly api: MockApi,
    /** 操作するユーザー。 */
    readonly user: Json,
    private readonly defaultChannel: () => string | undefined,
  ) {}

  /** 操作するユーザーの ID。 */
  get id(): string {
    return this.user.id;
  }

  private channel(options: ActionOptions = {}, message?: MessageRef): string {
    const fromMessage = typeof message === 'object' ? (message.channel_id as string) : undefined;
    const channelId = options.channelId ?? fromMessage ?? this.defaultChannel();
    if (!channelId) throw new Error('dismock: 操作するチャンネルを指定してください');
    return channelId;
  }

  /**
   * メッセージを送信し、Bot に `MESSAGE_CREATE` を配信する。
   *
   * @param content - メッセージの本文。
   * @param options - 操作のオプション。
   * @returns 作成されたメッセージ。Bot の応答は待たない。
   */
  sendMessage(content: string, options?: ActionOptions): Promise<Json> {
    return this.api.sendMessage(this.id, this.channel(options), content);
  }

  /**
   * スラッシュコマンドを実行し、Bot の応答を待つ。
   *
   * @param name - コマンド名。サブコマンドは `'group sub'` のように空白で区切る。
   * @param options - コマンドのオプションの名前と値。
   * @param action - 操作のオプション。
   * @returns Bot の応答のメッセージまたはモーダル。
   */
  async command(name: string, options: Json = {}, action: ActionOptions = {}): Promise<Json> {
    const result = await this.api.interact({
      kind: 'command',
      userId: this.id,
      channelId: this.channel(action),
      name,
      options,
      timeoutMs: action.timeoutMs,
    });
    return result.message ?? result.modal ?? {};
  }

  /**
   * メッセージのボタンを押す。
   *
   * @param message - ボタンのあるメッセージ。
   * @param customId - ボタンの `custom_id`。
   * @param options - 操作のオプション。
   * @returns Bot の応答。
   */
  click(message: MessageRef, customId: string, options?: ActionOptions): Promise<InteractResult> {
    return this.component('button', message, customId, undefined, options);
  }

  /**
   * メッセージのセレクトメニューを選択する。
   *
   * @param message - セレクトメニューのあるメッセージ。
   * @param customId - セレクトメニューの `custom_id`。
   * @param values - 選択する値。
   * @param options - 操作のオプション。
   * @returns Bot の応答。
   */
  select(message: MessageRef, customId: string, values: string[], options?: ActionOptions): Promise<InteractResult> {
    return this.component('select', message, customId, values, options);
  }

  private component(
    kind: 'button' | 'select',
    message: MessageRef,
    customId: string,
    values: string[] | undefined,
    options: ActionOptions = {},
  ): Promise<InteractResult> {
    return this.api.interact({
      kind,
      userId: this.id,
      channelId: this.channel(options, message),
      messageId: typeof message === 'string' ? message : (message.id as string),
      customId,
      values,
      timeoutMs: options.timeoutMs,
    });
  }

  /**
   * モーダルを送信する。
   *
   * @param customId - モーダルの `custom_id`。
   * @param fields - 入力欄の `custom_id` と値。
   * @param options - 操作のオプション。
   * @returns Bot の応答。
   */
  submitModal(customId: string, fields: Record<string, string>, options: ActionOptions = {}): Promise<InteractResult> {
    return this.api.interact({
      kind: 'modal',
      userId: this.id,
      channelId: this.channel(options),
      customId,
      fields,
      timeoutMs: options.timeoutMs,
    });
  }

  /**
   * メッセージにリアクションを付ける。
   *
   * @param message - 対象のメッセージ。
   * @param emoji - 絵文字。
   */
  react(message: Json, emoji: string): Promise<unknown> {
    return this.api.react(this.id, message.channel_id, message.id, emoji);
  }

  /** このユーザーでログインし、宛先が自分の DM を取得する。 */
  async dms(): Promise<Json[]> {
    await this.api.switchUser(this.id);
    return this.api.dms(this.id);
  }

  /** このユーザーで Mock の画面にログインする。 */
  login(): Promise<unknown> {
    return this.api.switchUser(this.id);
  }

  /**
   * ボイスチャンネルに接続する。
   *
   * @param guildId - サーバーの ID。
   * @param channelId - ボイスチャンネルの ID。
   * @returns 更新後のボイス状態。
   */
  joinVoice(guildId: string, channelId: string): Promise<Json> {
    return this.api.setVoice(this.id, guildId, channelId);
  }

  /**
   * ボイスチャンネルから切断する。
   *
   * @param guildId - サーバーの ID。
   * @returns 更新後のボイス状態。
   */
  leaveVoice(guildId: string): Promise<Json> {
    return this.api.setVoice(this.id, guildId, null);
  }
}
