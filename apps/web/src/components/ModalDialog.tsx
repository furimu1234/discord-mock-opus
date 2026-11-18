import { ComponentType, TextInputStyle } from '@dismock/server/constants';
import { useState, type FormEvent } from 'react';
import { api, type Json } from '../api';

interface ModalDialogProps {
  modal: Json;
  channelId: string;
  userId?: string;
  /**
   * テストの操作で開いたモーダル。読み取り専用で表示し、`values` はテストが送信した値。
   * 送信はテストが行うので、画面からは送信しない。
   */
  watched?: { values?: Record<string, string> };
  onClose: () => void;
  onResult: (result: Json) => void;
  onError: (message: string) => void;
}

/** 複数行の入力欄の高さ（行数）。 */
const PARAGRAPH_ROWS = 5;

/** Bot が開いたモーダルの入力欄。入力欄は行（古い形式）またはラベルの中にある。 */
function textInputs(modal: Json): Json[] {
  return (modal.components ?? [])
    .flatMap((row: Json) =>
      row.type === ComponentType.label
        ? [{ ...row.component, label: row.label, description: row.description }]
        : (row.components ?? []))
    .filter((component: Json) => component.type === ComponentType.textInput);
}

/** Bot が `value` で指定した初期値。 */
const initialValues = (modal: Json): Record<string, string> =>
  Object.fromEntries(textInputs(modal).flatMap((input) => (input.value === undefined ? [] : [[input.custom_id, input.value]])));

export function ModalDialog({ modal, channelId, userId, watched, onClose, onResult, onError }: ModalDialogProps) {
  const [fields, setFields] = useState<Record<string, string>>(() => initialValues(modal));
  const values = watched ? (watched.values ?? initialValues(modal)) : fields;
  const submit = (event: FormEvent) => {
    event.preventDefault();
    api
      .post('/interact', { kind: 'modal', userId, channelId, customId: modal.custom_id, fields })
      .then(onResult, (error: Error) => onError(error.message));
    onClose();
  };
  return (
    <div className="overlay" onClick={onClose}>
      <form className="dialog" role="dialog" aria-label={modal.title} onClick={(event) => event.stopPropagation()} onSubmit={submit}>
        <h2>{modal.title}</h2>
        {textInputs(modal).map((input) => {
          const props = {
            value: values[input.custom_id] ?? '',
            placeholder: input.placeholder,
            readOnly: Boolean(watched),
            // Discord と同じく、`required` を省略した入力欄は必須。
            required: input.required !== false,
            minLength: input.min_length,
            maxLength: input.max_length,
            onChange: (event: { target: { value: string } }) => setFields({ ...fields, [input.custom_id]: event.target.value }),
          };
          return (
            <label key={input.custom_id} className="field">
              <span>{input.label}{props.required && !watched && <span className="field-required"> *</span>}</span>
              {input.description && <small className="field-description">{input.description}</small>}
              {input.style === TextInputStyle.paragraph ? <textarea rows={PARAGRAPH_ROWS} {...props} /> : <input {...props} />}
            </label>
          );
        })}
        {watched ? (
          <div className="dialog-actions">
            <span className="dialog-note">{watched.values ? 'テストが送信しました' : 'テストの入力を待っています'}</span>
            <button type="button" className="button secondary" onClick={onClose}>閉じる</button>
          </div>
        ) : (
          <div className="dialog-actions">
            <button type="button" className="button secondary" onClick={onClose}>キャンセル</button>
            <button type="submit" className="button primary">送信</button>
          </div>
        )}
      </form>
    </div>
  );
}
