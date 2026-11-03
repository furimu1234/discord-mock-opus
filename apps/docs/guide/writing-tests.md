# テストの書き方

テストは `*.test.ts` に書きます。Jest と同じ `describe`、`test`、`expect` を `@dismock/test` から読み込みます。

```ts
import { describe, expect, test } from '@dismock/test';

describe('レベル', () => {
  test('発言すると levels に記録される', {}, async ({ actor, db }) => {
    await actor.sendMessage('hello');
    await expect.poll(() => db.pg().rows('levels')).not.toHaveLength(0);
  });
});
```

発言したユーザーの行を追加する Bot を、`alice` でログインしてテストしたときの例です。

**実行前**（`levels`、0 行）

| user_id | level |
|---|---|

**実行後**（`levels`）

| user_id | level |
|---|---|
| 1000000000000000101 | 1 |

## 使える関数

| 関数 | 内容 |
|---|---|
| `describe` | テストをまとめる。入れ子にでき、画面ではカテゴリーとして表示する |
| `test`, `it` | テストを定義する |
| `beforeAll`, `afterAll` | まとまりの前後に実行する |
| `beforeEach`, `afterEach` | それぞれのテストの前後に実行する |
| `expect` | Jest の `expect` と `expect.poll` |
| `fn`, `spyOn` | `jest-mock` のモック関数 |

`describe` には `.skip` と `.only`、`test` には `.skip`、`.only`、`.todo`、`.each` があります。

## テストに渡される値

テスト関数と `beforeEach`、`afterEach` は次の値を受け取ります。`beforeAll` と `afterAll` が受け取るのは `bot` と `db` だけです。

| 値 | 内容 |
|---|---|
| `bot` | testClient |
| `user` | テストを実行するユーザー |
| `actor` | `user` として操作する [Actor](../api/client/class/Actor.md) |
| `actors` | `users` に指定したすべてのユーザーの Actor |
| `guild` | テストを実行するサーバー |
| `channel` | テストを実行するチャンネル |
| `seeded` | `seed` で追加したデータ |
| `db` | インメモリ DB |

## テストのオプション

第 2 引数のオプションは必須です。指定するものがなければ `{}` を渡します。省略するとテストの読み込みでエラーになります。

```ts
test('管理者だけが実行できる', { users: 'alice', timeout: 10000 }, async ({ actor }) => {
  await actor.command('admin');
});
```

| オプション | 内容 |
|---|---|
| `users` | テストを実行するユーザー |
| `timeout` | 制限時間。既定は 5000ms |
| `description` | テストのカードに表示する説明 |
| `seed` | テストの前に投入する初期データ |

## 実行するユーザー

テストは、指定がなければ画面でログインしているユーザーで実行します。別のユーザーで実行するときは `users` を指定します。

```ts
test('A', {}, async ({ actor }) => {});                   // ログイン中のユーザー
test('B', { users: 'login' }, async ({ actor }) => {}); // ログイン中のユーザー
test('C', { users: 'alice' }, async ({ actor }) => {}); // ユーザー名で指定
test('D', { users: ['alice', 'bob'] }, async ({ actors }) => {}); // 複数のユーザー
```

リストを指定すると、`actors` で全員の Actor を受け取り、`user` と `actor` は先頭のユーザーになります。

`users` はユーザー名と ID の両方を受け付け、補完も効きます。

- 既定のダミーユーザーは `alice`（管理者）と `bob`（権限なし）です。ID は固定で、常に補完できます。
- 管理画面で追加したユーザーは、`pnpm test` / `pnpm app` の起動中に生成される `dismock-users.d.ts` によって補完できます。
- 存在しないユーザーを指定すると型エラーになります。

## Bot を操作する

```ts
await actor.sendMessage('hello');                       // メッセージを送信する
const reply = await actor.command('rank');              // コマンドを実行して応答を待つ
await actor.command('tag set', { name: 'a', content: 'b' }); // サブコマンドは空白で区切る
await actor.userCommand('User Info', other);            // ユーザーコマンド（右クリックの「アプリ」）を実行する
await actor.click(reply, 'next');                       // ボタンを押す
await actor.select(reply, 'menu', ['a']);               // セレクトメニューを選択する
await actor.submitModal('form', { title: 'hello' });    // モーダルを送信する
await bot.as(other).command('rank');                    // 別のユーザーとして操作する
```

`click`、`select`、`submitModal` の結果には、次の値が入ります。

| 値 | 内容 |
|---|---|
| `kind` | Bot の応答の種類。`message`（新しいメッセージ）、`update`（メッセージの書き換え）、`modal`、`deferred` |
| `message` | 押したボタンや選んだセレクトメニューのあるメッセージの、応答の後の状態。`submitModal` では、ボタンなどから開いたモーダルのときに、そのメッセージが入る |
| `reply` | Bot が新しく送ったメッセージ |
| `modal` | Bot が開いたモーダル |

```ts
const clicked = await actor.click(panel, 'open');
clicked.message; // panel の最新の状態
clicked.modal;   // ボタンで開いたモーダル
const submitted = await actor.submitModal(clicked.modal!.custom_id, { body: 'hello' });
submitted.reply; // モーダルへの返信
```

### モーダルを画面で見る

テストの操作で開いたモーダルは、そのままではテスト画面に表示しません。`watchModal` で囲んだ操作のモーダルだけを、指定した時間（ミリ秒）だけ表示します。囲んだ中で `submitModal` も行うと、送信した値をモーダルに入れて表示します。

```ts
import { test, watchModal } from '@dismock/test';

test('新規作成でモーダルが開く', {}, async ({ actor }) => {
  const clicked = await watchModal(async () => {
    const result = await actor.click(panel, 'add');                           // ボタンを押すとモーダルを表示する
    await actor.submitModal(result.modal!.custom_id, { name: '新規設定' });    // 入力した値も表示する
    return result;
  }, 2_500); // 2.5 秒表示する
});
```

`watchModal` は中の操作の結果を返します。表示は画面だけのもので、テストは表示の終わりを待たずに進みます。

## 時刻を固定する

`clock.set` で、テストの中の現在時刻を変えられます。テストは Bot と同じプロセスで動くので、Bot の `new Date()` と `Date.now()` も同じ時刻になります。昼と夜で動きが変わる Bot などのテストに使います。

```ts
import { clock, test } from '@dismock/test';

test('深夜は深夜投稿チャンネルに投稿する', {}, async ({ actor }) => {
  clock.set('2023-01-01T02:00:00+09:00');
  // ...
});
```

| 操作 | 内容 |
|---|---|
| `clock.set(time)` | 現在時刻を設定する |
| `clock.reset()` | 本当の時刻に戻す |
| `clock.isSet()` | 時刻を設定しているか |
| `clock.realNow()` | 時刻を設定していても、本当の現在時刻を返す |

- 時刻にはタイムゾーンを含めて書きます（`+09:00` など）。含めないと、実行する PC のタイムゾーンで解釈されます。
- 変えるのは `Date` だけです。Bot の接続や discord.js の処理を止めないよう、`setTimeout` などのタイマーは本物のまま動きます。
- 時刻は止まらず、設定した時刻から本当の時間と同じ速さで進みます。
- テストが終わると、ランナーが本当の時刻に戻します。`afterEach` で戻す必要はありません。

## テストの間で値を受け渡す

`store` に保存した値は、別のテストで読めます。前のテストで Bot が送ったメッセージのボタンを押すときなどに使います。

```ts
import { store, test } from '@dismock/test';
import type { MockMessage } from '@dismock/client';

test('パネルを送る', {}, async ({ actor }) => {
  store.push('panel', await actor.command('募集設定'));
});

test('新規作成ボタンを押す', {}, async ({ actor }) => {
  const panel = store.get<MockMessage>('panel');
  if (!panel) throw new Error('先に「パネルを送る」を実行してください');
  await actor.click(panel, 'recruit_setting_panel_add');
});
```

値は Bot のプロセスのメモリに保存します。画面から別々に実行したテストの間でも残り、Bot を起動し直すと消えます。保存したテストを実行していないと `get` は `undefined` を返すので、上の例のように確かめてから使います。

`sendMessage` は Bot の応答を待ちません。Bot の処理を待つときは `expect.poll` を使います。

```ts
await actor.sendMessage('hello');
await expect.poll(async () => (await bot.botMessages(channel.id)).length).toBeGreaterThan(before);
```

## 結果を確認する

| 操作 | 内容 |
|---|---|
| `bot.messages(channelId?)` | メッセージの履歴 |
| `bot.botMessages(channelId?)` | Bot が送信したメッセージ |
| `reply.fetch()` | メッセージの最新の状態。`actor` や `bot` から受け取ったメッセージで使える |
| `bot.followUps(reply)` | 応答に続けて送信されたフォローアップ |
| `actor.dms()` | そのユーザーでログインして、宛先が自分の DM を取得する |
| `bot.state()` | Mock の状態。DM の内容は含まない |
| `db.pg().rows(table)` など | [インメモリ DB](./database.md)の内容 |
| `traffic` | テストが始まってからの Bot の通信。次の節を参照 |

## Bot の通信で流れを確認する

テストの引数の `traffic` で、そのテストが始まってからの Bot の通信を確認できます。モーダルを開いたか、何が選ばれたか、どのメッセージを送ったかなど、応答のメッセージだけでは分からない流れを確かめられます。

- テストごとに新しく始まり、前のテストの通信は含みません。`seed` などの準備の通信も含みません。
- 各操作は呼び出した時点の通信を読むので、`await` して使います。`expect.poll(() => traffic.sentMessages())` のように、Bot の処理を待つこともできます。
- DM の内容は伏せます。

| 操作 | 内容 |
|---|---|
| `traffic.sentMessages()` | Bot が新しく送ったメッセージ（チャンネルへの送信、返信、フォローアップ） |
| `traffic.editedMessages()` | Bot が編集したメッセージの編集後の内容（`editReply`、`update`、`edit`） |
| `traffic.messageWith(customId)` | そのボタンやセレクトメニューがある、Bot の最新のメッセージ |
| `traffic.openedModals()` | Bot が開いたモーダル（`customId`、`title`、入力欄の `inputs`） |
| `traffic.submittedModals()` | 送信したモーダルと、入力した値（`values`） |
| `traffic.clickedButtons()` | 押したボタン |
| `traffic.selections()` | セレクトメニューで選んだ値 |
| `traffic.errors()` | Mock がエラーを返した API の呼び出し。`Unknown Message` などに気付ける |

メッセージは、送った時点や編集した時点の内容です。`deferReply` の後の `editReply` は `editedMessages()` に入ります。

Bot が defer した後で応答の内容を送らず、別のメッセージを送るときは、操作に `{ waitForReply: false }` を渡します。Bot が defer した時点で戻ります。Bot が続けて行う処理は、`expect.stable` で通信が止まるまで待ってから確認します。

```ts
test('新規作成ボタン押下', {}, async ({ actor, traffic, channel }) => {
  const { modal } = await actor.click('recruit_setting_panel_add');
  await actor.submitModal(modal!.custom_id, { settingName: 'テスト設定' }, { waitForReply: false });
  await actor.select('select-channel', [channel.id], { waitForReply: false });
  await expect.stable(async () => (await traffic.entries()).length); // Bot の処理が終わるまで待つ

  expect((await traffic.openedModals())[0]?.title).toBe('設定名入力');                    // モーダルを開いた
  expect((await traffic.submittedModals())[0]?.values).toEqual({ settingName: 'テスト設定' }); // 入力した値
  expect(await traffic.messageWith('select-channel')).toBeDefined();                     // セレクトメニューを送った
  expect((await traffic.selections())[0]?.values).toEqual([channel.id]);                 // 選んだチャンネル
  expect((await traffic.sentMessages()).at(-1)?.embeds[0]?.title).toBe('募集管理パネル');  // パネルを送った
  expect(await traffic.errors()).toEqual([]);                                            // 失敗した API がない
});
```

上の一覧にない通信は、API やイベントを指定して取り出せます。

| 操作 | 内容 |
|---|---|
| `traffic.rest(method?, path?)` | REST API の呼び出し。`path` は `/channels/:id/messages` のように書き、`/api/v10` は付けない。`:` で始まる部分は任意の値に一致する |
| `traffic.gateway(event?)` | `INTERACTION_CREATE` などの Gateway のイベント |
| `traffic.entries()` | すべての通信。起きた順 |

Mock は直近 2000 件の通信だけを持つので、長いテストでは古いものから消えます。

## 変わらないことを確認する

`expect.stable` は、値が 1 秒間変わらないことを確認します。3 秒以内に落ち着かなければ失敗します。Bot が返信しないことの確認などに使います。

```ts
await actor.sendMessage('hello');
await expect.stable(async () => (await bot.botMessages(channel.id)).length);
```

## 音声を確認する

Bot がボイスチャンネルで再生した音声は、Mock が受信します。`bot.voiceStatus` でフレーム数を確認できます。`audibleFrames` は、ログイン中のユーザーが Bot と同じチャンネルにいる間に受信した数です。

```ts
test('再生すると音声が流れる', { timeout: 30000 }, async ({ actor, bot, guild }) => {
  await actor.joinVoice(guild.id, voiceChannelId);
  await actor.command('play', { url });
  await expect.poll(async () => (await bot.voiceStatus(guild.id))?.audibleFrames ?? 0).toBeGreaterThan(0);
});
```

`deferReply` した後は、Discord のインタラクションのトークンと同じ 15 分まで応答を待ちます。時間のかかるコマンドは、テストの `timeout` を延ばします。

`actor.command` は最初の応答が届いた時点で返ります。その後の `followUp` は、`bot.followUps(reply)` で待ちます。`deferReply` の直後の `followUp` は Discord と同じく元の応答になるので、`reply` で受け取ります。

```ts
const reply = await actor.command('report');
await expect.poll(() => bot.followUps(reply)).toHaveLength(1);
```

## テストは今のデータの上で動く

テストごとの初期化はありません。メッセージ、ダミーデータ、DB は Mock を再起動するまで残ります。繰り返し実行しても結果が変わらないよう、データが空であることを前提にしないでください。

値は、操作の前後の差で確認します。

```ts
test('発言すると規定の XP を獲得する', {}, async ({ actor, user }) => {
  const before = await xpOf(user.id);
  await actor.sendMessage('hello');
  await expect.poll(() => xpOf(user.id)).toBe(before + XP_PER_MESSAGE);
});
```

`xpOf` は `members` テーブルから XP を読み取る関数です。`alice` でログインしていて、`XP_PER_MESSAGE` が 15 のときの例です。

**実行前**（`members`）

| user_id | xp |
|---|---|
| 1000000000000000101 | 100 |

**実行後**（`members`）

| user_id | xp |
|---|---|
| 1000000000000000101 | 115 |

期待値をリテラルで書かず、Bot が公開している定数（ここでは `XP_PER_MESSAGE`）から求めると、値を変更してもテストを直さずに済みます。

ログイン中のユーザーのデータもテストで変化します。
