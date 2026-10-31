# インメモリ DB

Bot は本物の DB に接続するコードのまま動きます。テストの実行時に、ドライバーの `import` と `require` がインメモリの実装に差し替わり、接続情報は無視されます。ドライバーごとに 1 つの DB を共有します。

| ドライバー | テストの API | エンジン |
|---|---|---|
| `pg` | `db.pg()` | PGlite（WASM 版の PostgreSQL） |
| `mysql2`, `mysql2/promise` | `db.mysql()` | `node:sqlite` と MySQL 方言の変換 |
| `better-sqlite3` | `db.sqlite()` | `node:sqlite` |
| `googleapis`（`sheets` v4）, `@googleapis/sheets` | `db.sheets()` | 独自のインメモリ実装 |

Drizzle ORM は `pg`、`mysql2`、`better-sqlite3` のいずれでも動きます。

## テーブルを作る

Bot が起動時にテーブルを作らない場合は、`setupDb` で作成します。Bot のプロセスごとに 1 回だけ実行します。

```ts
export const testClient = disMock.testClient({
  entry: 'src/index.ts',
  token: disMock.connection().token,
  setupDb: async () => {
    await disMock.db.pg().query('CREATE TABLE levels (user_id text PRIMARY KEY, level integer NOT NULL)');
  },
});
```

## 初期データを入れる

```ts
test('登録済みのユーザー', {
  seed: { db: { pg: { levels: [{ user_id: 'a', level: 5 }] } } },
}, async ({ db }) => {
  await expect(db.pg().rows('levels')).resolves.toContainEqual({ user_id: 'a', level: 5 });
});
```

テストの中から `db.pg().seed(...)` を呼び出すこともできます。

## 内容を確認する

```ts
await db.pg().query('SELECT level FROM levels WHERE user_id = $1', [user.id]); // pg は非同期
db.mysql().query('SELECT * FROM notes WHERE user_id = ?', [user.id]);
db.sqlite().query('SELECT * FROM tags WHERE name = ?', name as never);
db.sheets().values(spreadsheetId, 'Sheet1!A1:B2');
```

`pg` の操作だけが `Promise` を返します。詳しくは [PgEngine](../api/client/class/PgEngine.md)、[MysqlEngine](../api/client/class/MysqlEngine.md)、[SqliteEngine](../api/client/class/SqliteEngine.md)、[SheetsEngine](../api/client/class/SheetsEngine.md) を参照してください。

## スプレッドシート

`seed` は `{ スプレッドシートの ID: { シート名: 行の配列 } }` の形で指定します。

```ts
db.sheets().seed({ 'sheet-id': { Sheet1: [['name', 'score'], ['alice', 10]] } });
```

## データの寿命

データはテストの間で残り、Bot を起動し直すと空になります。Mock を再起動すると Bot も起動し直すので、DB も空になります。

DB は Bot のプロセスのメモリにあるので、接続中の Bot が内容を Mock へ送り、[DB Studio](./web-ui.md#db-studio) に表示します。テーブルごとに先頭 1000 行までです。

## 制約

- MySQL は SQL を変換して SQLite で実行するので、変換に対応していない固有の構文はエラーになります。型の厳密さも SQLite に準じます。
- 接続は実質 1 本で、同時に複数のトランザクションは実行できません。
- スプレッドシートは値の読み書きと、シートの追加、削除、改名に対応します。数式の計算と書式は対象外です。
