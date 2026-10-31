import { fileURLToPath } from 'node:url';
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
  webDir: fileURLToPath(new URL('../../web/dist', import.meta.url)),
  seedDefaults: true,
}).catch((error: Error) => {
  console.error(`Mock を起動できません: ${error.message}`);
  process.exit(1);
});
// トークンをフラグメントに置き、サーバーのログや Referer に残らないようにする。
console.log(`Discord Mock: ${server.url}/#token=${server.store.state.token}`);

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => void server.close().then(() => process.exit(0)));
}
