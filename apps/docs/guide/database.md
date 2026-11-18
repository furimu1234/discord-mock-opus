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

**実行前**: `levels` テーブルはありません。

**実行後**（`levels`、0 行）

| user_id | level |
|---|---|

Drizzle のスキーマがあれば、SQL を書かずに `createTables` で作成できます。`pg`、`mysql`、`sqlite` で使えます。`pgSchema` のスキーマも一緒に作成します。

```ts
import * as schema from '../src/schema';

export const testClient = disMock.testClient({
  entry: 'src/index.ts',
  token: disMock.connection().token,
  setupDb: () => disMock.db.pg().createTables(schema),
});
```

**実行前**: `levels` テーブルはありません。

**実行後**（`levels`、0 行）

| user_id | level |
|---|---|

実行せずに SQL だけを確認するときは `schemaSql` を使います。

```ts
const statements = await disMock.db.pg().schemaSql(schema);
```

読み取りだけなので、DB の内容は変わりません。

| 状態 | `levels` |
|---|---|
| 実行前後 | テーブルなし |

SQL の生成には `drizzle-kit` を使います。スキーマの主キーの重複など、本物の DB でエラーになる定義は、テストでも同じエラーになります。

## 初期データを入れる

`seed` は行を追加するだけです。データはテストの間で残るので、同じ主キーの行があるとエラーになります。繰り返し実行するテストでは、先に同じ行を削除します。

```ts
test('登録済みのユーザー', {}, async ({ db, user }) => {
  await db.pg().query('DELETE FROM levels WHERE user_id = $1', [user.id]);
  await db.pg().seed({ levels: [{ user_id: user.id, level: 5 }] });
  await expect(db.pg().rows('levels')).resolves.toContainEqual({ user_id: user.id, level: 5 });
});
```

`alice` でログインしているときの例です。

**実行前**（`levels`）

| user_id | level |
|---|---|
| 1000000000000000101 | 2 |
| 1000000000000000102 | 3 |

**実行後**（`levels`）

| user_id | level |
|---|---|
| 1000000000000000102 | 3 |
| 1000000000000000101 | 5 |

テストのオプションの `seed` でも `seed: { db: { pg: { levels: [...] } } }` の形で投入できます。テストを実行するたびに投入するので、主キーのないテーブルに使います。

## 内容を確認する

```ts
await db.pg().query('SELECT level FROM levels WHERE user_id = $1', [user.id]); // pg は非同期
db.mysql().query('SELECT level FROM levels WHERE user_id = ?', [user.id]);
db.sqlite().query('SELECT level FROM levels WHERE user_id = ?', user.id as never);
// どれも [{ level: 5 }] を返す
```

読み取りだけなので、実行の前後で内容は変わりません。

**実行前と実行後**（`levels`）

| user_id | level |
|---|---|
| 1000000000000000101 | 5 |

`pg` の操作だけが `Promise` を返します。詳しくは [PgEngine](../api/client/class/PgEngine.md)、[MysqlEngine](../api/client/class/MysqlEngine.md)、[SqliteEngine](../api/client/class/SqliteEngine.md)、[SheetsEngine](../api/client/class/SheetsEngine.md) を参照してください。

## スプレッドシート

`seed` は `{ スプレッドシートの ID: { シート名: 行の配列 } }` の形で指定します。

同じシートに投入すると、内容を置き換えます。`values` は値を文字列で返します。

```ts
db.sheets().seed({ 'sheet-id': { Sheet1: [['name', 'score'], ['alice', 10]] } });
db.sheets().values('sheet-id', 'Sheet1!A1:B2'); // [['name', 'score'], ['alice', '10']]
```

**実行前**: `sheet-id` のスプレッドシートはありません。

**実行後**（`sheet-id` の `Sheet1`）

| | A | B |
|---|---|---|
| 1 | name | score |
| 2 | alice | 10 |

## データの寿命

データはテストの間で残り、Bot を起動し直すと空になります。Mock を再起動すると Bot も起動し直すので、DB も空になります。

DB は Bot のプロセスのメモリにあるので、接続中の Bot が内容を Mock へ送り、[DB Studio](./web-ui.md#db-studio) に表示します。テーブルごとに先頭 1000 行までです。

## 制約

- MySQL は SQL を変換して SQLite で実行するので、変換に対応していない固有の構文はエラーになります。型の厳密さも SQLite に準じます。
- 接続は実質 1 本で、同時に複数のトランザクションは実行できません。
- スプレッドシートは値の読み書きと、シートの追加、削除、改名に対応します。数式の計算と書式は対象外です。
