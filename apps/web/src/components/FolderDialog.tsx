import { useEffect, useState } from 'react';
import { api, type Json } from '../api';
import { FolderIcon } from './Icons';

const folderUrl = (path?: string) => (path ? `/folders?path=${encodeURIComponent(path)}` : '/folders');

/** Mock が動いている PC のフォルダーを選ぶ。ブラウザの選択では絶対パスを取得できないため、Mock から一覧を受け取る。 */
export function FolderDialog({ initialPath, onSelect, onClose }: {
  /** 最初に開くフォルダー。開けないときはホームフォルダーを開く。 */
  initialPath: string;
  onSelect: (path: string) => void;
  onClose: () => void;
}) {
  const [listing, setListing] = useState<Json | null>(null);
  const [error, setError] = useState<string | null>(null);

  const open = (path?: string) => api.get(folderUrl(path)).then((next: Json) => {
    setListing(next);
    setError(null);
  });
  const browse = (path: string) => void open(path).catch((failure: Error) => setError(failure.message));

  useEffect(() => {
    void open(initialPath).catch(() => open()).catch((failure: Error) => setError(failure.message));
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [initialPath, onClose]);

  const folders = (listing?.folders ?? []) as Json[];
  return (
    <div className="overlay" onClick={onClose}>
      <div className="dialog folder-dialog" role="dialog" aria-label="フォルダーの選択" onClick={(event) => event.stopPropagation()}>
        <h2>フォルダーの選択</h2>
        <code className="folder-path">{listing?.path}</code>
        {error && <div className="notice">{error}</div>}
        <ul className="folder-list">
          {listing?.parent && (
            <li><button className="folder-item" onClick={() => browse(listing.parent)}>↑ 上のフォルダー</button></li>
          )}
          {folders.map((folder) => (
            <li key={folder.path}>
              <button className="folder-item" onClick={() => browse(folder.path)}><FolderIcon />{folder.name}</button>
            </li>
          ))}
        </ul>
        {listing && !listing.installed && <p className="folder-hint">@dismock/test がインストールされていないフォルダーは選択できません。</p>}
        <div className="dialog-actions">
          <button className="button secondary" onClick={onClose}>キャンセル</button>
          <button className="button primary" disabled={!listing?.installed} onClick={() => onSelect(listing!.path)}>選択</button>
        </div>
      </div>
    </div>
  );
}
