// ターミナルのウインドウの preload。Mock の出力の受け取りだけを公開する。
import { contextBridge, ipcRenderer } from 'electron';
import { DesktopChannel, TERMINAL_BRIDGE_KEY, type TerminalBridge, type TerminalChunk } from './bridge.js';

const bridge: TerminalBridge = {
  history: () => ipcRenderer.invoke(DesktopChannel.terminalHistory),
  onData: (listener) => {
    ipcRenderer.on(DesktopChannel.terminalData, (_event, chunk: TerminalChunk) => listener(chunk));
  },
};

contextBridge.exposeInMainWorld(TERMINAL_BRIDGE_KEY, bridge);
