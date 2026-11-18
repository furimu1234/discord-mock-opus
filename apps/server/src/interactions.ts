import { BOT_NOT_CONNECTED_STATUS, CHAT_INPUT_COMMAND_TYPE, ComponentType, INTERACTION_TIMEOUT_STATUS, MESSAGE_COMMAND_TYPE, USER_COMMAND_TYPE } from './constants.js';
import { randomBytes } from 'node:crypto';
import { NotFound, snowflake, type Json, type Store } from './store.js';

const InteractionType = { command: 2, component: 3, modal: 5 } as const;
const CallbackType = {
  pong: 1,
  reply: 4,
  deferReply: 5,
  deferUpdate: 6,
  update: 7,
  modal: 9,
} as const;
const EPHEMERAL = 64;
const LOADING = 128;
const OptionType = { subcommand: 1, group: 2, user: 6, channel: 7, role: 8, mentionable: 9 } as const;

/** @internal */
export interface InteractRequest {
  kind: 'command' | 'button' | 'select' | 'modal';
  userId: string;
  channelId: string;
  name?: string;
  options?: Json;
  /** ユーザーコマンド（右クリックの「アプリ」）の対象のユーザー。 */
  targetId?: string;
  /** メッセージコマンド（メッセージの「アプリ」）の対象のメッセージ。 */
  targetMessageId?: string;
  messageId?: string;
  customId?: string;
  values?: string[];
  fields?: Record<string, string>;
  timeoutMs?: number;
  /** `false` のときは、Bot が defer した時点で `deferred` として戻る。既定は応答の内容が届くまで待つ。 */
  waitForReply?: boolean;
  /** テストの `watchModal` の中の操作で、開いたモーダルを画面に表示しておく時間。ないときは画面に表示しない。 */
  watchModalMs?: number;
}

/** インタラクションに対する Bot の応答。 */
export interface InteractResult {
  /**
   * 応答の種類。`message` は新しいメッセージ、`modal` はモーダル、`update` は元のメッセージの更新。
   * `deferred` は `waitForReply: false` で、Bot が defer した時点で戻ったもの。
   */
  kind: 'message' | 'modal' | 'update' | 'deferred';
  /** `kind` が `message`、`update` のときのメッセージ。`deferred` のときは読み込み中のメッセージか、ボタンなどのあるメッセージ。 */
  message?: Json;
  /** `kind` が `modal` のときのモーダル。 */
  modal?: Json;
  /** ボタンやセレクトメニューの操作で、操作したメッセージの応答の後の状態。削除されていればない。 */
  source?: Json;
}

interface Pending {
  id: string;
  token: string;
  type: number;
  channelId: string;
  user: Json;
  commandName?: string;
  targetUser?: Json;
  targetMessageId?: string;
  sourceMessageId?: string;
  originalMessageId?: string;
  deferred: boolean;
  /** `deferReply` の後で、まだ応答の内容を送っていない。 */
  loading: boolean;
  /** defer した時点で操作を戻す。 */
  settleOnDefer: boolean;
  /** テストの `watchModal` の中の操作で、開いたモーダルを画面に表示しておく時間。 */
  watchModalMs?: number;
  /** `deferReply` の後は、応答の制限時間をトークンの有効期限まで延ばす。 */
  defer: () => void;
  settle: (result: InteractResult) => void;
}

/** Webhook の API で元の応答を指す ID。 */
const ORIGINAL_MESSAGE = '@original';

/** Discord のインタラクションのトークンの有効期限。 */
const INTERACTION_TOKEN_LIFETIME_MS = 15 * 60 * 1000;

/** `custom_id` の一致するコンポーネントを、アクションロウと Components V2 のコンテナやセクションの中から探す。 */
const findComponent = (components: Json[] | undefined, customId: string): Json | undefined => {
  for (const component of components ?? []) {
    if (component.custom_id === customId) return component;
    const found = findComponent([...(component.components ?? []), ...(component.accessory ? [component.accessory] : [])], customId);
    if (found) return found;
  }
  return undefined;
};

/** メッセージにあるコンポーネントの `custom_id` を、コンテナやセクションの中まで集める。 */
const customIds = (components: Json[] | undefined): string[] =>
  (components ?? []).flatMap((component) => [
    ...(component.custom_id ? [component.custom_id as string] : []),
    ...customIds([...(component.components ?? []), ...(component.accessory ? [component.accessory] : [])]),
  ]);

const modalSourceKey = (userId: string, customId: string | undefined) => `${userId}:${customId}`;

export class TimeoutError extends Error {
  readonly status = INTERACTION_TIMEOUT_STATUS;
  readonly code = 0;
}

/** Bot に配信したインタラクションと、その応答を結び付ける。 */
export class Interactions {
  private readonly pending = new Map<string, Pending>();
  /**
   * ボタンなどから開いたモーダルの、開いたチャンネルとメッセージ。キーは `ユーザー ID:モーダルの custom_id`。
   * Discord と同じく、そのモーダルの送信は開いたチャンネルで行い、`message` を入れて `deferUpdate` や `update` で書き換えられるようにする。
   */
  private readonly modalSources = new Map<string, { channelId: string; messageId: string }>();

  constructor(
    private readonly store: Store,
    private readonly dispatch: (event: string, data: Json) => void,
    /** Bot が Gateway に接続しているか。接続していなければ、応答を待たずにエラーにする。 */
    private readonly isBotConnected: () => boolean = () => true,
  ) {}

  /** `watched` はテストの操作で、`watchModalMs` があれば開いたモーダルと送信した値を画面に見せる。 */
  async interact(request: InteractRequest, watched = false): Promise<InteractResult> {
    const { store } = this;
    if (!this.isBotConnected()) {
      throw Object.assign(new Error('The application is not connected to the gateway'), { status: BOT_NOT_CONNECTED_STATUS, code: 0 });
    }
    const user = store.requireUser(request.userId);
    // モーダルの送信は、指定によらずモーダルを開いたチャンネルで行う。
    const modalSource = request.kind === 'modal' ? this.takeModalSource(user.id, request.customId) : undefined;
    const channel = store.requireChannel(modalSource?.channelId ?? request.channelId);
    const id = snowflake();
    const token = randomBytes(24).toString('base64url');
    const payload = this.buildPayload(request, id, token, user, channel, modalSource?.messageId);
    const timeoutMs = request.timeoutMs ?? 3000;
    // DM の内容は宛先のログインでしか見られないので、画面には配信しない。
    const shown = watched && channel.guild_id !== undefined;
    // 送信した値は、画面が表示しているモーダルのときだけ画面が使う。
    if (shown && request.kind === 'modal') {
      store.emit('ui', 'MODAL_SUBMIT', { channelId: channel.id, customId: request.customId, fields: request.fields ?? {} });
    }

    return new Promise<InteractResult>((resolve, reject) => {
      const expireAfter = (delayMs: number) =>
        setTimeout(() => {
          this.pending.delete(token);
          reject(new TimeoutError(`The application did not respond within ${delayMs}ms`));
        }, delayMs).unref();
      let timer = expireAfter(timeoutMs);
      this.pending.set(token, {
        id,
        token,
        type: payload.type,
        channelId: channel.id,
        user,
        commandName: request.kind === 'command' ? request.name : undefined,
        targetUser: request.targetId ? store.requireUser(request.targetId) : undefined,
        targetMessageId: request.targetMessageId,
        sourceMessageId: payload.message?.id,
        deferred: false,
        loading: false,
        settleOnDefer: request.waitForReply === false,
        watchModalMs: shown ? request.watchModalMs : undefined,
        defer: () => {
          clearTimeout(timer);
          timer = expireAfter(INTERACTION_TOKEN_LIFETIME_MS);
        },
        settle: (result) => {
          clearTimeout(timer);
          const source = payload.message && store.state.messages[channel.id]?.find((m) => m.id === payload.message.id);
          resolve(source ? { ...result, source } : result);
        },
      });
      this.dispatch('INTERACTION_CREATE', payload);
    });
  }

  /** ボタンなどから開いたモーダルの、開いたチャンネルとメッセージ。一度の送信で使い切る。 */
  private takeModalSource(userId: string, customId: string | undefined) {
    const key = modalSourceKey(userId, customId);
    const source = this.modalSources.get(key);
    this.modalSources.delete(key);
    return source;
  }

  /** `modalSourceId` はモーダルを開いたメッセージで、モーダルの送信の `message` になる。 */
  private buildPayload(request: InteractRequest, id: string, token: string, user: Json, channel: Json, modalSourceId?: string): Json {
    const { store } = this;
    const guildId = channel.guild_id as string | undefined;
    const member = guildId ? store.requireMember(guildId, user.id) : undefined;
    const base = {
      id,
      token,
      application_id: store.state.applicationId,
      version: 1,
      channel_id: channel.id,
      channel,
      app_permissions: '8',
      locale: 'en-US',
      entitlements: [],
      authorizing_integration_owners: { '0': guildId ?? '0' },
      context: guildId ? 0 : 1,
      ...(guildId
        ? {
            guild_id: guildId,
            guild_locale: 'en-US',
            member: { ...member, permissions: store.memberPermissions(guildId, user.id, channel.id) },
          }
        : { user }),
    };
    if (request.kind === 'command') {
      return { ...base, type: InteractionType.command, data: this.commandData(request, guildId) };
    }
    if (request.kind === 'modal') {
      const source = modalSourceId ? store.state.messages[channel.id]?.find((m) => m.id === modalSourceId) : undefined;
      return {
        ...base,
        type: InteractionType.modal,
        ...(source ? { message: source } : {}),
        data: {
          custom_id: request.customId,
          components: Object.entries(request.fields ?? {}).map(([customId, value]) => ({
            type: 1,
            components: [{ type: 4, custom_id: customId, value }],
          })),
        },
      };
    }
    const { customId, messageId } = request;
    if (!customId || !messageId) throw new Error('customId and messageId are required');
    const message = store.findMessage(channel.id, messageId);
    const component = findComponent(message.components, customId);
    if (!component) {
      const available = customIds(message.components).join(', ') || 'none';
      throw new Error(`Unknown component: ${customId} (message ${messageId} has: ${available})`);
    }
    const values = request.values ?? [];
    const resolved = this.selectResolved(component.type, values, guildId);
    return {
      ...base,
      type: InteractionType.component,
      message,
      data: {
        custom_id: request.customId,
        component_type: component.type,
        ...(request.kind === 'select' ? { values } : {}),
        ...(Object.keys(resolved).length ? { resolved } : {}),
      },
    };
  }

  /** ユーザー、ロール、チャンネルのセレクトメニューで選んだものを `resolved` に入れる。 */
  private selectResolved(type: number, values: string[], guildId?: string): Json {
    const resolved: Json = {};
    for (const id of values) {
      if (type === ComponentType.channelSelect) this.resolveChannel(id, resolved);
      else if (type === ComponentType.roleSelect) this.resolveRole(id, resolved, guildId);
      else if (type === ComponentType.userSelect) this.resolveUser(id, resolved, guildId);
      else if (type === ComponentType.mentionableSelect) {
        if (this.findRole(id, guildId)) this.resolveRole(id, resolved, guildId);
        else this.resolveUser(id, resolved, guildId);
      }
    }
    return resolved;
  }

  private findRole(roleId: string, guildId?: string): Json | undefined {
    return guildId ? this.store.requireGuild(guildId).roles.find((r) => r.id === roleId) : undefined;
  }

  private resolveRole(roleId: string, resolved: Json, guildId?: string): void {
    const role = this.findRole(roleId, guildId);
    if (!role) return;
    resolved.roles ??= {};
    resolved.roles[roleId] = role;
  }

  private resolveChannel(channelId: string, resolved: Json): void {
    resolved.channels ??= {};
    resolved.channels[channelId] = this.store.requireChannel(channelId);
  }

  private findCommand(name: string | undefined, guildId: string | undefined, type: number): Json {
    const command = this.store.state.commands.find(
      (c) =>
        c.name === name && (c.type ?? CHAT_INPUT_COMMAND_TYPE) === type && (c.guild_id === undefined || c.guild_id === guildId),
    );
    if (!command) throw new Error(`Command is not registered: ${name}`);
    return command;
  }

  private userCommandData(request: InteractRequest, guildId?: string): Json {
    const command = this.findCommand(request.name, guildId, USER_COMMAND_TYPE);
    const resolved: Json = {};
    this.resolveUser(request.targetId!, resolved, guildId);
    return {
      id: command.id,
      name: command.name,
      type: command.type,
      target_id: request.targetId,
      resolved,
      ...(guildId ? { guild_id: guildId } : {}),
    };
  }

  private resolveUser(userId: string, resolved: Json, guildId?: string): void {
    const { store } = this;
    (resolved.users ??= {})[userId] = store.requireUser(userId);
    if (!guildId) return;
    const { user: _user, ...member } = store.requireMember(guildId, userId);
    (resolved.members ??= {})[userId] = { ...member, permissions: store.memberPermissions(guildId, userId) };
  }

  private messageCommandData(request: InteractRequest, guildId?: string): Json {
    const command = this.findCommand(request.name, guildId, MESSAGE_COMMAND_TYPE);
    const message = this.store.findMessage(request.channelId, request.targetMessageId!);
    return {
      id: command.id,
      name: command.name,
      type: command.type,
      target_id: message.id,
      resolved: { messages: { [message.id]: message } },
      ...(guildId ? { guild_id: guildId } : {}),
    };
  }

  private commandData(request: InteractRequest, guildId?: string): Json {
    if (request.targetId) return this.userCommandData(request, guildId);
    if (request.targetMessageId) return this.messageCommandData(request, guildId);
    const [name, ...path] = (request.name ?? '').split(' ');
    const command = this.findCommand(name, guildId, CHAT_INPUT_COMMAND_TYPE);

    const resolved: Json = {};
    let definitions: Json[] = command.options ?? [];
    const chain: Json[] = [];
    for (const segment of path) {
      const definition = definitions.find((o) => o.name === segment);
      if (!definition) throw new Error(`Unknown subcommand: ${request.name}`);
      chain.push(definition);
      definitions = definition.options ?? [];
    }
    let options = Object.entries(request.options ?? {}).map(([optionName, value]) =>
      this.commandOption(definitions, optionName, value, resolved, guildId),
    );
    for (const definition of chain.reverse()) {
      options = [{ name: definition.name, type: definition.type, options }];
    }
    return {
      id: command.id,
      name: command.name,
      type: command.type,
      options,
      ...(guildId ? { guild_id: guildId } : {}),
      ...(Object.keys(resolved).length ? { resolved } : {}),
    };
  }

  private commandOption(
    definitions: Json[],
    name: string,
    value: unknown,
    resolved: Json,
    guildId?: string,
  ): Json {
    const definition = definitions.find((o) => o.name === name);
    if (!definition) throw new Error(`Unknown command option: ${name}`);
    const raw = typeof value === 'object' && value !== null ? (value as Json).id : value;
    if (definition.type === OptionType.user || definition.type === OptionType.mentionable) {
      this.resolveUser(raw, resolved, guildId);
    } else if (definition.type === OptionType.role) {
      this.resolveRole(raw, resolved, guildId);
    } else if (definition.type === OptionType.channel) {
      this.resolveChannel(raw, resolved);
    }
    return { name, type: definition.type, value: raw };
  }

  /** `with_response` のときに Bot へ返す内容を返す。 */
  callback(interactionId: string, token: string, body: Json): Json {
    const entry = this.pending.get(token);
    if (!entry || entry.id !== interactionId) {
      throw Object.assign(new Error('Unknown interaction'), { status: 404, code: 10062 });
    }
    const { type, uploads } = body;
    const data = { ...(body.data ?? {}), ...(uploads ? { uploads } : {}) };
    const { store } = this;
    let message: Json | undefined;
    if (type === CallbackType.reply || type === CallbackType.deferReply) {
      const flags = (data.flags ?? 0) | (type === CallbackType.deferReply ? LOADING : 0);
      message = store.createMessage(entry.channelId, store.botUser, { ...data, flags }, {
        type: entry.targetUser || entry.targetMessageId ? 23 : entry.commandName ? 20 : 19,
        webhook_id: store.state.applicationId,
        application_id: store.state.applicationId,
        interaction_metadata: this.metadata(entry),
      });
      entry.originalMessageId = message.id;
      entry.loading = type === CallbackType.deferReply;
      if (type === CallbackType.reply) entry.settle({ kind: 'message', message });
      else this.markDeferred(entry, message);
    } else if (type === CallbackType.update) {
      message = store.editMessage(entry.channelId, entry.sourceMessageId!, data);
      entry.originalMessageId = message.id;
      entry.settle({ kind: 'update', message });
    } else if (type === CallbackType.deferUpdate) {
      entry.originalMessageId = entry.sourceMessageId;
      this.markDeferred(entry, entry.sourceMessageId ? store.findMessage(entry.channelId, entry.sourceMessageId) : undefined);
    } else if (type === CallbackType.modal) {
      if (entry.watchModalMs !== undefined) {
        store.emit('ui', 'MODAL_OPEN', { channelId: entry.channelId, modal: data, durationMs: entry.watchModalMs });
      }
      if (entry.sourceMessageId) {
        this.modalSources.set(modalSourceKey(entry.user.id, data.custom_id), { channelId: entry.channelId, messageId: entry.sourceMessageId });
      }
      entry.settle({ kind: 'modal', modal: data });
    }
    return {
      interaction: { id: entry.id, type: entry.type },
      ...(message ? { resource: { type, message } } : {}),
    };
  }

  private metadata(entry: Pending): Json {
    return {
      id: entry.id,
      type: entry.type,
      user: entry.user,
      authorizing_integration_owners: {},
      ...(entry.commandName ? { name: entry.commandName } : {}),
      ...(entry.targetUser ? { target_user: entry.targetUser } : {}),
      ...(entry.targetMessageId ? { target_message_id: entry.targetMessageId } : {}),
    };
  }

  private markDeferred(entry: Pending, message: Json | undefined): void {
    entry.deferred = true;
    if (entry.settleOnDefer) entry.settle({ kind: 'deferred', message });
    else entry.defer();
  }

  private entry(token: string): Pending {
    const entry = this.pending.get(token);
    if (!entry) throw Object.assign(new Error('Unknown Webhook'), { status: 404, code: 10015 });
    return entry;
  }

  /** インタラクションの応答を返す。`messageId` は `@original` またはフォローアップの ID。 */
  responseMessage(token: string, messageId: string): Json {
    const entry = this.entry(token);
    const id = messageId === ORIGINAL_MESSAGE ? entry.originalMessageId! : messageId;
    const message = this.store.findMessage(entry.channelId, id);
    if (id !== entry.originalMessageId && message.interaction_metadata?.id !== entry.id) {
      throw new NotFound('Unknown Message', 10008);
    }
    return message;
  }

  editResponse(token: string, messageId: string, body: Json): Json {
    const entry = this.entry(token);
    const current = this.responseMessage(token, messageId);
    const flags = ((body.flags ?? current.flags & ~LOADING) | (current.flags & EPHEMERAL)) as number;
    const message = this.store.editMessage(entry.channelId, current.id, { ...body, flags });
    if (current.id === entry.originalMessageId) {
      entry.loading = false;
      if (entry.deferred) entry.settle({ kind: 'message', message });
    }
    return message;
  }

  deleteResponse(token: string, messageId: string): void {
    const entry = this.entry(token);
    this.store.deleteMessage(entry.channelId, this.responseMessage(token, messageId).id);
  }

  followUp(token: string, body: Json): Json {
    const entry = this.entry(token);
    // Discord と同じく、`deferReply` の直後のフォローアップは元の応答の編集になる。
    if (entry.loading) return this.editResponse(token, ORIGINAL_MESSAGE, body);
    const message = this.store.createMessage(entry.channelId, this.store.botUser, body, {
      webhook_id: this.store.state.applicationId,
      application_id: this.store.state.applicationId,
      interaction_metadata: { ...this.metadata(entry), original_response_message_id: entry.originalMessageId },
    });
    if (entry.deferred) entry.settle({ kind: 'message', message });
    return message;
  }

  clear(): void {
    this.pending.clear();
  }
}
