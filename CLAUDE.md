# Discord Mock (discord-mock-opus) 要件定義書

本ドキュメントは、**Discord Mock（サーバー / UI）** と **クライアントライブラリ（SDK / テストフレームワーク）** の責務を明確に分離した要件定義書です。

画面の表示と操作は [DESIGN.md](DESIGN.md)、作業の指針は [AGENTS.md](AGENTS.md) を参照してください。

---

## 1. 全体アーキテクチャ概要

```
+---------------------------------------------------------------------------------------+
|                                  discord-mock-opus                                    |
|                                                                                       |
|  [ 1. Mock 側 (apps/server & apps/web) ]                                              |
|  - セルフホスト独立サーバー (自分の PC / VPS 限定)                                    |
|  - Discord v10 REST API エミュレータ                                                  |
|  - Discord Gateway (WebSocket) エミュレータ                                           |
|  - Web UI (Discord風クライアント画面 / 管理ダッシュボード / DB Studio)                |
|  - ローカル JSON データ永続化 (discord-mock-state.json)                               |
|                                                                                       |
|  [ 2. ライブラリ側 (packages/client-js & packages/test) ]                             |
|  - testClient: 本物の Bot Client をラップし、透過的に Mock へルーティング            |
|  - インメモリ DB エミュレータ (pg, mysql, sqlite, sheets)                             |
|  - テストランナー & テスト DSL (@dismock/test: test, describe, expect)                |
|  - アサーションヘルパー & ユーザーなりすましアクター (actor, bot)                     |
+---------------------------------------------------------------------------------------+
```

---

## 2. Mock 側（Mock サーバー & Web UI）の要件

Mock 側は、本番の Discord インフラや外部ネットワークに一切依存せず、自分の PC または自分の管理下にある VPS 上で Discord の各種プロトコルと管理インターフェースを提供するスタンドアロン型エミュレータです。

### 2.1. セキュリティ & セルフホスト要件
- **SaaS 形式の完全排除**: 昨今の脆弱性の多発を踏まえ、SaaS 形式での提供は危険と判断。マルチテナント型外部クラウドでの提供を禁止し、自分の PC または自分の管理下にある VPS でのみ動作。
- **バインド制限**: デフォルトで `127.0.0.1` にのみバインドし、外部ネットワークからの不正アクセスを遮断。
- **クリーンルーム実装**: Discord 公式の公開ドキュメント仕様のみに基づき、非公開 API やクライアント内部実装のリバースエンジニアリングを行わない。
- **本番非依存**: 本番 Discord 認証（OAuth、本番 Bot Token 検証）や外部通信を行わない。

### 2.2. Discord API & Gateway エミュレーション要件
- **REST API (v10 互換)**:
  - `/api/v10/channels/:channelId/messages`: メッセージ送信・取得
  - `/api/v10/gateway/bot`: ローカル Gateway 接続先 URL の返却
  - `/api/v10/users/@me/channels`: Bot からの DM チャンネル作成
  - `/api/v10/guilds/:guildId/roles`: ロールの取得・作成
  - `/api/mock/interact`: スラッシュコマンド（Application Command）およびコンポーネント（ボタン、セレクト）のインタラクション受付
  - `/api/mock/switch-user`: 操作ダミーユーザーの動的切り替え
  - `/api/mock/state` & `/api/mock/reset`: モック内部状態の取得および初期化
- **Gateway WebSocket エミュレーション**:
  - Opcode 1 (Heartbeat), Opcode 2 (Identify), Opcode 4 (Voice State Update), Opcode 10 (Hello) のハンドシェイク
  - イベントディスパッチ:
    - `READY`: 初期接続時のギルド・ユーザー情報配信
    - `MESSAGE_CREATE`: メッセージ受信通知
    - `INTERACTION_CREATE`: スラッシュコマンドやボタン押下イベントの Bot への配信
    - `VOICE_STATE_UPDATE`: ボイスチャンネルの接続・切断通知
    - `VOICE_SERVER_UPDATE`: Bot への音声接続先の通知
  - Bot 側のソースコード変更なし（透過的）での WebSocket 接続。

### 2.3. CLI 起動要件
- CLI（`dismock-server`）で起動すると Mock サーバーが立ち上がり、URL を発行する。
- 利用者は発行された URL をブラウザで開いて Web UI を使う。URL の形式は `http://127.0.0.1:6470/#token=...` で、画面はフラグメントのトークンで認証する。フラグメントはサーバーのログに残らず、画面は読み取った後にアドレスバーから消す。
- 起動時にトークンを発行し、状態の JSON に保存する。JSON に値があるときは、以後そのトークンを使い回す。トークンの保存はポートの待ち受けより先に行い、起動に失敗してもトークンは発行された状態にする。
- 開発者は `--token` または環境変数 `DISMOCK_TOKEN` で Mock のトークンを指定できる。指定した値は JSON に保存し、以後も使い回す。値は英数字、`-`、`_`、`.` で 16 文字以上とし、本物の Bot のトークンと同じ形式の値は起動エラーにする。
- REST API、Gateway、`/api/mock` はトークンを検証し、一致しない場合は 401 または close code 4004 で拒否する。トークンを配布する API は設けない。

| コマンド | 動作 |
|---|---|
| `pnpm web` | Mock を起動する |
| `pnpm test` | 起動中の Mock に testClient（エージェント）を接続し、テスト画面からの実行を待つ |
| `pnpm app` | Mock と testClient の両方を起動する。Ctrl+C で終了する |
| `pnpm test:run` | 起動中の Mock に対して全テストを実行して終了する。CI などに使う |

起動エラー（Mock を起動できない、Mock に接続できない、トークンが一致しない、Bot や DB の準備に失敗した）が発生すると、`pnpm app` は Mock も含めて終了する。テストの失敗は起動エラーではない。

### 2.3.1. テストの実行
- Mock はプロセスを起動しない。testClient のエージェントがテストケースの一覧を Mock に登録し、画面の指示を受けてテストを実行する。
- エージェントは選択中のプロジェクトの Bot を接続したままにし、テストはその Bot のプロセスの中で実行する。別のプロジェクトのテストを実行すると、そのプロジェクトの Bot に接続を切り替える。
- テストごとの初期化は行わない。テストは今のダミーデータ、メッセージ、DB の上で実行し、結果は Mock を再起動するまで残る。
- テストは、指定がなければログイン中のユーザーで実行する。`seed` で追加したユーザーは操作に使わない。別のユーザーで実行するときは `users` に `'login'`、ID、ユーザー名、またはそのリストを指定する。リストのときは `actors` で全員の `Actor` を受け取り、`user` と `actor` は先頭のユーザーになる。
- チャンネルは画面で開いているチャンネルで、CLI から実行したときは最初のテキストチャンネルとする。`seed` でチャンネルを指定すると、追加したチャンネルを使う。`seed` のデータの追加先も、開いているチャンネルのサーバーとする。
- 既定のダミーユーザー（`alice` は管理者、`bob` は権限なし）の ID は固定する。`users` の型は既定のユーザーを補完でき、`pnpm test` / `pnpm app` の起動中は各プロジェクトに `dismock-users.d.ts` を生成して、管理画面で追加したユーザーも補完できるようにする。テストが追加したユーザーは含めない。
- テストは開いているチャンネルのサーバーで完結させ、新しいサーバーを作らない。別のサーバーが必要なテストは ID を固定し、繰り返し実行しても増えないようにする（同じ ID のサーバー、チャンネル、ロールは使い回す）。
- 画面から実行したテストは、実行ごとの結果（成功、失敗、エラー、テスト中の Bot の通信）を Mock のメモリに保存する。Mock を再起動すると消える。保存するのは直近 100 回まで。通信は Bot が呼び出した REST API のリクエストとレスポンス、Bot へ配信した Gateway イベントで、DM の内容は伏せる。
- テストの区切りをチャンネルに表示する。区切りは画面だけのもので、Bot やテストには見えない。
- testClient は Mock の再起動を検知すると再接続し、Bot を起動し直す。これにより DB も空になる。

### 2.4. ダミーデータ & 永続化要件
- ダミーユーザー、チャンネル、ロール等は、テストコードと管理画面の両方から追加でき、どちらから追加しても同じデータとして扱う。
- CLI で起動したときにダミーデータが 1 件もなければ、画面をすぐ操作できる初期データを投入する。
- モックサーバー内の状態（ギルド、チャンネル、ユーザー、ロール、メッセージ、設定）はローカルの JSON ファイル（`data/discord-mock-state.json` 等）に自動シリアライズ・保存。
- `pnpm web` と `pnpm app` の起動時に、トークンと Bot のユーザー以外のデータ（ダミーデータ、メッセージ、登録済みコマンド）をすべて消去する。

### 2.5. ログイン & 操作主体要件
- テスト画面ではダミーユーザーを選択してログインする。
- コマンドの実行者やボタンの押下者など、操作の主体はログイン中のダミーユーザーとする。

### 2.6. ボイスチャンネル要件
- 音声は、Bot とログイン中のダミーユーザーが同じボイスチャンネルにいるときだけ流れる。
- 例: Bot がボイスチャンネル A で音楽を流す機能を持つ場合
  1. Bot がボイスチャンネル A に接続する。
  2. ログイン中のダミーユーザーもボイスチャンネル A に接続すると、音声が流れる。
  3. ダミーユーザーが切断すると、音声が止まる。

### 2.7. ダイレクトメッセージ (DM) 要件
- Bot はそれぞれのダミーユーザーに DM を送信できる。
- DM の内容は、宛先のユーザーでログインしたときだけ閲覧できる。`/api/mock/state` にも DM の内容は含めない。

### 2.8. Web UI 要件
- テスト画面、管理画面、DB Studio を提供する。各画面の要件は [DESIGN.md](DESIGN.md) を参照。

---

## 3. ライブラリ側（Client SDK & テストフレームワーク）の要件

ライブラリ側は、Bot 開発者が自身のコード（discord.js / drizzle 等）を修正することなく、直感的なテストやモック操作を実行するための SDK およびテストランナー群（`@dismock/client`, `@dismock/test`）です。

### 3.1. クライアント統合要件 (`testClient`)
- **コード変更ゼロでの透過的ルーティング**:
  - 本物の `Client` インスタンスを渡すだけで、REST API エンドポイントと Gateway URL を Mock サーバーへ自動差し替え。
  - `discord.js` の `Client` と `REST` の通信先は、テストの実行時に読み込むフック（`@dismock/client/register`）が Mock へ差し替える。Bot が自分で作成した `REST` も対象で、本物のトークンは使わない。
  - `client.login` に渡されたトークンで判定する。Bot がトークンをどこに保存していても（`.env`、ハードコード、JSON など）同じように扱う。引数がなければ discord.js の既定どおり `client.token` を使う。Mock のトークンと一致するか、指定がなければ Mock へ接続し、一致しなければ送信せずに起動エラーにする。
  - `Proxy` パターンを採用し、本物の `Client` メソッド（`on`, `isReady` 等）と Mock 操作メソッド（`as`, `seed`, `messages` 等）の双方を同一インスタンスから呼び出し可能。名前が重なる `users` などは Mock 操作を優先し、本物は `bot.client` から使う。
- **重複定義の排除（設定の一本化）**:
  - `testClient` のオプションに、モック URL（`mockUrl`）、認証トークン（`token`）、テーブルの作成（`setupDb`）、コマンド定義（`commands`）、全テスト共通の初期データ（`seed`）をまとめて指定可能。
  - URL とトークンは、オプション、環境変数（`DISMOCK_URL`, `DISMOCK_TOKEN`）、`data/discord-mock-state.json` の順に優先する。JSON はカレントディレクトリから親へ順に探す。
  - `testClient` を定義するだけでグローバルに登録され、runner との二重定義は発生しない。テストランナーは `testClient.ts`（ルート、`__tests__/`、`tests/`、`test/`）を自動で読み込む。
- **利用スタイルの両立**:
  - `testClient.ts` では `import * as disMock from '@dismock/client';` で読み込む。
  - 引数注入型: `export const testClient = disMock.testClient(realClient, options);`
  - クラス継承型: `export class MyTestBotClient extends disMock.TestClient { ... }`
  - エントリー指定型: `export const testClient = disMock.testClient({ entry: 'src/index.ts' });`。`Client` を公開していない Bot でも、変更せずにテストできる。

### 3.2. インメモリ DB エミュレータ要件 (`disMock.db`)
Bot は本物の DB に接続するコードのまま動く。テストの実行時にフックがドライバーの `import` / `require` をインメモリ実装へ差し替え、接続情報は無視する。ドライバーごとに 1 つの DB を共有する。

| ドライバー | テスト側の API | エンジン |
|---|---|---|
| `pg` | `disMock.db.pg()` | PGlite（WASM 版の PostgreSQL） |
| `mysql2`, `mysql2/promise` | `disMock.db.mysql()` | `node:sqlite` と MySQL 方言の変換 |
| `better-sqlite3` | `disMock.db.sqlite()` | `node:sqlite` |
| `googleapis` (`sheets` v4), `@googleapis/sheets` | `disMock.db.sheets()` | 独自のインメモリ実装 |

- **共通 API**: `seed(data)` でテストケース側から初期データを投入し、`rows(table)` や `query(sql)` で内容を検証する。
- **Drizzle ORM**: `pg`, `mysql2`, `better-sqlite3` のいずれのドライバーでも動作する。
- **テーブルの作成**: `setupDb` で Bot のプロセスごとに 1 回だけ行う。データはテストの間で残り、Bot を起動し直すと空になる。
- **DB Studio への送信**: DB は Bot やテストのプロセスのメモリ上にあるため、それぞれのプロセスが内容を Mock へ送る。接続中の Bot は変化があったとき（1 秒ごとに確認）、画面から実行したテストはテストの終了時に送る。テーブルごとに先頭 1000 行までを送る。
- **既知の制約**:
  - MySQL は SQL を変換して SQLite で実行するため、変換に対応していない MySQL 固有の構文はエラーになる。型の厳密さも SQLite に準じる。
  - 接続は実質 1 本で、同時に複数のトランザクションは実行できない。
  - Sheets は値の読み書きとシートの追加、削除、改名に対応し、数式の計算や書式は対象外。

### 3.3. テストランナー & テスト DSL 要件 (`@dismock/test`)
テストファイル（`__tests__/*.test.ts`）を直感的・宣言的に記述できるカスタム DSL を提供：
- **パッケージ直インポート**:
  - `import { test, describe, expect } from '@dismock/test';` で呼び出し可能。
  - テストファイル側で `runner` を分割エクスポート・インポートする冗長なコードは不要。
- **テストオプション & コンテキスト注入**:
  - `users`: テストを実行するユーザー。省略時と `'login'` はログイン中のユーザー。テスト開始時に Bot を Mock Gateway へ自動でログインさせる。
  - テスト関数と `beforeEach` などのフックに `{ bot, user, actor, guild, channel, seeded, db }` を自動注入。
  - Jest と同じ `describe` / `test` / `it`、`beforeAll` / `afterAll` / `beforeEach` / `afterEach`、`.skip` / `.only` / `.todo` / `.each` を提供する。テストは `dismock test` で実行する。
- **Actor (ダミーユーザー操作)**:
  - `actor.sendMessage(text)`: テストを実行するユーザーとしてメッセージ送信し、Bot のイベントリスナーを発火。
  - `actor.command(name, options)`: スラッシュコマンドを実行し、Bot からの応答（Embed, ボタン, `interaction_metadata`）を受信・アサート。
- **Bot 状態操作 & アサーション (`bot`)**:
  - `bot.users.create()` / `bot.channels.create()` / `bot.roles.create()` / `bot.guilds.create()`: ダミーデータの動的生成。
  - `bot.seed({ guilds, roles, channels, users, db })`: 初期データの一括投入。ロールやチャンネルは名前で参照できる。テストの `seed` オプションでも指定できる。
  - Bot 固有のデータの読み書きは、`TestClient` を継承してメソッドを追加する。
  - `bot.as(otherUser)`: 別のユーザー視点に切り替えてコマンドやメッセージを実行。
  - `bot.messages(channelId?)` / `bot.botMessages(channelId?)`: メッセージ履歴の取得。DM は `actor.dms()` でのみ取得できる。
- **Jest 互換のアサーションヘルパー**:
  - `expect.poll(() => condition).toBe(...)` による非同期イベント発火待ち。
  - タイムアウト拒否テスト (`expect(...).rejects.toThrow("250ms")`)。

### 3.4. テストデータ管理方針
- **既存のデータへの非依存**:
  - テストごとに初期化しないため、テストはデータが空であることを前提にしない。何度実行しても結果が変わらないよう、必要なユーザーやサーバーは `seed` で追加し、値は操作の前後の差で検証する。
- **初期データの注入責任**:
  - ライブラリ側での過剰な固定データ自動生成は行わず、**テストケースを記述する開発者（または指示した AI）がテストコード内で柔軟に注入**する。
  - `__tests__/` 内のテストファイル群は、ランナー側で自動検出・実行可能とする。

### 3.5. ドキュメント要件 (`apps/docs`)
- 利用者向けのドキュメントを、Mock とは別の静的サイトとして提供する。Mock からは配信せず、サイトに Mock の機能やトークンを含めない。
- API リファレンスは、`@microsoft/api-extractor` が `packages/client-js` と `packages/test` の `.d.ts` と TSDoc から作るモデル（`apps/docs/.api/`）を、`apps/docs/scripts/generate-api.mjs` が日本語の Markdown（`apps/docs/api/`）へ変換して作る。どちらも生成物でコミットしない。ガイドは `apps/docs/guide/` に書く。
- `@internal` を付けた API はドキュメントに載せない。ランナーやシムだけが使う API に付ける。
- 次の場合は生成に失敗する: API Extractor の警告（公開 API が公開していない型を参照しているなど）、説明のない公開 API、解決できないリンク。
- サイトは VitePress で生成する。配信先のパスは環境変数 `DOCS_BASE` で指定する（例: `DOCS_BASE=/dismock/ pnpm docs:build`）。既定は `/`。`apps/docs/.vitepress/dist` を静的ファイルのサーバーに置けば公開できる。外部のサービスは使わず、検索もサイト内で完結する。

---

## 4. 責務分担表 (Responsibility Matrix)

| 機能分野 | Mock 側 (apps/server, apps/web) | ライブラリ側 (@dismock/client, @dismock/test) |
|---|---|---|
| **通信・プロトコル** | REST API エンドポイント、WebSocket Gateway の実サーバー提供 | Bot の HTTP/WS 通信先をローカル Mock へ透過的に差し替え |
| **ユーザー・権限** | ダミーユーザーの保存、DM の隔離管理、トークン自動発行 | `actor` / `bot.as(user)` によるテスト内での操作ユーザー切り替え |
| **GUI・可視化** | Discord 風テスト画面、管理画面、DB Studio UI | なし（DB の内容を Mock 側へ HTTP 経由で送信するのみ） |
| **データ永続化** | `discord-mock-state.json` へのローカル永続化 | テストケース単位のインメモリ状態管理（`seed`, クリーンアップ） |
| **データベース** | DB Studio 上でのテーブル構造・データ閲覧 | `pg`, `mysql`, `sqlite`, `sheets` の各インメモリ互換インスタンス提供 |
| **テスト実行** | インタラクションやメッセージの送受信仲介 | `test`, `describe`, `expect` の DSL、コンテキスト注入、アサーション |

---

## 5. ハードコーディングの禁止

このリポジトリのコードとテストは次の規則に従う。

- **値の定義は 1 か所にする。** 同じ意味の値を複数の場所に書かない。定数や関数として定義し、それを参照する。
- **テストの期待値は実装から導く。** 実装が定数や関数として公開している値を、リテラルで書き写さない。値を変更してもテストを直さずに済むようにする。
- **前後の差で検証する。** 操作の結果は「操作前の値 + 1 回の操作で変わる量 = 操作後の値」の形で書き、操作前の値も実際に読み取る。
- **前提データも実装から導く。** しきい値の手前の状態などを用意するときは、数値を計算して書かず、定数や関数から求める。ID は実際に生成された値（`user.id`, `guild.id` など）を使う。
- **値に名前を付ける。** 必要な値は、意味の分かる名前の定数にする。テスト名にも具体的な値を書かない。

ただし、次のものはリテラルでよい。

- 計算式や境界値そのものを検証するテストの期待値。実装と同じ式で期待値を求めると、誤りを検出できないため。
- 任意に選んだ入力値（ユーザー名、メッセージ本文など）。
- 繰り返し実行しても増えないように固定する ID。名前の付いた定数にする。
- 実装が定数として公開していない表示文言や、テーブル名、カラム名などの外部仕様。

---

## 6. 未決定事項

- VPS で起動したときのブラウザからのアクセス方法（デフォルトのバインド先 `127.0.0.1` には外部から届かないため）
- Bot が送信する音声の受信方法と、ブラウザでの再生方式
- ドキュメントサイトの公開先
