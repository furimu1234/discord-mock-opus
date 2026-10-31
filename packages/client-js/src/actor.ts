import type { InteractResult, Json } from '@dismock/server';
import type { MockApi } from './mock-api.js';

export interface ActionOptions {
  /** 操作するチャンネル。省略するとテストの既定のチャンネルを使う。 */
  channelId?: string;
  /** Bot の応答を待つ時間。既定は 3000ms。 */
  timeoutMs?: number;
}

type MessageRef = Json | string;

/** ダミーユーザーとして操作する。 */
export class Actor {
  constructor(
    private readonly api: MockApi,
    readonly user: Json,
    private readonly defaultChannel: () => string | undefined,
  ) {}

  get id(): string {
    return this.user.id;
  }

  private channel(options: ActionOptions = {}, message?: MessageRef): string {
    const fromMessage = typeof message === 'object' ? (message.channel_id as string) : undefined;
    const channelId = options.channelId ?? fromMessage ?? this.defaultChannel();
    if (!channelId) throw new Error('dismock: 操作するチャンネルを指定してください');
    return channelId;
  }

  sendMessage(content: string, options?: ActionOptions): Promise<Json> {
    return this.api.sendMessage(this.id, this.channel(options), content);
  }

  /** スラッシュコマンドを実行する。サブコマンドは `'group sub'` のように空白で区切る。 */
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

  click(message: MessageRef, customId: string, options?: ActionOptions): Promise<InteractResult> {
    return this.component('button', message, customId, undefined, options);
  }

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

  react(message: Json, emoji: string): Promise<unknown> {
    return this.api.react(this.id, message.channel_id, message.id, emoji);
  }

  /** このユーザーでログインし、宛先が自分の DM を取得する。 */
  async dms(): Promise<Json[]> {
    await this.api.switchUser(this.id);
    return this.api.dms(this.id);
  }

  login(): Promise<unknown> {
    return this.api.switchUser(this.id);
  }

  joinVoice(guildId: string, channelId: string): Promise<Json> {
    return this.api.setVoice(this.id, guildId, channelId);
  }

  leaveVoice(guildId: string): Promise<Json> {
    return this.api.setVoice(this.id, guildId, null);
  }
}
