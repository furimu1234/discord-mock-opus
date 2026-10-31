# testClient

testClient は、Bot と Mock をつなぐ設定です。テストファイルからは読み込まず、`testClient.ts` に定義するだけで使えます。テストランナーはプロジェクトのルート、`__tests__/`、`tests/`、`test/` の順に `testClient.ts` を探します。

```ts
import * as disMock from '@dismock/client';
```

## Bot を接続する

Bot の構成に合わせて、3 つの書き方から選びます。

### Client を公開していない Bot

エントリーファイルを指定します。ファイルを読み込むと Bot が起動します。

```ts
export const testClient = disMock.testClient({ entry: 'src/index.ts' });
```

### Client を公開している Bot

本物の `Client` を渡します。

```ts
import { client } from '../src/bot.ts';

export const testClient = disMock.testClient(client);
```

### Bot 固有の操作を追加する

`TestClient` を継承してメソッドを追加します。テストでは `bot` から呼び出せます。

```ts
class MyTestBotClient extends disMock.TestClient {
  visitNames() {
    return disMock.db.pg().query<{ name: string }>('SELECT name FROM visits');
  }
}

export const testClient = new MyTestBotClient(client);
```

## オプション

| オプション | 内容 |
|---|---|
| `entry` | Client を公開していない Bot のエントリーファイル |
| `commands` | 起動時に自動で登録しない Bot のためのコマンド定義 |
| `setupDb` | テーブルの作成など。Bot のプロセスごとに 1 回だけ実行する |
| `seed` | すべてのテストの前に投入する初期データ |
| `mockUrl` | Mock の URL |
| `token` | Mock のトークン |

詳しくは [TestClientOptions](../api/client/interface/TestClientOptions.md) を参照してください。

## 接続先

URL とトークンは、次の順に探します。通常は指定する必要はありません。

1. `testClient` のオプション（`mockUrl`, `token`）
2. 環境変数（`DISMOCK_URL`, `DISMOCK_TOKEN`）
3. `data/discord-mock-state.json`（カレントディレクトリから親へ順に探す）

トークンが一致しない、Mock に接続できない、Bot や DB の準備に失敗したときは、起動エラー（[StartupError](../api/client/class/StartupError.md)）になります。起動エラーはテストの失敗とは区別され、`pnpm app` は Mock も含めて終了します。

## Bot のトークン

テストでは `client.login` に渡された値で接続先を判定します。Bot がトークンを `.env`、ハードコード、JSON のどこに持っていても同じです。

| `client.login` に渡された値 | 動作 |
|---|---|
| Mock のトークン | Mock に接続する |
| なし | Mock のトークンで Mock に接続する |
| それ以外（本物のトークンなど） | どこにも送らず、起動エラーにする |

本物の Discord と使い分けるときは、たとえば `.env` の値を切り替えます。

```sh
# 本物の Discord に接続するとき
# DISCORD_TOKEN=本物のトークン

# Mock に接続するとき
DISCORD_TOKEN=my-mock-token-0001
```

`.env` は dismock が読み込むのではなく、Bot が自分で読み込みます。Mock のトークンは、画面の URL の `#token=` の後ろか `data/discord-mock-state.json` で確認できます。自分で決めることもできます。[コマンド](./cli.md#dismock-server)を参照してください。

1 つの Mock のトークンは 1 つなので、複数の Bot をテストするときは同じ値を指定します。

## 本物の Client を使う

testClient は Mock の操作と本物の Client の両方を持ちます。`users` のように名前が重なるものは Mock の操作を優先するので、本物の Client のものは `bot.client` から使います。

```ts
await bot.users.create({ username: 'carol' }); // Mock にダミーユーザーを追加する
bot.client.users.cache.size;                   // discord.js のキャッシュ
```

## 差し替えられるもの

テストの実行時に読み込まれるフックが、次のものを Mock やインメモリ DB へ差し替えます。Bot のコードを変える必要はありません。

- `discord.js` の `Client` と `REST`（Bot が自分で作成した `REST` も対象）
- `pg`, `mysql2`, `mysql2/promise`, `better-sqlite3`, `googleapis`, `@googleapis/sheets` の `import` と `require`
