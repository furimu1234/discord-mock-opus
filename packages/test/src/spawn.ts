import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, globSync } from 'node:fs';
import { join } from 'node:path';

const SETUP_CANDIDATES = ['testClient', '__tests__/testClient', 'tests/testClient', 'test/testClient'];
const EXTENSIONS = ['ts', 'mts', 'js', 'mjs'];
const IGNORED = ['node_modules', 'dist', '.local', '.git'];

export function findSetup(cwd: string): string | undefined {
  for (const base of SETUP_CANDIDATES) {
    for (const extension of EXTENSIONS) {
      if (existsSync(join(cwd, `${base}.${extension}`))) return `${base}.${extension}`;
    }
  }
  return undefined;
}

export function findTests(cwd: string, patterns: string[] = []): string[] {
  const files = globSync('**/*.test.{ts,mts,js,mjs}', {
    cwd,
    exclude: (name) => IGNORED.includes(String(name)),
  }).sort();
  if (patterns.length === 0) return files;
  return files.filter((file) => patterns.some((pattern) => file.includes(pattern)));
}

export interface RunnerConfig {
  mode?: 'run' | 'list' | 'bot';
  files: string[];
  setup?: string;
  filter?: string;
  ids?: string[];
  project?: string;
}

/** Bot のコードを差し替えるフックを読み込んだ Node でランナーを起動する。 */
export function spawnRunner(cwd: string, config: RunnerConfig, stdout: 'inherit' | 'pipe'): ChildProcess {
  return spawn(
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
      cwd,
      stdio: ['ignore', stdout, 'inherit'],
      env: { ...process.env, DISMOCK_TEST_CONFIG: JSON.stringify(config) },
    },
  );
}
