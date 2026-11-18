import { INVITE_URL } from '@dismock/server/constants';
import { useEffect, useState } from 'react';
import { api, type Json } from '../api';
import { displayName } from './Avatar';
import { copyText } from './Menus';

const SHAKE_MS = 400;

export function durationLabel(seconds: number): string {
  if (seconds === 0) return 'オフ';
  if (seconds < 60) return `${seconds}秒`;
  if (seconds < 3600) return `${seconds / 60}分`;
  if (seconds < 86400) return `${seconds / 3600}時間`;
  return seconds % 604800 === 0 ? `${seconds / 604800}週間` : `${seconds / 86400}日`;
}

/** 画像のファイルを data URI で読み込む。Mock は画像を data URI で受け取る。 */
export function readImageFile(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error ?? new Error('ファイルを読み込めません'));
    reader.readAsDataURL(file);
  });
}

export function ToggleRow({ label, description, checked, onChange }: { label: string; description: string; checked: boolean; onChange: (checked: boolean) => void }) {
  return (
    <label className="permission-row">
      <div>
        <strong>{label}</strong>
        <p>{description}</p>
      </div>
      <input type="checkbox" className="switch" checked={checked} aria-label={label} onChange={(event) => onChange(event.target.checked)} />
    </label>
  );
}

/** 変更が保存されていないことを知らせるバー。`shaking` は閉じようとしたときに揺らす。 */
export function UnsavedBar({ shaking, disabled, onReset, onSave }: { shaking: boolean; disabled?: boolean; onReset: () => void; onSave: () => void }) {
  return (
    <div className={shaking ? 'unsaved-bar shaking' : 'unsaved-bar'} role="status">
      <span>注意 — 保存されていない変更があります！</span>
      <button className="link" onClick={onReset}>リセット</button>
      <button className="button success" disabled={disabled} onClick={onSave}>変更を保存</button>
    </div>
  );
}

/**
 * 保存していない変更があるときは閉じずに揺らす。Esc でも閉じる。
 * 確認のダイアログが開いているときの Esc は、ダイアログを閉じるのに使う。
 */
export function useGuardedClose(dirty: boolean, onClose: () => void): { shaking: boolean; close: () => void } {
  const [shaking, setShaking] = useState(false);
  const close = () => {
    if (!dirty) return onClose();
    setShaking(true);
    window.setTimeout(() => setShaking(false), SHAKE_MS);
  };
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !document.querySelector('.overlay')) close();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  });
  return { shaking, close };
}

/** 招待の一覧。サーバーの設定では、チャンネルの列も表示する。 */
export function InviteTable({ invites, state, showChannel, onError }: { invites: Json[]; state: Json; showChannel?: boolean; onError: (message: string) => void }) {
  const fail = (error: Error) => onError(error.message);
  const expiry = (invite: Json) =>
    invite.max_age === 0 ? '無期限' : new Date(Date.parse(invite.created_at) + invite.max_age * 1000).toLocaleString();
  if (invites.length === 0) return <p className="permission-empty">招待はありません。</p>;
  return (
    <table className="admin-table">
      <thead><tr><th>作成者</th>{showChannel && <th>チャンネル</th>}<th>コード</th><th>使用回数</th><th>有効期限</th><th /></tr></thead>
      <tbody>
        {invites.map((invite) => (
          <tr key={invite.code}>
            <td>{displayName(state.users[invite.inviter_id])}</td>
            {showChannel && <td>#{state.channels[invite.channel_id]?.name}</td>}
            <td><code>{invite.code}</code></td>
            <td>{invite.uses}{invite.max_uses > 0 && ` / ${invite.max_uses}`}</td>
            <td>{expiry(invite)}</td>
            <td>
              <div className="row-actions">
                <button className="link" onClick={() => void copyText(`${INVITE_URL}/${invite.code}`).catch(fail)}>コピー</button>
                <button className="link-danger" onClick={() => void api.delete(`/invites/${invite.code}`).catch(fail)}>削除</button>
              </div>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function WebhookRow({ webhook, onError }: { webhook: Json; onError: (message: string) => void }) {
  const [name, setName] = useState<string>(webhook.name);
  const fail = (error: Error) => onError(error.message);
  const url = `${location.origin}/api/v10/webhooks/${webhook.id}/${webhook.token}`;
  return (
    <li>
      <input value={name} aria-label="ウェブフックの名前" onChange={(event) => setName(event.target.value)}
        onBlur={() => { if (name.trim() && name !== webhook.name) api.patch(`/webhooks/${webhook.id}`, { name: name.trim() }).catch(fail); }} />
      <button className="link" onClick={() => void copyText(url).catch(fail)}>URL をコピー</button>
      <button className="link-danger" onClick={() => void api.delete(`/webhooks/${webhook.id}`).catch(fail)}>削除</button>
    </li>
  );
}
