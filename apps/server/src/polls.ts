import type { Json, Store } from './store.js';

/** Discord の公開ドキュメントの値。 */
const MAX_QUESTION_LENGTH = 300;
const MAX_ANSWER_LENGTH = 55;
const MAX_ANSWERS = 10;
const DEFAULT_DURATION_HOURS = 24;
const MAX_DURATION_HOURS = 768;
const HOUR_MS = 3600 * 1000;
const DEFAULT_VOTERS_LIMIT = 25;
const MAX_VOTERS_LIMIT = 100;
const POLL_RESULT_MESSAGE = 46;
const ErrorCode = { invalidForm: 50035, votingBlocked: 520000, expired: 520001, notPoll: 520006 };
/** 期限の切れた投票を終了する間隔。 */
const SWEEP_MS = 60 * 1000;

const fail = (message: string, code: number, status = 400) => Object.assign(new Error(message), { status, code });

/** メッセージの作成時に、送られた `poll` から投票を作る。 */
export function createPoll(input: Json): Json {
  const question = String(input.question?.text ?? '');
  const answers = (input.answers ?? []) as Json[];
  const duration = Number(input.duration ?? DEFAULT_DURATION_HOURS);
  if (!question || question.length > MAX_QUESTION_LENGTH) throw fail(`質問は 1〜${MAX_QUESTION_LENGTH} 文字で指定してください`, ErrorCode.invalidForm);
  if (answers.length === 0 || answers.length > MAX_ANSWERS) throw fail(`選択肢は 1〜${MAX_ANSWERS} 個で指定してください`, ErrorCode.invalidForm);
  if (answers.some((answer) => !answer.poll_media?.text || answer.poll_media.text.length > MAX_ANSWER_LENGTH)) {
    throw fail(`選択肢は 1〜${MAX_ANSWER_LENGTH} 文字で指定してください`, ErrorCode.invalidForm);
  }
  if (!Number.isInteger(duration) || duration < 1 || duration > MAX_DURATION_HOURS) throw fail(`期間は 1〜${MAX_DURATION_HOURS} 時間で指定してください`, ErrorCode.invalidForm);
  return {
    question: { text: question },
    answers: answers.map((answer, index) => ({
      answer_id: index + 1,
      poll_media: { text: answer.poll_media.text, ...(answer.poll_media.emoji ? { emoji: answer.poll_media.emoji } : {}) },
    })),
    expiry: new Date(Date.now() + duration * HOUR_MS).toISOString(),
    allow_multiselect: Boolean(input.allow_multiselect),
    layout_type: input.layout_type ?? 1,
    results: { is_finalized: false, answer_counts: [] },
  };
}

/** 投票と集計。投票した人は `pollVotes` に、メッセージの ID ごとに選択肢の ID と投票者の ID で持つ。 */
export class Polls {
  private readonly timer: NodeJS.Timeout;

  constructor(private readonly store: Store) {
    this.timer = setInterval(() => this.sweep(), SWEEP_MS);
    this.timer.unref();
  }

  close(): void {
    clearInterval(this.timer);
  }

  private dispatch(event: string, data: Json): void {
    this.store.emit('dispatch', event, data);
  }

  private requirePoll(channelId: string, messageId: string): Json {
    const message = this.store.findMessage(channelId, messageId);
    if (!message.poll) throw fail('投票のメッセージではありません', ErrorCode.notPoll);
    return message;
  }

  private votes(messageId: string): Record<string, string[]> {
    return (this.store.state.pollVotes[messageId] ??= {});
  }

  /** 集計をメッセージに反映する。`me_voted` は Bot から見た値。 */
  private tally(message: Json): void {
    const votes = this.votes(message.id);
    message.poll.results.answer_counts = (message.poll.answers as Json[])
      .map((answer) => ({ id: answer.answer_id, count: votes[answer.answer_id]?.length ?? 0, me_voted: votes[answer.answer_id]?.includes(this.store.state.botUserId) ?? false }))
      .filter((count) => count.count > 0);
  }

  private closed(message: Json): boolean {
    return message.poll.results.is_finalized || Date.parse(message.poll.expiry) <= Date.now();
  }

  /**
   * ユーザーの投票を `answerIds` に置き換える。空にすると取り消す。
   * 1 つだけ選べる投票では、最初の選択肢だけを使う。
   */
  vote(channelId: string, messageId: string, userId: string, answerIds: number[]): Json {
    const message = this.requirePoll(channelId, messageId);
    if (this.closed(message)) throw fail('投票は終了しています', ErrorCode.expired);
    const valid = new Set((message.poll.answers as Json[]).map((answer) => answer.answer_id as number));
    const chosen = [...new Set(answerIds)].filter((id) => valid.has(id)).slice(0, message.poll.allow_multiselect ? undefined : 1);
    if (chosen.length !== new Set(answerIds).size && answerIds.length > 0 && message.poll.allow_multiselect) throw fail('存在しない選択肢です', ErrorCode.votingBlocked);
    const votes = this.votes(messageId);
    const event = (id: number) => ({ user_id: userId, channel_id: channelId, message_id: messageId, ...(message.guild_id ? { guild_id: message.guild_id } : {}), answer_id: id });
    for (const id of valid) {
      const voters = (votes[id] ??= []);
      const had = voters.includes(userId);
      const wants = chosen.includes(id);
      if (had && !wants) {
        votes[id] = voters.filter((voter) => voter !== userId);
        this.dispatch('MESSAGE_POLL_VOTE_REMOVE', event(id));
      }
      if (!had && wants) {
        voters.push(userId);
        this.dispatch('MESSAGE_POLL_VOTE_ADD', event(id));
      }
    }
    this.tally(message);
    this.store.changed();
    return message;
  }

  /** 選択肢に投票したユーザー。`after` より大きい ID のユーザーを返す。 */
  voters(channelId: string, messageId: string, answerId: number, query: URLSearchParams): Json {
    const message = this.requirePoll(channelId, messageId);
    const after = query.get('after');
    const limit = Math.min(Number(query.get('limit') ?? DEFAULT_VOTERS_LIMIT), MAX_VOTERS_LIMIT);
    const ids = (this.votes(message.id)[answerId] ?? []).filter((id) => !after || BigInt(id) > BigInt(after)).slice(0, limit);
    return { users: ids.map((id) => this.store.state.users[id]).filter(Boolean) };
  }

  /** 投票を終了し、結果のメッセージを送る。 */
  expire(channelId: string, messageId: string): Json {
    const message = this.requirePoll(channelId, messageId);
    if (message.poll.results.is_finalized) throw fail('投票は終了しています', ErrorCode.expired);
    this.tally(message);
    message.poll.results.is_finalized = true;
    message.poll.expiry = new Date().toISOString();
    this.store.changed();
    this.dispatch('MESSAGE_UPDATE', message);
    const counts = message.poll.results.answer_counts as Json[];
    const total = counts.reduce((sum, count) => sum + count.count, 0);
    const victor = [...counts].sort((a, b) => b.count - a.count)[0];
    const tied = victor && counts.filter((count) => count.count === victor.count).length > 1;
    const victorAnswer = !tied && victor ? (message.poll.answers as Json[]).find((answer) => answer.answer_id === victor.id) : undefined;
    this.store.createMessage(channelId, message.author, {
      embeds: [{
        type: 'poll_result',
        fields: [
          { name: 'poll_question_text', value: message.poll.question.text },
          { name: 'total_votes', value: String(total) },
          ...(victorAnswer
            ? [
                { name: 'victor_answer_id', value: String(victorAnswer.answer_id) },
                { name: 'victor_answer_text', value: victorAnswer.poll_media.text },
                { name: 'victor_answer_votes', value: String(victor!.count) },
              ]
            : []),
        ],
      }],
    }, { type: POLL_RESULT_MESSAGE, message_reference: { message_id: messageId, channel_id: channelId, ...(message.guild_id ? { guild_id: message.guild_id } : {}) } });
    return message;
  }

  /** 期限の切れた投票を終了する。 */
  private sweep(): void {
    for (const [channelId, messages] of Object.entries(this.store.state.messages)) {
      for (const message of messages) {
        if (message.poll && !message.poll.results.is_finalized && Date.parse(message.poll.expiry) <= Date.now()) this.expire(channelId, message.id);
      }
    }
  }
}
