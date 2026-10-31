# コマンド

## リポジトリのコマンド

| コマンド | 動作 |
|---|---|
| `pnpm web` | Mock を起動する |
| `pnpm test` | 起動中の Mock に testClient を接続し、画面からの実行を待つ |
| `pnpm app` | Mock と testClient の両方を起動する。Ctrl+C で終了する |
| `pnpm test:run` | 起動中の Mock に対して全テストを実行して終了する。CI などに使う |

`pnpm web` と `pnpm app` は、起動のたびにトークン以外のデータを消去します。

`pnpm test:run` は testClient と Bot が重ならないよう、`pnpm web` だけを起動した状態で実行してください。

## dismock-server

Mock を起動します。

| オプション | 既定値 | 内容 |
|---|---|---|
| `--host` | `127.0.0.1` | バインド先 |
| `--port` | `6470` | ポート |
| `--data` | `data/discord-mock-state.json` | 状態を保存する JSON |
| `--token` | `DISMOCK_TOKEN` の値 | Mock のトークン |

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
dismock test [ファイル名の一部...] [-t テスト名] [--setup testClient.ts]
dismock agent <プロジェクトのディレクトリ...>
```

### dismock test

カレントディレクトリのテストを実行して終了します。

| 引数 | 内容 |
|---|---|
| ファイル名の一部 | 名前に含むテストファイルだけを実行する |
| `-t`, `--testNamePattern` | 名前が正規表現に一致するテストだけを実行する |
| `--setup` | `testClient.ts` のパス |

テストが失敗すると 0 以外の終了コードを返します。起動エラーは別の終了コードで区別します。

### dismock agent

指定したプロジェクトのテストケースを Mock に登録し、画面の指示を受けて実行します。Mock の再起動を検知すると再接続し、Bot を起動し直します。
