# コマンド

## リポジトリのコマンド

| コマンド | 動作 |
|---|---|
| `pnpm web` | Mock を起動する |
| `pnpm test` | 起動中の Mock に testClient を接続し、画面からの実行を待つ |
| `pnpm app` | ビルドして Mock を起動する。Bot は管理画面のボタンで起動する。Ctrl+C で終了する |
| `pnpm test:run` | 起動中の Mock に対して全テストを実行して終了する。CI などに使う |
| `pnpm desktop` | 配布版と同じ 2 つのウインドウで Mock を起動する |
| `pnpm dist [ターゲット...]` | 配布用の Mock を `release/` に作る。[配布用のビルド](#配布用のビルド)を参照 |

`pnpm web` と `pnpm app` は、起動のたびに、画面で作ったサーバー、チャンネル、ロール、ユーザーなどと初期データを残し、それ以外（テストで作ったもの、メッセージ、添付など）を消去します。

`pnpm test:run` は testClient と Bot が重ならないよう、`pnpm web` だけを起動した状態で実行してください。

## dismock-server

Mock を起動します。

| オプション | 既定値 | 内容 |
|---|---|---|
| `--host` | `127.0.0.1` | バインド先 |
| `--port` | `6470` | ポート |
| `--data` | `data/discord-mock-state.json` | 状態を保存する JSON |
| `--token` | `DISMOCK_TOKEN` の値 | Mock のトークン |
| `--media` | 起動したファイルと同じディレクトリの `media` | 添付ファイルの保存先 |
| `--web` | リポジトリの `apps/web/dist` | 画面のビルド結果。配布版が指定する |
| `--open` | なし | 起動後に画面をブラウザで開く |

`--host` を変更する前に、[セキュリティ](./security.md)を読んでください。

起動するとトークンを発行して JSON に保存します。JSON に値があるときは、そのトークンを使い回します。

トークンは自分で決めることもできます。指定した値は JSON に保存され、次回からは指定しなくても使われます。

```sh
pnpm web --token my-mock-token-0001
pnpm app --token my-mock-token-0001
DISMOCK_TOKEN=my-mock-token-0001 pnpm web
```

値は英数字、`-`、`_`、`.` で 16 文字以上にしてください。本物の Bot のトークンと同じ形式の値は起動エラーになります。

## dismock

```text
dismock test [ファイル名の一部...] [-t テスト名] [--setup testClient.ts] [--coverage]
dismock agent <プロジェクトのディレクトリ...>
```

### dismock test

カレントディレクトリのテストを実行して終了します。

| 引数 | 内容 |
|---|---|
| ファイル名の一部 | 名前に含むテストファイルだけを実行する |
| `-t`, `--testNamePattern` | 名前が正規表現に一致するテストだけを実行する |
| `--setup` | `testClient.ts` のパス |
| `--coverage` | 実行の後に、カバレッジの表をターミナルに出力し、HTML を `coverage/` に書き出す |

テストが失敗すると 0 以外の終了コードを返します。起動エラーは別の終了コードで区別します。

### dismock agent

指定したプロジェクトのテストケースを Mock に登録し、画面の指示を受けて実行します。Mock の再起動を検知すると再接続し、Bot を起動し直します。

## カバレッジ

テストで実行した Bot のコードの割合（行、文、関数、分岐）を、ターミナルの表と HTML で確認できます。テストのコード、`testClient.ts`、依存パッケージは含めません。TypeScript は元のファイルの行で数えます。

- **CLI:** `dismock test --coverage`、またはリポジトリのルートで `pnpm test:run --coverage` を実行します。
- **画面:** 「全て実行」の後に、カバレッジを保存するかを尋ねるモーダルが開きます。保存すると、プロジェクトの `coverage/` に HTML を書き出し、`pnpm test` や `pnpm app` のターミナルに表を出力します。

画面から実行したときのカバレッジは、Bot の起動と、そのとき実行したテストで動いたコードです。テストの合間に画面から操作した分は含めません。テストで一度も読み込まれなかったファイルは表に出ません。

## 配布用のビルド

`pnpm dist` で、リポジトリなしで動く Mock を `release/` に作ります。ターゲットを省略するとすべて作ります。

| ターゲット | 作るもの | 起動 |
|---|---|---|
| `linux-x64`, `linux-arm64` | `dismock-<版>-<ターゲット>.tar.gz` | 展開した `dismock/dismock` を実行する |
| `windows-x64`, `windows-arm64` | `dismock-<版>-<ターゲット>.zip` | `dismock.exe` をダブルクリックする |
| `mac-x64`, `mac-arm64` | `dismock-<版>-<ターゲット>.zip` | `dismock.app` を開く |

```sh
pnpm dist                       # すべて
pnpm dist linux-x64 windows-x64 # 指定したものだけ
```

### ウインドウ

配布版はブラウザを使わず、画面とターミナルの 2 つのウインドウを開きます（Electron）。

- ターミナルのウインドウには、Mock と、管理画面から起動した Bot の出力を表示します。
- どちらかのウインドウを手前に出すと、もう一方も手前に出ます。2 つが重なっているときは、クリックしたほうが上になります。
- ウインドウの大きさは、上下左右の辺と四隅をドラッグして変えられます。
- どちらかのウインドウを閉じると終了します。Mock は Bot に `RECONNECT` を送ってから止まります。
- 管理画面の「ウインドウ」で、ウインドウを表示するディスプレイを選べます。終了したときのディスプレイと位置を保存し、次の起動で使います。「位置をリセット」で、メインのディスプレイの既定の位置に戻します。この項目はブラウザで開いた画面には表示しません。
- 管理画面の「アップデート」で、新しい版を確認できます。GitHub に問い合わせるのは「アップデートを確認」を押したときだけです。
  - Windows では「アップデートして再起動」を押すと、配布物をダウンロードして GitHub が示す SHA-256 と照合し、dismock を終了して exe のフォルダーを新しい版で上書きし、起動し直します。`data` と `media` のフォルダーは残ります。exe のフォルダーに書き込めないとき（Program Files など）は使えません。
  - Mac と Linux では「Release のページを開く」から入手してください。

### OS ごとの違い

- **Linux:** 展開したディレクトリに、起動スクリプト、Electron、Node を入れます。状態は `data/`、添付は `media/` に保存します。
  - 同梱の Electron が動かない環境（NixOS など）では、PATH の `electron` を使い、なければ `nix-shell -p electron` で用意します。日本語のフォントがないときは、nixpkgs の Noto Sans CJK を加えます。
  - ウインドウの位置を指定できるよう、Wayland でも X11（XWayland）で開きます。
  - ユーザー名前空間が使えない環境（Ubuntu 24.04 など）では、Chromium のサンドボックスを使わずに起動します。
  - 画面のない環境では `./dismock --no-window` で起動し、表示された URL をブラウザで開きます。同梱の Node を使い、動かないときは PATH の Node か `nix-shell -p nodejs_<版>` を使います。
- **Windows:** 状態と添付は exe と同じフォルダーの `data\`、`media\` に保存します。署名がないので、初回は SmartScreen の確認が出ます。
- **Mac:** 状態と添付は `~/Library/Application Support/dismock/` に保存します。アドホック署名だけで公証を受けていないので、初回は「システム設定」→「プライバシーとセキュリティ」で許可するか、`xattr -dr com.apple.quarantine dismock.app` を実行します。

### ビルド

- Electron は `apps/desktop` の `electron` と同じ版を使い、`@electron/packager` がダウンロードします。
- Linux の `--no-window` で使う Node は、ビルドに使った Node と同じ版です。nodejs.org からダウンロードして `SHASUMS256.txt` のハッシュと照合し、`.local/node-dist/` に保存します。
- Mac の署名には `rcodesign` を使うので、`nix-shell` の中で実行してください。

### Bot の実行

配布版の Mock は、管理画面から Bot を起動するときに、インストールされた Node.js を使います。

Windows の Mock では、WSL のフォルダー（`\\wsl.localhost\Ubuntu\home\...` など）の Bot も起動できます。Windows からは pnpm の `node_modules` のシンボリックリンクをたどれず、依存も Linux 向けなので、Mock は `wsl.exe` で WSL の中で Bot を起動します。

- Node.js は WSL の `PATH` にあるものを使います。なければ、フォルダーから親へ順に探した `shell.nix` を `nix-shell` で読み込んで使います。
- Bot は WSL の中から Windows の Mock（`127.0.0.1`）に接続します。WSL のネットワークを mirrored にしてください（`%UserProfile%\.wslconfig` の `[wsl2]` に `networkingMode=mirrored`）。
- 一緒に起動できるのは、同じディストリビューションのフォルダーだけです。

Bot のプロジェクトからは、配布版の状態の JSON を探せません。`pnpm test` などを別に実行するときは、`DISMOCK_URL` と `DISMOCK_TOKEN` を指定してください。
