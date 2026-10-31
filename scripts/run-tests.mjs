import { spawn } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { EXIT_STARTUP_FAILURE } from '../packages/test/dist/constants.js';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const DISMOCK = join(ROOT, 'packages/test/bin/dismock.js');

function run(cwd, args) {
  return new Promise((done) => {
    const child = spawn(process.execPath, [DISMOCK, 'test', ...args], { cwd, stdio: 'inherit' });
    child.on('exit', (code) => done(code ?? 1));
  });
}

/** 1 つの Mock を共有するため、examples のテストは順番に実行する。 */
export async function runTests(args = []) {
  const examples = join(ROOT, 'examples');
  const projects = readdirSync(examples)
    .map((name) => join(examples, name))
    .filter((path) => existsSync(join(path, 'package.json')));

  let status = 0;
  for (const project of projects) {
    console.log(`\n# ${project.slice(ROOT.length + 1)}`);
    const code = await run(project, args);
    if (code === EXIT_STARTUP_FAILURE) return code;
    status ||= code;
  }
  return status;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  process.exit(await runTests(process.argv.slice(2)));
}
