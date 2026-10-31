import { parseArgs } from 'node:util';
import { startServer } from './index.js';

const { values } = parseArgs({
  options: {
    host: { type: 'string', default: '127.0.0.1' },
    port: { type: 'string', default: '6470' },
    data: { type: 'string', default: 'data/discord-mock-state.json' },
  },
});

const server = await startServer({
  host: values.host,
  port: Number(values.port),
  dataFile: values.data,
}).catch((error: Error) => {
  console.error(`Mock を起動できません: ${error.message}`);
  process.exit(1);
});
console.log(`Discord Mock: ${server.url}`);

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => void server.close().then(() => process.exit(0)));
}
