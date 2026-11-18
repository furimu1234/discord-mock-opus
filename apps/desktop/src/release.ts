/**
 * 配布物の名前の決まり。配布用のビルド（scripts/dist.mjs）と、配布版のアップデートの確認が読み込む。
 * dist.mjs は Node の型の除去で直接読み込むので、型の注記の他に TypeScript だけの構文を使わない。
 */

/** 配布物を置く GitHub のリポジトリ。アップデートの確認はここの Releases を見る。 */
export const RELEASE_REPOSITORY = 'furimu1234/discord-mock-opus';

/** 配布物と、配布版のフォルダーの名前。 */
export const RELEASE_NAME = 'dismock';

/** `os` は配布の種類、`platform` と `arch` は Electron と Node の名前。 */
export const RELEASE_TARGETS = {
  'linux-x64': { os: 'linux', platform: 'linux', arch: 'x64' },
  'linux-arm64': { os: 'linux', platform: 'linux', arch: 'arm64' },
  'windows-x64': { os: 'windows', platform: 'win32', arch: 'x64' },
  'windows-arm64': { os: 'windows', platform: 'win32', arch: 'arm64' },
  'mac-x64': { os: 'mac', platform: 'darwin', arch: 'x64' },
  'mac-arm64': { os: 'mac', platform: 'darwin', arch: 'arm64' },
} as const;

export type ReleaseTarget = keyof typeof RELEASE_TARGETS;

/** 動いている PC に合う配布の種類。配布していない組み合わせでは `undefined`。 */
export function releaseTarget(platform: string, arch: string): ReleaseTarget | undefined {
  return (Object.keys(RELEASE_TARGETS) as ReleaseTarget[]).find(
    (target) => RELEASE_TARGETS[target].platform === platform && RELEASE_TARGETS[target].arch === arch,
  );
}

/** 配布物のファイル名。Linux は実行権限を残すため tar.gz、それ以外は zip。 */
export function releaseArchiveName(version: string, target: ReleaseTarget): string {
  return `${RELEASE_NAME}-${version}-${target}.${RELEASE_TARGETS[target].os === 'linux' ? 'tar.gz' : 'zip'}`;
}
