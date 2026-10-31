import { spawn, spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const READY_MESSAGE = 'Discord Mock:';
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function fail(message, code = 1) {
  console.error(`app を終了します: ${message}`);
  process.exit(code);
}

const build = spawnSync('pnpm', ['build'], { cwd: ROOT, stdio: 'inherit' });
if (build.status !== 0) fail('ビルドに失敗しました');

// ビルドで生成されるため、ビルドの後に読み込む。
const { EXIT_STARTUP_FAILURE } = await import('../packages/test/dist/constants.js');

const mock = spawn(process.execPath, ['apps/server/bin/dismock-server.js'], {
  cwd: ROOT,
  stdio: ['ignore', 'pipe', 'inherit'],
});

let agent;
let stopping = false;

function stop(code) {
  stopping = true;
  agent?.kill();
  mock.once('exit', () => process.exit(code));
  mock.kill();
}

mock.once('exit', () => {
  if (stopping) return;
  agent?.kill();
  fail('Mock が停止しました');
});

for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => stop(0));

// どのような理由で終了しても、Mock と testClient を残さない。
process.once('exit', () => {
  agent?.kill();
  mock.kill();
});

await new Promise((ready) => {
  mock.stdout.on('data', (chunk) => {
    console.log(chunk.toString().trimEnd());
    if (chunk.toString().includes(READY_MESSAGE)) ready();
  });
});

const examples = readdirSync(join(ROOT, 'examples')).map((name) => join('examples', name));
agent = spawn(process.execPath, ['packages/test/bin/dismock.js', 'agent', ...examples], {
  cwd: ROOT,
  stdio: 'inherit',
});
agent.once('exit', (code) => {
  if (stopping) return;
  console.error('app を終了します: testClient を起動できませんでした');
  stop(code === EXIT_STARTUP_FAILURE ? code : 1);
});
