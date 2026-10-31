import type { InteractRequest, InteractResult, Json, SeedInput } from '@dismock/server';
import type { Connection } from './connection.js';

/** Mock サーバーの `/api/mock` を呼び出すクライアント。 */
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
  reset = () => this.post('/reset');
  seed = (input: SeedInput) => this.post<Json>('/seed', input);
  switchUser = (userId: string) => this.post('/switch-user', { userId });
  interact = (request: InteractRequest) => this.post<InteractResult>('/interact', request);
  registerCommands = (commands: Json[]) => this.post('/commands', commands);
  sendMessage = (userId: string, channelId: string, content: string) =>
    this.post<Json>('/messages', { userId, channelId, content });
  react = (userId: string, channelId: string, messageId: string, emoji: string) =>
    this.post('/reactions', { userId, channelId, messageId, emoji });
  setVoice = (userId: string, guildId: string, channelId: string | null) =>
    this.post<Json>('/voice', { userId, guildId, channelId });

  messages(channelId?: string): Promise<Json[]> {
    const query = channelId ? `?channelId=${channelId}` : '';
    return this.request<Json[]>(`/messages${query}`);
  }

  dms(userId: string): Promise<Json[]> {
    return this.request<Json[]>(`/dms?userId=${userId}`);
  }
}
