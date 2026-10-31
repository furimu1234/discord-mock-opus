import { spawn, spawnSync } from 'node:child_process';
import { EXIT_STARTUP_FAILURE, ROOT, runTests } from './run-tests.mjs';

const READY_MESSAGE = 'Discord Mock:';

function fail(message, code = 1) {
  console.error(`app を終了します: ${message}`);
  process.exit(code);
}

const build = spawnSync('pnpm', ['build'], { cwd: ROOT, stdio: 'inherit' });
if (build.status !== 0) fail('ビルドに失敗しました');

const mock = spawn(process.execPath, ['apps/server/bin/dismock-server.js'], {
  cwd: ROOT,
  stdio: ['ignore', 'pipe', 'inherit'],
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

await new Promise((ready) => {
  mock.stdout.on('data', (chunk) => {
    process.stdout.write(chunk);
    if (chunk.toString().includes(READY_MESSAGE)) ready();
  });
});

const status = await runTests(process.argv.slice(2));
if (status === EXIT_STARTUP_FAILURE) {
  console.error('app を終了します: testClient を起動できませんでした');
  stop(status);
} else {
  console.log('\nテストが完了しました。Mock は起動したままです。Ctrl+C で終了します。');
}
