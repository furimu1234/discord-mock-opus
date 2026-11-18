import type { InteractRequest, InteractResult, Json, SeedInput, TrafficFeed, VoiceStatus } from '@dismock/server';
import type { APIMessage } from 'discord.js';
import type { MockMessage } from './actor.js';
import type { Connection } from './connection.js';
import { watchModalMs } from './watch-modal.js';

/** @internal */
export interface MockInteractResult extends Omit<InteractResult, 'message' | 'source'> {
  message?: MockMessage;
  source?: MockMessage;
}

/** Mock サーバーの `/api/mock` を呼び出すクライアント。 */
/** @internal */
export class MockApi {
  constructor(private readonly target: Connection) {}

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const { url, token } = this.target;
    const response = await fetch(`${url}/api/mock${path}`, {
      ...init,
      headers: { ...init.headers, authorization: `Bot ${token}` },
    });
    const data = (await response.json()) as T & { message?: string };
    if (!response.ok) throw new Error(`dismock: ${data.message ?? response.statusText}`);
    return data;
  }

  private post<T>(path: string, body: unknown = {}): Promise<T> {
    return this.request<T>(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  }

  state = () => this.request<Json>('/state');
  /** `after` を省略すると、今の位置（`cursor`）だけを返す。 */
  traffic = (after?: number) =>
    this.request<TrafficFeed>(`/traffic${after === undefined ? '' : `?after=${after}`}`);
  reset = () => this.post('/reset');
  seed = (input: SeedInput) => this.post<Json>('/seed', input);
  switchUser = (userId: string) => this.post('/switch-user', { userId });
  interact = async (request: InteractRequest): Promise<MockInteractResult> => {
    const { message, source, ...result } = await this.post<InteractResult>('/interact', { ...request, watchModalMs: watchModalMs() });
    return {
      ...result,
      ...(message ? { message: this.withFetch(message as APIMessage) } : {}),
      ...(source ? { source: this.withFetch(source as APIMessage) } : {}),
    };
  };
  registerCommands = (commands: Json[]) => this.post('/commands', commands);
  sendMessage = async (userId: string, channelId: string, content: string) =>
    this.withFetch(await this.post<APIMessage>('/messages', { userId, channelId, content }));
  react = (userId: string, channelId: string, messageId: string, emoji: string) =>
    this.post('/reactions', { userId, channelId, messageId, emoji });
  setVoice = (userId: string, guildId: string, channelId: string | null) =>
    this.post<Json>('/voice', { userId, guildId, channelId });

  voiceStatus = (guildId: string) => this.request<VoiceStatus | null>(`/voice?guildId=${guildId}`);

  async messages(channelId?: string): Promise<MockMessage[]> {
    const query = channelId ? `?channelId=${channelId}` : '';
    return (await this.request<APIMessage[]>(`/messages${query}`)).map(this.withFetch);
  }

  /** `fetch` は列挙されないので、`toEqual` などの比較には影響しない。 */
  private withFetch = (message: APIMessage): MockMessage =>
    Object.defineProperty(message, 'fetch', { value: () => this.latest(message) }) as MockMessage;

  private async latest({ id, channel_id }: APIMessage): Promise<MockMessage> {
    const found = (await this.messages(channel_id)).find((message) => message.id === id);
    if (!found) throw new Error(`dismock: メッセージ ${id} が見つかりません`);
    return found;
  }

  mark = (channelId: string, label: string) => this.post('/tests/mark', { channelId, label });
  join = (guildId: string, userId: string) =>
    this.request<Json>(`/guilds/${guildId}/members/${userId}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ roles: [] }),
    });

  async dms(userId: string): Promise<MockMessage[]> {
    return (await this.request<APIMessage[]>(`/dms?userId=${userId}`)).map(this.withFetch);
  }

  vote = (userId: string, channelId: string, messageId: string, answerIds: number[]) =>
    this.request<Json>(`/channels/${channelId}/polls/${messageId}/votes`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ userId, answerIds }),
    });

  acceptInvite = (userId: string, code: string) => this.post<Json>(`/invites/${code}/accept`, { userId });

  async groupDms(userId: string): Promise<Json[]> {
    return this.request<Json[]>(`/dms/groups?userId=${userId}`);
  }
}
