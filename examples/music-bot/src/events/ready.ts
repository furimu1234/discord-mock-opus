import { Events } from 'discord.js';
import { commands } from '../registry.ts';
import type { BotEvent } from '../types.ts';

export default {
  name: Events.ClientReady,
  once: true,
  async execute(client) {
    await client.application.commands.set(commands.map((command) => command.data.toJSON()));
    console.log(`${client.user.tag} として起動しました`);
  },
} satisfies BotEvent<Events.ClientReady>;
