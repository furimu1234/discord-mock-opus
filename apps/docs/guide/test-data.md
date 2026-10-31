# ダミーデータ

ユーザー、チャンネル、ロール、サーバーは、テストコードと管理画面のどちらからでも追加できます。どちらから追加しても同じデータとして扱います。

## 既定のデータ

Mock は起動時にデータを消去し、画面をすぐ操作できる初期データを投入します。テストサーバーと、`alice`（管理者）、`bob`（権限なし）を含みます。

## seed

`seed` は、テストの前にデータを投入します。テストのオプションと `testClient` のオプションで指定できます。

```ts
test('ロールを持つユーザーだけが使える', {
  seed: {
    roles: [{ name: 'member' }],
    users: [{ username: 'carol', roles: ['member'] }],
  },
}, async ({ actor, seeded }) => {
  const [carol] = seeded.users;
  await actor.command('check', { target: carol.id });
});
```

ロールやチャンネルは名前で参照できます。追加先は、開いているチャンネルのサーバーです。

`seed` で追加したユーザーはデータとして追加されるだけで、テストを実行するユーザーにはなりません。そのユーザーで操作するときは `bot.as` を使います。

```ts
await bot.as(seeded.users[0]).sendMessage('hello');
```

`seed` で追加したテキストチャンネルがあるときは、そのチャンネルでテストを実行します。

## テストの中で追加する

```ts
const user = await bot.users.create({ username: 'carol' });
const channel = await bot.channels.create({ name: 'log' });
const role = await bot.roles.create({ name: 'member' });
const guild = await bot.guilds.create({ id: OTHER_GUILD, name: 'other' });
```

## 別のサーバーを使う

テストは開いているチャンネルのサーバーで完結させてください。別のサーバーが必要なときは ID を固定します。同じ ID のサーバー、チャンネル、ロールは使い回されるので、繰り返し実行しても増えません。

```ts
const OTHER_GUILD = '2000000000000000001';
```

## データの寿命

| データ | 寿命 |
|---|---|
| ダミーデータ、メッセージ | Mock を再起動するまで |
| トークン | 残り続ける（`data/discord-mock-state.json`） |
| DB | Bot を起動し直すまで。Mock を再起動すると Bot も起動し直す |
| 実行結果 | Mock を再起動するまで（直近 100 回） |

`pnpm web` と `pnpm app` の起動時に、トークンと Bot のユーザー以外のデータをすべて消去します。
