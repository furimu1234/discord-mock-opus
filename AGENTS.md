# AGENTS.md

このリポジトリで作業する開発者・コーディングエージェント向けの指針です。

## プロジェクト概要

Discord Bot のテストを自動化するための Discord モックです。Bot を本物の Discord に接続せず、自分の環境で動くモックサーバーに接続してテストします。CLI で起動すると URL が発行され、ブラウザで開いて使います。

## ドキュメントの役割

| ファイル | 内容 |
|---|---|
| AGENTS.md | 作業の指針、守るべき制約、開発コマンド |
| [CLAUDE.md](CLAUDE.md) | 機能の要件（サーバー、プロトコル、ライブラリの動作） |
| [DESIGN.md](DESIGN.md) | 画面のデザイン要件（表示と操作） |

同じ内容を複数のファイルに書かず、他のファイルの内容はリンクで参照してください。

## 開発環境

すべてのコマンドは `nix-shell` の中で実行してください。VS Code の統合ターミナルは [.vscode/settings.json](.vscode/settings.json) の設定により、開くと自動で `nix-shell` に入ります。Node.js、pnpm、Python は [shell.nix](shell.nix) で固定しています。pnpm のストア、キャッシュ、一時ファイルは `.local/` に、Python の仮想環境は `.venv/` に置きます。

```sh
nix-shell
pnpm install
pnpm build       # apps と packages をビルドする
pnpm web         # Mock を起動する（既定は 127.0.0.1:6470）
pnpm test        # 起動中の Mock に testClient を接続し、テスト画面からの実行を待つ
pnpm app         # Mock と testClient の両方を起動する。Ctrl+C で終了する
pnpm test:run    # 起動中の Mock に対して全テストを実行して終了する
pnpm typecheck   # 型チェック
```

`pnpm web` と `pnpm app` は、ブラウザで開く URL をターミナルに表示します。起動のたびにトークン以外のデータは消去されます。`pnpm test` と `pnpm test:run` には起動中の Mock が必要です。`pnpm test:run` は testClient と Bot が重ならないよう、`pnpm web` だけを起動した状態で実行してください。

トークンは `data/discord-mock-state.json` に保存され、画面の URL にも含まれます。`data/` はコミットせず、URL も共有しないでください。

`examples/*` のテストは `packages/*/dist` を参照します。`apps` や `packages` を変更したら、ビルドしてからテストしてください。

## 現在の状態

実装済みのものと未実装のものは次のとおりです。

- 実装済み: REST API と Gateway のエミュレータ、`testClient`、テストランナーとテスト DSL、インメモリ DB（pg、mysql、sqlite、スプレッドシート）、Web UI（テスト画面、管理画面、DB Studio）
- 未実装: 音声の送受信（`VOICE_SERVER_UPDATE` と Voice Gateway）、DB Studio での編集、Python 用ライブラリ

## 構成

| パス | パッケージ | 責務 |
|---|---|---|
| `apps/server` | `@dismock/server` | REST API と Gateway のエミュレータ、JSON への永続化 |
| `apps/web` | `@dismock/web` | テスト画面、管理画面、DB Studio（React、Vite）。Mock が同じ URL で配信する |
| `packages/client-js` | `@dismock/client` | `testClient`、インメモリ DB、`import` を差し替えるフック |
| `packages/test` | `@dismock/test` | テストランナー、テスト DSL、画面からの実行を受けるエージェント |
| `examples/sample-bot` | | Client を公開しない Bot。全機能の動作確認を兼ねる |
| `examples/exported-client-bot` | | Client を公開する Bot と CommonJS の動作確認 |
| `examples/leveling-bot` | | レベリング Bot。PostgreSQL と drizzle を使う実用的な例 |

## 絶対に守ること

根拠と詳細は [CLAUDE.md](CLAUDE.md) 2.1 にあります。

- SaaS として提供しません。マルチテナント、ホスティング、利用者登録につながる機能は追加しないでください。
- デフォルトのバインド先は `127.0.0.1` とし、`0.0.0.0` をデフォルトにしないでください。
- 本番の Discord に接続せず、外部通信も行わないでください。
- Discord の公開ドキュメントのみを根拠に実装し、非公開 API やクライアント内部をリバースエンジニアリングしないでください。

## 作業のルール

- Bot 側のソースコードを変更しなくても動くことを保ってください。`examples/*/src` は Bot のコードとして扱い、モックの都合で書き換えないでください。
- 機能を実装する前に、[CLAUDE.md](CLAUDE.md) の該当する節を確認してください。画面を実装する場合は [DESIGN.md](DESIGN.md) も確認してください。
- 実装で仕様が決まったら、[CLAUDE.md](CLAUDE.md) 6 章と [DESIGN.md](DESIGN.md) の未決定の事項を更新してください。
- 値をハードコーディングしないでください。規則と例外は [CLAUDE.md](CLAUDE.md) 5 章にあります。
