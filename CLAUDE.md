# dismock (discord-mock-opus) 要件定義書

本ドキュメントは、**dismock の Mock（サーバー / UI）** と **クライアントライブラリ（SDK / テストフレームワーク）** の責務を明確に分離した要件定義書です。

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
- **Bot プロジェクトの実行**: 管理画面の Bot プロジェクトの登録と起動は `127.0.0.1` などのループバックで起動した Mock でのみ行える。起動できるのは登録済みのフォルダーだけで、登録時に確認を表示する。フォルダーの選択で Mock が返すのはフォルダーの名前だけで、ファイルの名前と内容は返さない。
- **クリーンルーム実装**: Discord 公式の公開ドキュメント仕様のみに基づき、非公開 API やクライアント内部実装のリバースエンジニアリングを行わない。
- **添付ファイル**: 添付の URL には Mock のトークンから作った署名を付け、署名が一致したときだけ Mock のトークンなしで返す（Discord の CDN と同じ）。画面と同じ場所で開いても安全な画像、動画、音声、テキスト以外は `application/octet-stream` のダウンロードとして返し、HTML や SVG のスクリプトが画面のトークンを読めないようにする。
- **名前と表示**: 製品名は `dismock` に統一し、「Discord」を製品名や画面のタイトルに使わない。Discord のロゴ、画像、フォント、配色の値は使わない。画面の起動前の表示、管理画面、ドキュメントに「dismock は Discord Inc. とは関係のない非公式のツールです。Discord は Discord Inc. の商標です。」と表示する。Discord の名前は、互換の対象を説明するときにだけ使う。
- **本番非依存**: 本番 Discord 認証（OAuth、本番 Bot Token 検証）や外部通信を行わない。例外は配布版の管理画面の「アップデートを確認」で、押したときだけ GitHub の Releases に問い合わせる。

### 2.2. Discord API & Gateway エミュレーション要件
- **REST API (v10 互換)**:
  - Discord の公開ドキュメントのすべての REST API と Gateway のイベントを扱う（DAVE を除く）。対応の一覧は [apps/docs/guide/discord-api.md](apps/docs/guide/discord-api.md)。OAuth や課金が要るもの（`access_token`、SKU、購入、サブスクリプション、アクティビティ）は、ダミーユーザーと `/api/mock` で代わりに行う。
  - `/api/mock/channels/:channelId/typing`、`/api/mock/users/:userId/presence`、`/api/mock/guilds/:guildId/scheduled-events/:eventId/users/:userId`、`/api/mock/skus`、`/api/mock/entitlements`、`/api/mock/subscriptions`、`/api/mock/activity-instances`: ユーザーの操作や Discord の外で起きることを、Bot へのイベントとして起こす
  - `/api/mock/gateway/reconnect`、`/api/mock/gateway/invalid-session`、`/api/mock/gateway/rate-limit`: Bot の再接続とレート制限への対応を試す。Mock の終了時は `RECONNECT` を送り、知らないセッションの再開には `INVALID_SESSION` を返す
  - `/api/v10/channels/:channelId/messages`: メッセージ送信・取得
  - `/api/v10/gateway/bot`: ローカル Gateway 接続先 URL の返却
  - `/api/v10/users/@me/channels`: Bot からの DM チャンネル作成
  - `/api/v10/guilds/:guildId/roles`: ロールの取得・作成
  - `/api/v10/channels/:channelId`: チャンネルの取得、変更、削除
  - `/api/v10/guilds/:guildId/channels`（PATCH）, `/api/v10/guilds/:guildId/roles`（PATCH）: チャンネル（並び順、カテゴリー、`lock_permissions`）とロールの並び替え。ロールの位置は 1 から振り直し、`@everyone` は常に 0
  - `/api/v10/channels/:channelId/threads`, `/api/v10/channels/:channelId/messages/:messageId/threads`, `/api/v10/channels/:channelId/thread-members`, `/api/v10/channels/:channelId/threads/archived/*`, `/api/v10/guilds/:guildId/threads/active`: スレッドとフォーラムの投稿
  - `/api/v10/channels/:channelId/messages/:messageId/crosspost`, `/api/v10/channels/:channelId/followers`: お知らせのクロスポストとフォロー
  - `/api/v10/stage-instances`, `/api/v10/guilds/:guildId/voice-states/*`: ステージの開催と発言の許可
  - `/api/v10/channels/:channelId/invites`, `/api/v10/guilds/:guildId/invites`, `/api/v10/invites/:code`: 招待の作成、取得、削除。`/api/mock/invites/:code/accept` でダミーユーザーが招待から参加する
  - `/api/v10/channels/:channelId/webhooks`, `/api/v10/guilds/:guildId/webhooks`, `/api/v10/webhooks/:id(/:token)`: ウェブフックの作成、取得、変更、削除、実行。トークンの付いた URL は Mock のトークンなしで使え、トークンのない URL には Mock のトークンが要る。インタラクションの応答と同じ形の URL は、アプリケーションの ID かどうかで区別する
  - `/api/v10/guilds/:guildId`（PATCH）: サーバーの名前、アイコン、説明、システムメッセージ、通知、安全設定の変更。画像は data URI で受け取り、Mock の中に保持する
  - `/api/v10/guilds/:guildId/audit-logs`: 監査ログ。操作者は API では Bot、画面とテストでは指定またはログイン中のユーザーで、`X-Audit-Log-Reason` を理由として記録する
  - `/api/v10/guilds/:guildId/members/:userId`（PATCH / DELETE）, `/api/v10/guilds/:guildId/bans`, `/api/v10/guilds/:guildId/bulk-ban`: メンバーの変更、キック、BAN。`channel_id` でボイスチャンネルの移動と切断（`null`）を行う。BAN 中のユーザーは招待で参加できない
  - `/api/v10/guilds/:guildId/emojis`, `/api/v10/guilds/:guildId/stickers`, `/api/v10/stickers/:stickerId`: 絵文字とスタンプ（ブーストなしの上限）
  - `/api/v10/guilds/:guildId/auto-moderation/rules`: AutoMod。キーワードとメンションスパムのルールを、Bot 以外のメッセージに適用する（ブロック、通知、タイムアウト）。スパム、プリセット、プロフィールのルールは保存だけで判定しない
  - メッセージの添付ファイル（Bot のマルチパートの `files[n]`、画面からの base64）は `/attachments/:channelId/:attachmentId/:filename?hm=<署名>` で配信する。上限は 1 メッセージ 10 個、1 個 10MB
  - `/api/mock/guilds/:guildId/reset`: サーバーを初期データと同じ状態に戻す。チャンネル（メッセージを含む）、ロール、権限、絵文字、スタンプ、AutoMod、BAN、設定を消して初期データを入れ直す。名前、アイコン、説明とメンバーは残す
  - `/api/mock/guilds/:guildId/reset-messages`: サーバーのメッセージ、スレッド、添付だけを消す。チャンネル、ロール、権限などは残す
  - メッセージの `poll`（投票）と、`/api/v10/channels/:channelId/polls/:messageId/answers/:answerId`（投票者）、`/api/v10/channels/:channelId/polls/:messageId/expire`（終了）。終了すると結果のメッセージ（`type: 46`）を送り、期限の切れた投票は 1 分ごとに終了する。ユーザーの投票は `/api/mock/channels/:channelId/polls/:messageId/votes` と `actor.vote` で行い、`MESSAGE_POLL_VOTE_ADD` / `REMOVE` を配信する。DM の投票の投票者は `/api/mock/state` に含めない
  - `/api/mock/interact`: スラッシュコマンド、ユーザーコマンド（Application Command）およびコンポーネント（ボタン、セレクト）のインタラクション受付。Bot が時間内に応答しなければ 408、Bot が Gateway に接続していなければ待たずに 503 を返す。ボタンなどから開いたモーダルの送信は、Discord と同じく開いたチャンネルで行い、開いたメッセージを `message` に入れる
  - `/api/mock/switch-user`: 操作ダミーユーザーの動的切り替え
  - `/api/mock/guilds/:guildId`, `/api/mock/guilds/:guildId/roles`, `/api/mock/channels/:channelId`: サーバー、ロール、チャンネルの権限の変更
  - `/api/mock/state` & `/api/mock/reset`: モック内部状態の取得および初期化
  - `/api/mock/traffic?after=<位置>`: 直近 2000 件の Bot の通信のうち、位置より後のもの。`after` を省略すると今の位置だけを返す
  - `/api/mock/projects`, `/api/mock/projects/start`, `/api/mock/projects/stop`: Bot プロジェクトの登録、起動、停止
  - `/api/mock/folders`: Bot プロジェクトのフォルダーの選択に使う、フォルダーの一覧の取得
- **Gateway WebSocket エミュレーション**:
  - Opcode 1 (Heartbeat), Opcode 2 (Identify), Opcode 4 (Voice State Update), Opcode 10 (Hello) のハンドシェイク
  - イベントディスパッチ:
    - `READY`: 初期接続時のギルド・ユーザー情報配信
    - `MESSAGE_CREATE`: メッセージ受信通知
    - `INTERACTION_CREATE`: スラッシュコマンドやボタン押下イベントの Bot への配信
    - `VOICE_STATE_UPDATE`: ボイスチャンネルの接続・切断通知
    - `VOICE_SERVER_UPDATE`: Bot への音声接続先の通知
    - `GUILD_UPDATE`、`GUILD_AUDIT_LOG_ENTRY_CREATE`、`GUILD_BAN_ADD` / `GUILD_BAN_REMOVE`、`GUILD_EMOJIS_UPDATE`、`GUILD_STICKERS_UPDATE`、`AUTO_MODERATION_RULE_*` / `AUTO_MODERATION_ACTION_EXECUTION`、`INVITE_CREATE` / `INVITE_DELETE`、`WEBHOOKS_UPDATE`
    - `CHANNEL_CREATE` / `CHANNEL_UPDATE` / `CHANNEL_DELETE`、`THREAD_CREATE` / `THREAD_UPDATE` / `THREAD_DELETE` / `THREAD_MEMBERS_UPDATE` / `THREAD_MEMBER_UPDATE`、`STAGE_INSTANCE_CREATE` / `STAGE_INSTANCE_UPDATE` / `STAGE_INSTANCE_DELETE`
  - Bot 側のソースコード変更なし（透過的）での WebSocket 接続。
- **Voice Gateway & UDP エミュレーション**:
  - Discord の公開ドキュメントの Voice Gateway（v8）と UDP の IP Discovery を提供し、Bot が送信した音声を受信する。暗号化は `aead_aes256_gcm_rtpsize` で、DAVE は使わない。
  - UDP は Mock と同じアドレスにだけバインドする。ポートは自動で割り当てる。
  - `VOICE_SERVER_UPDATE` の接続先は `host:port/voice` で、Voice Gateway の接続には接続ごとのトークンを検証する。
  - `/api/mock/voice`: Bot の接続状態の取得
  - `/api/mock/voice/audio`: 画面への PCM の配信

### 2.2.1. チャンネルタイプ要件
- サーバーはコミュニティサーバーとして扱う（`features` に `COMMUNITY` と `NEWS`）。初期データにはルールとモデレーター用のチャンネルを設定する。
- Discord の公開ドキュメントのすべてのチャンネルタイプを扱う。`bot.channels.create` と `seed` の `type` に指定できる。

| `type` | 種類 | 動作 |
|---|---|---|
| `text` | テキスト | メッセージとスレッド |
| `dm` | DM | Bot とユーザーの 1 対 1 |
| `voice` | ボイス | 接続と音声 |
| `group_dm` | グループ DM | 参加者だけが閲覧できる。Mock に OAuth はないので、API の `access_tokens` にはダミーユーザーの ID を渡す |
| `category` | カテゴリー | チャンネルをまとめる。削除すると配下のチャンネルはカテゴリーなしになる |
| `announcement` | お知らせ | クロスポストとフォロー。フォローは、フォロー先のチャンネルのチャンネルフォローのウェブフック（`type: 2`）として持つ |
| `announcement_thread`, `public_thread`, `private_thread` | スレッド | `parent` に親のチャンネルを指定する。権限は親のチャンネルに従う |
| `stage` | ステージ | 開催、終了、聴衆としての参加、発言の許可 |
| `directory` | ディレクトリ | 作成と表示だけで、メッセージは送信できない |
| `forum`, `media` | フォーラム、メディア | 投稿はスレッドで、最初のメッセージの ID はスレッドの ID と同じ。チャンネルに直接メッセージは送信できない |

- アーカイブされたスレッドはメッセージの送信で元に戻る。ロックもされていると送信できない。

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
| `pnpm app` | ビルドして Mock を起動する。Bot は管理画面のボタンで起動する。Ctrl+C で終了する |
| `pnpm test:run` | 起動中の Mock に対して全テストを実行して終了する。CI などに使う |
| `pnpm desktop` | 配布版と同じ 2 つのウインドウで Mock を起動する |
| `pnpm dist` | 配布用の Mock を `release/` に作る |

- 配布用のビルドは、Linux（Ubuntu、NixOS）はシェルスクリプト、Windows は exe、Mac は app とする。どれもブラウザを使わず、画面とターミナルの 2 つのウインドウ（Electron）で開く。Mock はウインドウのプロセスが Electron を Node として子プロセスで起動し、ターミナルのウインドウに Mock と Bot の出力を表示する。
- どちらかのウインドウを手前に出すと、もう一方も手前に出す。重なっているときは操作したほうを上にする。大きさは辺と四隅で変えられる。どちらかを閉じると終了する。
- 表示するディスプレイを管理画面で選べ、終了したときのディスプレイと位置を保存して次の起動で使う。位置のリセットでメインのディスプレイの既定の位置に戻す。この項目はブラウザで開いた画面には表示しない。
- 管理画面の「アップデートを確認」を押したときだけ、GitHub の Releases の最新版を問い合わせる。Windows の配布版は、ダウンロードした配布物を GitHub のアセットの SHA-256 と照合して展開し、終了してから exe のフォルダーを上書きして起動し直す（`data` と `media` は残す）。Mac と Linux は Release のページを開く。この項目もブラウザで開いた画面には表示しない。
- 同梱の Electron が動かない NixOS では、PATH の `electron` か `nix-shell` の Electron を使う。Linux は `--no-window` でウインドウなしでも起動できる。管理画面から起動する Bot には、インストールされた Node を使う。Windows の Mock に WSL のフォルダー（`\\wsl.localhost\<ディストリビューション>\...`）を登録したときは、`wsl.exe` で WSL の中でエージェントを起動し、Node は WSL の PATH か、フォルダーから親へ探した `shell.nix` の nix-shell のものを使う。WSL から Windows の `127.0.0.1` に届く必要がある（WSL の mirrored ネットワーク）。

起動エラー（Mock に接続できない、トークンが一致しない、Bot や DB の準備に失敗した）が発生すると、`pnpm test` は終了する。`pnpm app` は Mock を起動できないときだけ終了し、Bot の起動エラーは管理画面に表示する。テストの失敗は起動エラーではない。

Mock の起動時に Bot は起動しない。登録したプロジェクトの Bot は、管理画面の全起動または起動のボタンが押されたときに初めて起動する。確認のために Bot を起動することはなく、接続する 1 つの Bot だけを起動する。他の Bot の起動エラーは、そのプロジェクトへ切り替えたときに分かる。

### 2.3.1. テストの実行
- Mock は Bot やテストのプロセスを直接起動しない。testClient のエージェントがテストケースの一覧を Mock に登録し、画面の指示を受けてテストを実行する。
- 管理画面で Bot プロジェクト（ラベルとフォルダーの絶対パス）を 1 行ずつ登録できる。Mock はそのフォルダーにインストールされた `@dismock/test` のエージェントを起動する。全起動は登録したすべてのプロジェクトをテストの一覧に出し、先頭の Bot を接続する。行の起動はそのプロジェクトを起動する。起動中の testClient が扱うプロジェクトなら Bot だけを切り替え、一覧にないプロジェクトならそのプロジェクトだけで起動し直す。接続中の行は起動できない。行の停止は接続中の Bot だけを止め、テストの一覧は残す。全停止はエージェントと Bot を止める。接続できる Bot は 1 つ。
- Mock が起動したエージェントの起動エラーでは Mock を終了せず、管理画面にエラーを表示する。ラベルは画面のプロジェクトの一覧に表示する。`pnpm test` の testClient が接続している間は、画面から起動できない。
- エージェントは選択中のプロジェクトの Bot を接続したままにし、テストはその Bot のプロセスの中で実行する。画面でプロジェクトを切り替えると、そのプロジェクトの Bot に接続を切り替える。
- テストごとの初期化は行わない。テストは今のダミーデータ、メッセージ、DB の上で実行し、結果は Mock を再起動するまで残る。
- テストは、指定がなければログイン中のユーザーで実行する。`seed` で追加したユーザーは操作に使わない。別のユーザーで実行するときは `users` に `'login'`、ID、ユーザー名、またはそのリストを指定する。リストのときは `actors` で全員の `Actor` を受け取り、`user` と `actor` は先頭のユーザーになる。
- チャンネルは画面で開いているチャンネルで、CLI から実行したときは最初のテキストチャンネルとする。`seed` でチャンネルを指定すると、追加したチャンネルを使う。`seed` のデータの追加先も、開いているチャンネルのサーバーとする。
- 既定のダミーユーザー（`alice` は管理者、`bob` は権限なし）の ID は固定する。`users` の型は既定のユーザーを補完でき、`pnpm test` / `pnpm app` の起動中は各プロジェクトに `dismock-users.d.ts` を生成して、管理画面で追加したユーザーも補完できるようにする。テストが追加したユーザーは含めない。
- テストは開いているチャンネルのサーバーで完結させ、新しいサーバーを作らない。別のサーバーが必要なテストは ID を固定し、繰り返し実行しても増えないようにする（同じ ID のサーバー、チャンネル、ロールは使い回す）。
- 画面から実行したテストは、実行ごとの結果（成功、失敗、エラー、テスト中の Bot の通信）を Mock のメモリに保存する。Mock を再起動すると消える。保存するのは直近 100 回まで。通信は Bot が呼び出した REST API のリクエストとレスポンス、Bot へ配信した Gateway イベントで、DM の内容は伏せる。
- テストの区切りをチャンネルに表示する。区切りは画面だけのもので、Bot やテストには見えない。
- testClient は Mock の再起動を検知すると再接続し、Bot を起動し直す。これにより DB も空になる。
- カバレッジ: Bot のプロセスで V8 のカバレッジを取り、istanbul の形式で HTML とターミナルの表に出力する。テストのコード、`testClient.ts`、依存パッケージは含めない。CLI は `dismock test --coverage` で、HTML はプロジェクトの `coverage/` に書き出す。画面は「全て実行」の後にモーダルで保存するかを選び、保存すると Bot のプロセスが HTML を作って Mock へ送り、Mock が起動したファイル（exe、または `dismock-server.js`）と同じディレクトリの `coverage/<プロジェクト名>/` に書き出す（`--coverage` で場所を変えられる）。配布版はモーダルから既定のブラウザで開ける。画面から実行したときは、Bot の起動とその実行のテストで動いたコードを数える。

### 2.4. ダミーデータ & 永続化要件
- ダミーユーザー、チャンネル、ロール等は、テストコードと画面の両方から追加でき、どちらから追加しても同じデータとして扱う。サーバーとユーザーは管理画面で、チャンネル、ロール、メンバーのロールはサーバー内の画面で設定する。
- CLI で起動したときにダミーデータが 1 件もなければ、画面をすぐ操作できる初期データを投入する。
- モックサーバー内の状態（ギルド、チャンネル、ユーザー、ロール、メッセージ、設定）はローカルの JSON ファイル（`data/discord-mock-state.json` 等）に自動シリアライズ・保存。
- 添付ファイルは、起動したファイル（exe、または `dismock-server.js`）と同じディレクトリの `media/<サーバーID>/<チャンネルID>/<添付ID>.<拡張子>` に保存する。DM は `<サーバーID>` の代わりに `@me` とする。`--media` で場所を変えられる。メッセージ、チャンネル、サーバーを削除すると添付も消す。
- `pnpm web` と `pnpm app` の起動時に、画面で作ったもの（サーバー、チャンネル、カテゴリー、ロール、ユーザー、絵文字、スタンプ、AutoMod のルール、ウェブフック、招待）と初期データは残し、画面での変更も引き継ぐ。テストや Bot が作ったもの、メッセージ、スレッド、添付ファイル、ボイスの接続、投票、監査ログ、BAN、登録済みコマンドは消去する。トークン、Bot のユーザー、Bot プロジェクトも残す。添付は Mock が作ったサーバーと DM のフォルダーだけを消す。
- 画面からのリクエストにはヘッダー `x-dismock-origin: web` を付け、そのとき作ったものの ID を状態の `kept` に記録する。テストの SDK はこのヘッダーを送らない。初期データも `kept` に入れる。管理画面の「すべてリセット」は `kept` を含めてすべて消す。

### 2.5. ログイン & 操作主体要件
- テスト画面ではダミーユーザーを選択してログインする。
- コマンドの実行者やボタンの押下者など、操作の主体はログイン中のダミーユーザーとする。

### 2.6. ボイスチャンネル要件
- 音声は、Bot とログイン中のダミーユーザーが同じボイスチャンネルにいるときだけ流れる。
- 例: Bot がボイスチャンネル A で音楽を流す機能を持つ場合
  1. Bot がボイスチャンネル A に接続する。
  2. ログイン中のダミーユーザーもボイスチャンネル A に接続すると、音声が流れる。
  3. ダミーユーザーが切断すると、音声が止まる。
- 流すかどうかは Mock が判定する。ブラウザのコーデックに依存しないよう、Mock が Opus を PCM にデコードして配信し、画面は Web Audio で再生する。
- Bot の Gateway が切断されると、Bot をボイスチャンネルから退出させる。

### 2.7. ダイレクトメッセージ (DM) 要件
- Bot はそれぞれのダミーユーザーに DM を送信できる。
- DM の内容は、宛先のユーザーでログインしたときだけ閲覧できる。`/api/mock/state` にも DM の内容は含めない。

### 2.7.1. 権限要件
- ユーザーの権限は、Discord の公開ドキュメントの手順で、ロールの権限とチャンネルのロールごとの上書きから求める。
- カテゴリーの中に作ったチャンネルは、権限の上書きを指定しなければカテゴリーの上書きを引き継ぐ。上書きがカテゴリーと同じチャンネルを「同期している」とし、画面でカテゴリーの上書きを変えると同期しているチャンネルも合わせる（Discord のクライアントと同じ）。Bot の API での変更はカテゴリーだけを変える。並び替えの `lock_permissions` で移動先のカテゴリーに同期できる。
- 求めた権限は、インタラクションの `member.permissions` と、ログイン中のユーザーの画面の表示に使う。テストの `actor` の操作を Mock が権限で拒否することはしない。Bot の権限の判定をテストできるようにするため。

### 2.8. Web UI 要件
- テスト画面、管理画面、DB Studio を提供する。各画面の要件は [DESIGN.md](DESIGN.md) を参照。

---

## 3. ライブラリ側（Client SDK & テストフレームワーク）の要件

ライブラリ側は、Bot 開発者が自身のコード（discord.js / drizzle 等）を修正することなく、直感的なテストやモック操作を実行するための SDK およびテストランナー群（`@dismock/client`, `@dismock/test`）です。

### 3.1. クライアント統合要件 (`testClient`)
- **コード変更ゼロでの透過的ルーティング**:
  - 本物の `Client` インスタンスを渡すだけで、REST API エンドポイントと Gateway URL を Mock サーバーへ自動差し替え。
  - `discord.js` の `Client` と `REST` の通信先は、テストの実行時に読み込むフック（`@dismock/client/register`）が Mock へ差し替える。Bot が自分で作成した `REST` も対象で、本物のトークンは使わない。
  - `client.login` に渡されたトークンで判定する。Bot がトークンをどこに保存していても（`.env`、ハードコード、JSON など）同じように扱う。引数がなければ discord.js の既定どおり `client.token` を使い、それもなければ `testClient` の `token` オプションを使う。Mock のトークンと一致すれば Mock へ接続し、どこにも指定がないか一致しなければ、送信せずに起動エラーにする。
  - `@discordjs/voice` の接続先は `wss://` 固定のため、フックが `ws://` に差し替える。
  - `Proxy` パターンを採用し、本物の `Client` メソッド（`on`, `isReady` 等）と Mock 操作メソッド（`as`, `seed`, `messages` 等）の双方を同一インスタンスから呼び出し可能。名前が重なる `users` などは Mock 操作を優先し、本物は `bot.client` から使う。
- **重複定義の排除（設定の一本化）**:
  - `testClient` のオプションに、モック URL（`mockUrl`）、認証トークン（`token`）、テーブルの作成（`setupDb`）、コマンド定義（`commands`）、全テスト共通の初期データ（`seed`）をまとめて指定可能。
  - URL とトークンは、オプション、環境変数（`DISMOCK_URL`, `DISMOCK_TOKEN`）、`data/discord-mock-state.json` の順に優先する。JSON はカレントディレクトリから親へ順に探す。
  - `testClient` を定義するだけでグローバルに登録され、runner との二重定義は発生しない。テストランナーは `testClient.ts`（ルート、`__tests__/`、`tests/`、`test/`）を自動で読み込む。モノレポでルートにないときは、テストのあるパッケージから探し、そのパッケージをプロジェクトとして実行する。
- **利用スタイルの両立**:
  - `testClient.ts` では `import * as disMock from '@dismock/client';` で読み込む。
  - 引数注入型: `export const testClient = disMock.testClient(realClient, options);`
  - クラス継承型: `export class MyTestBotClient extends disMock.TestClient { ... }`
  - エントリー指定型: `export const testClient = disMock.testClient({ entry: 'src/index.ts' });`。`Client` を公開していない Bot でも、変更せずにテストできる。読み込みの後で `login` する Bot（Sapphire の `client.start()` など）は `login` を待ち、Sapphire はコマンドの登録の完了も待つ。

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
- **PostgreSQL のスキーマ**: `public` 以外のスキーマ（Drizzle の `pgSchema` など）のテーブルも扱い、`rows`、`seed`、DB Studio では `スキーマ.テーブル` の名前で表す。
- **テーブルの作成**: `setupDb` で Bot のプロセスごとに 1 回だけ行う。データはテストの間で残り、Bot を起動し直すと空になる。Drizzle のスキーマがあれば `createTables(schema)` で作成でき、`schemaSql(schema)` で SQL を確認できる（`pg`, `mysql`, `sqlite`）。
- **DB Studio への送信**: DB は Bot やテストのプロセスのメモリ上にあるため、それぞれのプロセスが内容を Mock へ送る。接続中の Bot は変化があったとき（1 秒ごとに確認）、画面から実行したテストはテストの終了時に送る。テーブルごとに先頭 1000 行までを送る。
- **既知の制約**:
  - MySQL は SQL を変換して SQLite で実行するため、変換に対応していない MySQL 固有の構文はエラーになる。型の厳密さも SQLite に準じる。
  - 接続は実質 1 本で、同時に複数のトランザクションは実行できない。`pg` は Bot の接続がトランザクションを始めると、終わるまで他の SQL（テストのコード、DB Studio、Bot の別の接続）を待たせ、トランザクションに入り込んで一緒にロールバックされないようにする。待つのは 10 秒までで、過ぎるとエラーにする。
  - Sheets は値の読み書きとシートの追加、削除、改名に対応し、数式の計算や書式は対象外。

### 3.3. テストランナー & テスト DSL 要件 (`@dismock/test`)
テストファイル（`__tests__/*.test.ts`）を直感的・宣言的に記述できるカスタム DSL を提供：
- **パッケージ直インポート**:
  - `import { test, describe, expect } from '@dismock/test';` で呼び出し可能。
  - テストファイル側で `runner` を分割エクスポート・インポートする冗長なコードは不要。
- **テストオプション & コンテキスト注入**:
  - テストは `test(name, options, fn)` の形で定義し、`options` は必須とする（`test.each` を除く）。指定するものがなければ `{}` を渡す。
  - 書いている途中の `async ({})` でも、引数の補完にはコンテキストの値だけを表示する。
  - `users`: テストを実行するユーザー。省略時と `'login'` はログイン中のユーザー。テスト開始時に Bot を Mock Gateway へ自動でログインさせる。
  - テスト関数と `beforeEach` などのフックに `{ bot, user, actor, guild, channel, seeded, db, traffic }` を自動注入。
  - Jest と同じ `describe` / `test` / `it`、`beforeAll` / `afterAll` / `beforeEach` / `afterEach`、`.skip` / `.only` / `.todo` / `.each` を提供する。テストは `dismock test` で実行する。
- **Actor (ダミーユーザー操作)**:
  - `actor.sendMessage(text)`: テストを実行するユーザーとしてメッセージ送信し、Bot のイベントリスナーを発火。
  - `actor.command(name, options)`: スラッシュコマンドを実行し、Bot からの応答（Embed, ボタン, `interaction_metadata`）を受信・アサート。
  - `actor.userCommand(name, target)`: ユーザーコマンドを実行し、Bot からの応答を受信・アサート。
  - `actor.click(message, customId)` / `actor.select(message, customId, values)`: メッセージのボタンを押す、セレクトメニューを選択する。結果の `message` は操作したメッセージの応答後の状態、`reply` は Bot が新しく送ったメッセージ、`modal` は開いたモーダル（`submitModal` の `message` は、ボタンなどから開いたモーダルのときのそのメッセージ）。Components V2 のコンテナやセクションの中のものも操作できる。ユーザー、ロール、メンション可能、チャンネルのセレクトでは、選んだものを `resolved` に入れる。
  - 操作のオプション `waitForReply: false`: Bot が defer した時点で `kind: 'deferred'` として戻る。既定では defer の後も応答の内容が届くまで待つ。
  - `watchModal(fn, durationMs)`: `fn` の中の操作で開いたモーダルを、テスト画面に `durationMs` だけ表示し、`fn` の結果を返す。囲んでいない操作のモーダルは画面に表示しない。テストは表示の終わりを待たない。
- **Bot 状態操作 & アサーション (`bot`)**:
  - `bot.users.create()` / `bot.channels.create()` / `bot.roles.create()` / `bot.guilds.create()`: ダミーデータの動的生成。
  - `bot.seed({ guilds, roles, channels, users, db })`: 初期データの一括投入。ロールやチャンネルは名前で参照できる。テストの `seed` オプションでも指定できる。
  - Bot 固有のデータの読み書きは、`TestClient` を継承してメソッドを追加する。
  - `bot.as(otherUser)`: 別のユーザー視点に切り替えてコマンドやメッセージを実行。
  - `bot.messages(channelId?)` / `bot.botMessages(channelId?)`: メッセージ履歴の取得。DM は `actor.dms()` でのみ取得できる。
  - `reply.fetch()` / `bot.followUps(reply)`: メッセージの最新の状態と、応答に続くフォローアップの取得。
  - `bot.voiceStatus(guildId)`: Bot のボイスチャンネルへの接続状態と、受信した音声のフレーム数の取得。
  - テストの引数の `traffic`: そのテストが始まってからの Bot の通信（REST API の呼び出しと Gateway のイベント）。テストの開始時に Mock の記録の位置を控え、テストごとに新しく始まる。各メソッドは呼び出した時点の通信を読む非同期で、`expect.poll` に渡せる。API を知らなくても使えるよう、`sentMessages`、`editedMessages`、`messageWith(customId)`、`openedModals`、`submittedModals`、`clickedButtons`、`selections`、`errors` で取り出せる。それ以外は `rest(method?, path?)` と `gateway(event?)` で絞り込む。インタラクションの応答で作ったメッセージは、Bot が `with_response` を付けなくても通信の記録に残す（Bot への応答は 204 のまま）。
- **時刻の固定**:
  - `clock.set(time)` / `clock.reset()`: `@dismock/test` から読み込む。テストは Bot と同じプロセスで動くので、Bot の `new Date()` と `Date.now()` にも効く。変えるのは `Date` だけで、タイマーは本物のまま動き、時刻は設定した時刻から進む。テストが終わるとランナーが本当の時刻に戻す。
- **テストの間の値の受け渡し**:
  - `store.push(key, value)` / `store.get(key)`: `@dismock/test` から読み込む。Bot のプロセスのメモリに保存し、画面から別々に実行したテストの間でも残る。Bot を起動し直すと消える。
- **Jest 互換のアサーションヘルパー**:
  - `expect.poll(() => condition).toBe(...)` による非同期イベント発火待ち。
  - `expect.stable(() => value)` による、値が変わらなくなることの確認。
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
- DB の処理を含むサンプルコードには、実行前と実行後の DB の内容を表で添える。読み取りだけのサンプルは内容を 1 つの表で示し、変わらないことを書く。TSDoc の `@example` では言語を `table` にしたコードブロックに Markdown の表を書く。
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
- ドキュメントサイトの公開先
