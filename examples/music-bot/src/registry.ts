import { loadModules } from './loader.ts';
import type { Command } from './types.ts';

export const commands = await loadModules<Command>('commands');
