import type { Json, TrafficEntry } from '@dismock/server';
import { ComponentType } from '#server-constants';
import type { APIMessage } from 'discord.js';

/** Bot が呼び出した REST API。DM の内容は `request` と `response` が伏せ字の文字列になる。 */
export interface RestTraffic {
  /** REST API の呼び出しを表す。 */
  kind: 'rest';
  /** 記録した時刻（ISO 8601）。 */
  at: string;
  /** `GET` や `POST` などのメソッド（大文字）。 */
  method: string;
  /** `/api/v10/channels/1/messages` のようなパス。 */
  path: string;
  /** Mock が返した HTTP のステータス。 */
  status: number;
  /** Bot が送った本文。本文がなければ `null`。 */
  request: Json | null;
  /** Mock が返した本文。本文がなければ `null`。 */
  response: Json | null;
}

/** Mock が Bot へ配信した Gateway のイベント。 */
export interface GatewayTraffic {
  /** Gateway のイベントを表す。 */
  kind: 'gateway';
  /** 記録した時刻（ISO 8601）。 */
  at: string;
  /** `MESSAGE_CREATE` などのイベント名。 */
  event: string;
  /** イベントの `d` の内容。 */
  data: Json;
}

/** Bot が開いたモーダル。 */
export interface OpenedModal {
  /** モーダルの `custom_id`。 */
  customId: string;
  /** モーダルのタイトル。 */
  title: string;
  /** 入力欄の `custom_id`。表示する順。 */
  inputs: string[];
}

/** ユーザーが送信したモーダル。 */
export interface SubmittedModal {
  /** モーダルの `custom_id`。 */
  customId: string;
  /** 入力欄の `custom_id` と、入力した値。セレクトメニューは選んだ値の配列。 */
  values: Record<string, string | string[]>;
  /** 送信したユーザーの ID。 */
  userId: string;
}

/** ユーザーが押したボタン、または選んだセレクトメニュー。 */
export interface ComponentUse {
  /** コンポーネントの `custom_id`。 */
  customId: string;
  /** ボタンやセレクトメニューのあるメッセージの ID。 */
  messageId: string;
  /** 操作したユーザーの ID。 */
  userId: string;
  /** セレクトメニューで選んだ値。ユーザー、ロール、チャンネルのセレクトメニューでは ID。ボタンでは空。 */
  values: string[];
}

/** Mock がエラーを返した API の呼び出し。 */
export interface FailedRequest {
  /** `GET` や `POST` などのメソッド。 */
  method: string;
  /** 呼び出したパス。 */
  path: string;
  /** HTTP のステータス。 */
  status: number;
  /** エラーのメッセージ。`Unknown Message` など。 */
  message: string;
  /** Discord のエラーコード。`10008` など。 */
  code: number;
}

/** インタラクションの応答の種類のうち、メッセージを作るもの、編集するもの、モーダルを開くもの。 */
const CallbackType = { reply: 4, update: 7, modal: 9 } as const;
const InteractionType = { component: 3, modal: 5 } as const;

/** Bot がメッセージを新しく送る API。 */
const SEND_PATHS = ['/channels/:id/messages', '/webhooks/:app/:token'];
/** Bot がメッセージを編集する API。 */
const EDIT_PATHS = ['/channels/:id/messages/:message', '/webhooks/:app/:token/messages/:message'];
const CALLBACK_PATH = '/interactions/:id/:token/callback';

/** `custom_id` の一致するコンポーネントがあるか、アクションロウやコンテナの中まで調べる。 */
const hasComponent = (components: Json[] | undefined, customId: string): boolean =>
  (components ?? []).some(
    (component) =>
      component.custom_id === customId ||
      hasComponent([...(component.components ?? []), ...(component.accessory ? [component.accessory] : [])], customId),
  );

/** モーダルの入力欄を、アクションロウとラベルの中から取り出す。 */
const modalInputs = (components: Json[] | undefined): Json[] =>
  (components ?? []).flatMap((component) => {
    if (component.type === ComponentType.actionRow) return component.components ?? [];
    if (component.type === ComponentType.label) return component.component ? [component.component] : [];
    return [];
  });

type BotMessage = { kind: 'sent' | 'edited'; message: APIMessage };

const isMessage = (value: unknown): value is APIMessage =>
  typeof value === 'object' && value !== null && 'id' in value && 'channel_id' in value;

/** API のバージョンの部分。{@link Traffic.rest} のパスでは省略する。 */
const API_PREFIX = /^\/api\/v\d+/;

/** 記録したパスから、API のバージョンとクエリを除く。 */
const apiPath = (path: string): string => path.replace(API_PREFIX, '').split('?')[0] ?? '';

/** `:name` の部分を任意の 1 区切りに一致させる正規表現にする。 */
const pathPattern = (path: string): RegExp =>
  new RegExp(
    `^${path
      .split('/')
      .map((segment) => (segment.startsWith(':') ? '[^/]+' : segment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
      .join('/')}$`,
  );


type Entry = RestTraffic | GatewayTraffic;

const restEntries = (entries: Entry[], method?: string, path?: string): RestTraffic[] => {
  const pattern = path === undefined ? undefined : pathPattern(path);
  return entries.filter(
    (entry): entry is RestTraffic =>
      entry.kind === 'rest' &&
      (method === undefined || entry.method === method.toUpperCase()) &&
      (pattern === undefined || pattern.test(apiPath(entry.path))),
  );
};

const gatewayEntries = (entries: Entry[], event?: string): GatewayTraffic[] =>
  entries.filter(
    (entry): entry is GatewayTraffic => entry.kind === 'gateway' && (event === undefined || entry.event === event),
  );

/** Bot のメッセージの送信と編集を、起きた順に並べる。 */
const botMessages = (entries: Entry[]): BotMessage[] => {
  const send = SEND_PATHS.map(pathPattern);
  const edit = EDIT_PATHS.map(pathPattern);
  const callback = pathPattern(CALLBACK_PATH);
  return restEntries(entries).flatMap((entry): BotMessage[] => {
    if (entry.status >= 400) return [];
    const path = apiPath(entry.path);
    if (entry.method === 'POST' && callback.test(path)) {
      const message = entry.response?.resource?.message;
      if (!isMessage(message)) return [];
      if (entry.request?.type === CallbackType.reply) return [{ kind: 'sent', message }];
      if (entry.request?.type === CallbackType.update) return [{ kind: 'edited', message }];
      return [];
    }
    if (!isMessage(entry.response)) return [];
    if (entry.method === 'POST' && send.some((pattern) => pattern.test(path))) {
      return [{ kind: 'sent', message: entry.response }];
    }
    if (entry.method === 'PATCH' && edit.some((pattern) => pattern.test(path))) {
      return [{ kind: 'edited', message: entry.response }];
    }
    return [];
  });
};

/** Bot へ配信したインタラクションのうち、`type` が一致するもの。 */
const interactions = (entries: Entry[], type: number): { data: Json; messageId: string; userId: string }[] =>
  gatewayEntries(entries, 'INTERACTION_CREATE')
    .map((entry) => entry.data)
    .filter((interaction) => interaction.type === type)
    .map((interaction) => ({
      data: interaction.data,
      messageId: interaction.message?.id,
      userId: interaction.member?.user?.id ?? interaction.user?.id,
    }));

/** ボタンはセレクトメニューと違い `values` を持たない。 */
const componentUses = (entries: Entry[]): (Omit<ComponentUse, 'values'> & { values?: string[] })[] =>
  interactions(entries, InteractionType.component).map(({ data, messageId, userId }) => ({
    customId: data.custom_id,
    messageId,
    userId,
    values: data.values,
  }));

/**
 * テスト中の Bot の通信。テストの引数の `traffic` で受け取る。
 *
 * @remarks
 * テストが始まってから Bot が呼び出した REST API と、Bot へ配信した Gateway のイベントを読む。
 * テストごとに新しく始まり、前のテストの通信は含まない。`seed` などの準備の通信も含まない。
 * 各メソッドは呼び出した時点の通信を Mock から読むので、`await` して使う。`expect.poll` に渡せば、Bot の処理を待てる。
 * よく使うものは {@link Traffic.sentMessages} や {@link Traffic.openedModals} などで取り出せる。
 * それ以外は {@link Traffic.rest} と {@link Traffic.gateway} で、API やイベントを指定して取り出す。
 *
 * @example
 * ```ts
 * test('新規作成', {}, async ({ actor, traffic, channel }) => {
 *   await actor.click('recruit_setting_panel_add');
 *   // ...
 *   expect((await traffic.openedModals())[0]?.title).toBe('設定名入力');
 *   expect((await traffic.selections())[0]?.values).toEqual([channel.id]);
 *   await expect.poll(() => traffic.sentMessages()).toHaveLength(1);
 *   expect(await traffic.errors()).toEqual([]);
 * });
 * ```
 */
export class Traffic {
  /** @internal */
  constructor(private readonly load: () => Promise<TrafficEntry[]>) {}

  /**
   * テストが始まってからのすべての通信を返す。
   *
   * @returns 記録した順の通信。
   */
  async entries(): Promise<(RestTraffic | GatewayTraffic)[]> {
    return (await this.load()) as Entry[];
  }

  /**
   * Bot が新しく送ったメッセージを返す。チャンネルへの送信、インタラクションへの返信、フォローアップを含む。
   *
   * @remarks
   * `deferReply` の読み込み中のメッセージは含まない。その後の `editReply` の内容は {@link Traffic.editedMessages} に入る。
   *
   * @returns 送った時点のメッセージ。古い順。
   */
  async sentMessages(): Promise<APIMessage[]> {
    return botMessages(await this.entries())
      .filter((item) => item.kind === 'sent')
      .map((item) => item.message);
  }

  /**
   * Bot が編集したメッセージの、編集後の内容を返す。`editReply`、`update`、メッセージの `edit` を含む。
   *
   * @returns 編集した時点のメッセージ。古い順。
   */
  async editedMessages(): Promise<APIMessage[]> {
    return botMessages(await this.entries())
      .filter((item) => item.kind === 'edited')
      .map((item) => item.message);
  }

  /**
   * Bot が送ったか編集したメッセージのうち、`customId` のボタンやセレクトメニューがある最新のものを返す。
   *
   * @param customId - ボタンやセレクトメニューの `custom_id`。
   * @returns その時点のメッセージ。なければ `undefined`。
   */
  async messageWith(customId: string): Promise<APIMessage | undefined> {
    return botMessages(await this.entries())
      .map((item) => item.message)
      .findLast((message) => hasComponent(message.components as Json[] | undefined, customId));
  }

  /**
   * Bot が開いたモーダルを返す。
   *
   * @returns 開いたモーダル。古い順。
   */
  async openedModals(): Promise<OpenedModal[]> {
    return restEntries(await this.entries(), 'POST', CALLBACK_PATH)
      .filter((entry) => entry.status < 400 && entry.request?.type === CallbackType.modal)
      .map(({ request }) => ({
        customId: request?.data?.custom_id,
        title: request?.data?.title,
        inputs: modalInputs(request?.data?.components).map((input) => input.custom_id),
      }));
  }

  /**
   * ユーザーが送信したモーダルと、入力した値を返す。
   *
   * @returns 送信したモーダル。古い順。
   */
  async submittedModals(): Promise<SubmittedModal[]> {
    return interactions(await this.entries(), InteractionType.modal).map(({ data, userId }) => ({
      customId: data.custom_id,
      values: Object.fromEntries(
        modalInputs(data.components).map((input) => [input.custom_id, input.values ?? input.value]),
      ),
      userId,
    }));
  }

  /**
   * ユーザーが押したボタンを返す。
   *
   * @returns 押したボタン。古い順。
   */
  async clickedButtons(): Promise<ComponentUse[]> {
    return componentUses(await this.entries())
      .filter((use) => use.values === undefined)
      .map((use) => ({ ...use, values: [] }));
  }

  /**
   * ユーザーがセレクトメニューで選んだものを返す。
   *
   * @returns 選んだセレクトメニューと値。古い順。
   */
  async selections(): Promise<ComponentUse[]> {
    return componentUses(await this.entries()).filter((use): use is ComponentUse => use.values !== undefined);
  }

  /**
   * Mock がエラーを返した API の呼び出しを返す。`Unknown Message` など、Bot の処理の失敗に気付ける。
   *
   * @returns 失敗した呼び出し。古い順。
   */
  async errors(): Promise<FailedRequest[]> {
    return restEntries(await this.entries())
      .filter((entry) => entry.status >= 400)
      .map((entry) => ({
        method: entry.method,
        path: entry.path,
        status: entry.status,
        message: entry.response?.message ?? '',
        code: entry.response?.code ?? 0,
      }));
  }

  /**
   * REST API の呼び出しを返す。
   *
   * @param method - `GET` や `POST` などのメソッド。省略するとすべて。
   * @param path - `/channels/:id/messages` のようなパス。`/api/v10` とクエリは付けず、`:` で始まる部分は任意の値に一致する。
   * @returns 一致した呼び出し。古い順。
   */
  async rest(method?: string, path?: string): Promise<RestTraffic[]> {
    return restEntries(await this.entries(), method, path);
  }

  /**
   * Gateway のイベントを返す。
   *
   * @param event - `MESSAGE_CREATE` などのイベント名。省略するとすべて。
   * @returns 一致したイベント。古い順。
   */
  async gateway(event?: string): Promise<GatewayTraffic[]> {
    return gatewayEntries(await this.entries(), event);
  }
}
