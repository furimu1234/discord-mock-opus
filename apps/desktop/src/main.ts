// 配布版のウインドウ。Mock を子プロセスで起動し、画面とターミナルの 2 つのウインドウで表示する。
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { app, BrowserWindow, ipcMain, Menu, screen, session, shell, type Display, type IpcMainInvokeEvent } from 'electron';
import { MOCK_STOP_MESSAGE, STATE_FILE_NAME, URL_LINE_PREFIX } from '@dismock/server/constants';
import { DesktopChannel, type DesktopDisplay, type TerminalChunk } from './bridge.js';
import { defaultLayout, findSavedDisplay, restoreLayout, MAIN_MIN_SIZE, TERMINAL_MIN_SIZE, type Layout, type SavedLayout } from './layout.js';

/** 起動スクリプトが渡す、状態、添付、ウインドウの位置を保存するディレクトリ。 */
const DATA_DIR_OPTION = '--data-dir';
/** ウインドウの位置を保存するファイル。状態の JSON と同じディレクトリに置く。 */
const LAYOUT_FILE_NAME = 'desktop-window.json';
/** ターミナルのウインドウを開き直したときに表示する、出力の量（文字数）。 */
const TERMINAL_HISTORY_CHARS = 2_000_000;
/** 移動と大きさの変更が落ち着いてから位置を保存するまでの時間。 */
const SAVE_DELAY_MS = 500;
/** 終了するときに Mock の停止を待つ時間。過ぎたら強制終了する。 */
const STOP_TIMEOUT_MS = 5000;

// 起動スクリプトは Chromium のオプションの後に `--` を置き、その後ろに dismock の引数を並べる。
// exe や app を直接起動したときは `--` がないので、すべてを dismock の引数とする。
const argv = process.argv.slice(app.isPackaged ? 1 : 2);
const userArgs = argv.includes('--') ? argv.slice(argv.indexOf('--') + 1) : argv;
const dataDirIndex = userArgs.indexOf(DATA_DIR_OPTION);
const dataDir =
  (dataDirIndex >= 0 ? userArgs[dataDirIndex + 1] : undefined) ??
  (process.platform === 'darwin' ? join(app.getPath('appData'), app.getName()) : dirname(process.execPath));
const serverArgs = dataDirIndex >= 0 ? userArgs.filter((_, index) => index !== dataDirIndex && index !== dataDirIndex + 1) : userArgs;
const layoutFile = join(dataDir, 'data', LAYOUT_FILE_NAME);

// ウインドウのキャッシュなども、状態と同じ場所にまとめる。
app.setPath('userData', join(dataDir, 'data', 'desktop'));

let main: BrowserWindow | undefined;
let terminal: BrowserWindow | undefined;
let terminalHistory = '';
/** これまでに書いた出力の文字数の合計。 */
let terminalEnd = 0;
let quitting = false;

const windows = () => [main, terminal].filter((window): window is BrowserWindow => Boolean(window && !window.isDestroyed()));

/** Mac の Finder から開いた app はシェルの PATH を受け取らないので、ログインシェルから読む。Bot の起動に Node を探すため。 */
function loginShellPath(): string | undefined {
  if (process.platform !== 'darwin') return process.env.PATH;
  try {
    const output = execFileSync(process.env.SHELL || '/bin/zsh', ['-ilc', 'printf "__DISMOCK_PATH__%s__DISMOCK_PATH__" "$PATH"'], { encoding: 'utf8', timeout: 5000 });
    return /__DISMOCK_PATH__(.*)__DISMOCK_PATH__/.exec(output)?.[1] ?? process.env.PATH;
  } catch {
    return process.env.PATH;
  }
}

// --- ターミナル ---

function writeTerminal(data: string): void {
  terminalHistory = (terminalHistory + data).slice(-TERMINAL_HISTORY_CHARS);
  terminalEnd += data.length;
  const chunk: TerminalChunk = { data, end: terminalEnd };
  if (terminal && !terminal.isDestroyed()) terminal.webContents.send(DesktopChannel.terminalData, chunk);
}

// --- Mock ---

/** Mock を子プロセスで起動する。Electron を Node として動かすので、別に Node をインストールしなくてよい。 */
function startMock(onUrl: (url: string) => void) {
  const child = spawn(
    process.execPath,
    [join(__dirname, 'server/dismock-server.cjs'), '--web', join(__dirname, 'web'), '--data', join(dataDir, 'data', STATE_FILE_NAME), '--media', join(dataDir, 'media'), ...serverArgs],
    {
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', FORCE_COLOR: '1', PATH: loginShellPath() },
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
      windowsHide: true,
    },
  );
  let pending = '';
  child.stdout?.setEncoding('utf8').on('data', (data: string) => {
    writeTerminal(data);
    pending += data;
    const lines = pending.split('\n');
    pending = lines.pop() ?? '';
    const line = lines.find((text) => text.startsWith(URL_LINE_PREFIX));
    if (line) onUrl(line.slice(URL_LINE_PREFIX.length).trim());
  });
  child.stderr?.setEncoding('utf8').on('data', writeTerminal);
  child.once('error', (error) => writeTerminal(`\nMock を起動できません: ${error.message}\n`));
  child.once('exit', (code) => {
    if (!quitting) writeTerminal(`\nMock が終了しました（終了コード ${code ?? '-'}）。ウインドウを閉じてください\n`);
  });
  return child;
}

// --- 配置 ---

function readLayout(): SavedLayout {
  try {
    return JSON.parse(readFileSync(layoutFile, 'utf8')) as SavedLayout;
  } catch {
    return {};
  }
}

function currentDisplay(): Display {
  return main && !main.isDestroyed() ? screen.getDisplayMatching(main.getBounds()) : screen.getPrimaryDisplay();
}

/** 最後に開いていたディスプレイとウインドウの位置を保存する。 */
function saveLayout(): void {
  if (!main || main.isDestroyed() || !terminal || terminal.isDestroyed()) return;
  const display = currentDisplay();
  const layout: SavedLayout = {
    display: { id: display.id, label: display.label, bounds: display.bounds },
    main: main.getNormalBounds(),
    terminal: terminal.getNormalBounds(),
  };
  mkdirSync(dirname(layoutFile), { recursive: true });
  writeFileSync(layoutFile, `${JSON.stringify(layout, null, 2)}\n`);
}

let saveTimer: NodeJS.Timeout | undefined;
function scheduleSave(): void {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveLayout, SAVE_DELAY_MS);
}

function notifyDisplaysChanged(): void {
  if (main && !main.isDestroyed()) main.webContents.send(DesktopChannel.displaysChanged);
}

function applyLayout(layout: Layout): void {
  for (const [window, bounds] of [[main, layout.main], [terminal, layout.terminal]] as const) {
    if (!window || window.isDestroyed()) continue;
    if (window.isMaximized()) window.unmaximize();
    if (window.isMinimized()) window.restore();
    // 拡大率の違うディスプレイへ移すと、1 回目は大きさがずれることがあるので 2 回設定する。
    window.setBounds(bounds);
    window.setBounds(bounds);
  }
  saveLayout();
  notifyDisplaysChanged();
}

const displayLabel = (display: Display, index: number) => display.label || `ディスプレイ ${index + 1}`;

function displayList(): DesktopDisplay[] {
  const primary = screen.getPrimaryDisplay().id;
  const current = currentDisplay().id;
  return screen.getAllDisplays().map((display, index) => ({
    id: display.id,
    label: displayLabel(display, index),
    width: display.size.width,
    height: display.size.height,
    primary: display.id === primary,
    current: display.id === current,
  }));
}

// --- ウインドウ ---

/** どちらかのウインドウが手前に来たら、もう一方も手前に出す。重なっているときは、操作したほうを上にする。 */
let raising = false;
function raiseTogether(focused: BrowserWindow): void {
  const other = windows().find((window) => window !== focused);
  if (raising || !other) return;
  raising = true;
  try {
    if (other.isMinimized()) other.showInactive();
    other.moveTop();
    focused.moveTop();
  } finally {
    raising = false;
  }
}

function openExternal(url: string): void {
  if (/^https?:\/\//.test(url)) void shell.openExternal(url);
}

function createWindow(options: Electron.BrowserWindowConstructorOptions & { preload: string }): BrowserWindow {
  const { preload, ...rest } = options;
  const window = new BrowserWindow({
    ...rest,
    show: false,
    autoHideMenuBar: true,
    webPreferences: { preload, contextIsolation: true, sandbox: true, nodeIntegration: false },
  });
  window.once('ready-to-show', () => window.show());
  window.on('focus', () => raiseTogether(window));
  window.on('moved', scheduleSave);
  window.on('resized', scheduleSave);
  // 閉じた後はウインドウの位置を読めないので、閉じる前に保存する。
  window.on('close', () => {
    clearTimeout(saveTimer);
    saveLayout();
  });
  // どちらかを閉じたら dismock を終了する。片方だけ残ると、閉じたほうを開き直せないため。
  window.on('closed', () => app.quit());
  window.webContents.setWindowOpenHandler(({ url }) => {
    openExternal(url);
    return { action: 'deny' };
  });
  return window;
}

function createTerminal(layout: Layout): BrowserWindow {
  const window = createWindow({ ...layout.terminal, minWidth: TERMINAL_MIN_SIZE.width, minHeight: TERMINAL_MIN_SIZE.height, title: 'dismock ターミナル', backgroundColor: '#000000', preload: join(__dirname, 'terminal-preload.cjs') });
  window.webContents.on('will-navigate', (event) => event.preventDefault());
  void window.loadFile(join(__dirname, 'terminal.html'));
  return window;
}

function createMain(layout: Layout, url: string): BrowserWindow {
  const origin = new URL(url).origin;
  const window = createWindow({ ...layout.main, minWidth: MAIN_MIN_SIZE.width, minHeight: MAIN_MIN_SIZE.height, title: 'dismock', preload: join(__dirname, 'preload.cjs') });
  // 画面の外へは移動させず、既定のブラウザで開く。
  window.webContents.on('will-navigate', (event, target) => {
    if (new URL(target).origin === origin) return;
    event.preventDefault();
    openExternal(target);
  });
  window.on('moved', notifyDisplaysChanged);
  void window.loadURL(url);
  return window;
}

/** IPC は、Mock の画面のウインドウの最上位のフレームからだけ受け付ける。 */
function fromMain(event: IpcMainInvokeEvent): boolean {
  return Boolean(main && !main.isDestroyed() && event.sender === main.webContents && event.senderFrame === main.webContents.mainFrame);
}

function handleIpc(): void {
  ipcMain.handle(DesktopChannel.displays, (event) => (fromMain(event) ? displayList() : []));
  ipcMain.handle(DesktopChannel.moveToDisplay, (event, id: unknown) => {
    const display = screen.getAllDisplays().find((candidate) => candidate.id === id);
    if (fromMain(event) && display) applyLayout(defaultLayout(display.workArea));
  });
  ipcMain.handle(DesktopChannel.resetPosition, (event) => {
    if (!fromMain(event)) return;
    rmSync(layoutFile, { force: true });
    applyLayout(defaultLayout(screen.getPrimaryDisplay().workArea));
  });
  ipcMain.handle(DesktopChannel.terminalHistory, (event): TerminalChunk => ({
    data: terminal && event.sender === terminal.webContents ? terminalHistory : '',
    end: terminalEnd,
  }));
}

function start(): void {
  Menu.setApplicationMenu(process.platform === 'darwin' ? Menu.getApplicationMenu() : null);
  // 画面が使う権限は、クリップボードへの書き込みだけ。
  session.defaultSession.setPermissionRequestHandler((_contents, permission, callback) => callback(permission === 'clipboard-sanitized-write'));
  handleIpc();
  screen.on('display-added', notifyDisplaysChanged);
  screen.on('display-removed', notifyDisplaysChanged);
  screen.on('display-metrics-changed', notifyDisplaysChanged);

  const saved = readLayout();
  const display = findSavedDisplay(screen.getAllDisplays(), saved.display) ?? screen.getPrimaryDisplay();
  const layout = restoreLayout(display, saved);
  terminal = createTerminal(layout);
  const mock = startMock((url) => {
    if (!main) main = createMain(layout, url);
  });

  // 終了するときは位置を保存し、Mock を止めてから終了する。Mock は Bot の Gateway に RECONNECT を送ってから止まる。
  app.on('before-quit', (event) => {
    if (quitting) return;
    quitting = true;
    clearTimeout(saveTimer);
    saveLayout();
    if (mock.exitCode !== null || mock.signalCode !== null) return;
    event.preventDefault();
    const timer = setTimeout(() => mock.kill(), STOP_TIMEOUT_MS);
    mock.once('exit', () => {
      clearTimeout(timer);
      app.quit();
    });
    mock.send(MOCK_STOP_MESSAGE);
  });
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    const window = main ?? terminal;
    if (!window || window.isDestroyed()) return;
    if (window.isMinimized()) window.restore();
    window.focus();
  });
  app.on('window-all-closed', () => app.quit());
  if (!existsSync(dataDir)) mkdirSync(dataDir, { recursive: true });
  void app.whenReady().then(start);
}
