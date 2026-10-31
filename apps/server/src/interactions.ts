import { randomBytes } from 'node:crypto';
import { snowflake, type Json, type Store } from './store.js';

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
const OptionType = { subcommand: 1, group: 2, user: 6, channel: 7, role: 8, mentionable: 9 } as const;

export interface InteractRequest {
  kind: 'command' | 'button' | 'select' | 'modal';
  userId: string;
  channelId: string;
  name?: string;
  options?: Json;
  messageId?: string;
  customId?: string;
  values?: string[];
  fields?: Record<string, string>;
  timeoutMs?: number;
}

export interface InteractResult {
  kind: 'message' | 'modal' | 'update';
  message?: Json;
  modal?: Json;
}

interface Pending {
  id: string;
  token: string;
  type: number;
  channelId: string;
  user: Json;
  commandName?: string;
  sourceMessageId?: string;
  originalMessageId?: string;
  deferred: boolean;
  settle: (result: InteractResult) => void;
}

export class TimeoutError extends Error {
  readonly status = 408;
  readonly code = 0;
}

/** Bot に配信したインタラクションと、その応答を結び付ける。 */
export class Interactions {
  private readonly pending = new Map<string, Pending>();

  constructor(
    private readonly store: Store,
    private readonly dispatch: (event: string, data: Json) => void,
  ) {}

  async interact(request: InteractRequest): Promise<InteractResult> {
    const { store } = this;
    const user = store.requireUser(request.userId);
    const channel = store.requireChannel(request.channelId);
    const id = snowflake();
    const token = randomBytes(24).toString('base64url');
    const payload = this.buildPayload(request, id, token, user, channel);
    const timeoutMs = request.timeoutMs ?? 3000;

    return new Promise<InteractResult>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(token);
        reject(new TimeoutError(`The application did not respond within ${timeoutMs}ms`));
      }, timeoutMs);
      this.pending.set(token, {
        id,
        token,
        type: payload.type,
        channelId: channel.id,
        user,
        commandName: request.kind === 'command' ? request.name : undefined,
        sourceMessageId: request.messageId,
        deferred: false,
        settle: (result) => {
          clearTimeout(timer);
          resolve(result);
        },
      });
      this.dispatch('INTERACTION_CREATE', payload);
    });
  }

  private buildPayload(request: InteractRequest, id: string, token: string, user: Json, channel: Json): Json {
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
        ? { guild_id: guildId, guild_locale: 'en-US', member: { ...member, permissions: '8' } }
        : { user }),
    };
    if (request.kind === 'command') {
      return { ...base, type: InteractionType.command, data: this.commandData(request, guildId) };
    }
    if (request.kind === 'modal') {
      return {
        ...base,
        type: InteractionType.modal,
        data: {
          custom_id: request.customId,
          components: Object.entries(request.fields ?? {}).map(([customId, value]) => ({
            type: 1,
            components: [{ type: 4, custom_id: customId, value }],
          })),
        },
      };
    }
    const message = store.findMessage(channel.id, request.messageId!);
    const component = message.components
      .flatMap((row: Json) => row.components ?? [])
      .find((c: Json) => c.custom_id === request.customId);
    if (!component) throw new Error(`Unknown component: ${request.customId}`);
    return {
      ...base,
      type: InteractionType.component,
      message,
      data: {
        custom_id: request.customId,
        component_type: component.type,
        ...(request.kind === 'select' ? { values: request.values ?? [] } : {}),
      },
    };
  }

  private commandData(request: InteractRequest, guildId?: string): Json {
    const [name, ...path] = (request.name ?? '').split(' ');
    const command = this.store.state.commands.find(
      (c) => c.name === name && (c.guild_id === undefined || c.guild_id === guildId),
    );
    if (!command) throw new Error(`Command is not registered: ${name}`);

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
    const { store } = this;
    if (definition.type === OptionType.user || definition.type === OptionType.mentionable) {
      (resolved.users ??= {})[raw] = store.requireUser(raw);
      if (guildId) {
        const { user: _user, ...member } = store.requireMember(guildId, raw);
        (resolved.members ??= {})[raw] = { ...member, permissions: '8' };
      }
    } else if (definition.type === OptionType.role && guildId) {
      const role = store.requireGuild(guildId).roles.find((r) => r.id === raw);
      (resolved.roles ??= {})[raw] = role;
    } else if (definition.type === OptionType.channel) {
      (resolved.channels ??= {})[raw] = store.requireChannel(raw);
    }
    return { name, type: definition.type, value: raw };
  }

  callback(interactionId: string, token: string, body: Json, withResponse: boolean): Json | null {
    const entry = this.pending.get(token);
    if (!entry || entry.id !== interactionId) {
      throw Object.assign(new Error('Unknown interaction'), { status: 404, code: 10062 });
    }
    const { type, data = {} } = body;
    const { store } = this;
    let message: Json | undefined;
    if (type === CallbackType.reply || type === CallbackType.deferReply) {
      const metadata = {
        id: entry.id,
        type: entry.type,
        user: entry.user,
        authorizing_integration_owners: {},
        ...(entry.commandName ? { name: entry.commandName } : {}),
      };
      const flags = (data.flags ?? 0) | (type === CallbackType.deferReply ? 128 : 0);
      message = store.createMessage(entry.channelId, store.botUser, { ...data, flags }, {
        type: entry.commandName ? 20 : 19,
        webhook_id: store.state.applicationId,
        application_id: store.state.applicationId,
        interaction_metadata: metadata,
      });
      entry.originalMessageId = message.id;
      if (type === CallbackType.reply) entry.settle({ kind: 'message', message });
      else entry.deferred = true;
    } else if (type === CallbackType.update) {
      message = store.editMessage(entry.channelId, entry.sourceMessageId!, data);
      entry.originalMessageId = message.id;
      entry.settle({ kind: 'update', message });
    } else if (type === CallbackType.deferUpdate) {
      entry.originalMessageId = entry.sourceMessageId;
      entry.deferred = true;
    } else if (type === CallbackType.modal) {
      entry.settle({ kind: 'modal', modal: data });
    }
    if (!withResponse) return null;
    return {
      interaction: { id: entry.id, type: entry.type },
      ...(message ? { resource: { type, message } } : {}),
    };
  }

  private entry(token: string): Pending {
    const entry = this.pending.get(token);
    if (!entry) throw Object.assign(new Error('Unknown Webhook'), { status: 404, code: 10015 });
    return entry;
  }

  originalMessage(token: string): Json {
    const entry = this.entry(token);
    return this.store.findMessage(entry.channelId, entry.originalMessageId!);
  }

  editOriginal(token: string, body: Json): Json {
    const entry = this.entry(token);
    const flags = (this.originalMessage(token).flags & EPHEMERAL) as number;
    const message = this.store.editMessage(entry.channelId, entry.originalMessageId!, { ...body, flags });
    if (entry.deferred) entry.settle({ kind: 'message', message });
    return message;
  }

  deleteOriginal(token: string): void {
    const entry = this.entry(token);
    this.store.deleteMessage(entry.channelId, entry.originalMessageId!);
  }

  followUp(token: string, body: Json): Json {
    const entry = this.entry(token);
    const message = this.store.createMessage(entry.channelId, this.store.botUser, body, {
      webhook_id: this.store.state.applicationId,
      application_id: this.store.state.applicationId,
    });
    if (entry.deferred) entry.settle({ kind: 'message', message });
    return message;
  }

  clear(): void {
    this.pending.clear();
  }
}
