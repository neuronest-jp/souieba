# そういえば。

日々のちょっとした出来事を、ひとことと写真1枚で残しておく。
あとで新しいひとことを書いたとき、関係のある昔の記憶が「そういえば。」と静かに浮かんでくる。

Built with Claude: Japan 2026 ハッカソン向けの個人開発です。

## 大切にしていること

- AI の推測を事実として確定しない。出てくるのはいつも「候補」で、決めるのはあなた
- 関係なければ何も言わない。「そういえば」が出ない日があっていい
- 思い出すときは、必ず昔のひとことの原文を添える

## 仕組み

- Cloudflare Workers + Hono + D1 + R2。画面（Vue 3 + Vite + Tailwind）も同じ Worker から配信
- ログインは Cloudflare Access（メールに届く確認コード）
- 記憶の想起と候補の抽出は Claude（Anthropic API）。JSON Schema で形を固定し、引用が原文にあるかを Worker 側で検証

## ドキュメント

| ファイル | 内容 |
|---|---|
| docs/spec.md | 仕様書 |
| docs/requirements.md | 機能要件と受け入れ条件 |
| docs/architecture.md | アーキテクチャ、データモデル、デザイン基盤 |
| docs/wireframes.md | 主要画面のワイヤーフレーム |
| docs/tasks.md | 実装タスク一覧 |
| docs/setup-cloudflare.md | Cloudflare（Access / D1 / R2 / secret）の手順 |
| docs/decisions/ | 判断の記録（ADR） |
| demo/fixtures/ | デモ4シナリオのフィクスチャ |

## 開発

```sh
pnpm install
cp .dev.vars.example .dev.vars   # ANTHROPIC_API_KEY などを手で書く（git には入れない）
pnpm db:migrate:local
pnpm dev                         # http://localhost:8787
```

ローカルでは `X-Dev-User: you@example.com` ヘッダでログイン相当になります（画面は自動で付けます）。

## デプロイ

docs/setup-cloudflare.md を参照。

```sh
pnpm db:migrate:remote
pnpm deploy
```

## ライセンス

MIT
