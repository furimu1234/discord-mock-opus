import { Client, GatewayIntentBits } from 'discord.js';
import { loadModules } from './loader.ts';
import type { BotEvent } from './types.ts';

const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates] });

for (const event of await loadModules<BotEvent>('events')) {
  const listener = event.execute as (...args: unknown[]) => Promise<void>;
  client[event.once ? 'once' : 'on'](event.name, listener);
}

await client.login(process.env.DISCORD_TOKEN);
