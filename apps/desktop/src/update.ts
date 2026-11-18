// 配布版のアップデート。管理画面の「アップデートを確認」を押したときだけ GitHub の Releases に問い合わせる。
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createWriteStream, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { DesktopUpdate, DesktopUpdateProgress } from './bridge.js';
import { RELEASE_NAME, RELEASE_REPOSITORY, type ReleaseTarget, releaseArchiveName } from './release.js';

const LATEST_RELEASE_API = `https://api.github.com/repos/${RELEASE_REPOSITORY}/releases/latest`;
/** GitHub の API は User-Agent を求める。利用者の情報は入れず、製品名だけを送る。 */
const REQUEST_HEADERS = { 'User-Agent': RELEASE_NAME, Accept: 'application/vnd.github+json' };
/** GitHub がアセットに付ける SHA-256 の形式。 */
const SHA256_DIGEST = /^sha256:([0-9a-f]{64})$/;
/** 進み具合を画面へ知らせる間隔。 */
const PROGRESS_INTERVAL_MS = 200;
/** 展開した配布物の中の、配布版のフォルダー。 */
const ARCHIVE_ROOT = RELEASE_NAME;
const EXECUTABLE = `${RELEASE_NAME}.exe`;
const UPDATE_SCRIPT = 'update.cmd';

interface GitHubAsset {
  name: string;
  browser_download_url: string;
  size: number;
  digest?: string | null;
}

export interface GitHubRelease {
  tag_name: string;
  html_url: string;
  body?: string | null;
  assets: GitHubAsset[];
}

/** `v1.2.3` や `1.2.3` を比べる。`a` が新しければ正、同じなら 0。 */
export function compareVersions(a: string, b: string): number {
  const parts = (version: string) =>
    version
      .replace(/^v/, '')
      .split('.')
      .map((part) => Number.parseInt(part, 10) || 0);
  const [left, right] = [parts(a), parts(b)];
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const difference = (left[index] ?? 0) - (right[index] ?? 0);
    if (difference) return difference;
  }
  return 0;
}

const versionOf = (release: GitHubRelease) => release.tag_name.replace(/^v/, '');

export async function fetchLatestRelease(): Promise<GitHubRelease> {
  let response: Response;
  try {
    response = await fetch(LATEST_RELEASE_API, { headers: REQUEST_HEADERS });
  } catch {
    throw new Error('GitHub に接続できません。インターネットの接続を確認してください');
  }
  if (!response.ok) throw new Error(`最新版を確認できません（GitHub の応答 ${response.status}）`);
  return (await response.json()) as GitHubRelease;
}

/** この PC 向けの配布物と、その SHA-256。どちらかがなければ `undefined`。 */
function findAsset(release: GitHubRelease, target: ReleaseTarget | undefined) {
  if (!target) return undefined;
  const name = releaseArchiveName(versionOf(release), target);
  const asset = release.assets.find((candidate) => candidate.name === name);
  const sha256 = SHA256_DIGEST.exec(asset?.digest ?? '')?.[1];
  return asset && sha256 ? { asset, sha256 } : undefined;
}

/** 画面から差し替えられるのは、Windows の配布版だけ。Mac の app と Linux のシェルスクリプトは置き場所がまちまちなので、ページから入手する。 */
export const canReplace = (packaged: boolean) => packaged && process.platform === 'win32';

export function describeUpdate(
  current: string,
  release: GitHubRelease,
  target: ReleaseTarget | undefined,
  replaceable: boolean,
): DesktopUpdate {
  const latest = versionOf(release);
  return {
    current,
    latest,
    available: compareVersions(latest, current) > 0,
    notes: release.body ?? '',
    url: release.html_url,
    installable: replaceable && Boolean(findAsset(release, target)),
  };
}

/** 書き込めないフォルダー（Program Files など）では、差し替えられないので先に知らせる。 */
function assertWritable(dir: string): void {
  const probe = join(dir, `.${RELEASE_NAME}-update-check`);
  try {
    writeFileSync(probe, '');
    rmSync(probe, { force: true });
  } catch {
    throw new Error(`${dir} に書き込めないため、アップデートできません。Release のページから入手してください`);
  }
}

/**
 * 配布物をダウンロードして SHA-256 を照合し、`workDir` に展開する。
 * 展開した配布版のフォルダーを返す。
 */
export async function downloadUpdate(
  release: GitHubRelease,
  target: ReleaseTarget | undefined,
  installDir: string,
  workDir: string,
  onProgress: (progress: DesktopUpdateProgress) => void,
): Promise<string> {
  const found = findAsset(release, target);
  if (!found) throw new Error('この PC 向けの配布物が Release にありません。Release のページを確認してください');
  assertWritable(installDir);
  rmSync(workDir, { recursive: true, force: true });
  mkdirSync(workDir, { recursive: true });

  const archive = join(workDir, found.asset.name);
  const response = await fetch(found.asset.browser_download_url, { headers: { 'User-Agent': RELEASE_NAME } });
  if (!response.ok || !response.body) throw new Error(`ダウンロードできません（GitHub の応答 ${response.status}）`);
  const hash = createHash('sha256');
  const file = createWriteStream(archive);
  const total = found.asset.size;
  let received = 0;
  let reportedAt = 0;
  for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
    hash.update(chunk);
    received += chunk.length;
    if (!file.write(chunk)) await new Promise<void>((resolve) => file.once('drain', () => resolve()));
    if (Date.now() - reportedAt >= PROGRESS_INTERVAL_MS) {
      reportedAt = Date.now();
      onProgress({ received, total });
    }
  }
  await new Promise<void>((resolve, reject) => file.end((error?: Error | null) => (error ? reject(error) : resolve())));
  onProgress({ received, total });
  if (hash.digest('hex') !== found.sha256) {
    rmSync(workDir, { recursive: true, force: true });
    throw new Error('ダウンロードしたファイルの SHA-256 が Release と一致しません。もう一度試してください');
  }

  // Windows 10 以降に入っている tar.exe は zip を展開できる。
  const tar = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe');
  const extracted = join(workDir, 'new');
  mkdirSync(extracted, { recursive: true });
  const result = spawnSync(tar, ['-xf', archive, '-C', extracted], { windowsHide: true });
  const staged = join(extracted, ARCHIVE_ROOT);
  if (result.status !== 0 || !existsSync(join(staged, EXECUTABLE))) {
    throw new Error(`ダウンロードしたファイルを展開できません${result.error ? `: ${result.error.message}` : ''}`);
  }
  rmSync(archive, { force: true });
  return staged;
}

/**
 * dismock の終了を待って、展開した新しい版で配布版のフォルダーを上書きし、起動し直すスクリプト。
 * 動いている exe は上書きできないため、dismock の外のプロセスで行う。
 * cmd.exe はスクリプトを OEM のコードページで読むので、ASCII だけで書き、パスは引数で渡す。
 * 切り離した cmd.exe ではパイプ（`tasklist | find`）の `find` が入力の終わりを待ったまま止まるので、ファイルを経由する。
 * プロセスがないときの tasklist の出力は数字を含まないので、ID の文字列があればまだ動いている。
 * 引数: 1=待つプロセスの ID、2=新しい版のフォルダー、3=配布版のフォルダー、4=ログ
 */
const REPLACE_SCRIPT = `@echo off
:wait
tasklist /FI "PID eq %~1" /FO CSV /NH >"%~4.pid" 2>nul
find "%~1" "%~4.pid" >nul
if not errorlevel 1 (
  ping -n 2 127.0.0.1 >nul
  goto wait
)
del "%~4.pid"
robocopy "%~2" "%~3" /E /R:30 /W:1 /NP /LOG:"%~4"
if errorlevel 8 echo dismock update failed >> "%~4"
start "" "%~3\\${EXECUTABLE}"
`;

/** 差し替えのスクリプトを、dismock から切り離して起動する。呼んだ後に dismock を終了する。 */
export function scheduleReplace(staged: string, installDir: string, workDir: string): void {
  const script = join(workDir, UPDATE_SCRIPT);
  writeFileSync(script, REPLACE_SCRIPT.replaceAll('\n', '\r\n'));
  const log = join(workDir, 'update.log');
  // cmd.exe の /s /c は、全体を囲んだ引用符を外してから実行する。
  const command = `""${script}" ${process.pid} "${staged}" "${installDir}" "${log}""`;
  spawn(process.env.ComSpec ?? 'cmd.exe', ['/d', '/s', '/c', command], {
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
    windowsVerbatimArguments: true,
  }).unref();
}

/** 前回のアップデートで残った作業用のフォルダーを消す。差し替えのスクリプトがまだ終わっていなければ次の起動で消す。 */
export function cleanUpdate(workDir: string): void {
  try {
    rmSync(workDir, { recursive: true, force: true });
  } catch {
    // 次の起動で消す。
  }
}
