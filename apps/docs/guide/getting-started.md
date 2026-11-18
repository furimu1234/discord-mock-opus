# クイックスタート

Bot を 1 つ作り、Mock に接続してテストを実行します。

## 準備

テストに使うパッケージ `@dismock/client` と `@dismock/test` は npm で配布しています。Mock は配布版（Windows の exe、Mac の app、Linux のシェルスクリプト）か、[リポジトリ](https://github.com/furimu1234/discord-mock-opus)から起動します。Node.js は 24 以降が必要です。

### npm のパッケージを使う

Bot のプロジェクトにパッケージを追加します。

```sh
npm install --save-dev @dismock/client @dismock/test
```

`package.json` は次のようになります。

```json
{
  "name": "my-bot",
  "private": true,
  "type": "module",
  "dependencies": { "discord.js": "^14.28.0" },
  "devDependencies": {
    "@dismock/client": "^0.1.0",
    "@dismock/test": "^0.1.0"
  }
}
```

Bot のプロジェクトからは、Mock の状態の JSON を探せないことがあります。そのときは、テストを実行するターミナルで環境変数 `DISMOCK_URL` と `DISMOCK_TOKEN` に Mock の URL とトークンを指定してください（[CLI](./cli.md)）。

### リポジトリの中で使う

[リポジトリ](https://github.com/furimu1234/discord-mock-opus)を clone し、Bot を `examples/` の下に置いて pnpm workspace の一員として使うこともできます。必要なものは Nix だけです。Node.js と pnpm は `shell.nix` で固定しています。

```sh
git clone https://github.com/furimu1234/discord-mock-opus.git
cd discord-mock-opus
nix-shell
pnpm install
```

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

## Bot を用意する

以降はリポジトリの中で使う場合のパスで説明します。npm のパッケージを使う場合は、`examples/my-bot/` を Bot のプロジェクトのフォルダーに読み替えてください。

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

`examples/my-bot/__tests__/testClient.ts` を作成します。`entry` に Bot のエントリーファイルを、`token` に Mock のトークンを指定します。

```ts
import * as disMock from '@dismock/client';

export const testClient = disMock.testClient({ entry: 'src/index.ts', token: disMock.connection().token });
```

`disMock.connection().token` は Mock が保存したトークンを返すので、先に Mock を起動してください。テストでは `client.login` の接続先が Mock に差し替わります。本物のトークンは必要ありません。

## テストを書く

`examples/my-bot/__tests__/ping.test.ts` を作成します。

```ts
import { expect, test } from '@dismock/test';

test('ping に応答する', {}, async ({ actor }) => {
  const reply = await actor.command('ping');
  expect(reply.content).toBe('pong');
});
```

`actor` はログイン中のダミーユーザーです。

## 実行する

npm のパッケージを使う場合は、配布版の Mock を起動します。画面とターミナルのウインドウが開くので、管理画面の「Bot プロジェクト」で Bot のプロジェクトのフォルダーを追加して「起動」を押します。画面を使わずに実行するときは、Mock を起動したまま、Bot のプロジェクトで `npx dismock test` を実行します。

リポジトリの中で使う場合は、ワークスペースに Bot を追加したので、もう一度インストールしてから起動します。

```sh
pnpm install
pnpm app
```

ターミナルに表示された URL をブラウザで開きます。

```text
dismock: http://127.0.0.1:6470/#token=...
```

管理画面の「Bot プロジェクト」で `my-bot` のフォルダーを追加し、「起動」を押します。登録は残りますが、Bot は `pnpm app` のたびにボタンで起動します。

左のレールからテストを開き、`my-bot` のカードをクリックするとテストが実行されます。Bot の応答は開いているチャンネルに表示されます。

画面を使わずに実行するときは、1 つのターミナルで `pnpm web` を実行し、別のターミナルで `pnpm test:run` を実行します。全テストを実行して、失敗があれば終了コードで知らせます。

## 次に読むもの

- [テストの書き方](./writing-tests.md)
- [testClient](./test-client.md)の設定
- [API リファレンス](../api/index.md)
