import { MAX_ATTACHMENT_BYTES, MAX_ATTACHMENTS } from '@dismock/server/constants';
import { useEffect, useMemo, useState, type ClipboardEvent } from 'react';
import type { Json } from '../api';
import { readImageFile } from './SettingsParts';

const megabytes = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(1)}MB`;

/** Mock の画面の API は JSON だけを受け付けるので、ファイルは base64 で送る。 */
export async function encodeFiles(files: File[]): Promise<Json[]> {
  return Promise.all(files.map(async (file) => {
    const dataUrl = await readImageFile(file);
    return { filename: file.name, contentType: file.type, data: dataUrl.slice(dataUrl.indexOf(',') + 1) };
  }));
}

/** 添付するファイルの選択。上限を超えるファイルは知らせて加えない。 */
export function useUploads(onError: (message: string) => void) {
  const [files, setFiles] = useState<File[]>([]);
  const add = (added: File[]) => {
    const tooLarge = added.find((file) => file.size > MAX_ATTACHMENT_BYTES);
    if (tooLarge) return onError(`${tooLarge.name} は ${megabytes(MAX_ATTACHMENT_BYTES)} を超えています`);
    setFiles((current) => [...current, ...added].slice(0, MAX_ATTACHMENTS));
  };
  const onPaste = (event: ClipboardEvent) => {
    const pasted = [...event.clipboardData.files];
    if (pasted.length === 0) return;
    event.preventDefault();
    add(pasted);
  };
  return {
    files,
    add,
    onPaste,
    remove: (index: number) => setFiles((current) => current.filter((_, i) => i !== index)),
    clear: () => setFiles([]),
  };
}

/** 選んだ画像のプレビュー。外したときに URL を解放する。 */
function UploadPreview({ file }: { file: File }) {
  const url = useMemo(() => URL.createObjectURL(file), [file]);
  useEffect(() => () => URL.revokeObjectURL(url), [url]);
  return <img src={url} alt="" />;
}

export function UploadList({ files, onRemove }: { files: File[]; onRemove: (index: number) => void }) {
  if (files.length === 0) return null;
  return (
    <ul className="upload-list" aria-label="添付するファイル">
      {files.map((file, index) => (
        <li key={`${file.name}-${index}`}>
          {file.type.startsWith('image/') ? <UploadPreview file={file} /> : <span className="upload-file">📄</span>}
          <small>{file.name}</small>
          <button type="button" aria-label={`${file.name} を外す`} title="外す" onClick={() => onRemove(index)}>×</button>
        </li>
      ))}
    </ul>
  );
}
