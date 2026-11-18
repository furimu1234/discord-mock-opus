// 画面のウインドウの preload。ウインドウの操作だけを画面に公開する。
import { contextBridge, ipcRenderer } from 'electron';
import { DESKTOP_BRIDGE_KEY, DesktopChannel, type DesktopBridge, type DesktopUpdateProgress } from './bridge.js';

const bridge: DesktopBridge = {
  displays: () => ipcRenderer.invoke(DesktopChannel.displays),
  moveToDisplay: (id) => ipcRenderer.invoke(DesktopChannel.moveToDisplay, id),
  resetPosition: () => ipcRenderer.invoke(DesktopChannel.resetPosition),
  onDisplaysChanged: (listener) => {
    const handler = () => listener();
    ipcRenderer.on(DesktopChannel.displaysChanged, handler);
    return () => ipcRenderer.removeListener(DesktopChannel.displaysChanged, handler);
  },
  checkUpdate: () => ipcRenderer.invoke(DesktopChannel.checkUpdate),
  installUpdate: () => ipcRenderer.invoke(DesktopChannel.installUpdate),
  onUpdateProgress: (listener) => {
    const handler = (_event: unknown, progress: DesktopUpdateProgress) => listener(progress);
    ipcRenderer.on(DesktopChannel.updateProgress, handler);
    return () => ipcRenderer.removeListener(DesktopChannel.updateProgress, handler);
  },
};

contextBridge.exposeInMainWorld(DESKTOP_BRIDGE_KEY, bridge);
