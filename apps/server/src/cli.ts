import { spawn } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { LEGAL_NOTICE, MOCK_STOP_MESSAGE, STATE_FILE_NAME, URL_LINE_PREFIX } from './constants.js';
import { DEFAULT_HOST, DEFAULT_PORT, startServer } from './index.js';
import { webDirectory } from './static.js';

const { values } = parseArgs({
  options: {
    host: { type: 'string', default: DEFAULT_HOST },
    port: { type: 'string', default: String(DEFAULT_PORT) },
    data: { type: 'string', default: join('data', STATE_FILE_NAME) },
    token: { type: 'string', default: process.env.DISMOCK_TOKEN },
    media: { type: 'string' },
    /** Web UI のビルド結果のディレクトリ。配布用のビルドで、起動スクリプトとウインドウが指定する。 */
    web: { type: 'string' },
    /** 起動後に画面をブラウザで開く。 */
    open: { type: 'boolean', default: false },
  },
});

// 添付は、起動したファイル（dismock-server.js）と同じディレクトリの media に置く。
const mediaDir = values.media ?? join(dirname(resolve(process.argv[1] ?? '.')), 'media');
const webDir = values.web ? resolve(values.web) : fileURLToPath(new URL('../../web/dist', import.meta.url));

/** 既定のブラウザで開く。開けなくても URL は表示しているので、起動は続ける。 */
function openBrowser(url: string): void {
  const [command, args] =
    process.platform === 'win32'
      ? ['cmd.exe', ['/d', '/s', '/c', `start "" "${url}"`]]
      : [process.platform === 'darwin' ? 'open' : 'xdg-open', [url]];
  const child = spawn(command, args, { detached: true, stdio: 'ignore', windowsVerbatimArguments: true });
  child.once('error', () => console.error('ブラウザを開けませんでした。上の URL を開いてください'));
  child.unref();
}

startServer({
  host: values.host,
  port: Number(values.port),
  dataFile: values.data,
  token: values.token,
  webFiles: webDirectory(webDir),
  mediaDir,
  clearOnStart: true,
  seedDefaults: true,
}).then(
  (server) => {
    // トークンをフラグメントに置き、サーバーのログや Referer に残らないようにする。
    const url = `${server.url}/#token=${server.store.state.token}`;
    console.log(`${URL_LINE_PREFIX}${url}`);
    console.log(LEGAL_NOTICE);
    if (values.open) openBrowser(url);
    const stop = () => void server.close().then(() => process.exit(0));
    for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, stop);
    // 配布版のウインドウは Windows でもシグナルを送れないので、IPC で停止を指示する。
    process.on('message', (message) => {
      if (message === MOCK_STOP_MESSAGE) stop();
    });
    // 親のプロセスが突然終了したときも、Mock を残さない。
    process.once('disconnect', stop);
  },
  (error: Error) => {
    console.error(`Mock を起動できません: ${error.message}`);
    process.exit(1);
  },
);
