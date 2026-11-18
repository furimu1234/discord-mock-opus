# @dismock/client

Discord の Bot を、コードを変えずに dismock の Mock へつなぐクライアントです。テストは [`@dismock/test`](https://www.npmjs.com/package/@dismock/test) で書きます。

- `client.login` の接続先（REST API と Gateway）を Mock へ差し替えます。本物のトークンは使いません。
- `pg`、`mysql2`、`better-sqlite3`、`googleapis`（Sheets）をインメモリの DB に差し替えます。

```sh
npm install --save-dev @dismock/client @dismock/test
```

`__tests__/testClient.ts`:

```ts
import * as disMock from '@dismock/client';

export const testClient = disMock.testClient({ entry: 'src/index.ts', token: disMock.connection().token });
```

Mock は配布版か[リポジトリ](https://github.com/furimu1234/discord-mock-opus)から起動します。Node.js 24 以降が必要です。使い方はリポジトリの `apps/docs/guide/` を参照してください。

dismock は Discord Inc. とは関係のない非公式のツールです。Discord は Discord Inc. の商標です。

## ライセンス

MIT
