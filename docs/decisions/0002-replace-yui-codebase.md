# ADR-0002: リポジトリ内の既存コード（Yui 雪かき）を全削除して置き換える

- 日付: 2026-11-03
- 状態: 採用

## 背景

リポジトリ neuronest-jp/yui には、別プロダクト「Yui（雪かき助け合い）」のコード（apps/api, apps/web, CI）が入っていた。
ハッカソンのルール上、期間前に書かれたコードは持ち込めない。

## 決定

開発者の選択（選択肢 a）に従い、既存の apps/, package.json, pnpm-lock.yaml, .github, README を削除し、
「そういえば。」をルートから新規に構成する。wrangler.toml、CI 設定も流用せず書き直す。
LICENSE（MIT, Neuronest）と .editorconfig、.gitignore は設定ファイルとして残す。

## 影響

- 既存の D1 `yui`（database_id 設定済み）は流用しない。D1 は `souieba` として新規作成する
- 旧コードは git 履歴から参照できる
