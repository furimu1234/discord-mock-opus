# テストの書き方

テストは `*.test.ts` に書きます。Jest と同じ `describe`、`test`、`expect` を `@dismock/test` から読み込みます。

```ts
import { describe, expect, test } from '@dismock/test';

describe('レベル', () => {
  test('発言すると XP が増える', async ({ actor, user, db }) => {
    await actor.sendMessage('hello');
    await expect.poll(() => db.pg().rows('levels')).not.toHaveLength(0);
  });
});
```

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

第 2 引数にオプションを指定できます。

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
test('A', async ({ actor }) => {});                   // ログイン中のユーザー
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
await actor.click(reply, 'next');                       // ボタンを押す
await actor.select(reply, 'menu', ['a']);               // セレクトメニューを選択する
await actor.submitModal('form', { title: 'hello' });    // モーダルを送信する
await bot.as(other).command('rank');                    // 別のユーザーとして操作する
```

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
| `actor.dms()` | そのユーザーでログインして、宛先が自分の DM を取得する |
| `bot.state()` | Mock の状態。DM の内容は含まない |
| `db.pg().rows(table)` など | [インメモリ DB](./database.md)の内容 |

## テストは今のデータの上で動く

テストごとの初期化はありません。メッセージ、ダミーデータ、DB は Mock を再起動するまで残ります。繰り返し実行しても結果が変わらないよう、データが空であることを前提にしないでください。

値は、操作の前後の差で確認します。

```ts
test('発言すると規定の XP を獲得する', async ({ actor, user }) => {
  const before = await xpOf(user.id);
  await actor.sendMessage('hello');
  await expect.poll(() => xpOf(user.id)).toBe(before + XP_PER_MESSAGE);
});
```

期待値をリテラルで書かず、Bot が公開している定数（ここでは `XP_PER_MESSAGE`）から求めると、値を変更してもテストを直さずに済みます。

ログイン中のユーザーのデータもテストで変化します。
