# dismock とは

dismock は、Discord Bot のテストを自動化するためのモックです。Bot を本物の Discord に接続せず、自分の環境で動く Mock に接続してテストします。

## できること

- Bot のソースコードを変更せずに、Mock へ接続する
- ダミーユーザーとして、メッセージの送信、スラッシュコマンド、ボタン、セレクトメニュー、モーダルを操作する
- Discord そっくりの画面で、テストの実行と結果の確認を行う
- Bot が使う DB をインメモリの DB に置き換え、内容を DB Studio で確認する
- ダミーユーザーでログインして、そのユーザー宛ての DM を確認する

## 構成

| パッケージ | 役割 |
|---|---|
| `@dismock/server` | Discord の REST API と Gateway のエミュレータ、Web UI の配信 |
| `@dismock/client` | `testClient`、インメモリ DB、`import` を差し替えるフック |
| `@dismock/test` | テストランナー、テストの DSL、画面からの実行を受けるエージェント |

```text
Bot とテスト ── REST / Gateway ──▶ Mock ◀── HTTP ── ブラウザ
（testClient）                  （127.0.0.1）        （テスト画面）
```

Mock はプロセスを起動しません。testClient のエージェントが Mock に接続し、画面の指示を受けて、Bot のプロセスの中でテストを実行します。

## 対応していないもの

- 音声の送受信（ボイスチャンネルの接続状態は扱えますが、音声そのものは流れません）
- DB Studio でのデータの編集
- Python 用のライブラリ
- discord.js 以外のライブラリの Bot

## 制約

Mock は SaaS として提供しません。自分の PC か、自分の管理下にある VPS でのみ起動してください。理由は[セキュリティ](./security.md)を参照してください。

dismock は Discord Inc. とは関係のない非公式のプロジェクトです。Discord の公開ドキュメントのみに基づいて実装しています。
