import { isThreadType } from '@dismock/server/constants';
import { useState, type FormEvent } from 'react';
import { api, type Json } from '../api';
import { ChannelIcon } from './Icons';
import { encodeFiles, UploadList, useUploads } from './Uploads';

/** フォーラムとメディアのチャンネル。投稿の一覧と、投稿の作成を表示する。 */
export function ForumView({ channel, state, activeUser, onOpen, onError }: {
  channel: Json;
  state: Json;
  activeUser?: Json;
  onOpen: (threadId: string) => void;
  onError: (message: string) => void;
}) {
  const [name, setName] = useState('');
  const [content, setContent] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const uploads = useUploads(onError);
  const available = channel.available_tags as Json[];
  const posts = Object.values<Json>(state.channels)
    .filter((candidate) => candidate.parent_id === channel.id && isThreadType(candidate.type))
    .sort((a, b) => b.thread_metadata.create_timestamp.localeCompare(a.thread_metadata.create_timestamp));

  // 投稿の最初のメッセージの、最初の画像をサムネイルにする。
  const thumbnail = (post: Json) => ((state.messages[post.id]?.[0]?.attachments ?? []) as Json[])
    .find((file) => String(file.content_type).startsWith('image/'))?.url as string | undefined;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!name.trim() || (!content.trim() && uploads.files.length === 0) || !activeUser) return;
    encodeFiles(uploads.files)
      .then((files) => api.post(`/channels/${channel.id}/threads`, { userId: activeUser.id, name: name.trim(), message: { content: content.trim(), files }, applied_tags: tags }))
      .then((post: Json) => {
        setName('');
        setContent('');
        setTags([]);
        uploads.clear();
        onOpen(post.id);
      }, (error: Error) => onError(error.message));
  };
  const toggleTag = (id: string, enabled: boolean) => setTags(enabled ? [...tags, id] : tags.filter((tag) => tag !== id));

  return (
    <section className="chat forum">
      <header className="chat-header">
        <span className="chat-header-icon"><ChannelIcon type={channel.type} /></span>
        <h1>{channel.name}</h1>
      </header>
      <div className="forum-body">
        {channel.topic && <p className="forum-topic">{channel.topic}</p>}
        <form className="forum-form" onSubmit={submit}>
          <input value={name} placeholder="投稿のタイトル" aria-label="投稿のタイトル" onChange={(event) => setName(event.target.value)} />
          <textarea value={content} placeholder="最初のメッセージ" aria-label="最初のメッセージ" rows={3} onPaste={uploads.onPaste}
            onChange={(event) => setContent(event.target.value)} />
          <UploadList files={uploads.files} onRemove={uploads.remove} />
          <label className="button secondary file-button forum-attach">
            画像やファイルを添付
            <input type="file" multiple onChange={(event) => {
              uploads.add([...(event.target.files ?? [])]);
              event.target.value = '';
            }} />
          </label>
          {available.length > 0 && (
            <div className="role-checks">
              {available.map((tag) => (
                <label key={tag.id} className="check-label">
                  <input type="checkbox" checked={tags.includes(tag.id)} onChange={(event) => toggleTag(tag.id, event.target.checked)} />
                  {tag.name}
                </label>
              ))}
            </div>
          )}
          <button className="button primary" disabled={!activeUser || !name.trim() || (!content.trim() && uploads.files.length === 0)}>投稿</button>
        </form>
        {posts.length === 0 && <p className="forum-empty">投稿はまだありません。</p>}
        <ul className="forum-posts">
          {posts.map((post) => (
            <li key={post.id}>
              <button className="forum-post" onClick={() => onOpen(post.id)}>
                {thumbnail(post) && <img className="forum-thumbnail" src={thumbnail(post)} alt="" />}
                <strong>{post.name}</strong>
                <small>
                  {post.message_count} 件の返信
                  {post.thread_metadata.archived && ' ・アーカイブ済み'}
                  {post.thread_metadata.locked && ' ・ロック済み'}
                </small>
                {(post.applied_tags as string[]).length > 0 && (
                  <span className="forum-tags">
                    {(post.applied_tags as string[]).map((id) => (
                      <span key={id} className="forum-tag">{available.find((tag) => tag.id === id)?.name}</span>
                    ))}
                  </span>
                )}
              </button>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
