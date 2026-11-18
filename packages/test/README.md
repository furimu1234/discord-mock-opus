# @dismock/test

dismock の Mock の上で Discord の Bot をテストする、テストランナーとテスト DSL です。Bot は [`@dismock/client`](https://www.npmjs.com/package/@dismock/client) で Mock へつなぎます。

```sh
npm install --save-dev @dismock/client @dismock/test
```

`__tests__/ping.test.ts`:

```ts
import { expect, test } from '@dismock/test';

test('ping に応答する', {}, async ({ actor }) => {
  const reply = await actor.command('ping');
  expect(reply.content).toBe('pong');
});
```

Mock を起動したまま、テストを実行します。

```sh
npx dismock test
```

Mock は配布版か[リポジトリ](https://github.com/furimu1234/discord-mock-opus)から起動します。Node.js 24 以降が必要です。使い方はリポジトリの `apps/docs/guide/` を参照してください。

dismock は Discord Inc. とは関係のない非公式のツールです。Discord は Discord Inc. の商標です。

## ライセンス

MIT
