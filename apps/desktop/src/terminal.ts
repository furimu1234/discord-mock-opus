// ターミナルのウインドウ。Mock と Bot の出力を表示する。入力は受け付けない。
import { FitAddon } from '@xterm/addon-fit';
import { Terminal } from '@xterm/xterm';
import { TERMINAL_BRIDGE_KEY, type TerminalBridge, type TerminalChunk } from './bridge.js';

/** 遡って読める行数。 */
const SCROLLBACK_LINES = 10_000;

const bridge = (window as unknown as { [TERMINAL_BRIDGE_KEY]: TerminalBridge })[TERMINAL_BRIDGE_KEY];
const terminal = new Terminal({
  convertEol: true,
  disableStdin: true,
  scrollback: SCROLLBACK_LINES,
  fontFamily: 'ui-monospace, "Cascadia Mono", Menlo, Consolas, "DejaVu Sans Mono", "Noto Sans Mono CJK JP", monospace',
  fontSize: 13,
});
const fit = new FitAddon();
terminal.loadAddon(fit);
terminal.open(document.getElementById('terminal') ?? document.body);
fit.fit();
new ResizeObserver(() => fit.fit()).observe(document.body);

// 選択した文字は Ctrl+C（Mac は Cmd+C）でコピーする。
terminal.attachCustomKeyEventHandler((event) => {
  const copy = event.type === 'keydown' && (event.ctrlKey || event.metaKey) && event.key === 'c' && terminal.hasSelection();
  if (copy) void navigator.clipboard.writeText(terminal.getSelection());
  return !copy;
});

// 履歴を取り出す間に届いた出力は、履歴に含まれていないものだけを書く。
let written: number | undefined;
const pending: TerminalChunk[] = [];
const write = ({ data, end }: TerminalChunk) => {
  if (written !== undefined && end <= written) return;
  terminal.write(data);
  written = end;
};
bridge.onData((chunk) => (written === undefined ? pending.push(chunk) : write(chunk)));
void bridge.history().then((history) => {
  terminal.write(history.data);
  written = history.end;
  for (const chunk of pending.splice(0)) write(chunk);
});
