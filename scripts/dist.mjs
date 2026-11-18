// 配布用のビルド。Linux はシェルスクリプト、Windows は exe、Mac は app を release/ に作る。
// どれも画面とターミナルの 2 つのウインドウで起動する（Electron）。Linux は --no-window でウインドウなしでも起動できる。
// 使い方: pnpm dist [ターゲット...]（省略するとすべて）
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, cpSync, existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { packager } from '@electron/packager';
import { buildDesktopApp, ELECTRON_VERSION, NAME, ROOT, VERSION } from './desktop-app.mjs';

const SERVER = join(ROOT, 'apps/server');
const OUT = join(ROOT, 'release');
const WORK = join(OUT, '.work');
const APP = join(WORK, 'app');

// Linux の --no-window で使う Node。ビルドに使う Node と同じ版を同梱する。
const NODE_VERSION = process.version;
const NODE_MAJOR = process.versions.node.split('.')[0];
const NODE_DIST = `https://nodejs.org/dist/${NODE_VERSION}`;
const NODE_CACHE = join(ROOT, '.local/node-dist', NODE_VERSION);

/** `os` は配布の種類、`platform` と `arch` は Electron の配布の名前。 */
const TARGETS = {
  'linux-x64': { os: 'linux', platform: 'linux', arch: 'x64' },
  'linux-arm64': { os: 'linux', platform: 'linux', arch: 'arm64' },
  'windows-x64': { os: 'windows', platform: 'win32', arch: 'x64' },
  'windows-arm64': { os: 'windows', platform: 'win32', arch: 'arm64' },
  'mac-x64': { os: 'mac', platform: 'darwin', arch: 'x64' },
  'mac-arm64': { os: 'mac', platform: 'darwin', arch: 'arm64' },
};

const { LEGAL_NOTICE, STATE_FILE_NAME } = await import(join(SERVER, 'dist/constants.js')).catch(() => {
  throw new Error('先に pnpm build を実行してください');
});

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { stdio: 'inherit', ...options });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} が失敗しました（終了コード ${result.status}）`);
}

/** `dir` から親へ順に node_modules を探し、パッケージの package.json を返す。 */
function findPackage(dir, name) {
  for (let current = dir; ; current = dirname(current)) {
    const manifest = join(current, 'node_modules', name, 'package.json');
    // pnpm では依存の依存が実体の隣にあるので、実体のパスを返す。
    if (existsSync(manifest)) return realpathSync(manifest);
    if (dirname(current) === current) throw new Error(`${name} が見つかりません`);
  }
}

// --- Node の公式配布 ---

let shasums;

async function fetchToCache(name) {
  const file = join(NODE_CACHE, name);
  if (existsSync(file)) return file;
  console.log(`ダウンロード: ${NODE_DIST}/${name}`);
  const response = await fetch(`${NODE_DIST}/${name}`);
  if (!response.ok) throw new Error(`${name} をダウンロードできません（${response.status}）`);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, Buffer.from(await response.arrayBuffer()));
  return file;
}

/** Node の公式配布をダウンロードし、SHASUMS256.txt のハッシュと照合する。 */
async function nodeDist(name) {
  shasums ??= readFileSync(await fetchToCache('SHASUMS256.txt'), 'utf8');
  const file = await fetchToCache(name);
  const expected = shasums.split('\n').find((line) => line.endsWith(`  ${name}`))?.split(' ')[0];
  const actual = createHash('sha256').update(readFileSync(file)).digest('hex');
  if (!expected || expected !== actual) {
    rmSync(file);
    throw new Error(`${name} のハッシュが SHASUMS256.txt と一致しません`);
  }
  return file;
}

/** Linux の配布から、Node の実行ファイルと LICENSE を取り出す。 */
async function extractNode(arch, dest) {
  const dir = `node-${NODE_VERSION}-linux-${arch}`;
  const archive = await nodeDist(`${dir}.tar.xz`);
  const extracted = join(WORK, 'node', arch);
  rmSync(extracted, { recursive: true, force: true });
  mkdirSync(extracted, { recursive: true });
  run('tar', ['-xf', archive, '-C', extracted, '--strip-components=1', `${dir}/bin/node`, `${dir}/LICENSE`]);
  mkdirSync(dirname(dest), { recursive: true });
  cpSync(join(extracted, 'bin/node'), dest);
  return readFileSync(join(extracted, 'LICENSE'), 'utf8');
}

// --- ライセンス ---

/** Web UI が使うパッケージ。ワークスペースのパッケージは自分たちのコードなので除く。 */
function webPackages(dir = join(ROOT, 'apps/web'), found = new Map()) {
  const { dependencies = {} } = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
  for (const [name, range] of Object.entries(dependencies)) {
    if (String(range).startsWith('workspace:') || found.has(name)) continue;
    const manifest = findPackage(dir, name);
    found.set(name, manifest);
    webPackages(dirname(manifest), found);
  }
  return [...found.values()];
}

/** 同梱するパッケージのライセンスをまとめる。Electron（Chromium と Node を含む）のライセンスは、Electron の配布のファイルにある。 */
function thirdPartyLicenses(manifests, nodeLicense) {
  const sections = [...new Set(manifests)].sort().map((manifest) => {
    const dir = dirname(manifest);
    const { name, version, license } = JSON.parse(readFileSync(manifest, 'utf8'));
    const files = readdirSync(dir).filter((file) => /^(licen[cs]e|copying)/i.test(file));
    // opusscript は libopus を wasm として含むので、build の中の COPYING.libopus も載せる。
    const nested = existsSync(join(dir, 'build')) ? readdirSync(join(dir, 'build')).filter((file) => /^copying/i.test(file)).map((file) => `build/${file}`) : [];
    const texts = [...files, ...nested].map((file) => readFileSync(join(dir, file), 'utf8').trim());
    return [`${name}@${version} (${license})`, ...(texts.length ? texts : ['（ライセンスのファイルがありません）'])].join('\n\n');
  });
  const electron = `Electron ${ELECTRON_VERSION}\n\nElectron、Chromium、Node.js のライセンスは、同梱の LICENSE と LICENSES.chromium.html にあります。`;
  const node = nodeLicense ? [`Node.js ${NODE_VERSION}（--no-window で使う）\n\n${nodeLicense.trim()}`] : [];
  return `${[electron, ...node, ...sections].join(`\n\n${'='.repeat(80)}\n\n`)}\n`;
}

// --- 起動スクリプトと説明 ---

function linuxLauncher() {
  return `#!/bin/sh
# dismock を起動する。画面とターミナルの 2 つのウインドウを開く。
# --no-window を付けるとウインドウを開かず、表示された URL をブラウザで開いて使う（画面のない VPS など）。
# そのほかの引数は Mock にそのまま渡す（例: ./${NAME} --port 6471）。
set -eu
DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
APP="$DIR/lib/desktop/resources/app"
ELECTRON="$DIR/lib/desktop/${NAME}"
REQUIRED_NODE_MAJOR=${NODE_MAJOR}

quote() {
  printf "'%s'" "$(printf '%s' "$1" | sed "s/'/'\\\\\\\\''/g")"
}

can_use_nix() {
  [ -z "\${DISMOCK_IN_NIX_SHELL:-}" ] && command -v nix-shell >/dev/null 2>&1
}

# NixOS: 同梱のものが動かないので、一時的な nix-shell のパッケージ（空白区切り）でこのスクリプトを実行し直す。
rerun_in_nix_shell() {
  PACKAGES="$1"
  shift
  COMMAND="exec sh $(quote "$0")"
  for ARG in "$@"; do COMMAND="$COMMAND $(quote "$ARG")"; done
  # shellcheck disable=SC2086
  DISMOCK_IN_NIX_SHELL=1 exec nix-shell -p $PACKAGES --run "$COMMAND"
}

# NixOS: 日本語と等幅のフォントを fontconfig に登録していないと文字化けするので、nixpkgs の Noto Sans CJK を加える。
add_fonts() {
  if command -v fc-list >/dev/null 2>&1 && [ -n "$(fc-list :lang=ja 2>/dev/null | head -n 1)" ]; then return 0; fi
  FONTS=$(nix-build '<nixpkgs>' -A noto-fonts-cjk-sans --no-out-link 2>/dev/null) || return 0
  CONF="$DIR/data/desktop/fonts.conf"
  BASE="\${FONTCONFIG_FILE:-/etc/fonts/fonts.conf}"
  [ "$BASE" = "$CONF" ] && BASE=/etc/fonts/fonts.conf
  mkdir -p "$DIR/data/desktop/fontconfig"
  cat > "$CONF" <<FONTS_CONF
<?xml version="1.0"?>
<!DOCTYPE fontconfig SYSTEM "fonts.dtd">
<fontconfig>
  <include ignore_missing="yes">$BASE</include>
  <dir>$FONTS/share/fonts</dir>
  <cachedir>$DIR/data/desktop/fontconfig</cachedir>
</fontconfig>
FONTS_CONF
  export FONTCONFIG_FILE="$CONF"
}

if [ "\${1:-}" = "--no-window" ]; then
  shift
  node_ok() {
    "$1" -e "process.exit(Number(process.versions.node.split('.')[0]) >= $REQUIRED_NODE_MAJOR ? 0 : 1)" >/dev/null 2>&1
  }
  if node_ok "$DIR/lib/node"; then
    NODE="$DIR/lib/node"
  elif command -v node >/dev/null 2>&1 && node_ok node; then
    NODE=node
  elif can_use_nix; then
    rerun_in_nix_shell "nodejs_$REQUIRED_NODE_MAJOR" --no-window "$@"
  else
    echo "Node.js $REQUIRED_NODE_MAJOR 以上が必要です。インストールしてから実行してください" >&2
    exit 1
  fi
  exec "$NODE" "$APP/server/dismock-server.cjs" --web "$APP/web" --data "$DIR/data/${STATE_FILE_NAME}" --media "$DIR/media" "$@"
fi

# VS Code のターミナルなどから起動すると Electron が Node として動いてしまうので、外す。
unset ELECTRON_RUN_AS_NODE
# ウインドウの位置を指定できるよう、Wayland でも X11（XWayland）で開く。
FLAGS="--ozone-platform=x11"
if ELECTRON_RUN_AS_NODE=1 "$ELECTRON" -e 0 >/dev/null 2>&1; then
  # chrome-sandbox を root の setuid にしていない環境で、ユーザー名前空間も使えないときは、サンドボックスを使わない。
  if ! { [ -u "$DIR/lib/desktop/chrome-sandbox" ] && [ "$(stat -c %u "$DIR/lib/desktop/chrome-sandbox")" = 0 ]; }; then
    if [ "$(cat /proc/sys/kernel/apparmor_restrict_unprivileged_userns 2>/dev/null || echo 0)" = 1 ] || [ "$(cat /proc/sys/kernel/unprivileged_userns_clone 2>/dev/null || echo 1)" = 0 ]; then
      FLAGS="$FLAGS --no-sandbox"
    fi
  fi
  exec "$ELECTRON" $FLAGS -- --data-dir "$DIR" "$@"
elif command -v electron >/dev/null 2>&1; then
  if command -v nix-build >/dev/null 2>&1; then add_fonts; fi
  exec electron "$APP" $FLAGS -- --data-dir "$DIR" "$@"
elif can_use_nix; then
  rerun_in_nix_shell "electron fontconfig" "$@"
else
  echo "ウインドウを開けません（Electron に必要なライブラリがありません）。--no-window を付けるとブラウザで使えます" >&2
  exit 1
fi
`;
}

const WINDOWS_HELP = `画面とターミナルの 2 つのウインドウが開きます。どちらかを閉じると終了します。
ウインドウを表示するディスプレイは、管理画面の「ウインドウ」で変えられます。`;

const README = {
  linux: `dismock ${VERSION}

起動: ./${NAME}
${WINDOWS_HELP}
状態は data/、添付は media/ に保存します。

同梱の Electron が動かない環境（NixOS など）では、PATH の electron を使い、なければ nix-shell で一時的に用意します。
画面のない環境では ./${NAME} --no-window で起動し、表示された URL をブラウザで開きます。Ctrl+C で終了します。

${LEGAL_NOTICE}
`,
  windows: `dismock ${VERSION}

起動: ${NAME}.exe をダブルクリックします。
${WINDOWS_HELP}
状態は exe と同じフォルダーの data\\、添付は media\\ に保存します。

署名のない exe なので、初回は「Windows によって PC が保護されました」と表示されることがあります。
「詳細情報」→「実行」で起動します。
管理画面から Bot を起動するには、Node.js ${NODE_MAJOR} 以上のインストールが必要です。

${LEGAL_NOTICE}
`,
  mac: `dismock ${VERSION}

起動: ${NAME}.app を開きます。
${WINDOWS_HELP}
状態と添付は ~/Library/Application Support/${NAME}/ に保存します。

Apple の公証を受けていないので、初回は開けないと表示されます。
「システム設定」→「プライバシーとセキュリティ」の「このまま開く」を押すか、ターミナルで次を実行します。
  xattr -dr com.apple.quarantine ${NAME}.app
管理画面から Bot を起動するには、Node.js ${NODE_MAJOR} 以上のインストールが必要です。

${LEGAL_NOTICE}
`,
};

/** zip を作る。実行権限と、Mac の app の中のシンボリックリンクを残すため、Python の zipfile を使う。 */
function zip(source, archive) {
  const script = `
import os, stat, sys, zipfile
source, archive = sys.argv[1], sys.argv[2]
base = os.path.dirname(source)
with zipfile.ZipFile(archive, "w", zipfile.ZIP_DEFLATED) as z:
    def link(path):
        info = zipfile.ZipInfo(os.path.relpath(path, base))
        info.create_system = 3
        info.external_attr = (stat.S_IFLNK | 0o777) << 16
        z.writestr(info, os.readlink(path))
    for root, dirs, files in os.walk(source):
        dirs.sort()
        for name in list(dirs):
            if os.path.islink(os.path.join(root, name)):
                link(os.path.join(root, name))
                dirs.remove(name)
        for name in sorted(files):
            path = os.path.join(root, name)
            if os.path.islink(path):
                link(path)
            else:
                z.write(path, os.path.relpath(path, base))
`;
  run('python3', ['-c', script, source, archive]);
}

// --- ターゲットごとの組み立て ---

async function buildTarget(target, manifests) {
  const { os, platform, arch } = TARGETS[target];
  const stage = join(WORK, target);
  const dir = join(stage, NAME);
  rmSync(stage, { recursive: true, force: true });
  mkdirSync(stage, { recursive: true });
  const archiveBase = join(OUT, `${NAME}-${VERSION}-${target}`);
  const [packaged] = await packager({
    dir: APP,
    out: join(stage, 'packager'),
    name: NAME,
    executableName: NAME,
    appVersion: VERSION,
    appBundleId: `local.${NAME}`,
    // exe のプロパティに表示する。作者の名前の代わりに製品名を入れる。
    win32metadata: { CompanyName: NAME, ProductName: NAME, FileDescription: NAME },
    platform,
    arch,
    electronVersion: ELECTRON_VERSION,
    // Mock は Electron を Node として起動し、ファイルとして読むので、asar にまとめない。
    asar: false,
    prune: false,
    overwrite: true,
    quiet: true,
  });

  if (os === 'linux') {
    mkdirSync(join(dir, 'lib'), { recursive: true });
    renameSync(packaged, join(dir, 'lib/desktop'));
    const nodeLicense = await extractNode(arch, join(dir, 'lib/node'));
    writeFileSync(join(dir, NAME), linuxLauncher());
    chmodSync(join(dir, NAME), 0o755);
    writeFileSync(join(dir, 'THIRD_PARTY_LICENSES.txt'), thirdPartyLicenses(manifests, nodeLicense));
    writeFileSync(join(dir, 'README.txt'), README.linux);
    run('tar', ['-czf', `${archiveBase}.tar.gz`, '-C', stage, NAME]);
    return `${archiveBase}.tar.gz`;
  }

  renameSync(packaged, dir);
  if (os === 'mac') {
    // arm64 の Mac は署名のない実行ファイルを起動しない。packager が書き換えた app を、中のものも含めてアドホック署名する。
    run('rcodesign', ['sign', join(dir, `${NAME}.app`)]);
  }
  writeFileSync(join(dir, 'THIRD_PARTY_LICENSES.txt'), thirdPartyLicenses(manifests));
  writeFileSync(join(dir, 'README.txt'), README[os]);
  zip(dir, `${archiveBase}.zip`);
  return `${archiveBase}.zip`;
}

async function main() {
  const requested = process.argv.slice(2);
  const unknown = requested.filter((target) => !(target in TARGETS));
  if (unknown.length) throw new Error(`知らないターゲット: ${unknown.join(', ')}（${Object.keys(TARGETS).join(', ')}）`);
  const targets = requested.length ? requested : Object.keys(TARGETS);

  rmSync(WORK, { recursive: true, force: true });
  mkdirSync(WORK, { recursive: true });
  const manifests = [...(await buildDesktopApp(APP)), ...webPackages()];

  const built = [];
  for (const target of targets) {
    console.log(`\n== ${target}`);
    built.push(await buildTarget(target, manifests));
  }
  rmSync(WORK, { recursive: true, force: true });
  console.log(`\n${built.map((file) => relative(ROOT, file)).join('\n')}`);
}

main().catch((error) => {
  console.error(`配布用のビルドに失敗しました: ${error.message}`);
  process.exit(1);
});
