import { useEffect } from 'react';

/** 削除などの取り消せない操作の確認。 */
export function ConfirmDialog({ title, message, confirmLabel, onConfirm, onClose }: {
  title: string;
  message: string;
  confirmLabel: string;
  onConfirm: () => void;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  return (
    <div className="overlay" onClick={onClose}>
      <div className="dialog" role="alertdialog" aria-label={title} onClick={(event) => event.stopPropagation()}>
        <h2>{title}</h2>
        <p className="dialog-message">{message}</p>
        <div className="dialog-actions">
          <button className="button secondary" autoFocus onClick={onClose}>キャンセル</button>
          <button className="button danger" onClick={() => {
            onConfirm();
            onClose();
          }}>{confirmLabel}</button>
        </div>
      </div>
    </div>
  );
}
