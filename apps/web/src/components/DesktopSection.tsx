import { useCallback, useEffect, useState } from 'react';
import { DESKTOP_BRIDGE_KEY, type DesktopBridge, type DesktopDisplay } from '@dismock/desktop/bridge';
import { Select } from './Select';

/** 配布版のウインドウで開いたときだけある、ウインドウの操作。ブラウザでは `undefined`。 */
const desktop = (window as unknown as Partial<Record<string, DesktopBridge>>)[DESKTOP_BRIDGE_KEY];

const displayName = (display: DesktopDisplay) =>
  `${display.label}（${display.width}×${display.height}${display.primary ? '、メイン' : ''}）`;

/** 画面とターミナルのウインドウを表示するディスプレイ。配布版のウインドウでだけ表示する。 */
export function DesktopSection({ onError }: { onError: (message: string) => void }) {
  const [displays, setDisplays] = useState<DesktopDisplay[]>([]);

  const reload = useCallback(() => {
    desktop?.displays().then(setDisplays, (error: Error) => onError(error.message));
  }, [onError]);

  useEffect(() => {
    reload();
    return desktop?.onDisplaysChanged(reload);
  }, [reload]);

  if (!desktop) return null;
  const current = displays.find((display) => display.current);
  const call = (action: Promise<void>) => action.then(reload, (error: Error) => onError(error.message));

  return (
    <section className="admin-section">
      <div className="admin-section-header">
        <h2>ウインドウ</h2>
        <small>画面とターミナルのウインドウを表示するディスプレイです。終了したときのディスプレイと位置を、次の起動で使います。</small>
        <button type="button" className="button secondary" onClick={() => void call(desktop.resetPosition())}>位置をリセット</button>
      </div>
      <Select label="表示するディスプレイ" value={current ? String(current.id) : ''} placeholder="ディスプレイ"
        options={displays.map((display) => ({ value: String(display.id), label: displayName(display) }))}
        onChange={(id) => void call(desktop.moveToDisplay(Number(id)))} />
    </section>
  );
}
