import { readdirSync } from 'node:fs';

/** `src/` の下のフォルダーから、各ファイルの default export を読み込む。 */
export async function loadModules<T>(folder: string): Promise<T[]> {
  const directory = new URL(`./${folder}/`, import.meta.url);
  const modules = readdirSync(directory).map(async (file) => {
    const loaded = (await import(new URL(file, directory).href)) as { default: T };
    return loaded.default;
  });
  return Promise.all(modules);
}
