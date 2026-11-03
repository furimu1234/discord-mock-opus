// 開発中に、配布版と同じ 2 つのウインドウで Mock を起動する。
// 使い方: pnpm desktop [Mock の引数...]（例: pnpm desktop --port 6471）
// 状態は pnpm web と同じ data/ を使う。npm の Electron が動かない環境（NixOS など）では nix-shell の electron を使う。
import { spawn, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { buildDesktopApp, ROOT } from './desktop-app.mjs';

const APP = join(ROOT, 'apps/desktop/dist/app');
// pnpm web と同じく、添付はリポジトリの dismock-server.js の隣に置く。
const MEDIA = join(ROOT, 'apps/server/bin/media');
// ウインドウの位置を指定できるよう、Wayland でも X11（XWayland）で開く。
const FLAGS = process.platform === 'linux' ? ['--ozone-platform=x11'] : [];

await buildDesktopApp(APP);

const args = [APP, ...FLAGS, '--', '--data-dir', ROOT, '--media', MEDIA, ...process.argv.slice(2)];
const electron = createRequire(join(ROOT, 'apps/desktop/package.json'))('electron');
const usable = spawnSync(electron, ['-e', '0'], { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' } }).status === 0;
const [command, commandArgs] = usable ? [electron, args] : ['nix-shell', ['-p', 'electron', '--run', ['electron', ...args].map((arg) => `'${arg.replaceAll("'", `'\\''`)}'`).join(' ')]];

// VS Code のターミナルなどから起動すると Electron が Node として動いてしまうので、外す。
const { ELECTRON_RUN_AS_NODE: _, ...env } = process.env;
const child = spawn(command, commandArgs, { stdio: 'inherit', env });
child.once('exit', (code) => process.exit(code ?? 0));
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => child.kill(signal));
