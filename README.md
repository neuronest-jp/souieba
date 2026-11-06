# そういえば。

日々のちょっとした出来事を、ひとことと写真1枚で残しておく。
あとで新しいひとことを書いたとき、関係のある昔の記憶が「そういえば。」と静かに浮かんでくる。

Built with Claude: Japan 2026 ハッカソン向けの個人開発です。

## 大切にしていること

- AI の推測を事実として確定しない。出てくるのはいつも「候補」で、決めるのはあなた
- 関係なければ何も言わない。「そういえば」が出ない日があっていい
- 思い出すときは、必ず昔のひとことの原文を添える

## 仕組み

- アプリ: Capacitor（iOS / Android）の中で Vue 3 + Vite + Tailwind の画面が動く。写真は端末のカメラかライブラリから
- API: Cloudflare Workers + Hono + D1 + R2。同じ Worker から画面も配信していて、ブラウザでの開発プレビューに使う（配布はアプリ）
- ログイン: 招待コードとメールアドレス。パスワードは無い。Worker が 90 日有効のトークン（HS256 JWT）を返し、アプリが端末に保持する
- 記憶の想起と候補の抽出は Claude（Anthropic API、既定 Claude Opus 5.5）。JSON Schema で形を固定し、引用が原文にあるかを Worker 側で検証

詳しくは docs/architecture.md と docs/decisions/0007-capacitor-and-invite-jwt.md。

## ドキュメント

| ファイル | 内容 |
|---|---|
| docs/spec.md | 仕様書 |
| docs/requirements.md | 機能要件と受け入れ条件 |
| docs/architecture.md | アーキテクチャ、データモデル、デザイン基盤 |
| docs/wireframes.md | 主要画面のワイヤーフレーム |
| docs/tasks.md | 実装タスク一覧 |
| docs/setup-cloudflare.md | Cloudflare（D1 / R2 / secret / deploy）の手順 |
| docs/setup-capacitor.md | iOS / Android アプリのビルドと確認の手順 |
| docs/decisions/ | 判断の記録（ADR） |
| demo/fixtures/ | デモ4シナリオのフィクスチャ |

## 開発

```sh
pnpm install
cp .dev.vars.example .dev.vars   # ANTHROPIC_API_KEY を手で書く（git には入れない）
pnpm db:migrate:local
pnpm dev:worker                  # Worker: http://localhost:8787
pnpm dev                         # 画面:   http://localhost:5173（/api は 8787 に中継）
```

ローカルの Worker は development として起動し、`X-Dev-User` ヘッダをログイン相当として受け付けます。
画面の開発サーバがこのヘッダ（既定は `X-Dev-User: dev@example.com`）を自動で付けるので、ブラウザではログイン画面を通らずに使えます（`DEV_USER=<メールアドレス> pnpm dev` で変更）。本番ではこのヘッダは無視されます。

ローカルの Worker には開発専用の招待コード `dev` が入っています（`pnpm dev:worker` が渡す既定値。`.dev.vars` に `INVITE_CODE` / `JWT_SECRET` を書けばそちらが優先）。
`pnpm preview`（画面を Worker から配信する本番と同じ形、http://localhost:8787）で開くと、ログイン画面に `dev` と好きなメールアドレスを入れて中に入れます（`=` の無い招待コードをどのメールでも受け付けるのは development だけ）。

### デモの状態で見る

既定の `dev@example.com` は記憶 0 件から始まります。想起は過去の記憶があるときだけ動くので、最初の 1 件では「そういえば。」は出ません。
デモ用の過去の記憶（`demo@example.com` の 16 件、2024〜2026）を入れて、そのユーザーで開きます。

```sh
pnpm db:migrate:local
pnpm db:seed:local                   # demo@example.com と other@example.com の D1 の行を消してから入れ直す
pnpm dev:worker
DEV_USER=demo@example.com pnpm dev   # fish なら env DEV_USER=demo@example.com pnpm dev
```

`pnpm preview` で開くときは、ログイン画面に招待コード `dev` とメールアドレス `demo@example.com` を入れます。
新しいひとことに「スーパーで青梅を見かけた」と書くと、2024 年のおばあちゃんの梅干しの記憶が札で出るはずです（`.dev.vars` の `ANTHROPIC_API_KEY` が要ります。札が出るか、その文面はモデルの出力しだい）。4 つのシナリオと seed の中身は demo/fixtures/README.md を参照。
seed は流すたびに `demo@example.com` と `other@example.com` の記憶を消して入れ直します。ふだんの作業は既定の `dev@example.com` のままにしてください。

### ログイン

本番では、招待コードとメールアドレスをアプリのログイン画面に入れます。招待コードは 1 人 1 つで、開発者がそのコードに結びつけたメールアドレスでしか入れません（`INVITE_CODE` は `コード=メール[,コード=メール…]` の対応表。docs/setup-cloudflare.md 4.1）。
Worker が 90 日有効のトークンを返し、アプリはそれを端末に保持して以降の呼び出しに付けます。トークンが切れたり無効になったりしたら、静かにログイン画面に戻ります。
招待コードは、その人のぶんだけを本人に直接伝えます。リポジトリや文書には書きません。

### アプリ（iOS / Android）

docs/setup-capacitor.md を参照。Mac で Xcode / Android Studio を使います。

```sh
printf 'VITE_API_BASE=%s\n' https://<api-domain> > web/.env.production   # アプリが叩く Worker の URL（git には入れない）
pnpm cap:sync        # 画面をビルドして ios/ と android/ に同期
pnpm cap:ios         # 同期して Xcode を開く
pnpm cap:android     # 同期して Android Studio を開く
```

## デプロイ

docs/setup-cloudflare.md を参照。

```sh
pnpm exec wrangler secret put ANTHROPIC_API_KEY
pnpm exec wrangler secret put INVITE_CODE     # コード=メール を人ごとに , でつなぐ（コードは openssl rand -hex 8）
pnpm exec wrangler secret put JWT_SECRET      # 32 文字以上（openssl rand -base64 48）
pnpm db:migrate:remote
pnpm run deploy     # pnpm deploy は pnpm 組み込みコマンドと衝突するため run を付ける
```

## ライセンス

MIT
