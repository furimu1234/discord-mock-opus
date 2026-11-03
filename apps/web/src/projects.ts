import type { Json } from './api';

/**
 * 画面から Bot プロジェクトを起動できるか。
 * 画面から起動した testClient は起動し直せる。起動の途中、テストの実行中、別の testClient が接続している間は起動できない。
 */
export function canStartProjects(tests: Json | null): boolean {
  const launcher = (tests?.launcher ?? {}) as Json;
  return Boolean(launcher.enabled) && !tests?.runningProject && Boolean(launcher.running) === Boolean(tests?.agentConnected);
}

/** プロジェクトの Bot が接続中か。 */
export function isActiveProject(tests: Json | null, project: Json): boolean {
  return tests?.activeBot === project.label;
}
