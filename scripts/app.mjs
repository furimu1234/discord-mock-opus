import { spawn, spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function fail(message, code = 1) {
  console.error(`app を終了します: ${message}`);
  process.exit(code);
}

const build = spawnSync('pnpm', ['build'], { cwd: ROOT, stdio: 'inherit' });
if (build.status !== 0) fail('ビルドに失敗しました');

// Bot は起動しない。管理画面のボタンが押されたときに、Mock が testClient を起動する。
const mock = spawn(process.execPath, ['apps/server/bin/dismock-server.js', ...process.argv.slice(2)], {
  cwd: ROOT,
  stdio: 'inherit',
});

let stopping = false;

function stop(code) {
  stopping = true;
  mock.once('exit', () => process.exit(code));
  mock.kill();
}

mock.once('exit', () => {
  if (!stopping) fail('Mock が停止しました');
});

for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => stop(0));

// どのような理由で終了しても、Mock を残さない。
process.once('exit', () => mock.kill());
