// npm へ配るパッケージの pack の前に、カレントディレクトリのパッケージで実行する。
// - リポジトリの LICENSE を複製する（npm はパッケージのフォルダーの LICENSE だけを含める）。
// - api-extractor.publish.json があれば、配布しない @dismock/server の型を取り込んだ 1 つの .d.ts を作る。
import { copyFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const PACKAGE_DIR = process.cwd();
const PUBLISH_CONFIG = join(PACKAGE_DIR, 'api-extractor.publish.json');
const BUILT_ENTRY = join(PACKAGE_DIR, 'dist', 'index.d.ts');

copyFileSync(new URL('../LICENSE', import.meta.url), join(PACKAGE_DIR, 'LICENSE'));

if (!existsSync(BUILT_ENTRY)) {
  throw new Error('dist/ がありません。先にリポジトリのルートで pnpm build を実行してください');
}

if (existsSync(PUBLISH_CONFIG)) {
  // API Extractor はこのスクリプトではなく、パッケージの依存から読み込む。
  const resolved = createRequire(join(PACKAGE_DIR, 'package.json')).resolve('@microsoft/api-extractor');
  const { Extractor, ExtractorConfig } = await import(pathToFileURL(resolved).href);
  const result = Extractor.invoke(ExtractorConfig.loadFileAndPrepare(PUBLISH_CONFIG), { localBuild: true });
  if (!result.succeeded) {
    throw new Error('型の .d.ts をまとめられませんでした');
  }
}
