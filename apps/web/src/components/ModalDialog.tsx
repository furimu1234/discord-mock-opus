import { useState } from 'react';
import { api, type Json } from '../api';

interface ModalDialogProps {
  modal: Json;
  channelId: string;
  userId?: string;
  onClose: () => void;
  onResult: (result: Json) => void;
  onError: (message: string) => void;
}

/** Bot が開いたモーダル。入力欄は行またはラベルの中にある。 */
function textInputs(modal: Json): Json[] {
  return (modal.components ?? [])
    .flatMap((row: Json) => row.components ?? (row.component ? [{ ...row.component, label: row.label }] : []))
    .filter((component: Json) => component.type === 4);
}

export function ModalDialog({ modal, channelId, userId, onClose, onResult, onError }: ModalDialogProps) {
  const [fields, setFields] = useState<Record<string, string>>({});
  const submit = () => {
    api
      .post('/interact', { kind: 'modal', userId, channelId, customId: modal.custom_id, fields })
      .then(onResult, (error: Error) => onError(error.message));
    onClose();
  };
  return (
    <div className="overlay" onClick={onClose}>
      <div className="dialog" role="dialog" aria-label={modal.title} onClick={(event) => event.stopPropagation()}>
        <h2>{modal.title}</h2>
        {textInputs(modal).map((input) => (
          <label key={input.custom_id} className="field">
            <span>{input.label}</span>
            <input value={fields[input.custom_id] ?? ''} placeholder={input.placeholder}
              onChange={(event) => setFields({ ...fields, [input.custom_id]: event.target.value })} />
          </label>
        ))}
        <div className="dialog-actions">
          <button className="button secondary" onClick={onClose}>キャンセル</button>
          <button className="button primary" onClick={submit}>送信</button>
        </div>
      </div>
    </div>
  );
}
