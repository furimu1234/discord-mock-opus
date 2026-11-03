import type { InteractResult, Json } from '@dismock/server';
import type { APIMessage, APIModalInteractionResponseCallbackData } from 'discord.js';
import type { MockApi, MockInteractResult } from './mock-api.js';

/** {@link Actor} の操作のオプション。 */
export interface ActionOptions {
  /** 操作するチャンネル。省略するとテストの既定のチャンネルを使う。 */
  channelId?: string;
  /** Bot の応答を待つ時間。既定は 3000ms。 */
  timeoutMs?: number;
  /**
   * `false` にすると、Bot が defer した時点で `kind: 'deferred'` として戻る。
   * 既定では、defer の後も応答の内容が届くまで待つ。
   * defer した後で応答せずに別のメッセージを送る Bot は、`false` にして、テストの引数の `traffic`（{@link Traffic}）で流れを検証する。
   */
  waitForReply?: boolean;
}

/** {@link ActionOptions} のうち、Mock の操作にそのまま渡すもの。 */
const interactOptions = ({ timeoutMs, waitForReply }: ActionOptions = {}) => ({ timeoutMs, waitForReply });

/** 操作の対象のメッセージ。メッセージのオブジェクトまたは ID。 */
export type MessageRef = Json | string;

/** Mock から受け取ったメッセージ。 */
export interface MockMessage extends APIMessage {
  /**
   * メッセージの最新の状態を取得する。Bot が編集した後の内容の確認に使う。
   *
   * @returns 最新のメッセージ。
   */
  fetch(): Promise<MockMessage>;
}

/** コマンドの応答。モーダルのときは `custom_id` と `title` が入り、`fetch` は使えない。 */
export type CommandReply = MockMessage & Partial<Pick<APIModalInteractionResponseCallbackData, 'custom_id' | 'title'>>;

/** ボタン、セレクトメニュー、モーダルの操作に対する Bot の応答。 */
export interface ActionResult extends Pick<InteractResult, 'kind'> {
  /**
   * 操作したメッセージ（押したボタンや選んだセレクトメニューのあるメッセージ）の、Bot の応答の後の状態。
   * モーダルの送信では、ボタンなどから開いたモーダルのときに、そのメッセージが入る。メッセージが削除されたときは入らない。
   */
  message?: MockMessage;
  /**
   * Bot が新しく送った応答のメッセージ。`kind` が `message` のとき、または `deferReply` で `deferred` のときの読み込み中のメッセージ。
   */
  reply?: MockMessage;
  /** `kind` が `modal` のときのモーダル。 */
  modal?: APIModalInteractionResponseCallbackData;
}

const toCommandReply = ({ message, modal }: MockInteractResult) => (message ?? modal ?? {}) as CommandReply;

/** Mock の `message` は応答のメッセージなので、操作したメッセージ（`source`）と分けて返す。 */
const toActionResult = ({ kind, message, modal, source }: MockInteractResult): ActionResult => {
  const updated = kind === 'update' || (message !== undefined && message.id === source?.id);
  return {
    kind,
    message: source ?? (updated ? message : undefined),
    reply: updated ? undefined : message,
    modal: modal as APIModalInteractionResponseCallbackData | undefined,
  };
};

/**
 * ダミーユーザーとして操作する。
 *
 * @remarks
 * テストでは `actor` や `actors` として受け取り、別のユーザーの操作には {@link TestClient.as} を使う。
 *
 * @example
 * ```ts
 * test('挨拶を返す', {}, async ({ actor }) => {
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
  sendMessage(content: string, options?: ActionOptions): Promise<MockMessage> {
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
  async command(name: string, options: Json = {}, action: ActionOptions = {}): Promise<CommandReply> {
    const result = await this.api.interact({
      kind: 'command',
      userId: this.id,
      channelId: this.channel(action),
      name,
      options,
      ...interactOptions(action),
    });
    return toCommandReply(result);
  }

  /**
   * ユーザーコマンド（ユーザーの右クリックの「アプリ」）を実行し、Bot の応答を待つ。
   *
   * @param name - コマンド名。
   * @param target - 対象のユーザー、またはその ID。
   * @param action - 操作のオプション。
   * @returns Bot の応答のメッセージまたはモーダル。
   */
  async userCommand(name: string, target: string | { id: string }, action: ActionOptions = {}): Promise<CommandReply> {
    const result = await this.api.interact({
      kind: 'command',
      userId: this.id,
      channelId: this.channel(action),
      name,
      targetId: typeof target === 'string' ? target : target.id,
      ...interactOptions(action),
    });
    return toCommandReply(result);
  }

  /**
   * メッセージコマンド（メッセージの右クリックの「アプリ」）を実行する。
   * @param name - コマンドの名前。
   * @param message - 対象のメッセージ、またはその ID。
   */
  async messageCommand(name: string, message: MessageRef, action: ActionOptions = {}): Promise<CommandReply> {
    const result = await this.api.interact({
      kind: 'command',
      userId: this.id,
      channelId: this.channel(action, message),
      name,
      targetMessageId: typeof message === 'string' ? message : (message.id as string),
      ...interactOptions(action),
    });
    return toCommandReply(result);
  }

  /**
   * メッセージのボタンを押す。
   *
   * @param message - ボタンのあるメッセージ。
   * @param customId - ボタンの `custom_id`。
   * @param options - 操作のオプション。
   * @returns Bot の応答。
   */
  click(message: MessageRef, customId: string, options?: ActionOptions): Promise<ActionResult> {
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
  select(message: MessageRef, customId: string, values: string[], options?: ActionOptions): Promise<ActionResult> {
    return this.component('select', message, customId, values, options);
  }

  private async component(
    kind: 'button' | 'select',
    message: MessageRef,
    customId: string,
    values: string[] | undefined,
    options: ActionOptions = {},
  ): Promise<ActionResult> {
    const result = await this.api.interact({
      kind,
      userId: this.id,
      channelId: this.channel(options, message),
      messageId: typeof message === 'string' ? message : (message.id as string),
      customId,
      values,
      ...interactOptions(options),
    });
    return toActionResult(result);
  }

  /**
   * モーダルを送信する。
   *
   * @param customId - モーダルの `custom_id`。
   * @param fields - 入力欄の `custom_id` と値。
   * @param options - 操作のオプション。
   * @returns Bot の応答。
   */
  async submitModal(customId: string, fields: Record<string, string>, options: ActionOptions = {}): Promise<ActionResult> {
    const result = await this.api.interact({
      kind: 'modal',
      userId: this.id,
      channelId: this.channel(options),
      customId,
      fields,
      ...interactOptions(options),
    });
    return toActionResult(result);
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
  async dms(): Promise<MockMessage[]> {
    await this.api.switchUser(this.id);
    return this.api.dms(this.id);
  }

  /**
   * 投票に答える。前の投票は `answerIds` に置き換わり、何も渡さないと取り消す。
   * @param message - 投票のメッセージ。API の形（`channel_id`）でも discord.js の形（`channelId`）でもよい。
   * @param answerIds - 選ぶ選択肢の `answer_id`。
   */
  vote(message: Json, ...answerIds: number[]): Promise<Json> {
    const channelId = (message.channel_id ?? message.channelId) as string;
    return this.api.vote(this.id, channelId, message.id as string, answerIds);
  }

  /**
   * 招待でサーバーに参加する。参加済みのときは使用回数だけが増える。
   * @param code - 招待のコード。
   */
  acceptInvite(code: string): Promise<Json> {
    return this.api.acceptInvite(this.id, code);
  }

  /** このユーザーでログインし、参加するグループ DM のチャンネルとメッセージの組を取得する。 */
  async groupDms(): Promise<Json[]> {
    await this.api.switchUser(this.id);
    return this.api.groupDms(this.id);
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
