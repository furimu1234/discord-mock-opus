import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { DEFAULT_HOST } from './constants.js';
import { Gateway } from './gateway.js';
import { ApplicationActions } from './application-actions.js';
import { Attachments } from './attachments.js';
import { ChannelActions } from './channel-actions.js';
import { CommandActions } from './command-actions.js';
import { Expressions } from './expressions.js';
import { GuildActions } from './guild-actions.js';
import { Integrations } from './integrations.js';
import { InviteTargets } from './invite-targets.js';
import { Lobbies } from './lobbies.js';
import { MessageActions } from './message-actions.js';
import { Monetization } from './monetization.js';
import { Moderation } from './moderation.js';
import { Polls } from './polls.js';
import { Presences } from './presences.js';
import { Interactions } from './interactions.js';
import { ProjectLauncher } from './projects.js';
import { Rest } from './rest.js';
import { ScheduledEvents } from './scheduled-events.js';
import { Soundboard } from './soundboard.js';
import { Templates } from './templates.js';
import { TestRegistry } from './tests.js';
import { Store } from './store.js';
import type { WebFiles } from './static.js';
import { VoiceServer } from './voice.js';
import { WebhookFormats } from './webhook-formats.js';

export { ChannelType, DEFAULT_HOST, DEFAULT_PORT, DEFAULT_USERS } from './constants.js';
export { Store } from './store.js';
export { webDirectory, type WebFiles } from './static.js';
export type { Json, SeedChannel, SeedGuild, SeedInput, SeedRole, SeedUser } from './store.js';
export type { InteractRequest, InteractResult } from './interactions.js';
export type { CoverageReport, TestCaseInfo, TestProject, TestResult, TrafficEntry, TrafficFeed } from './tests.js';
export type { VoiceStatus } from './voice.js';

export interface MockServerOptions {
  /** 既定は `DEFAULT_HOST`。 */
  host?: string;
  /** 既定は `0`（空いているポートを自動で割り当てる）。 */
  port?: number;
  /** 状態を保存する JSON ファイル。省略するとメモリ上にのみ保持する。 */
  dataFile?: string;
  /** 開発者が指定する Mock のトークン。省略すると保存済みの値を使い、なければ発行する。 */
  token?: string;
  /** Web UI のビルド結果。`webDirectory` でディレクトリから作る。 */
  webFiles?: WebFiles;
  /** トークン以外のデータを消してから起動する。 */
  clearOnStart?: boolean;
  /** ダミーデータが空のとき、初期データを投入する。 */
  seedDefaults?: boolean;
  /** 添付ファイルを保存するディレクトリ。省略するとメモリーに保持する。 */
  mediaDir?: string;
}

export interface MockServer {
  url: string;
  store: Store;
  close(): Promise<void>;
}

export async function startServer(options: MockServerOptions = {}): Promise<MockServer> {
  const host = options.host ?? DEFAULT_HOST;
  const store = new Store(options.dataFile, options.token);
  let url = '';

  const gatewayUrl = () => `${url.replace(/^http/, 'ws')}/gateway`;
  const voice = new VoiceServer(store, () => `${url.replace(/^http:\/\//, '')}/voice`);
  const channelActions = new ChannelActions(store);
  const soundboard = new Soundboard(store);
  const presences = new Presences(store);
  const gateway = new Gateway(store, gatewayUrl, voice, {
    soundboardSounds: (guildId) => soundboard.soundsPayload(guildId),
    channelInfo: (guildId) => channelActions.channelInfo(guildId),
    updatePresence: (userId, presence) => presences.updatePresence(userId, presence),
  });
  const interactions = new Interactions(store, (event, data) => store.emit('dispatch', event, data), () => gateway.hasBot);
  const tests = new TestRegistry(store);
  const projects = new ProjectLauncher(store, tests, host, () => url);
  const moderation = new Moderation(store);
  const integrations = new Integrations(store, (guildId, userId) => moderation.isBanned(guildId, userId));
  const expressions = new Expressions(store);
  const attachments = new Attachments(options.mediaDir, () => store.state.token, () => url);
  store.attachments = attachments;
  const polls = new Polls(store);
  const modules = [
    new MessageActions(store),
    channelActions,
    new GuildActions(store),
    new ApplicationActions(store),
    new CommandActions(store),
    new ScheduledEvents(store),
    soundboard,
    new Templates(store),
    new Monetization(store),
    new Lobbies(store),
    new InviteTargets(store, integrations),
    new WebhookFormats(integrations),
    presences,
    gateway,
  ];
  const rest = new Rest(store, interactions, integrations, moderation, expressions, attachments, polls, tests, projects, voice, gatewayUrl, () => gateway.hasBot, modules, options.webFiles);
  if (options.clearOnStart) store.clearAll();
  if (options.seedDefaults) store.seedDefaults();

  const server: Server = createServer((req, res) => void rest.handle(req, res));
  gateway.attach(server);
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(options.port ?? 0, host, resolve);
  });
  await voice.listen(host);
  const { port } = server.address() as AddressInfo;
  url = `http://${host}:${port}`;
  store.published(url);

  return {
    url,
    store,
    close: async () => {
      projects.close();
      polls.close();
      store.flush();
      gateway.close();
      voice.close();
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    },
  };
}
