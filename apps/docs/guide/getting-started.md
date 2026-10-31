# クイックスタート

Bot を 1 つ作り、Mock に接続してテストを実行します。

## 準備

dismock のパッケージは npm に公開していません。[リポジトリ](https://github.com/furimu1234/discord-mock-opus)を clone し、Bot を `examples/` の下に置いて pnpm workspace の一員として使います。

必要なものは Nix だけです。Node.js と pnpm は `shell.nix` で固定しています。

```sh
git clone https://github.com/furimu1234/discord-mock-opus.git
cd discord-mock-opus
nix-shell
pnpm install
```

## Bot を用意する

`examples/my-bot/package.json` を作成します。

```json
{
  "name": "my-bot",
  "private": true,
  "type": "module",
  "dependencies": { "discord.js": "^14.28.0" },
  "devDependencies": {
    "@dismock/client": "workspace:*",
    "@dismock/test": "workspace:*"
  }
}
```

`examples/my-bot/src/index.ts` に Bot を書きます。すでに Bot がある場合は、そのコードをそのまま置いてください。

```ts
import { Client, Events, GatewayIntentBits } from 'discord.js';

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

client.once(Events.ClientReady, async (ready) => {
  await ready.application.commands.set([{ name: 'ping', description: '応答を返す' }]);
});

client.on(Events.InteractionCreate, async (interaction) => {
  if (interaction.isChatInputCommand() && interaction.commandName === 'ping') {
    await interaction.reply('pong');
  }
});

await client.login(process.env.DISCORD_TOKEN);
```

## testClient を作る

`examples/my-bot/__tests__/testClient.ts` を作成します。`entry` に Bot のエントリーファイルを指定します。

```ts
import * as disMock from '@dismock/client';

export const testClient = disMock.testClient({ entry: 'src/index.ts' });
```

テストでは `client.login` の接続先が Mock に差し替わるので、本物のトークンは必要ありません。`DISCORD_TOKEN` が未設定のときは Mock のトークンで接続します。

## テストを書く

`examples/my-bot/__tests__/ping.test.ts` を作成します。

```ts
import { expect, test } from '@dismock/test';

test('ping に応答する', async ({ actor }) => {
  const reply = await actor.command('ping');
  expect(reply.content).toBe('pong');
});
```

`actor` はログイン中のダミーユーザーです。

## 実行する

ワークスペースに Bot を追加したので、もう一度インストールしてから起動します。

```sh
pnpm install
pnpm app
```

ターミナルに表示された URL をブラウザで開きます。

```text
Discord Mock: http://127.0.0.1:6470/#token=...
```

左のレールからテストを開き、`my-bot` のカードをクリックするとテストが実行されます。Bot の応答は開いているチャンネルに表示されます。

画面を使わずに実行するときは、1 つのターミナルで `pnpm web` を実行し、別のターミナルで `pnpm test:run` を実行します。全テストを実行して、失敗があれば終了コードで知らせます。

## 次に読むもの

- [テストの書き方](./writing-tests.md)
- [testClient](./test-client.md)の設定
- [API リファレンス](../api/index.md)
