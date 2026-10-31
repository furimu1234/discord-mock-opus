import type { ChatInputCommandInteraction, ClientEvents, SharedSlashCommand } from 'discord.js';

/** `commands/` の 1 ファイルが default export する形。 */
export interface Command {
  data: SharedSlashCommand;
  execute(interaction: ChatInputCommandInteraction<'cached'>): Promise<void>;
}

/** `events/` の 1 ファイルが default export する形。 */
export interface BotEvent<Name extends keyof ClientEvents = keyof ClientEvents> {
  name: Name;
  once?: boolean;
  execute(...args: ClientEvents[Name]): Promise<void>;
}
