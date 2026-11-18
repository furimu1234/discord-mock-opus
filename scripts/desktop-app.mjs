// 配布版のウインドウのアプリ（Electron の resources/app）を組み立てる。配布用のビルドと、開発中の起動（pnpm desktop）が使う。
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { RELEASE_NAME } from '../apps/desktop/src/release.ts';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const NAME = RELEASE_NAME;
const SERVER = join(ROOT, 'apps/server');
const DESKTOP = join(ROOT, 'apps/desktop');
const WEB_DIST = join(ROOT, 'apps/web/dist');
export const { version: VERSION } = JSON.parse(readFileSync(join(SERVER, 'package.json'), 'utf8'));
/** 同梱する Electron の版。apps/desktop の package.json の値を使う。 */
export const ELECTRON_VERSION = JSON.parse(readFileSync(join(DESKTOP, 'package.json'), 'utf8')).devDependencies.electron;
/** Electron が内蔵する Node の主な版。バンドルの変換先にする。 */
const ELECTRON_NODE_TARGET = 'node24';

/** opusscript の wasm を、ファイルから読む代わりにバンドルに埋め込む。バンドルの隣に wasm を置かずに済むようにするため。 */
const embedOpusWasm = {
  name: 'embed-opus-wasm',
  setup(builder) {
    builder.onLoad({ filter: /opusscript_native_wasm\.js$/ }, ({ path }) => {
      const source = readFileSync(path, 'utf8');
      const wasm = readFileSync(path.replace(/\.js$/, '.wasm')).toString('base64');
      const patched = source.replace('function(Module = {})', `function(Module = { wasmBinary: Buffer.from("${wasm}", "base64") })`);
      if (patched === source) throw new Error('opusscript の wasm を埋め込めません。opusscript の版を確認してください');
      return { contents: patched, loader: 'js' };
    });
  },
};

/** バンドルに入ったファイルのパスから、パッケージの package.json を求める。 */
function bundledPackages(metafile) {
  return Object.keys(metafile.inputs).flatMap((input) => {
    const at = input.lastIndexOf('node_modules/');
    const name = at < 0 ? undefined : /^((?:@[^/]+\/)?[^/]+)\//.exec(input.slice(at + 'node_modules/'.length))?.[1];
    return name ? [resolve(ROOT, input.slice(0, at + 'node_modules/'.length + name.length), 'package.json')] : [];
  });
}

const common = { bundle: true, metafile: true, logLevel: 'warning', absWorkingDir: ROOT };

/**
 * `outDir` にアプリを組み立て、同梱したパッケージの package.json の一覧を返す。
 * Mock は 1 つの CommonJS のファイルにまとめ、ウインドウのプロセスが Electron を Node として動かして起動する。
 */
export async function buildDesktopApp(outDir) {
  if (!existsSync(join(WEB_DIST, 'index.html'))) throw new Error('Web UI がビルドされていません。先に pnpm build を実行してください');
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });
  const node = { ...common, platform: 'node', format: 'cjs', target: ELECTRON_NODE_TARGET };
  const results = await Promise.all([
    build({
      ...node,
      entryPoints: [join(SERVER, 'src/cli.ts')],
      outfile: join(outDir, 'server/dismock-server.cjs'),
      // ws の任意の高速化パッケージ。なければ ws が自分で読み込みを諦める。
      external: ['bufferutil', 'utf-8-validate'],
      banner: { js: 'const __importMetaUrl = require("node:url").pathToFileURL(__filename).href;' },
      define: { 'import.meta.url': '__importMetaUrl' },
      plugins: [embedOpusWasm],
    }),
    build({ ...node, entryPoints: [join(DESKTOP, 'src/main.ts')], outfile: join(outDir, 'main.cjs'), external: ['electron'] }),
    build({ ...node, entryPoints: [join(DESKTOP, 'src/preload.ts')], outfile: join(outDir, 'preload.cjs'), external: ['electron'] }),
    build({ ...node, entryPoints: [join(DESKTOP, 'src/terminal-preload.ts')], outfile: join(outDir, 'terminal-preload.cjs'), external: ['electron'] }),
    build({ ...common, platform: 'browser', format: 'iife', entryPoints: [join(DESKTOP, 'src/terminal.ts')], outfile: join(outDir, 'terminal.js') }),
  ]);
  cpSync(join(DESKTOP, 'src/terminal.html'), join(outDir, 'terminal.html'));
  cpSync(join(DESKTOP, 'node_modules/@xterm/xterm/css/xterm.css'), join(outDir, 'xterm.css'));
  cpSync(WEB_DIST, join(outDir, 'web'), { recursive: true });
  writeFileSync(join(outDir, 'package.json'), `${JSON.stringify({ name: NAME, productName: NAME, version: VERSION, main: 'main.cjs' }, null, 2)}\n`);
  return [...new Set(results.flatMap(({ metafile }) => bundledPackages(metafile)))];
}
