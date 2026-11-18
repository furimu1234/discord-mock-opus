// @dismock/server の定数を、カレントディレクトリのパッケージの vendor/ に複製する。
// npm で配る @dismock/client と @dismock/test は server に依存せず、`#server-constants` でこの複製を読み込む。
// 定数の定義は apps/server/src/constants.ts の 1 か所で、ここは server のビルド結果を写すだけ。
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const SOURCE = new URL('../apps/server/dist/', import.meta.url);
const TARGET = join(process.cwd(), 'vendor');
const FILES = { 'constants.js': 'server-constants.js', 'constants.d.ts': 'server-constants.d.ts' };
// server の src を指すソースマップは配布物にないので、参照を取り除く。
const SOURCE_MAP_COMMENT = /\n\/\/# sourceMappingURL=.*$/;

mkdirSync(TARGET, { recursive: true });
for (const [from, to] of Object.entries(FILES)) {
  let text;
  try {
    text = readFileSync(new URL(from, SOURCE), 'utf8');
  } catch {
    throw new Error(`apps/server/dist/${from} がありません。先に @dismock/server をビルドしてください`);
  }
  if (/^\s*(import|export .* from)\b/m.test(text)) {
    throw new Error(`apps/server/dist/${from} が他のファイルを読み込んでいるため、複製できません`);
  }
  writeFileSync(join(TARGET, to), text.replace(SOURCE_MAP_COMMENT, '\n'));
}
