import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { Session } from 'node:inspector/promises';
import { tmpdir } from 'node:os';
import { join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import libCoverage, { type CoverageMap, type CoverageSummaryData } from 'istanbul-lib-coverage';
import libReport from 'istanbul-lib-report';
import reports from 'istanbul-reports';
import v8ToIstanbul from 'v8-to-istanbul';

/** カバレッジの HTML を書き出す、プロジェクトの中のディレクトリ。 */
export const COVERAGE_DIR = 'coverage';

/** カバレッジに含めないファイル。テストのコード、testClient、依存パッケージ、生成された型定義。 */
const EXCLUDED = [/(^|[/\\])node_modules[/\\]/, /(^|[/\\])__tests__[/\\]/, /\.test\.[cm]?[jt]s$/, /(^|[/\\])testClient\.[cm]?[jt]s$/, /\.d\.ts$/];

/** 画面に表示するカバレッジの要約。 */
export interface CoverageSummary {
  total: CoverageSummaryData;
  files: { file: string; lines: number; statements: number; functions: number; branches: number }[];
}

let session: Session | undefined;
const projectDir = resolve(process.cwd());

const isTarget = (file: string) => file.startsWith(projectDir + sep) && !EXCLUDED.some((pattern) => pattern.test(relative(projectDir, file)));

/**
 * Bot のコードを読み込む前に、V8 のカバレッジの記録を始める。
 * 読み込んだ後で始めると、すでに実行された関数の記録が欠けるため。
 */
export async function startCoverage(): Promise<void> {
  session = new Session();
  session.connect();
  // TypeScript は変換した後のコードで記録されるので、ソースマップを読むためにコードを取り出せるようにする。
  await session.post('Debugger.enable');
  await session.post('Profiler.enable');
  await session.post('Profiler.startPreciseCoverage', { callCount: true, detailed: true });
}

/** 前回から今までに実行したコードのカバレッジ。取ると V8 の記録は 0 に戻る。 */
export async function takeCoverage(): Promise<CoverageMap> {
  const map = libCoverage.createCoverageMap({});
  if (!session) return map;
  const { result } = await session.post('Profiler.takePreciseCoverage');
  for (const script of result) {
    if (!script.url.startsWith('file://')) continue;
    const file = fileURLToPath(script.url.replace(/\?.*$/, ''));
    if (!isTarget(file)) continue;
    const { scriptSource } = await session.post('Debugger.getScriptSource', { scriptId: script.scriptId });
    // 変換後のコードにソースマップがあれば、元のファイルの行に対応付ける。
    const converter = v8ToIstanbul(file, 0, { source: scriptSource });
    await converter.load();
    converter.applyCoverage(script.functions);
    const data = converter.toIstanbul();
    for (const [path, fileCoverage] of Object.entries(data)) {
      if (isTarget(path)) map.merge({ [path]: fileCoverage });
    }
    converter.destroy();
  }
  return map;
}

/** カバレッジをまとめる。同じファイルの実行回数は足し合わせる。 */
export function mergeCoverage(...maps: CoverageMap[]): CoverageMap {
  const merged = libCoverage.createCoverageMap({});
  for (const map of maps) merged.merge(map);
  return merged;
}

export function summarize(map: CoverageMap): CoverageSummary {
  const files = map.files().sort().map((file) => {
    const summary = map.fileCoverageFor(file).toSummary();
    return {
      file: relative(projectDir, file),
      lines: summary.lines.pct,
      statements: summary.statements.pct,
      functions: summary.functions.pct,
      branches: summary.branches.pct,
    };
  });
  return { total: map.getCoverageSummary().toJSON(), files };
}

/** HTML を `dir` に書き出し、表をターミナルに出力する。 */
function report(map: CoverageMap, dir: string): void {
  const context = libReport.createContext({ dir, coverageMap: map, defaultSummarizer: 'nested' });
  reports.create('html').execute(context);
  reports.create('text').execute(context);
}

/** HTML をプロジェクトの `coverage/` に書き出し、表をターミナルに出力する。書き出したディレクトリを返す。 */
export function writeCoverage(map: CoverageMap): string {
  const dir = join(projectDir, COVERAGE_DIR);
  report(map, dir);
  console.log(`カバレッジの HTML: ${join(dir, 'index.html')}`);
  return dir;
}

/**
 * HTML のファイルを作り、`/` 区切りの相対パスと base64 の中身の組で返す。表はターミナルに出力する。
 * 画面から保存したときは、Mock がこのファイルを Mock のフォルダーの `coverage/` に書き出す。
 * Bot は WSL の中など、Mock から見えない場所で動くことがあるため、ファイルの中身を送る。
 */
export function renderCoverage(map: CoverageMap): Record<string, string> {
  const dir = mkdtempSync(join(tmpdir(), 'dismock-coverage-'));
  try {
    report(map, dir);
    const files: Record<string, string> = {};
    for (const entry of readdirSync(dir, { recursive: true, withFileTypes: true })) {
      if (!entry.isFile()) continue;
      const path = join(entry.parentPath, entry.name);
      files[relative(dir, path).split(sep).join('/')] = readFileSync(path).toString('base64');
    }
    return files;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
