import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { Json, SeedChannel, SeedGuild, SeedInput, SeedRole, SeedUser } from '@dismock/server';
import { Actor } from './actor.js';
import { connection, StartupError, verifyConnection } from './connection.js';
import { db } from './db/index.js';
import type { SheetSeed } from './db/sheets.js';
import type { SeedData } from './db/types.js';
import { MockApi } from './mock-api.js';
import { runtime } from './runtime.js';

/** Bot が公開している Client の最小限の形。discord.js の Client を想定している。 */
export interface BotClient {
  login(token?: string): Promise<string>;
  isReady(): boolean;
  destroy(): Promise<void> | void;
  rest: { options: { api: string } };
  guilds: { cache: Map<string, unknown> };
  channels: { cache: Map<string, unknown> };
  users: { cache: Map<string, unknown> };
  user?: { id: string } | null;
}

export interface DbSeed {
  pg?: SeedData;
  mysql?: SeedData;
  sqlite?: SeedData;
  sheets?: SheetSeed;
}

export interface TestSeed extends SeedInput {
  db?: DbSeed;
}

export interface TestClientOptions {
  /** Mock の URL。省略すると `data/discord-mock-state.json` の値を使う。 */
  mockUrl?: string;
  /** Mock のトークン。省略すると `data/discord-mock-state.json` の値を使う。 */
  token?: string;
  /** Client を公開していない Bot のエントリーファイル。読み込むと Bot が起動する。 */
  entry?: string;
  /** 起動時に自動で登録しない Bot のためのコマンド定義。 */
  commands?: Json[];
  /** テーブルの作成など。最初のテストの前に 1 回だけ実行する。 */
  setupDb?: () => Promise<void> | void;
  /** すべてのテストの前に投入する初期データ。 */
  seed?: TestSeed;
}

export interface PrepareOptions {
  users?: 'login';
  seed?: TestSeed;
  /** チャンネルに表示するテストの区切りの名前。 */
  label?: string;
}

export interface Prepared {
  user?: Json;
  actor?: Actor;
  guild?: Json;
  channel?: Json;
  seeded: Json;
}

const READY_TIMEOUT_MS = 5000;
const TEXT_CHANNEL = 0;

function isOptions(value: unknown): value is TestClientOptions {
  return typeof (value as BotClient | undefined)?.login !== 'function';
}

export class TestClient {
  private bot?: BotClient;
  private api?: MockApi;
  private readonly options: TestClientOptions;
  private dbReady = false;
  private verified?: Promise<void>;
  private defaultChannelId?: string;
  private loggedInUserId?: string | null;

  readonly db = db;

  /** ダミーユーザーを追加する。 */
  readonly users = {
    create: async (input: SeedUser): Promise<Json> => (await this.seed({ users: [input] })).users[0],
  };

  readonly channels = {
    create: async (input: SeedChannel): Promise<Json> => (await this.seed({ channels: [input] })).channels[0],
  };

  readonly roles = {
    create: async (input: SeedRole): Promise<Json> => (await this.seed({ roles: [input] })).roles[0],
  };

  readonly guilds = {
    create: async (input: SeedGuild): Promise<Json> => (await this.seed({ guilds: [input] })).guilds[0],
  };

  constructor(client?: BotClient | TestClientOptions, options?: TestClientOptions) {
    this.bot = isOptions(client) ? undefined : client;
    this.options = isOptions(client) ? (client ?? {}) : (options ?? {});
    if (this.options.mockUrl) runtime.overrides.url = this.options.mockUrl;
    if (this.options.token) runtime.overrides.token = this.options.token;

    // Mock の操作を優先し、それ以外は本物の Client の持つプロパティを返す。
    const proxy = new Proxy(this, {
      get(target, key) {
        if (key in target) return Reflect.get(target, key, target);
        const value = target.bot?.[key as keyof BotClient] as unknown;
        return typeof value === 'function' ? value.bind(target.bot) : value;
      },
    });
    runtime.testClient = proxy;
    return proxy;
  }

  /** 本物の Client。`bot.users` などの名前が重なるものはこちらから使う。 */
  get client(): BotClient {
    if (!this.bot) throw new Error('dismock: Bot がまだ起動していません');
    return this.bot;
  }

  private async mock(): Promise<MockApi> {
    await this.connect();
    this.api ??= new MockApi(connection());
    return this.api;
  }

  /** Mock に接続でき、トークンが一致することを確認する。 */
  connect(): Promise<void> {
    this.verified ??= verifyConnection();
    return this.verified;
  }

  /** Bot を Mock の Gateway にログインさせ、準備が完了するまで待つ。 */
  async login(): Promise<void> {
    const api = await this.mock();
    if (this.options.commands) await api.registerCommands(this.options.commands);
    if (this.options.entry) await this.loadEntry();
    const bot = this.client;
    if (!bot.isReady() && !this.options.entry) {
      const { url, token } = connection();
      bot.rest.options.api = `${url}/api`;
      await bot.login(token);
    }
    await this.waitUntilReady(bot);
  }

  private async loadEntry(): Promise<void> {
    if (this.bot) return;
    await import(pathToFileURL(resolve(this.options.entry!)).href);
    this.bot = runtime.loginClients.at(-1) as BotClient | undefined;
    if (!this.bot) throw new Error(`dismock: ${this.options.entry} は client.login を呼び出していません`);
  }

  private async waitUntilReady(bot: BotClient): Promise<void> {
    const deadline = Date.now() + READY_TIMEOUT_MS;
    while (!bot.isReady()) {
      if (Date.now() > deadline) throw new Error(`dismock: Bot が ${READY_TIMEOUT_MS}ms 以内に準備完了になりませんでした`);
      await new Promise((done) => setTimeout(done, 5));
    }
  }

  /** ダミーデータと DB を初期データとして投入する。 */
  async seed(input: TestSeed): Promise<Json> {
    const { db: dbSeed, ...discord } = input;
    if (dbSeed?.pg) await db.pg().seed(dbSeed.pg);
    if (dbSeed?.mysql) db.mysql().seed(dbSeed.mysql);
    if (dbSeed?.sqlite) db.sqlite().seed(dbSeed.sqlite);
    if (dbSeed?.sheets) db.sheets().seed(dbSeed.sheets);
    return (await this.mock()).seed(discord);
  }

  /**
   * テストの準備をする。状態は初期化せず、今のデータの上でテストを実行する。
   * 操作するユーザーとチャンネルは、初期データの指定がなければ、ログイン中のユーザーと最初のテキストチャンネルを使う。
   */
  async prepare(options: PrepareOptions = {}): Promise<Prepared> {
    const api = await this.mock();
    await this.start(options);
    const seeded = await this.seed(this.merge(this.options.seed, options.seed));
    if (options.users !== 'login') return { seeded };

    const user = await this.pickUser(api, seeded);
    const channel = await this.pickChannel(api, seeded);
    const guildId = channel.guild_id as string;
    const state = await api.state();
    if (!state.guilds[guildId].members[user.id]) await api.join(guildId, user.id);
    await api.switchUser(user.id);
    if (options.label) await api.mark(channel.id, options.label);
    this.defaultChannelId = channel.id;
    return { user, actor: this.as(user), guild: (await api.state()).guilds[guildId], channel, seeded };
  }

  private async pickUser(api: MockApi, seeded: Json): Promise<Json> {
    const state = await api.state();
    return (
      (seeded.users[0] as Json | undefined) ??
      (state.users[state.activeUserId] as Json | undefined) ??
      (await this.seed({ users: [{ username: 'test-user' }] })).users[0]
    );
  }

  private async pickChannel(api: MockApi, seeded: Json): Promise<Json> {
    const seededChannel = seeded.channels.find((channel: Json) => channel.type === TEXT_CHANNEL) as Json | undefined;
    if (seededChannel) return seededChannel;
    const state = await api.state();
    const guild = (seeded.guilds[0] ?? Object.values<Json>(state.guilds)[0]) as Json | undefined;
    const channels = Object.values<Json>(state.channels)
      .filter((channel) => channel.guild_id === guild?.id && channel.type === TEXT_CHANNEL)
      .sort((a, b) => a.position - b.position);
    return channels[0] ?? (await this.seed({ channels: [{ name: 'general', guild: guild?.id }] })).channels[0];
  }

  /** Bot のログインと DB の準備に失敗すると、どのテストも実行できない。 */
  private async start(options: PrepareOptions): Promise<void> {
    try {
      if (options.users === 'login' && !this.bot?.isReady()) await this.login();
      if (!this.dbReady) {
        this.dbReady = true;
        await this.options.setupDb?.();
      }
    } catch (error) {
      if (error instanceof StartupError) throw error;
      throw new StartupError(`Bot を起動できません: ${(error as Error).message}`, { cause: error });
    }
  }

  private merge(base: TestSeed = {}, extra: TestSeed = {}): TestSeed {
    return {
      guilds: [...(base.guilds ?? []), ...(extra.guilds ?? [])],
      roles: [...(base.roles ?? []), ...(extra.roles ?? [])],
      channels: [...(base.channels ?? []), ...(extra.channels ?? [])],
      users: [...(base.users ?? []), ...(extra.users ?? [])],
      db: { ...base.db, ...extra.db },
    };
  }

  /** テストの前後で、画面でログインしているユーザーを維持する。 */
  async beginTestSession(): Promise<void> {
    this.loggedInUserId = (await (await this.mock()).state()).activeUserId;
  }

  async endTestSession(): Promise<void> {
    if (this.loggedInUserId) await (await this.mock()).switchUser(this.loggedInUserId);
  }

  /** テストを実行せず Bot を起動したままにする。画面からの手動操作に使う。 */
  async serve(): Promise<void> {
    await this.mock();
    await this.start({ users: 'login' });
  }

  /** 指定したユーザーとして操作する `Actor` を返す。 */
  as(user: Json | string): Actor {
    const target = typeof user === 'string' ? { id: user } : user;
    if (!this.api) throw new Error('dismock: テストの実行中に呼び出してください');
    return new Actor(this.api, target, () => this.defaultChannelId);
  }

  /** メッセージの履歴を返す。DM は `actor.dms()` で取得する。 */
  async messages(channelId?: string): Promise<Json[]> {
    return (await this.mock()).messages(channelId);
  }

  /** Bot が送信したメッセージだけを返す。 */
  async botMessages(channelId?: string): Promise<Json[]> {
    const state = await (await this.mock()).state();
    const messages = await this.messages(channelId);
    return messages.filter((message) => message.author.id === state.botUserId);
  }

  async state(): Promise<Json> {
    return (await this.mock()).state();
  }

  async destroy(): Promise<void> {
    await this.bot?.destroy();
  }
}

/** 本物の Client をラップし、Mock と Client の両方のメソッドを持つ `TestClient` を返す。 */
export function testClient(client: BotClient | TestClientOptions, options?: TestClientOptions): TestClient & BotClient {
  return new TestClient(client, options) as TestClient & BotClient;
}
