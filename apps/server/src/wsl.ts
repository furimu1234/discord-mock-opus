import { type ChildProcess, spawn, spawnSync } from 'node:child_process';
import { STARTUP_ERROR_PREFIX } from './constants.js';

/**
 * Windows の Mock から WSL のフォルダーの Bot を動かす。
 * Windows からは `\\wsl.localhost\<ディストリビューション>\...` でフォルダーを開けるが、
 * pnpm の node_modules のシンボリックリンクはたどれず、依存も Linux 向けなので、エージェントは WSL の中で起動する。
 */

const WSL = 'wsl.exe';
/** `\\wsl.localhost\<ディストリビューション>\<パス>` と、古い形式の `\\wsl$\...`。 */
const WSL_PATH = /^\\\\wsl(?:\.localhost|\$)\\([^\\]+)(?:\\(.*))?$/i;
const WSL_ROOT = (distro: string) => `\\\\wsl.localhost\\${distro}\\`;

export const isWindows = process.platform === 'win32';

export interface WslPath {
  distro: string;
  /** WSL の中での絶対パス。 */
  path: string;
}

/** Windows から見た WSL のフォルダーのパスを、ディストリビューションと WSL の中のパスに分ける。 */
export function parseWslPath(path: string): WslPath | undefined {
  if (!isWindows) return undefined;
  const [, distro, rest = ''] = WSL_PATH.exec(path) ?? [];
  if (!distro) return undefined;
  return { distro, path: `/${rest.split('\\').filter(Boolean).join('/')}` };
}

let distros: string[] | undefined;

/** インストールされた WSL のディストリビューションの名前。WSL がなければ空。 */
export function wslDistros(): string[] {
  if (!isWindows) return [];
  if (distros) return distros;
  const result = spawnSync(WSL, ['--list', '--quiet'], { windowsHide: true, timeout: 10_000 });
  // wsl.exe の一覧は UTF-16LE で出力される。
  distros =
    result.status === 0
      ? result.stdout
          .toString('utf16le')
          .replace(/\0/g, '')
          .split(/\r?\n/)
          .map((name) => name.trim())
          .filter(Boolean)
      : [];
  return distros;
}

/** フォルダーの選択で最初に辿れる場所として、WSL のディストリビューションのフォルダーを返す。 */
export const wslRoots = () => wslDistros().map((distro) => ({ name: `WSL: ${distro}`, path: WSL_ROOT(distro) }));

/** 単引用符で囲み、sh の 1 つの引数にする。 */
const quote = (value: string) => `'${value.replaceAll("'", `'\\''`)}'`;

/** `wsl.exe` で `sh -c` を実行する引数。`sh` の後ろは `$0`、`$1` ... になる。 */
const wslShell = (distro: string, script: string, args: string[]) => [
  '--distribution',
  distro,
  '--exec',
  'sh',
  '-c',
  script,
  'sh',
  ...args,
];

/** プロジェクトにインストールされた `@dismock/test` のエージェントを、WSL の中で親へ順に探す。 */
export function findWslAgent(target: WslPath, agentPath: string): string | undefined {
  const script = `d=$1
while :; do
  if [ -e "$d/$2" ]; then printf '%s' "$d/$2"; exit 0; fi
  [ "$d" = / ] && exit 1
  d=$(dirname "$d")
done`;
  const result = spawnSync(WSL, wslShell(target.distro, script, [target.path, agentPath]), {
    windowsHide: true,
    timeout: 30_000,
  });
  const found = result.status === 0 ? result.stdout.toString('utf8').trim() : '';
  return found || undefined;
}

/**
 * WSL の中でエージェントを起動する。
 * - Node は WSL の PATH にあればそれを、なければフォルダーから親へ探した `shell.nix` の nix-shell で使う。
 * - Mock が wsl.exe を止めると標準入力が閉じるので、それを合図にエージェント（と Bot）を止める。
 *   wsl.exe を止めただけでは WSL の中のプロセスが残るため。
 */
export function spawnWslAgent(
  target: WslPath,
  agent: string,
  args: string[],
  env: Record<string, string>,
): ChildProcess {
  const command = ['exec', 'node', agent, ...args].map((part, index) => (index < 2 ? part : quote(part))).join(' ');
  const script = `cd "$1" || exit 1
exec 3<&0
if command -v node >/dev/null 2>&1; then
  sh -c "$2" </dev/null &
else
  d=$1; nix=
  while :; do
    if [ -f "$d/shell.nix" ]; then nix=$d/shell.nix; break; fi
    [ "$d" = / ] && break
    d=$(dirname "$d")
  done
  if [ -z "$nix" ] || ! command -v nix-shell >/dev/null 2>&1; then
    echo ${quote(`${STARTUP_ERROR_PREFIX}WSL の ${target.distro} に Node.js がありません。Node.js をインストールするか、プロジェクトに shell.nix を置いてください`)} >&2
    exit 1
  fi
  nix-shell "$nix" --run "$2" </dev/null &
fi
pid=$!
(cat <&3 >/dev/null; kill "$pid" 2>/dev/null) &
watcher=$!
wait "$pid"
code=$?
kill "$watcher" 2>/dev/null
exit "$code"`;
  // WSLENV に名前を並べた環境変数だけが WSL の中へ渡る。
  const names = Object.keys(env);
  const wslenv = [process.env.WSLENV, ...names.map((name) => `${name}/u`)].filter(Boolean).join(':');
  return spawn(WSL, wslShell(target.distro, script, [target.path, command]), {
    stdio: ['pipe', 'inherit', 'pipe'],
    windowsHide: true,
    env: { ...process.env, ...env, WSLENV: wslenv },
  });
}
