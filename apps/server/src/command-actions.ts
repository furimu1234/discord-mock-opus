import { AuditLogEvent } from './constants.js';
import { NO_CONTENT, type ApiRoute, type RouteModule } from './routes.js';
import { BadRequest, NotFound, type Json, type Store } from './store.js';

/** Discord の公開ドキュメントの上限。 */
const MAX_COMMAND_PERMISSIONS = 100;
const ErrorCode = { unknownCommand: 10063, invalidForm: 50035 };
const COMMAND_FIELDS = [
  'name', 'name_localizations', 'description', 'description_localizations', 'options', 'default_member_permissions',
  'dm_permission', 'default_permission', 'integration_types', 'contexts', 'nsfw', 'handler',
];

/** アプリケーションコマンドの 1 件ずつの取得、変更、削除と、コマンドの権限。 */
export class CommandActions implements RouteModule {
  constructor(private readonly store: Store) {
    store.on('guild-cleared', (guildId: string) => {
      for (const key of Object.keys(store.state.commandPermissions)) {
        if (key.startsWith(`${guildId}:`)) delete store.state.commandPermissions[key];
      }
    });
  }

  routes(api: ApiRoute): void {
    api('GET', '/applications/:app/guilds/:guild/commands/permissions', ({ params }) => this.guildPermissions(params.guild!));
    api('PUT', '/applications/:app/guilds/:guild/commands/permissions', ({ params, body }) =>
      (body as Json[]).map((entry) => this.setPermissions(params.guild!, entry.id, entry)),
    );
    api('GET', '/applications/:app/guilds/:guild/commands/:command/permissions', ({ params }) =>
      this.permissions(params.guild!, params.command!),
    );
    api('PUT', '/applications/:app/guilds/:guild/commands/:command/permissions', ({ params, body }) =>
      this.setPermissions(params.guild!, params.command!, body),
    );
    api('GET', '/applications/:app/guilds/:guild/commands/:command', ({ params }) => this.requireCommand(params.command!, params.guild!));
    api('PATCH', '/applications/:app/guilds/:guild/commands/:command', ({ params, body }) => this.edit(params.command!, body, params.guild!));
    api('DELETE', '/applications/:app/guilds/:guild/commands/:command', ({ params }) => {
      this.delete(params.command!, params.guild!);
      return NO_CONTENT;
    });
    api('GET', '/applications/:app/commands/:command', ({ params }) => this.requireCommand(params.command!));
    api('PATCH', '/applications/:app/commands/:command', ({ params, body }) => this.edit(params.command!, body));
    api('DELETE', '/applications/:app/commands/:command', ({ params }) => {
      this.delete(params.command!);
      return NO_CONTENT;
    });
  }

  requireCommand(commandId: string, guildId?: string): Json {
    const command = this.store.state.commands.find((candidate) => candidate.id === commandId && (candidate.guild_id ?? undefined) === guildId);
    if (!command) throw new NotFound('Unknown application command', ErrorCode.unknownCommand);
    return command;
  }

  edit(commandId: string, body: Json, guildId?: string): Json {
    const command = this.requireCommand(commandId, guildId);
    for (const key of COMMAND_FIELDS) {
      if (body[key] !== undefined) command[key] = body[key];
    }
    command.version = String(BigInt(command.version) + 1n);
    this.store.changed();
    return command;
  }

  delete(commandId: string, guildId?: string): void {
    const command = this.requireCommand(commandId, guildId);
    this.store.state.commands = this.store.state.commands.filter((candidate) => candidate !== command);
    for (const key of Object.keys(this.store.state.commandPermissions)) {
      if (key.endsWith(`:${commandId}`)) delete this.store.state.commandPermissions[key];
    }
    this.store.changed();
  }

  guildPermissions(guildId: string): Json[] {
    this.store.requireGuild(guildId);
    return Object.entries(this.store.state.commandPermissions)
      .filter(([key]) => key.startsWith(`${guildId}:`))
      .map(([, permissions]) => permissions);
  }

  permissions(guildId: string, commandId: string): Json {
    this.store.requireGuild(guildId);
    const permissions = this.store.state.commandPermissions[`${guildId}:${commandId}`];
    if (!permissions) throw new NotFound('Unknown application command permissions', ErrorCode.unknownCommand);
    return permissions;
  }

  /** コマンドの ID がアプリケーションの ID のときは、すべてのコマンドの既定の権限。 */
  setPermissions(guildId: string, commandId: string, body: Json): Json {
    const { store } = this;
    store.requireGuild(guildId);
    if (commandId !== store.state.applicationId) this.requireCommand(commandId, store.state.commands.some((command) => command.id === commandId && command.guild_id === guildId) ? guildId : undefined);
    const entries = body.permissions as Json[] | undefined;
    if (!Array.isArray(entries) || entries.length > MAX_COMMAND_PERMISSIONS) {
      throw new BadRequest(`permissions は ${MAX_COMMAND_PERMISSIONS} 件までの配列で指定してください`, ErrorCode.invalidForm);
    }
    const key = `${guildId}:${commandId}`;
    const before = store.state.commandPermissions[key]?.permissions ?? [];
    const permissions = { id: commandId, application_id: store.state.applicationId, guild_id: guildId, permissions: entries };
    store.state.commandPermissions[key] = permissions;
    store.changed();
    store.emit('dispatch', 'APPLICATION_COMMAND_PERMISSIONS_UPDATE', permissions);
    store.audit(guildId, AuditLogEvent.applicationCommandPermissionUpdate, commandId, [{ key: 'permissions', old_value: before, new_value: entries }], {
      application_id: store.state.applicationId,
    });
    return permissions;
  }
}
