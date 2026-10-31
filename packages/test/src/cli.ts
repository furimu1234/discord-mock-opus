import { parseArgs } from 'node:util';
import { runAgent } from './agent.js';
import { findSetup, findTests, spawnRunner } from './spawn.js';

const USAGE = `使い方:
  dismock test [ファイル名の一部...] [-t テスト名] [--setup testClient.ts]
  dismock agent <プロジェクトのディレクトリ...>`;

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    testNamePattern: { type: 'string', short: 't' },
    setup: { type: 'string' },
  },
});

const [command, ...rest] = positionals;

if (command === 'agent' && rest.length > 0) {
  await runAgent(rest);
} else if (command === 'test') {
  const cwd = process.cwd();
  const files = findTests(cwd, rest);
  if (files.length === 0) {
    console.error('テストファイルが見つかりません');
    process.exit(1);
  }
  const child = spawnRunner(
    cwd,
    { files, setup: values.setup ?? findSetup(cwd), filter: values.testNamePattern },
    'inherit',
  );
  child.on('exit', (code) => process.exit(code ?? 1));
} else {
  console.log(USAGE);
  process.exit(command ? 1 : 0);
}
