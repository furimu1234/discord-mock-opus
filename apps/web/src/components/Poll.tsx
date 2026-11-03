import { useEffect, useState, type FormEvent } from 'react';
import { api, type Json } from '../api';
import { Select } from './Select';
import { durationLabel } from './SettingsParts';

/** Discord の公開ドキュメントの上限。 */
const MAX_QUESTION_LENGTH = 300;
const MAX_ANSWER_LENGTH = 55;
const MAX_ANSWERS = 10;
const MIN_ANSWERS = 2;
const DURATION_HOURS = [1, 4, 8, 24, 72, 168, 336];
const HOUR_MS = 3600 * 1000;

/** 投票を作る。送信は呼び出し元が、ほかのメッセージと同じ API で行う。 */
export function PollDialog({ onSubmit, onClose }: { onSubmit: (poll: Json) => void; onClose: () => void }) {
  const [question, setQuestion] = useState('');
  const [answers, setAnswers] = useState<string[]>(['', '']);
  const [duration, setDuration] = useState(24);
  const [multiselect, setMultiselect] = useState(false);
  const filled = answers.map((answer) => answer.trim()).filter(Boolean);
  const ready = question.trim() && filled.length >= MIN_ANSWERS;
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!ready) return;
    onSubmit({
      question: { text: question.trim() },
      answers: filled.map((text) => ({ poll_media: { text } })),
      duration,
      allow_multiselect: multiselect,
    });
    onClose();
  };

  return (
    <div className="overlay" onClick={onClose}>
      <form className="dialog" role="dialog" aria-label="投票を作成" onSubmit={submit} onClick={(event) => event.stopPropagation()}>
        <h2>投票を作成</h2>
        <div className="dialog-body">
          <label className="field">
            <span>質問</span>
            <input autoFocus value={question} maxLength={MAX_QUESTION_LENGTH} placeholder="何を聞きますか？" onChange={(event) => setQuestion(event.target.value)} />
          </label>
          <div className="field">
            <span>選択肢</span>
            {answers.map((answer, index) => (
              <div key={index} className="poll-answer-input">
                <input value={answer} maxLength={MAX_ANSWER_LENGTH} placeholder={`選択肢 ${index + 1}`} aria-label={`選択肢 ${index + 1}`}
                  onChange={(event) => setAnswers(answers.map((current, i) => (i === index ? event.target.value : current)))} />
                {answers.length > MIN_ANSWERS && (
                  <button type="button" aria-label={`選択肢 ${index + 1} を削除`} onClick={() => setAnswers(answers.filter((_, i) => i !== index))}>×</button>
                )}
              </div>
            ))}
            {answers.length < MAX_ANSWERS && (
              <button type="button" className="link" onClick={() => setAnswers([...answers, ''])}>+ 選択肢を追加</button>
            )}
          </div>
          <div className="field">
            <span>期間</span>
            <Select label="期間" value={String(duration)} onChange={(value) => setDuration(Number(value))}
              options={DURATION_HOURS.map((hours) => ({ value: String(hours), label: durationLabel((hours * HOUR_MS) / 1000) }))} />
          </div>
          <label className="check-label">
            <input type="checkbox" checked={multiselect} onChange={(event) => setMultiselect(event.target.checked)} />
            複数回答を許可
          </label>
        </div>
        <div className="dialog-actions">
          <button type="button" className="button secondary" onClick={onClose}>キャンセル</button>
          <button className="button primary" disabled={!ready}>投稿</button>
        </div>
      </form>
    </div>
  );
}

const remaining = (expiry: string) => {
  const hours = Math.max(0, Math.ceil((Date.parse(expiry) - Date.now()) / HOUR_MS));
  return hours >= 24 ? `残り ${Math.ceil(hours / 24)} 日` : `残り ${hours} 時間`;
};

/** メッセージの投票。集計はログイン中のユーザーの投票を含めて、Mock の状態から求める。 */
export function PollView({ message, state, userId, onError }: { message: Json; state: Json; userId?: string; onError: (message: string) => void }) {
  const poll = message.poll as Json;
  const votes = (state.pollVotes?.[message.id] ?? {}) as Record<string, string[]>;
  const counts = (poll.answers as Json[]).map((answer) => votes[answer.answer_id]?.length ?? 0);
  const total = new Set(Object.values(votes).flat()).size;
  const mine = (poll.answers as Json[]).filter((answer) => userId && votes[answer.answer_id]?.includes(userId)).map((answer) => answer.answer_id as number);
  const ended = poll.results.is_finalized || Date.parse(poll.expiry) <= Date.now();
  const fail = (error: Error) => onError(error.message);
  const vote = (answerIds: number[]) => {
    api.put(`/channels/${message.channel_id}/polls/${message.id}/votes`, { userId, answerIds }).catch(fail);
  };
  const choose = (answerId: number) => {
    if (ended || !userId) return;
    if (!poll.allow_multiselect) return vote(mine.includes(answerId) ? [] : [answerId]);
    vote(mine.includes(answerId) ? mine.filter((id) => id !== answerId) : [...mine, answerId]);
  };
  return (
    <div className="poll">
      <strong className="poll-question">{poll.question.text}</strong>
      <small>{poll.allow_multiselect ? '複数の回答を選択' : '回答を 1 つ選択'}</small>
      <div className="poll-answers" role={poll.allow_multiselect ? 'group' : 'radiogroup'}>
        {(poll.answers as Json[]).map((answer, index) => {
          const share = total ? Math.round((counts[index]! / total) * 100) : 0;
          return (
            <button key={answer.answer_id} className={mine.includes(answer.answer_id) ? 'poll-answer chosen' : 'poll-answer'} disabled={ended || !userId}
              role={poll.allow_multiselect ? 'checkbox' : 'radio'} aria-checked={mine.includes(answer.answer_id)} onClick={() => choose(answer.answer_id)}>
              <span className="poll-bar" style={{ width: `${share}%` }} />
              <span className="poll-text">{answer.poll_media.text}</span>
              <span className="poll-count">{counts[index]}票 {share}%</span>
            </button>
          );
        })}
      </div>
      <small>
        {total}票・{ended ? '投票は終了しました' : remaining(poll.expiry)}
        {!ended && mine.length > 0 && <button className="link" onClick={() => vote([])}>投票を取り消す</button>}
        {!ended && message.author.id === userId && (
          <button className="link" onClick={() => void api.post(`/channels/${message.channel_id}/polls/${message.id}/expire`).catch(fail)}>投票を終了</button>
        )}
      </small>
    </div>
  );
}
