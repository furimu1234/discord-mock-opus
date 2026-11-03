import { useEffect, useState } from 'react';
import { api, type Json } from '../api';

/** 要約に並べる指標。istanbul の要約の項目名と表示名。 */
const METRICS = [
  ['lines', '行'],
  ['statements', '文'],
  ['functions', '関数'],
  ['branches', '分岐'],
] as const;

/** これ以上なら十分、これ未満なら不足として色を付ける割合（%）。 */
const HIGH_COVERAGE = 80;
const LOW_COVERAGE = 50;

const level = (pct: number) => (pct >= HIGH_COVERAGE ? 'high' : pct < LOW_COVERAGE ? 'low' : 'medium');

function Percent({ value }: { value: number }) {
  return <span className={`coverage-pct ${level(value)}`}>{value.toFixed(1)}%</span>;
}

/**
 * 全件のテストの後に、カバレッジを保存するかを選ぶ。
 * 保存すると、Bot のプロセスが HTML をプロジェクトの `coverage/` に書き出し、表をターミナルに出力する。
 */
export function CoverageDialog({ coverage, onClose, onError }: { coverage: Json; onClose: () => void; onError: (message: string) => void }) {
  const [requested, setRequested] = useState(false);
  const { total, files } = coverage.summary as { total: Json; files: Json[] };
  const saved = requested && !coverage.saving;

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  const save = () => {
    setRequested(true);
    api.post('/tests/coverage/save').catch((error: Error) => {
      setRequested(false);
      onError(error.message);
    });
  };

  return (
    <div className="overlay" onClick={onClose}>
      <div className="dialog wide coverage-dialog" role="dialog" aria-label="カバレッジ" onClick={(event) => event.stopPropagation()}>
        <h2>カバレッジを保存しますか？</h2>
        <p className="dialog-message">
          {coverage.project} の全件のテストで実行した Bot のコードの割合です。保存すると、HTML をプロジェクトの coverage フォルダーに書き出し、表をターミナルに出力します。
        </p>
        <div className="coverage-total">
          {METRICS.map(([key, label]) => (
            <div key={key} className="coverage-metric">
              <span className="coverage-label">{label}</span>
              <Percent value={total[key].pct} />
              <small>{total[key].covered} / {total[key].total}</small>
            </div>
          ))}
        </div>
        <div className="dialog-body">
          {files.length === 0 ? (
            <p className="dialog-message">テストで読み込まれた Bot のファイルがありません。</p>
          ) : (
            <table className="coverage-table">
              <thead>
                <tr>
                  <th>ファイル</th>
                  {METRICS.map(([key, label]) => <th key={key}>{label}</th>)}
                </tr>
              </thead>
              <tbody>
                {files.map((file) => (
                  <tr key={file.file}>
                    <td className="coverage-file">{file.file}</td>
                    {METRICS.map(([key]) => <td key={key}><Percent value={file[key]} /></td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        <div className="dialog-actions">
          {saved && (
            <span className="dialog-note">
              {coverage.savedDir ? `${coverage.savedDir}/index.html に保存し、ターミナルに出力しました` : '保存できませんでした。Bot が停止しています'}
            </span>
          )}
          {saved ? (
            <button className="button" autoFocus onClick={onClose}>閉じる</button>
          ) : (
            <>
              <button className="button secondary" autoFocus onClick={onClose}>保存しない</button>
              <button className="button" disabled={requested} onClick={save}>{requested ? '保存中…' : '保存する'}</button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
