import { spawnSync } from 'node:child_process';
import { existsSync, globSync } from 'node:fs';
import { parseArgs } from 'node:util';

const SETUP_CANDIDATES = ['testClient', '__tests__/testClient', 'tests/testClient', 'test/testClient'];
const EXTENSIONS = ['ts', 'mts', 'js', 'mjs'];
const IGNORED = ['node_modules', 'dist', '.local', '.git'];

function findSetup(): string | undefined {
  for (const base of SETUP_CANDIDATES) {
    for (const extension of EXTENSIONS) {
      if (existsSync(`${base}.${extension}`)) return `${base}.${extension}`;
    }
  }
  return undefined;
}

function findTests(patterns: string[]): string[] {
  const files = globSync('**/*.test.{ts,mts,js,mjs}', { exclude: (name) => IGNORED.includes(String(name)) }).sort();
  if (patterns.length === 0) return files;
  return files.filter((file) => patterns.some((pattern) => file.includes(pattern)));
}

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    testNamePattern: { type: 'string', short: 't' },
    setup: { type: 'string' },
  },
});

if (positionals[0] !== 'test') {
  console.log('使い方: dismock test [ファイル名の一部...] [-t テスト名] [--setup testClient.ts]');
  process.exit(positionals.length === 0 ? 0 : 1);
}

const files = findTests(positionals.slice(1));
if (files.length === 0) {
  console.error('テストファイルが見つかりません');
  process.exit(1);
}

const result = spawnSync(
  process.execPath,
  [
    '--disable-warning=ExperimentalWarning',
    '--import',
    import.meta.resolve('tsx'),
    '--import',
    import.meta.resolve('@dismock/client/register'),
    new URL('./run.js', import.meta.url).pathname,
  ],
  {
    stdio: 'inherit',
    env: {
      ...process.env,
      DISMOCK_TEST_CONFIG: JSON.stringify({
        files,
        setup: values.setup ?? findSetup(),
        filter: values.testNamePattern,
      }),
    },
  },
);
process.exit(result.status ?? 1);
