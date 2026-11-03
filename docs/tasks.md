# 実装タスク一覧

- 根拠: docs/spec.md 第14節（作成順と日程）、第4節（P0 / P1）、第11節（デモ4シナリオ）
- 受け入れ条件: docs/requirements.md の条件 ID（`F2-3`、`S-4`、`X-6`、`N-1` の形）を参照する
- 既定値: ADR-0003。デザイン: ADR-0004。D1 スキーマ: worker/migrations/0001_init.sql（変更しない）
- 粒度: 1〜2 時間。ID は `T-mmdd-nn`。状態は着手時に「進行中」「完了」「保留」に書き換える
- 1 日の持ち時間は 8 時間を上限とする。超える日は P1 を落とす

## 0. 開発者の判断が必要な項目（先に決める）

| # | 項目 | 必要になる日 | 内容 | 決まらない場合の既定 |
|---|---|---|---|---|
| J-1 | クレデンシャル投入 | 11/4 | `wrangler login`（Cloudflare）、`wrangler secret put ANTHROPIC_API_KEY`、ローカルは `.dev.vars` に `ANTHROPIC_API_KEY` と `ENVIRONMENT=development` を手で書く。Claude Code は `.dev.vars` に書けない | 投入されるまで AI 呼び出しは `ai_runs.status='failed'` で記録され、登録・一覧・削除だけ動く |
| J-2 | D1 / R2 の作成 | 11/4 | `wrangler d1 create souieba` の `database_id` を wrangler.toml に貼る。`wrangler r2 bucket create souieba-photos` | 現在の `database_id` はダミー。埋まるまで `db:migrate:remote` と本番 deploy は通らない |
| J-3 | ドメイン | 11/4 | Access で守るホスト名（例 `souieba.neuronest.jp`）。wrangler.toml に `routes`（custom_domain）を追加し `workers_dev = false` にする。Access の Self-hosted アプリをそのホスト全体に設定し、`ACCESS_TEAM_DOMAIN` と `ACCESS_AUD` を `[vars]` に書く | 当面は `souieba.<account>.workers.dev` を Access で守る（requirements S-10 の記述どおり）。architecture 3.3 の `workers_dev = false` は提出前の切替候補 |
| J-4 | 写真素材 | 11/7 | D3「公園の花」用に、開発者が権利を持つ花の写真（JPEG、10MB 以下）を `demo/photos/` に置く。ファイル名は `demo/photos/README.md` の案内に従う。D1 用の青梅、D4 用の自転車の写真は任意 | 写真なしで D3 を F4 の候補「場所: 公園」を「ちがう」にする代替手順（requirements 第7節）で通す |
| J-5 | モデル | 11/6 | `ANTHROPIC_MODEL` を `claude-sonnet-5-5` のまま行くか、想起の品質を見て `claude-opus-5-5` に上げるか | sonnet のまま。11/6 の T-1106-12 で判断材料を出す |
| J-6 | AI 出力の形 | 11/6 | 仕様 9 章は tool use、architecture 6.1 は `output_config.format`（json_schema）。`worker/src/ai/client.ts` を境界にして 1 か所で切り替えられるようにする。本番モデルで `tool_choice: {type:"tool"}` が通るかを T-1106-01 で実測して決める | 実測で通る方を採用。通らなければ json_schema |
| J-7 | API レスポンスの形 | 11/5 | requirements（`{status:"pending"|"done", facts:[…]}`、`recalled_by`）と architecture（`{pending:boolean, items:[…]}`）が違う。どちらかに寄せる | architecture 5 章の形（`pending` / `items`）に寄せ、`GET /api/memories/:id` に `recalled_by` を足す。requirements を追従させる |
| J-8 | 提出素材 | 11/9 | デモ動画の長さと形式（提出フォームの要件）、公開リポジトリにするか | 3 分以内の画面収録（スマホ縦）、音声なし字幕あり |

## 1. 全体の流れ

| 日 | 主眼 | 合計見積 | 終わりの確認 |
|---|---|---|---|
| 11/3 | ドキュメント（本書を含む） | 済 | `docs/` が揃う |
| 11/4 | 雛形、D1、デザイン基盤、`/api/health`、Access、deploy | 8.0h | 本番でログインして S1 が開く |
| 11/5 | F2 登録、F3 一覧・詳細・削除、写真 R2 | 8.0h | 書いて、一覧で見て、消せる |
| 11/6 | F4 候補抽出、F5 そういえば、引用検証 | 8.0h | D1（梅干し）と D2（電気代）が通る |
| 11/7 | F6 反応、デモ4本の通し、F7 写真候補 | 8.0h | 本番で D1〜D4 が通る |
| 11/8 | UI 磨き、エラー時の静かな振る舞い | 7.5h | スマホ実機で D1〜D4 が気持ちよく通る |
| 11/9 | F8 ふりかえり（余裕があれば）、README、デモ動画 | 7.5h | 動画が撮れている、機能凍結 |
| 11/10 | 提出 | 2.5h | 14:00 JST までに提出完了 |

備考: 11/3 のコミット a78ed8f に 11/4 スコープの雛形（package.json、wrangler.toml、vite.config.ts、`worker/src/access.ts` ほか、`web/src/style.css`）が先行して入っている。11/4 のタスクは「確認して仕上げる」作業になる。状態は本書の時点では未着手のまま。

## 2. 11/4 雛形から本番 deploy まで

| ID | タスク | 成果物 | 受け入れ条件 | 依存 | 見積(h) | 状態 |
|---|---|---|---|---|---|---|
| T-1104-01 | 雛形の確認と整合: `package.json`（scripts: dev / dev:worker / build / deploy / db:* / test / typecheck）、`wrangler.toml`（name `souieba`、assets、D1、R2、vars）、`vite.config.ts`（root `web`、`/api` proxy と `X-Dev-User`）、`worker/tsconfig.json`、`web/tsconfig.json`、`vitest.config.ts`。architecture 2.1 / 9.1 / 9.2 と突き合わせ、差分を直す | /home/user/yui/package.json, /home/user/yui/wrangler.toml, /home/user/yui/vite.config.ts, /home/user/yui/vitest.config.ts, /home/user/yui/worker/tsconfig.json, /home/user/yui/web/tsconfig.json | S-1, N-8, N-10 | なし | 1.0 | 未着手 |
| T-1104-02 | クリーン clone で `pnpm install && pnpm typecheck && pnpm test && pnpm build` が通ることを確認。`pnpm build` は `wrangler deploy --dry-run --outdir dist/worker` まで。`dist/` と `web/dist/` が gitignore されていることを確認 | （確認のみ。壊れていれば T-1104-01 の各ファイル） | S-1 | T-1104-01 | 0.5 | 未着手 |
| T-1104-03 | 【開発者】Cloudflare にログインし D1 `souieba` と R2 `souieba-photos` を作る。`database_id` を `wrangler.toml` に貼る（J-2） | /home/user/yui/wrangler.toml | N-10 | J-1, J-2 | 0.5 | 未着手 |
| T-1104-04 | D1 マイグレーション（ローカル）: `pnpm db:migrate:local` を 2 回実行し、5 テーブルと 2 回目が no-op であることを `wrangler d1 execute souieba --local --command "select name from sqlite_master where type='table'"` で確認 | /home/user/yui/worker/migrations/0001_init.sql（変更しない） | S-2 | T-1104-01 | 0.5 | 未着手 |
| T-1104-05 | D1 マイグレーション（リモート）: `pnpm db:migrate:remote` と `wrangler d1 migrations list souieba --remote` | （なし） | S-3 | T-1104-03, T-1104-04 | 0.5 | 未着手 |
| T-1104-06 | デザイン基盤: `web/src/style.css` の `@theme` に ADR-0004 の 10 色・フォント・サイズ・角丸トークン、`@layer base` の html/body、`.rise` アニメーション（600ms、`prefers-reduced-motion` で無効）。`web/index.html` の Google Fonts リンク（Zen Maru Gothic、Noto Sans JP、`display=swap`）。`.vue` に `#` 始まりの色がないことを grep で確認 | /home/user/yui/web/src/style.css, /home/user/yui/web/index.html | N-11, N-12, S-12 | T-1104-01 | 1.5 | 未着手 |
| T-1104-07 | `GET /api/health`: `{ ok, service:"souieba", version, time }`。認証なし。秘密を返さない。`worker/test/app.test.ts` で 200 と形を確認 | /home/user/yui/worker/src/index.ts, /home/user/yui/worker/test/app.test.ts | S-4 | T-1104-01 | 0.5 | 未着手 |
| T-1104-08 | Access JWT 検証（純粋ロジック）: `Cf-Access-Jwt-Assertion` を分割、`alg` は RS256 のみ、JWKS（`https://<team>.cloudflareaccess.com/cdn-cgi/access/certs`）を 10 分キャッシュし `kid` 不一致で 1 回だけ再取得、`crypto.subtle.verify`、`aud` / `iss` / `exp` / `nbf` / `email` を確認。`fetchJwks` は引数で差し替え可能にする | /home/user/yui/worker/src/access.ts | F1-1, F1-3, F1-4 | T-1104-01 | 1.5 | 未着手 |
| T-1104-09 | Access JWT のテスト: `crypto.subtle.generateKey` で RSA 鍵を作りテスト内で署名。`aud` 不一致・`iss` 不一致・`exp` 切れ・署名改ざん・`alg: none`・`email` なし・JWKS 取得失敗を全て拒否（401 側へ） | /home/user/yui/worker/test/access.test.ts, /home/user/yui/worker/test/helpers.ts | F1-2, F1-3, F1-4 | T-1104-08 | 1.0 | 未着手 |
| T-1104-10 | 認証ミドルウェア `requireUser`: `ENVIRONMENT === "development"` のときだけ `X-Dev-User`（`@` を含む簡易検証、小文字化）を受理。それ以外は JWT のみ（ヘッダがあっても無視）。両方あるときは JWT を優先。`users` に upsert（`created_at` / `last_seen_at`）。テストを `app.test.ts` に追加 | /home/user/yui/worker/src/auth.ts, /home/user/yui/worker/src/env.ts, /home/user/yui/worker/test/app.test.ts | S-5, S-6, S-7, S-8, S-9, F1-1, F1-2 | T-1104-08 | 1.0 | 未着手 |
| T-1104-11 | `GET /api/me`: `{ user_id, display_name }`。初回アクセスで `users` に行ができ、2 回目で `last_seen_at` が更新される | /home/user/yui/worker/src/index.ts | F1-1 | T-1104-10 | 0.5 | 未着手 |
| T-1104-12 | 画面の骨格: `App.vue` でハッシュ（`#today` / `#past` / `#memory/<id>`）により S0〜S3 を切り替える `composables/useScreen.ts`、下部タブ `BottomNav.vue`（きょう / これまで）、`WelcomeScreen.vue`（アプリ名、一行、「はじめる」）、`TodayScreen.vue`（入力欄・写真ボタン・「保存する」の枠だけ）、`TimelineScreen.vue`（空状態の一行）。`GET /api/me` が 401 なら S0。「AI」「生成」「送信」を出さない | /home/user/yui/web/src/App.vue, /home/user/yui/web/src/composables/useScreen.ts, /home/user/yui/web/src/components/BottomNav.vue, /home/user/yui/web/src/screens/WelcomeScreen.vue, /home/user/yui/web/src/screens/TodayScreen.vue, /home/user/yui/web/src/screens/TimelineScreen.vue, /home/user/yui/web/src/api.ts | F1-5, F1-6, X-12, X-13, N-3, N-4 | T-1104-06, T-1104-11 | 1.5 | 未着手 |
| T-1104-13 | ローカル疎通: ターミナル 1 で `pnpm dev:worker`（8787）、ターミナル 2 で `pnpm dev`（5173）。curl で S-4〜S-7 を確認し、ブラウザ 5173 で S1 が開く（Vite proxy が `X-Dev-User` を付ける）。`pnpm preview` で 8787 一本の本番相当（Static Assets、SPA フォールバック）も確認 | （確認のみ） | S-4, S-5, S-6, S-7, S-11 | T-1104-04, T-1104-11, T-1104-12 | 0.5 | 未着手 |
| T-1104-14 | `docs/setup-cloudflare.md` を書く: `wrangler login`、D1 / R2 作成、Access の Self-hosted アプリ（メール OTP、対象ホスト全体、AUD タグの取り方）、`[vars]` の `ACCESS_TEAM_DOMAIN` / `ACCESS_AUD`、`wrangler secret put ANTHROPIC_API_KEY`、`pnpm db:migrate:remote`、`pnpm deploy`、確認用 curl、`wrangler tail` | /home/user/yui/docs/setup-cloudflare.md | S-3, S-10, S-11, N-9 | T-1104-01 | 1.0 | 未着手 |
| T-1104-15 | 【開発者】Access アプリを作り、`ACCESS_TEAM_DOMAIN` と `ACCESS_AUD` を `wrangler.toml` の `[vars]` に書く。ドメイン（J-3）を決めて `routes` を書く。`wrangler secret put ANTHROPIC_API_KEY` を実行する | /home/user/yui/wrangler.toml | S-10, N-8 | J-1, J-3, T-1104-14 | 1.0 | 未着手 |
| T-1104-16 | deploy dry-run と本番 deploy: `pnpm build`（dry-run）→ `pnpm deploy`。ブラウザでメール OTP を経て S0/S1 が出る。JWT なしの curl で `/api/memories` が 401、`/api/health` が 200。未知パスが `index.html` を返す | （確認のみ。手順は docs/setup-cloudflare.md） | S-1, S-10, S-11, N-9 | T-1104-05, T-1104-15 | 0.5 | 未着手 |
| T-1104-17 | スモークテストの手順を `docs/setup-cloudflare.md` 末尾に固定する（architecture 11.2 の curl を、11/5 以降の API 追加に合わせて育てる）。`X-Dev-User` ありなしの 2 系統 | /home/user/yui/docs/setup-cloudflare.md | S-4〜S-9 | T-1104-13 | 0.5 | 未着手 |
| T-1104-18 | 日の終わりの確認（デモが通るか）: 本番 URL でログイン → S1 が開く → タブで S2 に移る → ログアウト相当（別ブラウザ）で S0 が出る。通らなければ 11/5 の先頭で直す | （確認のみ） | F1-5, F1-6, S-10 | T-1104-16 | 0.5 | 未着手 |

11/4 合計: 8.0h（【開発者】の 1.5h を含む）

## 3. 11/5 記憶の登録、一覧・詳細・削除、写真（F2, F3）

| ID | タスク | 成果物 | 受け入れ条件 | 依存 | 見積(h) | 状態 |
|---|---|---|---|---|---|---|
| T-1105-01 | 入力検証（純粋関数）: 本文 trim 後 1〜2000 文字（`Array.from(body).length`）、`happened_on_precision` の 4 値、`day` / `month` / `year` の `happened_on` 正規化（`YYYY-MM-01`、`YYYY-01-01`）、`unknown` は NULL、実在しない日付の拒否。テスト付き | /home/user/yui/worker/src/validate.ts, /home/user/yui/worker/test/validate.test.ts, /home/user/yui/worker/test/date-precision.test.ts | F2-2, F2-3, F2-4 | T-1104-02 | 1.0 | 未着手 |
| T-1105-02 | キーセットカーソル: `(COALESCE(happened_on,''), created_at, id)` の base64url エンコード/デコード、壊れたカーソルの拒否。テスト付き | /home/user/yui/worker/src/cursor.ts, /home/user/yui/worker/test/cursor.test.ts | F3-3 | T-1104-02 | 0.5 | 未着手 |
| T-1105-03 | `memories` の D1 アクセス層: INSERT、一覧（`ORDER BY COALESCE(happened_on,'') DESC, created_at DESC, id DESC`、limit 1〜50 既定 20）、1 件取得、DELETE。全クエリに `WHERE user_id = ?`。SQL を組む関数と実行する関数を分け、SQL 文字列をテスト | /home/user/yui/worker/src/db/memories.ts, /home/user/yui/worker/test/memories-sql.test.ts | F3-1, F3-2, F3-5, X-11 | T-1105-02 | 1.0 | 未着手 |
| T-1105-04 | `POST /api/memories`（201、`waitUntil` の呼び出し口は空の関数で用意）と `GET /api/memories?cursor=&limit=`。エラー形式 `{ error: { code, message } }` を errors.ts に揃える（J-7） | /home/user/yui/worker/src/routes/memories.ts, /home/user/yui/worker/src/errors.ts, /home/user/yui/worker/src/index.ts | F2-1, F2-2, F2-3, F2-4, F3-1, F3-2, F3-3 | T-1105-01, T-1105-03 | 1.0 | 未着手 |
| T-1105-05 | `GET /api/memories/:id`（`memory` + `facts` + `recalls` + `recalled_by` の枠。この時点では空配列）と `DELETE /api/memories/:id`（所有者確認 → R2 削除 → D1 削除、CASCADE 確認、204）。他人のものは 404 | /home/user/yui/worker/src/routes/memories.ts | F3-4, F3-5, X-10 | T-1105-04 | 1.0 | 未着手 |
| T-1105-06 | 写真: `PUT /api/memories/:id/photo`（multipart `photo`、`image/jpeg` / `image/png` のみ 415、10,485,760 バイト超 413、キー `photos/<user_id>/<memory_id>/<uuid>.<ext>`、前の写真は R2 から削除、`httpMetadata.contentType`）と `GET /api/photos/*`（自分の `photos/<user_id>/` 配下だけ、`Cache-Control: private, max-age=3600`） | /home/user/yui/worker/src/routes/photos.ts, /home/user/yui/worker/src/validate.ts | F2-5, F2-6, F2-7, F2-8 | T-1105-05 | 1.5 | 未着手 |
| T-1105-07 | 画面の API クライアントと型: 5 章のレスポンス型、`createMemory` / `listMemories` / `getMemory` / `deleteMemory` / `putPhoto`。エラーは `ApiError(status, code, message)` | /home/user/yui/web/src/api.ts, /home/user/yui/web/src/api/types.ts | F2-2, F3-6 | T-1105-04 | 0.5 | 未着手 |
| T-1105-08 | S1 きょう: 入力欄（本文、空白のみなら「保存する」を無効）、起きた日（既定: 端末の今日、精度は「日 / 月 / 年 / いつだったか」）、`PhotoPicker.vue`（`accept="image/jpeg,image/png"`、プレビュー、10MB 超は「写真が大きすぎるみたいです（10MB まで）」）、保存 → 写真 PUT → 保存後の静かな状態。失敗時は本文を消さず「うまく保存できませんでした。もう少ししてから、もう一度」、写真だけ失敗は「写真だけ、あとでもう一度」 | /home/user/yui/web/src/screens/TodayScreen.vue, /home/user/yui/web/src/components/PhotoPicker.vue, /home/user/yui/web/src/date.ts | F2-1, F2-2, F2-4, F2-6, X-13 | T-1105-07 | 1.5 | 未着手 |
| T-1105-09 | S2 これまで: `MemoryCard.vue`（写真サムネイルと最初の一行、起きた日。精度に応じて「2024年6月」「2024年」「いつだったか」）、カーソルで続きを読む、空状態「まだ何もありません。きょうのひとことから」、読み込み中は薄い「よみこみ中」、失敗は「読み込めませんでした」と再読み込み | /home/user/yui/web/src/screens/TimelineScreen.vue, /home/user/yui/web/src/components/MemoryCard.vue | F3-1, F3-3, F3-6 | T-1105-07 | 1.0 | 未着手 |
| T-1105-10 | S3 記憶の詳細: 本文全文、写真（`/api/photos/...`）、起きた日、「消す」→ 一度だけ確認（「この記憶を消しますか」「消す」「やめる」）→ 即時削除 → S2 へ。失敗は「消せませんでした」。事実と札の枠は空のまま置く | /home/user/yui/web/src/screens/MemoryDetailScreen.vue, /home/user/yui/web/src/App.vue | F3-7, F3-4 | T-1105-09 | 1.0 | 未着手 |
| T-1105-11 | 日の終わりの確認（デモが通るか）: ローカルで「スーパーで青梅を見かけた」を写真付きで保存 → S2 に出る → S3 で写真と本文 → 消す → 一覧から消え R2 からも消える。curl スモーク（T-1104-17）も更新して通す。本番にも deploy して同じ流れを 1 回通す | /home/user/yui/docs/setup-cloudflare.md（スモーク更新） | F2-1, F2-5, F3-4, F3-7 | T-1105-08, T-1105-10 | 1.0 | 未着手 |

11/5 合計: 8.0h。超過したら T-1105-09 の「続きを読む」と T-1105-06 の「前の写真の削除」を 11/8 へ回す。

## 4. 11/6 候補抽出とそういえば（F4, F5, C1, C2）、引用検証

| ID | タスク | 成果物 | 受け入れ条件 | 依存 | 見積(h) | 状態 |
|---|---|---|---|---|---|---|
| T-1106-01 | AI クライアントの境界 `ai/client.ts`: `new Anthropic({ apiKey, maxRetries, timeout: 20_000 })` をリクエストごとに生成、`model = env.ANTHROPIC_MODEL`、`max_tokens 4096`、入力「system + user + JSON Schema」→ 出力「パース済み JSON または失敗理由」。tool use（`tool_choice: {type:"tool"}`）と `output_config.format` のどちらで呼ぶかをここだけで切り替える（J-6）。`stop_reason` が `refusal` / `max_tokens` は失敗。`usage` の token 数を返す。`@anthropic-ai/sdk` を依存に追加（この 1 つだけ）、`nodejs_compat` を wrangler.toml に追加 | /home/user/yui/worker/src/ai/client.ts, /home/user/yui/package.json, /home/user/yui/wrangler.toml | N-7, F4-1 | T-1105-11, J-1 | 1.5 | 未着手 |
| T-1106-02 | JSON Schema `recall` と `facts`（architecture 6.2 / 6.3）と、システムプロンプト（6.4: 会話しない、関係なければ空、逐語引用、創作しない、最大 3 件、断定しない、JSON 以外書かない）。固定文を先、可変を後。入力の XML 風タグは `<` `>` `&` `"` をエスケープ。`feedback` は入力に含めない | /home/user/yui/worker/src/ai/schemas.ts, /home/user/yui/worker/src/ai/prompts.ts | F6-4, X-2 | なし | 1.0 | 未着手 |
| T-1106-03 | 引用検証（純粋関数）: `evidence` が引用元 body の部分文字列か（`body.includes(evidence)`、空は不可。NFC 正規化の有無は J-7 と同様に requirements X-7 に従い「しない」）、C1 の `related_memory_id` が送った id 集合にある・自分自身でない・重複なし・先頭 3 件、C2 の `date` 値の形（10 / 7 / 4 文字、実在）・(kind, value) の重複・既に rejected の候補を除く・先頭 10 件。テスト付き | /home/user/yui/worker/src/ai/verify.ts, /home/user/yui/worker/test/evidence.test.ts | X-6, X-7, F4-2, F5-3 | なし | 1.5 | 未着手 |
| T-1106-04 | `ai_runs` の記録: `running` で作成 → `succeeded` / `empty` / `failed`（`error` は先頭 500 文字）へ。同じ `memory_id`・`kind` の 2 行目を作らない。`pending` 判定（最新が `running`）の SQL | /home/user/yui/worker/src/db/ai_runs.ts | N-5, N-7 | なし | 0.5 | 未着手 |
| T-1106-05 | C2 候補抽出の実行 `runFacts`: 本文と起きた日を入力 → 検証 → `memory_facts` に `status='candidate'`, `source='ai'` で保存。失敗は何も保存せず `failed`。`POST /api/memories` の `waitUntil` から呼ぶ | /home/user/yui/worker/src/ai/facts.ts, /home/user/yui/worker/src/db/facts.ts, /home/user/yui/worker/src/routes/memories.ts | F4-1, F4-2, F4-5, X-1 | T-1106-01〜04 | 1.0 | 未着手 |
| T-1106-06 | C1 想起の実行 `runRecall`: 同一ユーザーの過去記憶を `created_at DESC` 200 件（`confirmed` の事実だけ付ける、`feedback` は付けない）→ 0 件なら API を呼ばず `empty` → 検証 → `recalls` に保存（`UNIQUE` 衝突は無視）。独立した `waitUntil`。記憶が先に削除されていたら例外を握って `failed` | /home/user/yui/worker/src/ai/recall.ts, /home/user/yui/worker/src/db/recalls.ts, /home/user/yui/worker/src/routes/memories.ts | F5-1, F5-2, F5-3, F5-4, F5-5, N-1, N-6, X-4, X-11 | T-1106-05 | 1.0 | 未着手 |
| T-1106-07 | `GET /api/memories/:id/facts`（`pending` + 候補・確定・却下）、`PATCH /api/facts/:id`（confirm / reject、`decided_at`。confirmed ⇄ rejected は許可、candidate には戻さない）、`GET /api/memories/:id/recalls`（`pending` + `related_memory` を埋める）。他人のものは 404。`GET /api/memories/:id` の `facts` / `recalls` / `recalled_by` を埋める | /home/user/yui/worker/src/routes/facts.ts, /home/user/yui/worker/src/routes/recalls.ts, /home/user/yui/worker/src/routes/memories.ts | F4-3, F4-4, F4-6, F5-6, X-1, X-3 | T-1106-05, T-1106-06 | 1.0 | 未着手 |
| T-1106-08 | 画面のポーリング `usePolling.ts`（2 秒間隔、facts と recalls の両方の `pending` が false で停止、打ち切りは requirements N-2 の 30 秒）と `FactChips.vue`（候補を本文の下に並べ「そう」「ちがう」。そう → moss 色の選択、ちがう → 薄く消える。楽観更新、失敗は元に戻す）。候補 0 件なら枠も見出しも出さない | /home/user/yui/web/src/composables/usePolling.ts, /home/user/yui/web/src/components/FactChips.vue, /home/user/yui/web/src/screens/TodayScreen.vue, /home/user/yui/web/src/api.ts | N-2, F4-3, F4-4, F4-5, X-5 | T-1106-07 | 1.0 | 未着手 |
| T-1106-09 | `RecallCard.vue`: 「そういえば。」の見出し（font-display）、`reason`、「」で囲んだ `evidence`、昔の記憶の最初の一行と起きた日。初めて届いたときに `.rise`（600ms）で現れる。0 件なら何も描かず、「読み込み中」も出さない。タップで S3（昔の記憶）へ | /home/user/yui/web/src/components/RecallCard.vue, /home/user/yui/web/src/screens/TodayScreen.vue | X-8, N-12, F5-6, X-4 | T-1106-08 | 0.5 | 未着手 |
| T-1106-10 | 日の終わりの確認（デモが通るか）: ローカルに `.dev.vars` の API キーを入れた状態で D1（梅干し → 青梅、札 1 枚と引用）と D2（電気代、札 0 件、`ai_runs.status='empty'`）を画面と curl で通す。`ai_runs` の token 数と所要秒数を記録し、J-5（モデル）と `effort` の判断材料を書き残す | /home/user/yui/docs/decisions/0005-ai-output-format.md（J-6 の結論。tool use か json_schema か、モデル、所要時間） | F4-1, F5-1, F5-2, X-4, N-1, N-5 | T-1106-09 | 1.0 | 未着手 |

11/6 合計: 8.0h。超過したら T-1106-09 の遷移（タップで S3）を 11/7 へ回す。

## 5. 11/7 反応、デモ4本の通し、写真候補（F6, F7）

| ID | タスク | 成果物 | 受け入れ条件 | 依存 | 見積(h) | 状態 |
|---|---|---|---|---|---|---|
| T-1107-01 | `PATCH /api/recalls/:id`（`helpful` / `not_related` / `none`、何度でも変更可）。他人のものは 404。学習には使わない（入力に含めないことは T-1106-02 で担保） | /home/user/yui/worker/src/routes/recalls.ts, /home/user/yui/worker/src/db/recalls.ts | F6-1, F6-2, F6-3, F6-5 | T-1106-07 | 0.5 | 未着手 |
| T-1107-02 | 札の反応 UI: 「そうだった」（moss の印、札は残る）、「関係ないかも」（薄くなるが残る）、同じボタンをもう一度でトグルして `none`。楽観更新、失敗は印を戻し「記録できませんでした」。S3 の「関連する そういえば の履歴」にも同じ部品を使う | /home/user/yui/web/src/components/RecallCard.vue, /home/user/yui/web/src/screens/MemoryDetailScreen.vue | F6-1, F6-2, F6-3 | T-1107-01 | 1.0 | 未着手 |
| T-1107-03 | デモ用フィクスチャの整備: `demo/fixtures/seed.sql`（`demo@example.com`、D1 用「おばあちゃんは毎年6月になると、縁側で梅干しを漬けていた」、D4 用「はるとが三輪車で転んで泣いた」、起きた日と確定事実）と各シナリオの JSON。別担当が先行して置いていればスキーマ（0001_init.sql の CHECK）との整合だけ確認。`pnpm db:seed:local` で投入 | /home/user/yui/demo/fixtures/seed.sql, /home/user/yui/demo/fixtures/d1-ume.json, /home/user/yui/demo/fixtures/d2-denki.json, /home/user/yui/demo/fixtures/d3-hana.json, /home/user/yui/demo/fixtures/d4-haruto.json | requirements 第7節 | T-1104-04 | 1.0 | 未着手 |
| T-1107-04 | デモ 4 本をローカルで通す（seed → D1 → D2 → D3（写真があれば F7、無ければ F4 の「場所: 公園」を「ちがう」）→ D4（「はると」を「そう」、札に「そうだった」））。各シナリオの所要秒数と、札・候補の実際の出力を記録する | /home/user/yui/demo/fixtures/README.md（通し手順と期待結果） | D1〜D4 の担保条件（requirements 第7節） | T-1107-02, T-1107-03 | 1.5 | 未着手 |
| T-1107-05 | 通しで見つかった不具合の修正（プロンプトの調整、検証の抜け、画面の崩れ）。プロンプトを変えたら D2 が 0 件のままかを必ず再確認する | 該当ファイル | 同上 | T-1107-04 | 1.5 | 未着手 |
| T-1107-06 | F7 写真からの気づき候補（P1）: スキーマ `photo_hints`（`kind` は thing / place / date、最大 5 件）、写真を base64 で渡す（画像ブロック）、Worker で `kind='person'` と年齢・感情の語を捨てる。D1 には保存せず `GET /facts` の `photo_hints` として返す（requirements 第8節 #4）。写真なしなら `ai_runs(kind='photo')` を作らない。写真 PUT 完了後に `waitUntil` で 1 回だけ | /home/user/yui/worker/src/ai/photo.ts, /home/user/yui/worker/src/ai/schemas.ts, /home/user/yui/worker/src/ai/prompts.ts, /home/user/yui/worker/src/routes/photos.ts, /home/user/yui/worker/src/routes/facts.ts | F7-1, F7-4, F7-5 | T-1107-05, J-4 | 1.5 | 未着手 |
| T-1107-07 | F7 の画面: 写真候補は語尾を「でしょうか」にして `FactChips` と同じ並びに出す。「そう」で `PATCH`/`POST` により `memory_facts` に `source='user'`, `status='confirmed'`, `evidence NULL` で保存。「ちがう」は `memory_facts` に候補を残さない（F7-2）。再読み込み後に同じ候補を出し直さない方法は 2 案（a: 却下時に `source='user'`, `status='rejected'`, `evidence NULL` の行を作る。b: 写真候補は保存直後の 1 回だけ出し、再読み込み時は出さない）。実装時に選び ADR-0006 に残す | /home/user/yui/web/src/components/FactChips.vue, /home/user/yui/worker/src/routes/facts.ts, /home/user/yui/docs/decisions/0006-photo-hints-storage.md | F7-2, F7-3, X-1 | T-1107-06 | 1.0 | 未着手 |
| T-1107-08 | 日の終わりの確認（デモが通るか）: 本番に deploy し、`pnpm db:seed:remote` は使わず（本番は実ユーザーのメール）実際のアカウントで D1〜D4 を手で入力して通す。所要秒数が 10 秒を超えるなら `effort` と過去記憶件数を見直す | （確認のみ） | N-1, N-9, requirements 第7節 | T-1107-05（T-1107-07 は任意） | 1.0 | 未着手 |

11/7 合計: 8.0h。T-1107-06 / 07 は P1。T-1107-05 が長引いたら落とし、D3 は代替手順で通す。

## 6. 11/8 UI 磨きとエラー時の静かな振る舞い

| ID | タスク | 成果物 | 受け入れ条件 | 依存 | 見積(h) | 状態 |
|---|---|---|---|---|---|---|
| T-1108-01 | 文字組みと余白: 本文 17px / 行間 1.8、見出し 22〜28px（font-display）、補足 14px、本文列の最大幅 640px 中央寄せ、375px で横スクロールなし。角丸 16〜24px、影は薄く、縁は `line` | /home/user/yui/web/src/style.css, /home/user/yui/web/src/App.vue, 各 `.vue` | N-3, N-4, N-11 | T-1107-08 | 1.5 | 未着手 |
| T-1108-02 | 空状態と読み込み: S2 の空状態、S3 の事実・札が無いときは見出しごと出さない、保存直後の S1 は本文を残したまま静かに（候補と札が届くまで何も言わない）。スピナーは使わない | /home/user/yui/web/src/screens/TimelineScreen.vue, /home/user/yui/web/src/screens/MemoryDetailScreen.vue, /home/user/yui/web/src/screens/TodayScreen.vue | F3-6, X-4, X-5 | T-1108-01 | 1.0 | 未着手 |
| T-1108-03 | エラー時の静かな振る舞いの総点検: 保存失敗（本文を消さない）、写真だけ失敗、一覧失敗（再読み込み導線）、削除失敗、反応失敗、401（S0 へ戻す）、AI 失敗（何も出さない、ポーリングは止まる）。文言はすべて短い日本語で「AI」「生成」「送信」を使わない | /home/user/yui/web/src/api.ts, 各 `.vue` | F1-5, F2 エラー時, F3 エラー時, F6 エラー時, X-12 | T-1108-02 | 1.0 | 未着手 |
| T-1108-04 | 禁止語の機械チェック: `grep -rnE "AI|生成|送信" web/src --include=*.vue` が UI 文字列に 0 件（コメントは除外）。`grep -rn "#[0-9A-Fa-f]\{3,6\}" web/src --include=*.vue` が 0 件。結果を `package.json` の `check:words` script にする | /home/user/yui/package.json | X-12, N-11 | T-1108-03 | 0.5 | 未着手 |
| T-1108-05 | S3 の根拠の強調: 札から開いた昔の記憶で、`evidence` に一致する本文の範囲を `ember-soft` の地で強調する（`body.indexOf(evidence)` で分割、見つからなければ強調なし）。「関連する そういえば の履歴」（`recalls` と `recalled_by` の両方）を時系列で | /home/user/yui/web/src/screens/MemoryDetailScreen.vue, /home/user/yui/web/src/components/RecallCard.vue | F5-6, X-8 | T-1108-01 | 1.0 | 未着手 |
| T-1108-06 | 写真の見せ方: S2 のサムネイル（正方形、`object-fit: cover`、`loading="lazy"`）、S3 の写真（角丸、横幅いっぱい）、S1 の選択プレビュー。写真の縦横比が極端でも崩れない | /home/user/yui/web/src/components/MemoryCard.vue, /home/user/yui/web/src/screens/MemoryDetailScreen.vue, /home/user/yui/web/src/components/PhotoPicker.vue | N-3, N-4 | T-1108-01 | 1.0 | 未着手 |
| T-1108-07 | 触り心地: タップ領域 44px 以上、フォーカスリング（`ember`）、`prefers-reduced-motion` で `.rise` 無効、下部タブの安全領域（`viewport-fit=cover`、`env(safe-area-inset-bottom)`）、iOS でズームしないよう入力欄 16px 以上 | /home/user/yui/web/src/style.css, /home/user/yui/web/src/components/BottomNav.vue | N-3, N-12 | T-1108-01 | 0.5 | 未着手 |
| T-1108-08 | 日の終わりの確認（デモが通るか）: 本番に deploy し、スマホ実機（iPhone Safari と Android Chrome のどちらか 1 台以上）で D1〜D4 を通す。写真は実機のカメラロールから（HEIC が JPEG に変換されて届くかを確認。届かなければリスク R-5 の対処） | （確認のみ） | N-3, F2-5, requirements 第7節 | T-1108-02〜07 | 1.0 | 未着手 |

11/8 合計: 7.5h

## 7. 11/9 ふりかえり（余裕があれば）、README、デモ動画

| ID | タスク | 成果物 | 受け入れ条件 | 依存 | 見積(h) | 状態 |
|---|---|---|---|---|---|---|
| T-1109-01 | 午前の判断: 11/8 までの残課題が 0 なら F8 に着手。1 つでも残っていれば F8 を落とし、残課題 → README → 動画の順にする | （判断のみ。結果を本書の状態欄に書く） | なし | T-1108-08 | 0.0 | 未着手 |
| T-1109-02 | F8 ふりかえり（P1）の Worker: 人物（確定済み `person` の value）または期間で記憶を集め（0 件なら呼ばない）、スキーマ `retrospect`（段落ごとに `text` 200 文字以下、`memory_id`、`evidence`）、検証（`memory_id` が集めた集合にある、`evidence` が本文の部分文字列）、保存せず `ai_runs(kind='retrospect')` のみ記録。パスは `POST /api/retrospects`（requirements 第8節 #7） | /home/user/yui/worker/src/ai/retrospect.ts, /home/user/yui/worker/src/routes/retrospects.ts, /home/user/yui/worker/src/ai/schemas.ts, /home/user/yui/worker/src/ai/prompts.ts | F8-1, F8-2, F8-3, X-9 | T-1109-01 | 2.0 | 未着手 |
| T-1109-03 | S4 ふりかえりの画面: 人物（確定済み person の一覧から選ぶ）か期間を選んで語りを読む。段落タップで引用元の S3 へ。0 段落は「まだ語れるほど集まっていないようです」。導線は S2 の上部に小さく | /home/user/yui/web/src/screens/RetrospectScreen.vue, /home/user/yui/web/src/App.vue, /home/user/yui/web/src/api.ts | F8-4, X-9 | T-1109-02 | 1.5 | 未着手 |
| T-1109-04 | README 仕上げ: 何ができるか（3 つの原則）、デモの 4 シナリオ、仕組み（図は architecture 1 章から要約）、Claude の使いどころ（C1〜C3 と引用検証）、セットアップ（docs/setup-cloudflare.md へ）、スクリーンショット 3 枚（S1 に札が出た状態、S2、S3）、ライセンス。「ハッカソン期間内に書いた」ことを明記 | /home/user/yui/README.md, /home/user/yui/docs/screenshots/*.png | 提出要件 | T-1108-08 | 1.0 | 未着手 |
| T-1109-05 | デモ動画の台本: 3 分以内、スマホ縦。順に D1（梅干し → 青梅、札が静かに出る）→ D2（電気代、何も出ない。「出ない日があっていい」）→ D3（花、「桜でしょうか」に「ちがう」。記憶に残らない）→ D4（はると、「そうだった」）。字幕の文言に「AI」「生成」「送信」を使わない | /home/user/yui/docs/demo-script.md | requirements 第7節, X-12 | T-1109-04 | 0.5 | 未着手 |
| T-1109-06 | デモ動画の収録と書き出し: 本番環境、実機の画面収録。収録前に `ANTHROPIC_MODEL` と `effort` を固定、過去記憶は D1 / D4 の 2 件だけにした専用アカウントで。NG なら撮り直し（2 回まで）。字幕を付けて書き出し | 動画ファイル（リポジトリに入れない。提出フォームへ） | 提出要件 | T-1109-05 | 1.5 | 未着手 |
| T-1109-07 | 機能凍結と最終 deploy: `pnpm typecheck && pnpm test && pnpm build` → `pnpm deploy` → 本番で D1〜D4 を最後に 1 回通す。以降は文言と README 以外を触らない | （確認のみ） | S-1, N-9, requirements 第7節 | T-1109-06 | 1.0 | 未着手 |

11/9 合計: 7.5h（F8 の 3.5h は余裕があるときだけ。無ければ 4.0h）。F9 検索（P1）は本計画に入れない（やらないことリスト参照）。

## 8. 11/10 提出

| ID | タスク | 成果物 | 受け入れ条件 | 依存 | 見積(h) | 状態 |
|---|---|---|---|---|---|---|
| T-1110-01 | README の最終読み合わせ（リンク切れ、スクリーンショット、セットアップ手順を別環境の目で追う） | /home/user/yui/README.md | 提出要件 | T-1109-07 | 0.5 | 未着手 |
| T-1110-02 | デモ動画のアップロード（提出フォームの指定先）と再生確認 | （フォーム） | 提出要件 | T-1109-06 | 0.5 | 未着手 |
| T-1110-03 | 提出フォーム記入: プロジェクト名「そういえば。」、一行説明、リポジトリ URL、動画 URL、Claude の使いどころ（C1〜C3 と引用検証を 3 文で）、チーム 1 名。送信前に J-8 の確認 | （フォーム） | 提出要件 | T-1110-01, T-1110-02 | 1.0 | 未着手 |
| T-1110-04 | 最終確認（13:30 まで）: 本番 `/api/health` が 200、ログインして S1 が開く、D1 が通る。問題があれば直さず README に「既知の問題」として書いて提出する | （確認のみ） | S-10, N-9 | T-1110-03 | 0.5 | 未着手 |

11/10 合計: 2.5h。14:00 JST 締切。コードの変更はしない。

## 9. やらないことリスト

| 項目 | 理由 | 根拠 |
|---|---|---|
| P2 全般（共有、通知、音声入力、エクスポート、記憶の編集） | 提出後 | 仕様 4 節 P2、3.2 節 |
| ダークモード | ライトのみ | ADR-0004 |
| 多言語 | 日本語のみ | 仕様 3.2 節 |
| vue-router | 画面 4 つ、ハッシュで足りる。依存最小限 | architecture 7.1 |
| UI ライブラリ（component kit、icon set、state 管理ライブラリ） | Tailwind の `@theme` と素の Vue で足りる | ADR-0004、仕様 12 節 |
| F9 検索 | P1 の最後。11/9 は README と動画を優先 | 仕様 4 節 P1、本書 7 章 |
| @cloudflare/vitest-pool-workers による統合テスト | 1 人 1 週間ではセットアップ負担が大きい。curl スモークで代替 | architecture 11.2 |
| HEIC の変換ライブラリ | JPEG / PNG のみ受け付ける。端末側変換に頼る | requirements 第8節 #5 |
| AI の再試行、キュー、バッチ | 失敗は静かに `failed`。1 記憶あたり C1 1 回 + C2 1 回（+ C3 1 回）固定 | 仕様 5 節、9 節 |
| AI とのチャット、人格、アバター、「質問する」導線 | 製品の核に反する | 仕様 3.2 節、X-13 |
| 自動タグの一括確定、自動アルバム | 推測を事実にしない | 仕様 3.2 節、原則 1 |
| D1 のバックアップ、複数環境（staging） | 期間中は不要 | 仕様 5 節 |
| スキーマ変更（0002 以降のマイグレーション） | 0001 で足りる。差異は値の形で吸収 | requirements 第8節 |

## 10. リスク表

| ID | リスク | 兆候 | 対処 | 影響するタスク |
|---|---|---|---|---|
| R-1 | Cloudflare Access の設定に時間がかかる（AUD タグ、ドメイン、OTP メールの到達、JWKS の `iss`） | 11/4 の T-1104-15 / 16 が夕方までに終わらない | 11/4 中は本番認証を諦め、ローカル `X-Dev-User` で 11/5〜11/6 を進める。Access は 11/7 の T-1107-08 までに通ればよい。`workers.dev` を Access で守る形（J-3 既定）から始め、カスタムドメインは後回し。JWT 検証は T-1104-09 のテストで先に担保しておく | T-1104-15, T-1104-16, T-1107-08 |
| R-2 | Anthropic API のレート制限、混雑（429 / 529）、応答が 10 秒を超える | `ai_runs.status='failed'` が続く、`error` に 429 / overloaded、D1 で札が 10 秒以内に出ない | `maxRetries` は 1 まで（N-7 は 0。J-6 と合わせて決める）。`effort` を C2 `low`、C1 `medium` から始め、計測して下げる。過去記憶の送信を 200 → 100 件に落とす切替を env で持つ。デモ収録は過去記憶 2 件の専用アカウントで、混雑時間帯を避ける。ポーリング打ち切り後に開き直せば届く設計（architecture 1.1）なので動画は「少し待つ」カットを許容 | T-1106-10, T-1107-08, T-1109-06 |
| R-3 | D1 の書き込み制限（1 リクエストあたりの文数、`waitUntil` 中の接続、外部キー） | `waitUntil` 内の INSERT が失敗する、`D1_ERROR` | 候補・札の保存は `batch()` で 1 往復にまとめる。削除後に届いた結果は外部キー失敗を握って `failed`（architecture 4.6）。書き込み量は 1 記憶あたり数行なので無料枠で足りる。D1 の読み取りは一覧 20 件 + 過去 200 件に固定 | T-1106-05, T-1106-06, T-1105-05 |
| R-4 | 構造化出力の方式がモデルで変わる（`tool_choice` 強制が 400、`output_config` の名称差） | T-1106-01 で 400 が返る | `ai/client.ts` に閉じ込め、tool use と json_schema の両方を実装して env で切り替え可能にする。結論を ADR-0005 に残す。それでも駄目なら `claude-sonnet-5` に落とす | T-1106-01, T-1106-10 |
| R-5 | 写真の HEIC（iPhone の既定形式）が JPEG に変換されず届く、または 10MB を超える | 415 / 413 が実機で出る | `accept="image/jpeg,image/png"` で Safari の自動変換に頼る。届かなければ画面で「写真は JPEG か PNG で」と案内し、デモは JPEG を事前に用意。縮小は `canvas.toBlob("image/jpeg", 0.85)` で画面側に実装（依存なし、1h）。HEIC デコードのライブラリは入れない | T-1105-08, T-1108-08 |
| R-6 | 引用検証で正しい提案まで捨てる（モデルが句読点や空白を変える） | D1 で札が `empty` になる、`ai_runs` が `empty` 続き | プロンプトで「一字も変えない」を強調し、`evidence` は短め（1 文以内）を指示。検証は X-7 どおり完全一致のまま（緩めない）。捨てた件数を `console.log` に出して観察する | T-1106-03, T-1107-05 |
| R-7 | D2（電気代）で関係のない札が出る | D2 で 1 件以上保存される | システムプロンプトの「無理に結びつけない」「確かな 1 件」を強め、`effort` を上げる。D2 はプロンプト変更のたびに再確認（T-1107-05） | T-1106-02, T-1107-05 |
| R-8 | 1 人開発で見積超過 | 各日の「日の終わりの確認」が通らない | 翌日の P1（T-1107-06/07、T-1109-02/03）から落とす。11/8 の磨きは T-1108-01〜03 を優先。11/9 の午前に凍結判断（T-1109-01） | 全体 |
| R-9 | `wrangler` / Vite / Tailwind v4 のバージョン差で雛形が動かない | T-1104-02 で失敗 | ロックファイルに固定し、更新しない。`compatibility_date` は変えない | T-1104-01, T-1104-02 |
| R-10 | 本番でのデモ中に実データが混ざる | 動画に関係ない記憶が写る | デモ専用のメールアドレスでログインし、D1 / D4 の過去記憶だけを手で入れておく。seed SQL は本番には流さない | T-1107-08, T-1109-06 |

## 11. 日の終わりの確認（共通手順）

1. `pnpm typecheck && pnpm test && pnpm build` が終了コード 0
2. ローカルの curl スモーク（docs/setup-cloudflare.md 末尾）を上から通す
3. その日の対象シナリオを画面で通す（11/4: ログイン、11/5: 登録〜削除、11/6: D1 と D2、11/7 以降: D1〜D4）
4. 通らなかった項目は、翌日の先頭タスクとして本書に追記する（ID は `T-mmdd-00` で割り込み）
5. 本書の状態欄を更新し、「作ったもの / 次にすること / 開発者の判断が必要なこと」を報告する
