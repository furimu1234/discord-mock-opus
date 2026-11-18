import {
  DESKTOP_BRIDGE_KEY,
  type DesktopBridge,
  type DesktopUpdate,
  type DesktopUpdateProgress,
} from '@dismock/desktop/bridge';
import { useEffect, useState } from 'react';

/** 配布版のウインドウで開いたときだけある、ウインドウの操作。ブラウザでは `undefined`。 */
const desktop = (window as unknown as Partial<Record<string, DesktopBridge>>)[DESKTOP_BRIDGE_KEY];

const percent = ({ received, total }: DesktopUpdateProgress) => (total ? Math.floor((received / total) * 100) : 0);

/**
 * 配布版のアップデート。配布版のウインドウでだけ表示する。
 * GitHub への問い合わせは「アップデートを確認」を押したときだけ行う。
 */
export function UpdateSection({ onError }: { onError: (message: string) => void }) {
  const [checking, setChecking] = useState(false);
  const [update, setUpdate] = useState<DesktopUpdate | null>(null);
  const [progress, setProgress] = useState<DesktopUpdateProgress | null>(null);
  const [installing, setInstalling] = useState(false);

  useEffect(() => desktop?.onUpdateProgress(setProgress), []);

  if (!desktop) return null;

  const check = () => {
    setChecking(true);
    desktop
      .checkUpdate()
      .then(setUpdate, (error: Error) => onError(error.message))
      .finally(() => setChecking(false));
  };
  const install = () => {
    setInstalling(true);
    setProgress(null);
    // 成功すると dismock が終了して起動し直すので、戻ってくるのは失敗したときだけ。
    desktop.installUpdate().catch((error: Error) => {
      setInstalling(false);
      onError(error.message);
    });
  };

  return (
    <section className="admin-section">
      <div className="admin-section-header">
        <h2>アップデート</h2>
        <small>押したときだけ GitHub の Releases に最新版を問い合わせます。</small>
        <button type="button" className="button secondary" disabled={checking || installing} onClick={check}>
          {checking ? '確認中…' : 'アップデートを確認'}
        </button>
      </div>
      {update && !update.available && <p className="update-status">最新の版です（{update.current}）。</p>}
      {update?.available && (
        <div className="update-available">
          <p className="update-status">
            新しい版 {update.latest} があります（今の版 {update.current}）。
          </p>
          {update.notes.trim() && <pre className="update-notes">{update.notes.trim()}</pre>}
          <div className="update-actions">
            <a className="button secondary" href={update.url} target="_blank" rel="noreferrer">
              Release のページを開く
            </a>
            {update.installable && (
              <button type="button" className="button primary" disabled={installing} onClick={install}>
                {installing
                  ? progress
                    ? `ダウンロード中 ${percent(progress)}%`
                    : '準備中…'
                  : 'アップデートして再起動'}
              </button>
            )}
          </div>
          {update.installable && (
            <small className="update-hint">
              dismock を終了し、新しい版に差し替えて起動し直します。data と media のフォルダーはそのまま残ります。
            </small>
          )}
        </div>
      )}
    </section>
  );
}
