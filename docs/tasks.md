# 実装タスク一覧

- 根拠: docs/spec.md 第14節（作成順と日程）、第4節（P0 / P1）、第11節（デモ4シナリオ）
- 受け入れ条件: docs/requirements.md の条件 ID（`F2-3`、`S-4`、`X-6`、`N-1` の形）を参照する
- 既定値: ADR-0003。デザイン: ADR-0004。AI 出力の形とモデル: ADR-0005。D1 スキーマ: worker/migrations/0001_init.sql（変更しない）
- 粒度: 0.25〜2 時間。ID は `T-mmdd-nn`。状態は「未着手 / 進行中 / 完了 / 保留」。着手時に書き換える
- 1 日の持ち時間は 8 時間を上限とする。各日の合計は見積(h) 列を機械的に足した値（`awk` で検算。セル内の `\|` を除いてから分割する）。超える日は P1 を落とす

## 0. 開発者の判断が必要な項目（先に決める）

| # | 項目 | 必要になる日 | 内容 | 決まらない場合の既定 |
|---|---|---|---|---|
| J-1 | クレデンシャル投入 | 11/4 | `wrangler login`（Cloudflare）、`wrangler secret put ANTHROPIC_API_KEY`、ローカルは `.dev.vars` に `ANTHROPIC_API_KEY` と `ENVIRONMENT=development` を手で書く。Claude Code は `.dev.vars` に書けない | 投入されるまで AI 呼び出しは `ai_runs.status='failed'` で記録され、登録・一覧・削除だけ動く |
| J-2 | D1 / R2 の作成 | 11/4 | `wrangler d1 create souieba` の `database_id` を wrangler.toml に貼る。`wrangler r2 bucket create souieba-photos` | 現在の `database_id` はダミー。埋まるまで `db:migrate:remote` と本番 deploy は通らない |
| J-3 | ドメイン | 11/4 | Access で守るホスト名（例 `souieba.neuronest.jp`）。wrangler.toml に `routes`（custom_domain）を追加し `workers_dev = false` にする。Access の Self-hosted アプリをそのホスト全体に設定し、`ACCESS_TEAM_DOMAIN` と `ACCESS_AUD` を `[vars]` に書く | 当面は `souieba.<account>.workers.dev` を Access で守る（requirements S-10 の記述どおり）。architecture 3.3 の `workers_dev = false` は提出前の切替候補 |
| J-4 | 写真素材 | 11/7 | 開発者が権利を持つ写真（JPEG、10MB 以下）を次のファイル名で `demo/photos/` に置く。**`demo/photos/park-flower.jpg`**（D3 の公園の花。梅。必須）、**`demo/photos/ume.jpg`**（D1 の青梅。任意）。D4 用の自転車の写真は不要。ファイル名は demo/fixtures/scenarios.json と demo/fixtures/README.md に合わせたもので、demo/photos/README.md の例 `d3-park-flower.jpg` は古い（T-1107-03 で開発者に修正を依頼する） | 写真なしで D3 を F4 の候補「場所: 公園」を「ちがう」にする代替手順（requirements 第7節）で通す |
| J-5 | モデル | 11/6 | `ANTHROPIC_MODEL` は `claude-opus-5-5`（ADR-0005、wrangler.toml と .dev.vars.example の現在値）。コストや所要秒数で困ったら `claude-sonnet-5-5` に下げる | opus のまま。11/6 の T-1106-10 で token 数と所要秒数を出し、下げるかを判断する |
| J-7 | API レスポンスの形 | 11/5 | requirements と architecture の差を次のとおり決める。(1) `GET /facts` `GET /recalls` と `GET /api/memories/:id` の中は architecture 5 章の `{ pending: boolean, items: [...] }`（`recalled_by` は `{ items }` のみ）。(2) `PATCH /api/facts/:id` のボディは requirements の `{ status: "confirmed" \| "rejected" }`（保存する値と同じ語。architecture 5.10 の `{ decision }` は使わない）。(3) エラー `code` は requirements 第2節の短い名 `validation` / `unauthorized` / `not_found` / `too_large` / `unsupported_media` と、500 は既存 worker/src/errors.ts・index.ts の `internal`。(4) ポーリングの打ち切りは requirements N-2 の 30 秒（2 秒間隔 15 回）。(5) 写真候補（F7）は requirements F7 のとおり `memory_facts` に `source='ai'`, `evidence='photo:<photo_key>'` で保存し、確定・却下は同じ `PATCH /api/facts/:id`。ユーザー由来の fact を作る API は増やさない | 上記のとおり。文書の追従は T-1105-00 で行う |
| J-8 | 提出素材 | 11/9 | デモ動画の長さと形式（提出フォームの要件）、公開リポジトリにするか | 3 分以内の画面収録（スマホ縦）、音声なし字幕あり |

J-6（AI 出力の形: tool use か `output_config.format` か）は ADR-0005 で Structured Outputs に決定済みのため削除した。番号は欠番のまま残す。

## 1. 全体の流れ

| 日 | 主眼 | 合計見積 | 終わりの確認 |
|---|---|---|---|
| 11/3 | ドキュメント（本書を含む） | 完了 | `docs/` が揃う |
| 11/4 | 雛形の確認、D1、デザイン基盤、`/api/health`、Access、deploy | 7.0h | 本番でログインして S1 が開く |
| 11/5 | 文書の整合、F2 登録（写真を除く）、F3 一覧・詳細・削除 | 7.75h | 書いて、一覧で見て、消せる |
| 11/6 | F4 候補抽出、F5 そういえば、引用検証 | 8.0h | D1（梅干し）と D2（電気代）が通る |
| 11/7 | 写真 R2、F6 反応、デモ4本の通し。F7 写真候補は残時間があれば | 7.25h（F7 の 2.5h は別枠） | 本番で D1〜D4 が通る |
| 11/8 | UI 磨き、エラー時の静かな振る舞い、11/5 から回した小物 | 8.0h | スマホ実機で D1〜D4 が気持ちよく通る |
| 11/9 | F8 ふりかえり（余裕があれば）、README、デモ動画 | 7.5h | 動画が撮れている、機能凍結 |
| 11/10 | 提出 | 2.5h | 14:00 JST までに提出完了 |

備考:

- 11/4 スコープの大半はコミット a78ed8f（雛形、JWT 検証、`/api/health`、`/api/me`、デザイン基盤、画面の骨格、テスト）、2ee0743（ADR-0005、既定モデル opus）、1444096（scripts/smoke.sh、CI）、5b85d68（レビュー反映、テスト 35 本）で先行して入っている。11/4 の実装タスクは「差分を確認して仕上げる」0.25h 単位に縮めてある。状態は本書の時点では未着手のまま
- 11/5 の 8h に収めるため、写真の API と写真ボタン（旧 T-1105-06 と PhotoPicker）を 11/7 の先頭 T-1107-00 に、「前の写真の削除」と S2 の「続きを読む」を 11/8 の先頭 T-1108-00 に最初から置いた
- 11/7 の F7（T-1107-06 / 07、2.5h）は合計に含めない。T-1107-04 / 05 が早く終わった残時間で着手し、終わらなければ D3 は代替手順で通す

## 2. 11/4 雛形から本番 deploy まで

| ID | タスク | 成果物 | 受け入れ条件 | 依存 | 見積(h) | 状態 |
|---|---|---|---|---|---|---|
| T-1104-01 | 雛形の差分確認（実装済み: a78ed8f）: `package.json`（scripts: dev / dev:worker / build / deploy / db:* / test / typecheck）、`wrangler.toml`（name `souieba`、assets、D1、R2、vars）、`vite.config.ts`（root `web`、`/api` proxy と `X-Dev-User`）、`worker/tsconfig.json`、`web/tsconfig.json`、`vitest.config.ts` を architecture 2.1 / 9.1 / 9.2 と突き合わせ、差分だけ直す | /home/user/yui/package.json, /home/user/yui/wrangler.toml, /home/user/yui/vite.config.ts, /home/user/yui/vitest.config.ts, /home/user/yui/worker/tsconfig.json, /home/user/yui/web/tsconfig.json | S-1, N-8, N-10 | なし | 0.25 | 未着手 |
| T-1104-02 | クリーン clone で `pnpm install && pnpm typecheck && pnpm test && pnpm build` が通ることを確認。`pnpm build` は `wrangler deploy --dry-run --outdir dist/worker` まで。`dist/` と `web/dist/` が gitignore されていることを確認。CI（.github/workflows/ci.yml、1444096）が同じ 3 コマンドを回していることを確認 | （確認のみ。壊れていれば T-1104-01 の各ファイル） | S-1 | T-1104-01 | 0.5 | 未着手 |
| T-1104-03 | 【開発者】Cloudflare にログインし D1 `souieba` と R2 `souieba-photos` を作る。`database_id` を `wrangler.toml` に貼る（J-2） | /home/user/yui/wrangler.toml | N-10 | J-1, J-2 | 0.5 | 未着手 |
| T-1104-04 | D1 マイグレーション（ローカル）: `pnpm db:migrate:local` を 2 回実行し、5 テーブルと 2 回目が no-op であることを `wrangler d1 execute souieba --local --command "select name from sqlite_master where type='table'"` で確認 | /home/user/yui/worker/migrations/0001_init.sql（変更しない） | S-2 | T-1104-01 | 0.25 | 未着手 |
| T-1104-05 | D1 マイグレーション（リモート）: `pnpm db:migrate:remote` と `wrangler d1 migrations list souieba --remote` | （なし） | S-3 | T-1104-03, T-1104-04 | 0.25 | 未着手 |
| T-1104-06 | デザイン基盤の差分確認（実装済み: a78ed8f）: `web/src/style.css` の `@theme` に ADR-0004 の 10 色・フォント・サイズ・角丸トークン、`@layer base` の html/body、`.rise` アニメーション（600ms、`prefers-reduced-motion: reduce` で無効。この無効化は本タスクだけで持つ）。`web/index.html` の Google Fonts リンク（Zen Maru Gothic、Noto Sans JP、`display=swap`）。`.vue` に `#` 始まりの色がないことを grep で確認 | /home/user/yui/web/src/style.css, /home/user/yui/web/index.html | N-11, N-12, S-12 | T-1104-01 | 0.25 | 未着手 |
| T-1104-07 | `GET /api/health` の確認（実装済み: 5b85d68 で仕様 8 節の 4 項目 `{ ok, service:"souieba", version, time }` に揃えてある）。認証なし。秘密を返さない。`worker/test/app.test.ts` に 200 と形のテストがあることを確認。scripts/smoke.sh は `"ok":true` だけを見るので `environment` を足し戻さない | /home/user/yui/worker/src/index.ts, /home/user/yui/worker/test/app.test.ts | S-4 | T-1104-01 | 0.25 | 未着手 |
| T-1104-08 | Access JWT 検証の確認（実装済み: a78ed8f、5b85d68）: `Cf-Access-Jwt-Assertion` を分割、`alg` は RS256 のみ、JWKS（`https://<team>.cloudflareaccess.com/cdn-cgi/access/certs`）を 10 分キャッシュし `kid` 不一致で 1 回だけ再取得、`crypto.subtle.verify`、`aud` / `iss` / `exp` / `nbf` / `email` を確認。`fetchJwks` が引数で差し替え可能であること。JWKS 取得失敗は 503（5b85d68 の判断。requirements F1 エラー時の「401」と差があるので T-1105-00 で requirements を 503 に追従させる） | /home/user/yui/worker/src/access.ts | F1-1, F1-3, F1-4 | T-1104-01 | 0.25 | 未着手 |
| T-1104-09 | Access JWT のテストの確認（実装済み: worker/test/access.test.ts、helpers.ts）: `crypto.subtle.generateKey` で RSA 鍵を作りテスト内で署名。`aud` 不一致・`iss` 不一致・`exp` 切れ・署名改ざん・`alg: none`・`email` なし・JWKS 取得失敗を全て拒否していること。足りないケースだけ足す | /home/user/yui/worker/test/access.test.ts, /home/user/yui/worker/test/helpers.ts | F1-2, F1-3, F1-4 | T-1104-08 | 0.25 | 未着手 |
| T-1104-10 | 認証ミドルウェア `requireUser` の確認（実装済み: worker/src/auth.ts）: `ENVIRONMENT === "development"` のときだけ `X-Dev-User`（`@` を含む簡易検証、小文字化）を受理。それ以外は JWT のみ（ヘッダがあっても無視）。両方あるときは JWT を優先。`users` に upsert（`created_at` / `last_seen_at`）。`app.test.ts` のテストが S-5〜S-9 を覆っているか確認 | /home/user/yui/worker/src/auth.ts, /home/user/yui/worker/src/env.ts, /home/user/yui/worker/test/app.test.ts | S-5, S-6, S-7, S-8, S-9, F1-1, F1-2 | T-1104-08 | 0.25 | 未着手 |
| T-1104-11 | `GET /api/me` の確認（実装済み: worker/src/index.ts）: `{ user_id, display_name }`（`since` が余分に付いているが秘密ではないので残してよい）。初回アクセスで `users` に行ができ、2 回目で `last_seen_at` が更新される | /home/user/yui/worker/src/index.ts | F1-1 | T-1104-10 | 0.25 | 未着手 |
| T-1104-12 | 画面の骨格の差分確認（実装済み: web/src の App.vue、BottomNav.vue、WelcomeScreen.vue、TodayScreen.vue、TimelineScreen.vue、api.ts、date.ts）: ハッシュ（`#today` / `#past` / `#memory/<id>`）で S0〜S3 を切り替える処理を `composables/useScreen.ts` に切り出す（無ければ作る）、`GET /api/me` が 401 なら S0。「AI」「生成」「送信」を出さない | /home/user/yui/web/src/App.vue, /home/user/yui/web/src/composables/useScreen.ts, /home/user/yui/web/src/components/BottomNav.vue, /home/user/yui/web/src/screens/WelcomeScreen.vue, /home/user/yui/web/src/screens/TodayScreen.vue, /home/user/yui/web/src/screens/TimelineScreen.vue, /home/user/yui/web/src/api.ts | F1-5, F1-6, X-12, X-13, N-3, N-4 | T-1104-06, T-1104-11 | 0.5 | 未着手 |
| T-1104-13 | ローカル疎通: ターミナル 1 で `pnpm dev:worker`（8787）、ターミナル 2 で `pnpm dev`（5173）。`bash scripts/smoke.sh` で S-4〜S-7 を確認し、ブラウザ 5173 で S1 が開く（Vite proxy が `X-Dev-User` を付ける）。`pnpm preview` で 8787 一本の本番相当（Static Assets、SPA フォールバック）も確認 | （確認のみ） | S-4, S-5, S-6, S-7, S-11 | T-1104-04, T-1104-11, T-1104-12 | 0.5 | 未着手 |
| T-1104-14 | 既存の docs/setup-cloudflare.md（11 節構成）をレビューし、J-3 の結論（workers.dev か独自ドメインか）と `ACCESS_AUD` の取り方（Access アプリの Overview の AUD タグ）、`wrangler secret put ANTHROPIC_API_KEY`、`pnpm db:migrate:remote`、`pnpm deploy`、`wrangler tail` の記述が現状の wrangler.toml と scripts/smoke.sh に合っているかを確認して直す | /home/user/yui/docs/setup-cloudflare.md | S-3, S-10, S-11, N-9 | T-1104-01 | 0.5 | 未着手 |
| T-1104-15 | 【開発者】Access アプリを作り、`ACCESS_TEAM_DOMAIN` と `ACCESS_AUD` を `wrangler.toml` の `[vars]` に書く。ドメイン（J-3）を決めて `routes` を書く。`wrangler secret put ANTHROPIC_API_KEY` を実行する | /home/user/yui/wrangler.toml | S-10, N-8 | J-1, J-3, T-1104-14 | 1.0 | 未着手 |
| T-1104-16 | deploy dry-run と本番 deploy: `pnpm build`（dry-run）→ `pnpm run deploy`（`pnpm deploy` は pnpm 組み込みと衝突する）。ブラウザでメール OTP を経て S0/S1 が出る。JWT なしの curl で `/api/memories` が 401 または Access の 302、`/api/health` は Access 設定前なら 200（N-9）。未知パスが `index.html` を返す | （確認のみ。手順は docs/setup-cloudflare.md） | S-1, S-10, S-11, N-9 | T-1104-05, T-1104-15 | 0.5 | 未着手 |
| T-1104-17 | スモークテストは既存の scripts/smoke.sh（1444096）を正とし、docs に curl を重複して書かない。この日は `bash scripts/smoke.sh` と `EXPECT_PRODUCTION=1 bash scripts/smoke.sh "$URL"` の 2 系統が通ることだけ確認する。11/5 以降の API 追加に合わせて同スクリプトを育てる（記憶の登録 → facts → recalls → 写真 → 削除。T-1105-11、T-1107-00 で追記） | /home/user/yui/scripts/smoke.sh | S-4〜S-9 | T-1104-13 | 0.25 | 未着手 |
| T-1104-18 | 日の終わりの確認（デモが通るか）: 本番 URL でログイン → S1 が開く → タブで S2 に移る → 別ブラウザ（Access セッションなし）で Access のログイン画面が出る。通らなければ 11/5 の先頭で直す | （確認のみ） | F1-5, F1-6, S-10 | T-1104-16 | 0.5 | 未着手 |

11/4 合計: 7.0h（【開発者】の 1.5h を含む。残り 1.0h は R-1（Access の設定）の予備）

## 3. 11/5 文書の整合、記憶の登録、一覧・詳細・削除（F2 写真を除く、F3）

| ID | タスク | 成果物 | 受け入れ条件 | 依存 | 見積(h) | 状態 |
|---|---|---|---|---|---|---|
| T-1105-00 | 文書を J-7 の決定に揃える。requirements.md: 第2節「AI 処理の状態」と F3 / F4 / F5 の出力欄、F4-5、F5-2、F5-4、F5-9、F5-10、N-2、N-7、X-5 の `status: "pending" \| "done"` と `facts` / `recalls` 配列を `pending` / `items` に書き換える。F1 エラー時の「JWKS 取得失敗は 401」を 503 に直す（T-1104-08）。architecture.md: 5.10 の `{ decision }` を `{ status: "confirmed" \| "rejected" }` に、5 章冒頭の読み替えと 12 章 #4 を更新する。エラーコード名（architecture 5 章）とポーリング 30 秒（architecture 1.1 / 7.2、wireframes 2.6）、NFC 正規化なし（architecture 6.5 / 11.1）、`maxRetries: 0`（architecture 6.1 / 6.6）は既に揃っているので確認だけ | /home/user/yui/docs/requirements.md, /home/user/yui/docs/architecture.md | J-7 | なし | 0.5 | 未着手 |
| T-1105-01 | 入力検証（純粋関数）: 本文 trim 後 1〜2000 文字（`Array.from(body).length`）、`happened_on_precision` の 4 値、`day` / `month` / `year` の `happened_on` 正規化（`YYYY-MM-01`、`YYYY-01-01`）、`unknown` は NULL、実在しない日付の拒否、省略時は `Asia/Tokyo` の今日。テスト付き | /home/user/yui/worker/src/validate.ts, /home/user/yui/worker/test/validate.test.ts, /home/user/yui/worker/test/date-precision.test.ts | F2-2, F2-3, F2-4 | T-1104-02 | 0.75 | 完了 |
| T-1105-02 | キーセットカーソル: `(COALESCE(happened_on,''), created_at, id)` の base64url エンコード/デコード、壊れたカーソルの拒否。テスト付き | /home/user/yui/worker/src/cursor.ts, /home/user/yui/worker/test/cursor.test.ts | F3-3 | T-1104-02 | 0.5 | 完了 |
| T-1105-03 | `memories` の D1 アクセス層: INSERT、一覧（`ORDER BY COALESCE(happened_on,'') DESC, created_at DESC, id DESC`、limit 1〜50 既定 20）、1 件取得、DELETE。全クエリに `WHERE user_id = ?`。SQL を組む関数と実行する関数を分け、SQL 文字列をテスト | /home/user/yui/worker/src/db/memories.ts, /home/user/yui/worker/test/memories-sql.test.ts | F3-1, F3-2, F3-5, X-11 | T-1105-02 | 0.75 | 完了 |
| T-1105-04 | `POST /api/memories`（201。`ai_runs` の `running` 行を同期 INSERT する口と `waitUntil` の呼び出し口は空の関数で用意）と `GET /api/memories?cursor=&limit=`。エラー形式 `{ error: { code, message } }` は既存 errors.ts の `ApiError` を使い、`code` は J-7 (3) の 6 語だけにする | /home/user/yui/worker/src/routes/memories.ts, /home/user/yui/worker/src/errors.ts, /home/user/yui/worker/src/index.ts | F2-1, F2-2, F2-3, F2-4, F3-1, F3-2, F3-3 | T-1105-01, T-1105-03 | 0.75 | 完了 |
| T-1105-05 | `GET /api/memories/:id`（`memory` + `facts: { pending, items }` + `recalls: { pending, items }` + `recalled_by: { items }` の枠。この時点では `pending: false`、空配列）と `DELETE /api/memories/:id`（所有者確認 → `photo_key` があれば R2 削除 → D1 削除、CASCADE 確認、204。写真 API は 11/7 なのでこの日は `photo_key` NULL の経路だけ確認）。他人のものは 404 | /home/user/yui/worker/src/routes/memories.ts | F3-4, F3-5, X-10 | T-1105-04 | 0.75 | 完了 |
| T-1105-07 | 画面の API クライアントと型: architecture 5 章 + J-7 のレスポンス型、`createMemory` / `listMemories` / `getMemory` / `deleteMemory`（`putPhoto` は T-1107-00）。エラーは既存 api.ts の `ApiError(status, code, message)` を使う | /home/user/yui/web/src/api.ts, /home/user/yui/web/src/api/types.ts | F2-2, F3-6 | T-1105-04 | 0.5 | 完了 |
| T-1105-08 | S1 きょう: 入力欄（本文、空白のみなら「保存する」を無効）、起きた日（既定: 端末の今日、「いつ？」で日 / 月 / 年 / いつだったか）、保存 → 保存後の静かな状態。失敗時は本文を消さず「うまく保存できませんでした。もう少ししてから、もう一度」。写真ボタンは枠だけ置き、`PhotoPicker.vue` は T-1107-00 | /home/user/yui/web/src/screens/TodayScreen.vue, /home/user/yui/web/src/date.ts | F2-1, F2-2, F2-4, F2-9, X-13 | T-1105-07 | 1.0 | 完了 |
| T-1105-09 | S2 これまで: `MemoryCard.vue`（最初の一行、起きた日。精度に応じて「2024年6月」「2024年」「いつだったか」。サムネイルの枠は置くだけ）、1 ページ目 20 件、空状態「まだ何もありません。きょうのひとことから」、読み込み中は薄い「よみこみ中」、失敗は「読み込めませんでした」と再読み込み。「続きを読む」（カーソルで 2 ページ目以降）は T-1108-00 | /home/user/yui/web/src/screens/TimelineScreen.vue, /home/user/yui/web/src/components/MemoryCard.vue | F3-1, F3-6 | T-1105-07 | 0.75 | 完了 |
| T-1105-10 | S3 記憶の詳細: 本文全文、起きた日、「消す」→ 一度だけ確認（「この記憶を消しますか」「消す」「やめる」）→ 即時削除 → S2 へ。失敗は「消せませんでした」。写真（`/api/photos/...`）の枠、事実と札の枠は空のまま置く | /home/user/yui/web/src/screens/MemoryDetailScreen.vue, /home/user/yui/web/src/App.vue | F3-7, F3-4 | T-1105-09 | 1.0 | 完了 |
| T-1105-11 | 日の終わりの確認（デモが通るか）: ローカルで「スーパーで青梅を見かけた」を保存 → S2 に出る → S3 で本文 → 消す → 一覧から消える。scripts/smoke.sh に「登録 → 一覧 → 1 件取得 → 削除（204）→ 再取得 404」を追記して通す。本番 deploy は 11/7 の T-1107-08 でまとめて行う | /home/user/yui/scripts/smoke.sh | F2-1, F3-4, F3-7 | T-1105-08, T-1105-10 | 0.5 | 完了 |

11/5 合計: 7.75h（残り 0.25h は T-1105-00 の追従漏れの予備）。旧 T-1105-06（写真 PUT / GET）は T-1107-00 に移した（欠番）。超過したら T-1105-10 の確認ダイアログを素の `confirm()` にして 0.25h 稼ぐ。

## 4. 11/6 候補抽出とそういえば（F4, F5, C1, C2）、引用検証

| ID | タスク | 成果物 | 受け入れ条件 | 依存 | 見積(h) | 状態 |
|---|---|---|---|---|---|---|
| T-1106-01 | AI クライアントの境界 `ai/client.ts`: ADR-0005 どおり `output_config.format`（`{ type: "json_schema", schema }`）のみで呼ぶ。tool use は実装しない。`new Anthropic({ apiKey: env.ANTHROPIC_API_KEY, maxRetries: 0, timeout: 20_000 })` をリクエストごとに生成（再試行は SDK の自動分も 0。仕様 9 節、requirements N-7）、`model = env.ANTHROPIC_MODEL`、`max_tokens 4096`、`output_config.effort` を引数で受ける。入力「system + user + JSON Schema」→ 出力「パース済み JSON または失敗理由」。`content` の最初の `text` ブロックを `JSON.parse`。`stop_reason` が `refusal`（`error = refusal:<stop_details.category>`、null なら `refusal:unknown`）/ `max_tokens` は失敗。`usage` の token 数を返す。スキーマは全オブジェクトに `additionalProperties: false` を付ける。`@anthropic-ai/sdk` を依存に追加（この 1 つだけ）、`nodejs_compat` を wrangler.toml に追加。400 が返ったら SDK の版と `output_config` の綴りを疑う（R-4） | /home/user/yui/worker/src/ai/client.ts, /home/user/yui/package.json, /home/user/yui/wrangler.toml | N-7, N-7b, F4-1 | T-1105-11, J-1 | 1.0 | 未着手 |
| T-1106-02 | JSON Schema `recall` と `extract_facts`（architecture 6.2 / 6.3、`additionalProperties: false`）と、システムプロンプト（6.4: 会話しない、関係なければ空、逐語引用、創作しない、最大 3 件、断定しない、JSON 以外書かない）。固定文を先、可変を後。入力の XML 風タグは `<` `>` `&` `"` をエスケープ。`feedback` は入力に含めない | /home/user/yui/worker/src/ai/schemas.ts, /home/user/yui/worker/src/ai/prompts.ts | F6-4, X-2 | なし | 0.75 | 未着手 |
| T-1106-03 | 引用検証（純粋関数）: `evidence` が引用元 body の部分文字列か（`body.includes(evidence)`、空は不可。X-7 と仕様 9 節に従い NFC 正規化・trim・全角半角変換はしない。architecture 6.5 / 11.1 も同じ記述）、C1 の `related_memory_id` が送った id 集合にある・自分自身でない・重複なし・`reason` 1〜80 文字・先頭 3 件、C2 の `kind` 4 種・`date` 値の形（10 / 7 / 4 文字、実在）・(kind, value) の重複・先頭 10 件。demo/fixtures/ai/*.json を通し invalid/*.json を落とすテスト付き | /home/user/yui/worker/src/ai/verify.ts, /home/user/yui/worker/test/evidence.test.ts | X-6, X-7, F4-2, F4-7, F5-3, F5-7, F5-8 | なし | 1.0 | 未着手 |
| T-1106-04 | `ai_runs` の記録: `POST /api/memories` のハンドラ内で `running` を同期 INSERT（`facts` は常に、`recall` は過去記憶 1 件以上）→ `waitUntil` で `succeeded` / `empty` / `failed`（`error` は先頭 500 文字）へ。同じ `memory_id`・`kind` の 2 行目を作らない。`pending` 判定（`running` の行があり `created_at` から 60 秒以内）の SQL | /home/user/yui/worker/src/db/ai_runs.ts, /home/user/yui/worker/src/routes/memories.ts | N-5, N-7, F5-9, F5-10 | なし | 0.5 | 未着手 |
| T-1106-05 | C2 候補抽出の実行 `runFacts`: 本文と起きた日を入力 → 検証 → `memory_facts` に `status='candidate'`, `source='ai'` で `batch()` 保存。失敗は何も保存せず `failed`。`POST /api/memories` の `waitUntil` から呼ぶ。`effort` は `low` から | /home/user/yui/worker/src/ai/facts.ts, /home/user/yui/worker/src/db/facts.ts, /home/user/yui/worker/src/routes/memories.ts | F4-1, F4-2, F4-5, X-1 | T-1106-01〜04 | 1.0 | 未着手 |
| T-1106-06 | C1 想起の実行 `runRecall`: 同一ユーザーの過去記憶を `created_at DESC` 200 件（`confirmed` の事実だけ付ける、`feedback` は付けない）→ 0 件なら API を呼ばず `ai_runs` も作らない → 検証 → `recalls` に保存（`UNIQUE` 衝突は無視）。独立した `waitUntil`。記憶が先に削除されていたら例外を握って `failed`。`effort` は `medium` から | /home/user/yui/worker/src/ai/recall.ts, /home/user/yui/worker/src/db/recalls.ts, /home/user/yui/worker/src/routes/memories.ts | F5-1, F5-2, F5-3, F5-4, F5-5, N-1, N-6, X-4, X-11 | T-1106-05 | 1.0 | 未着手 |
| T-1106-07 | `GET /api/memories/:id/facts` → `{ pending, items }`（候補・確定・却下すべて）、`PATCH /api/facts/:id` ボディ `{ status: "confirmed" \| "rejected" }`（J-7 (2)。`decided_at` を設定。confirmed ⇄ rejected は許可、candidate には戻さない。200 で更新後の fact）、`GET /api/memories/:id/recalls` → `{ pending, items }`（`related_memory` を埋める）。他人のものは 404。`GET /api/memories/:id` の `facts` / `recalls` / `recalled_by` を埋める | /home/user/yui/worker/src/routes/facts.ts, /home/user/yui/worker/src/routes/recalls.ts, /home/user/yui/worker/src/routes/memories.ts | F3-8, F4-3, F4-4, F4-6, F5-6, X-1, X-3 | T-1106-05, T-1106-06 | 0.75 | 未着手 |
| T-1106-08 | 画面のポーリング `usePolling.ts`（2 秒間隔、facts と recalls の両方の `pending` が false で停止、打ち切りは J-7 (4) の 30 秒 = 15 回）と `FactChips.vue`（候補を本文の下に並べ「そう」「ちがう」。そう → moss 色の選択、ちがう → 薄く消える。`date` は「2026年6月ごろ」の形。楽観更新、失敗は元に戻す）。候補 0 件なら枠も見出しも出さない | /home/user/yui/web/src/composables/usePolling.ts, /home/user/yui/web/src/components/FactChips.vue, /home/user/yui/web/src/screens/TodayScreen.vue, /home/user/yui/web/src/api.ts | N-2, F4-3, F4-4, F4-5, F4-8, X-5 | T-1106-07 | 1.0 | 未着手 |
| T-1106-09 | `RecallCard.vue`: 「そういえば。」の見出し（font-display）、`reason`、「」で囲んだ `evidence`、昔の記憶の最初の一行と起きた日。初めて届いたときに `.rise`（600ms）で現れる。0 件なら何も描かず、「読み込み中」も出さない。タップで S3（昔の記憶）へ | /home/user/yui/web/src/components/RecallCard.vue, /home/user/yui/web/src/screens/TodayScreen.vue | X-8, N-12, F5-6, X-4 | T-1106-08 | 0.5 | 未着手 |
| T-1106-10 | 日の終わりの確認（デモが通るか）: ローカルに `.dev.vars` の API キーを入れた状態で D1（梅干し → 青梅、札 1 枚と引用）と D2（電気代、札 0 件、`ai_runs.status='empty'`）を画面と curl で通す。`ai_runs` の token 数と所要秒数を記録し、`effort` と J-5（opus のままか sonnet に下げるか）の判断材料を ADR-0005 の末尾に「実測」として追記する | /home/user/yui/docs/decisions/0005-structured-outputs-instead-of-forced-tool-choice.md（実測の追記。モデル、effort、所要秒数、token 数） | F4-1, F5-1, F5-2, X-4, N-1, N-5 | T-1106-09 | 0.5 | 未着手 |

11/6 合計: 8.0h。超過したら T-1106-09 の遷移（タップで S3）を 11/8 へ回す。

## 5. 11/7 写真、反応、デモ4本の通し、写真候補（F2 写真, F6, F7）

| ID | タスク | 成果物 | 受け入れ条件 | 依存 | 見積(h) | 状態 |
|---|---|---|---|---|---|---|
| T-1107-00 | 写真（11/5 から移動）: `PUT /api/memories/:id/photo`（multipart `photo`、`image/jpeg` / `image/png` のみ 415、10,485,760 バイト超 413、キー `photos/<user_id>/<memory_id>/<uuid>.<ext>`、`httpMetadata.contentType`。前の写真の削除は T-1108-00）と `GET /api/photos/*`（自分の `photos/<user_id>/` 配下だけ、`Cache-Control: private, max-age=3600`）。画面は `PhotoPicker.vue`（`accept="image/jpeg,image/png"`、プレビュー、Canvas で長辺 1600px・JPEG 0.85 に縮小、10MB 超は「写真が大きすぎるみたいです（10MB まで）」）、保存 → 写真 PUT、写真だけ失敗は「写真だけ、あとでもう一度」、S2 サムネイルと S3 の写真に `<img src="/api/photos/...">`。scripts/smoke.sh に PUT（手元の任意の JPEG）を追記 | /home/user/yui/worker/src/routes/photos.ts, /home/user/yui/worker/src/validate.ts, /home/user/yui/web/src/components/PhotoPicker.vue, /home/user/yui/web/src/screens/TodayScreen.vue, /home/user/yui/web/src/components/MemoryCard.vue, /home/user/yui/web/src/screens/MemoryDetailScreen.vue, /home/user/yui/web/src/api.ts, /home/user/yui/scripts/smoke.sh | F2-5, F2-6, F2-7, F2-8, F2-10 | T-1105-11 | 1.25 | 未着手 |
| T-1107-01 | `PATCH /api/recalls/:id`（`helpful` / `not_related` / `none`、何度でも変更可）。他人のものは 404。学習には使わない（入力に含めないことは T-1106-02 で担保） | /home/user/yui/worker/src/routes/recalls.ts, /home/user/yui/worker/src/db/recalls.ts | F6-1, F6-2, F6-3, F6-5 | T-1106-07 | 0.5 | 未着手 |
| T-1107-02 | 札の反応 UI: 「そうだった」（moss の印、札は残る）、「関係ないかも」（薄くなるが残る）、同じボタンをもう一度でトグルして `none`。楽観更新、失敗は印を戻し「記録できませんでした」。S3 の「関連する そういえば の履歴」にも同じ部品を使う | /home/user/yui/web/src/components/RecallCard.vue, /home/user/yui/web/src/screens/MemoryDetailScreen.vue | F6-1, F6-2, F6-3 | T-1107-01 | 1.0 | 未着手 |
| T-1107-03 | デモ用フィクスチャの整合確認（別担当が demo/fixtures/ に置いた seed.sql、scenarios.json、ai/*.json、invalid/*.json、README.md を使う。新規作成はしない）: 0001_init.sql の CHECK / FK / UNIQUE に seed.sql が合うこと（`pnpm db:seed:local` が通る）、ai/*.json の `evidence` が seed.sql の本文に逐語で含まれること（grep で確認）、scenarios.json の写真名が J-4（`park-flower.jpg`、`ume.jpg`）と一致すること。demo/photos/README.md の例 `d3-park-flower.jpg` は `park-flower.jpg` に直す必要があるが、demo/photos/ 配下は Claude Code の書き込み禁止なので開発者に修正を依頼する | /home/user/yui/demo/fixtures/seed.sql, /home/user/yui/demo/fixtures/scenarios.json, /home/user/yui/demo/fixtures/ai/*.json, /home/user/yui/demo/fixtures/invalid/*.json（いずれも確認のみ） | requirements 第7節 | T-1104-04 | 0.5 | 未着手 |
| T-1107-04 | デモ 4 本をローカルで通す（seed → D1 → D2 → D3（写真を添えて保存。F7 があれば写真候補、無ければ F4 の「場所: 公園」を「ちがう」）→ D4（「はると」を「そう」、札に「そうだった」））。各シナリオの所要秒数と、札・候補の実際の出力を記録する | /home/user/yui/demo/fixtures/README.md（通し手順と実際の結果） | D1〜D4 の担保条件（requirements 第7節） | T-1107-02, T-1107-03 | 1.5 | 未着手 |
| T-1107-05 | 通しで見つかった不具合の修正（プロンプトの調整、検証の抜け、画面の崩れ）。プロンプトを変えたら D2 が 0 件のままかを必ず再確認する | 該当ファイル | 同上 | T-1107-04 | 1.5 | 未着手 |
| T-1107-08 | 日の終わりの確認（デモが通るか）: 本番に deploy し、`pnpm db:seed:remote` は使わず（本番は実ユーザーのメール）実際のアカウントで D1〜D4 を手で入力して通す。所要秒数が 10 秒を超えるなら `effort` と過去記憶件数を見直す | （確認のみ） | N-1, N-9, requirements 第7節 | T-1107-05（T-1107-07 は任意） | 1.0 | 未着手 |

11/7 合計: 7.25h（上の表の行の合計。下の F7 は含めない）。

F7 写真からの気づき候補（P1）は残時間があれば。T-1107-04 / 05 が早く終わった時間で着手し、11/7 中に終わらなければ落とし、D3 は代替手順で通す。11/9 の F8 枠（3.5h）と差し替えてもよい。

| ID | タスク | 成果物 | 受け入れ条件 | 依存 | 見積(h) | 状態 |
|---|---|---|---|---|---|---|
| T-1107-06 | F7 Worker（P1、requirements F7 のとおり）: スキーマ `photo_hints`（`kind` は thing / place、最大 5 件、`additionalProperties: false`）、R2 から読んだ写真を base64 の画像ブロックで渡す、Worker で `kind` が thing / place 以外を捨て `(kind, value)` の重複を除き先頭 5 件。`memory_facts` に `source='ai'`, `status='candidate'`, `evidence='photo:<photo_key>'` で保存（X-6 / X-7 の引用検証は `evidence` が `photo:` で始まる候補には適用しない）。`ai_runs(kind='photo', status='running')` は `PUT /photo` のハンドラ内で作り `waitUntil` で 1 回だけ実行。写真なし、または R2 のオブジェクトが 6,291,456 バイト超なら作らない。写真の差し替え時は同じ `memory_id` の `photo` run が既にあれば作らない（N-5。前回の候補が残る。差し替えで再実行したくなったら N-5 の例外として requirements に追記してから） | /home/user/yui/worker/src/ai/photo.ts, /home/user/yui/worker/src/ai/schemas.ts, /home/user/yui/worker/src/ai/prompts.ts, /home/user/yui/worker/src/routes/photos.ts, /home/user/yui/worker/src/db/ai_runs.ts | F7-1, F7-4, F7-5, F7-6, F7-7, X-1 | T-1107-05, J-4 | 1.5 | 未着手 |
| T-1107-07 | F7 の画面と ADR: 写真候補は `evidence` が `photo:` で始まるものを「写真から」と添え、`value` に「でしょうか」を付けて `FactChips` と同じ並びに出す（引用「」は出さない）。「そう」「ちがう」は F4 と同じ `PATCH /api/facts/:id`（`confirmed` / `rejected`）。却下した候補は行として残り、再読み込み後は薄く残って F5 / F9 の入力に含まれない（F7-2）。新しい API は増やさず、`source='user'` の行も作らない。ADR-0006 に「写真候補を `source='ai'`, `evidence='photo:<photo_key>'` で D1 に残す」判断（requirements 第8節 #4）を記録し、architecture 4.3 の `source` 行（`user` を写真候補の確定に使う旧記述）を追従させる | /home/user/yui/web/src/components/FactChips.vue, /home/user/yui/docs/decisions/0006-photo-hints-storage.md, /home/user/yui/docs/architecture.md | F7-2, F7-3, X-1 | T-1107-06 | 1.0 | 未着手 |

## 6. 11/8 UI 磨きとエラー時の静かな振る舞い

| ID | タスク | 成果物 | 受け入れ条件 | 依存 | 見積(h) | 状態 |
|---|---|---|---|---|---|---|
| T-1108-00 | 11/5 から回した小物: `PUT /photo` で前の写真があれば R2 から削除してから差し替える（architecture 5.7）。S2 の「続きを読む」（`next_cursor` で 2 ページ目以降、重複も欠落もない） | /home/user/yui/worker/src/routes/photos.ts, /home/user/yui/web/src/screens/TimelineScreen.vue | F3-3, F2-5 | T-1107-08 | 0.75 | 未着手 |
| T-1108-01 | 文字組みと余白: 本文 17px / 行間 1.8、見出し 22〜28px（font-display）、補足 14px、本文列の最大幅 640px 中央寄せ、375px で横スクロールなし。角丸 16〜24px、影は薄く、縁は `line` | /home/user/yui/web/src/style.css, /home/user/yui/web/src/App.vue, 各 `.vue` | N-3, N-4, N-11 | T-1107-08 | 1.5 | 未着手 |
| T-1108-02 | 空状態と読み込み: S2 の空状態、S3 の事実・札が無いときは見出しごと出さない、保存直後の S1 は本文を残したまま静かに（候補と札が届くまで何も言わない）。スピナーは使わない | /home/user/yui/web/src/screens/TimelineScreen.vue, /home/user/yui/web/src/screens/MemoryDetailScreen.vue, /home/user/yui/web/src/screens/TodayScreen.vue | F3-6, X-4, X-5 | T-1108-01 | 1.0 | 未着手 |
| T-1108-03 | エラー時の静かな振る舞いの総点検: 保存失敗（本文を消さない）、写真だけ失敗、一覧失敗（再読み込み導線）、削除失敗、反応失敗、401（S0 へ戻す）、AI 失敗（何も出さない、ポーリングは止まる）。文言はすべて短い日本語で「AI」「生成」「送信」を使わない | /home/user/yui/web/src/api.ts, 各 `.vue` | F1-5, F2 エラー時, F3 エラー時, F6 エラー時, X-12 | T-1108-02 | 1.0 | 未着手 |
| T-1108-04 | 禁止語の機械チェック: `.vue` の `<template>` 内だけを対象に `grep -rnE "(^\|[^A-Za-z])AI([^A-Za-z]\|$)\|生成\|送信" web/src --include=*.vue` が 0 件（単語境界を付け、`MAIN` `DETAIL` のような識別子や `<script>` 内を拾わない。コメントは除外）。`grep -rn "#[0-9A-Fa-f]\{3,6\}" web/src --include=*.vue` が 0 件。結果を `package.json` の `check:words` script にする | /home/user/yui/package.json | X-12, N-11 | T-1108-03 | 0.5 | 未着手 |
| T-1108-05 | S3 の根拠の強調: 札から開いた昔の記憶で、`evidence` に一致する本文の範囲を `ember-soft` の地で強調する（`body.indexOf(evidence)` で分割、見つからなければ強調なし）。「関連する そういえば の履歴」（`recalls` と `recalled_by` の両方）を時系列で | /home/user/yui/web/src/screens/MemoryDetailScreen.vue, /home/user/yui/web/src/components/RecallCard.vue | F5-6, X-8 | T-1108-01 | 1.0 | 未着手 |
| T-1108-06 | 写真の見せ方: S2 のサムネイル（正方形、`object-fit: cover`、`loading="lazy"`）、S3 の写真（角丸、横幅いっぱい）、S1 の選択プレビュー。写真の縦横比が極端でも崩れない | /home/user/yui/web/src/components/MemoryCard.vue, /home/user/yui/web/src/screens/MemoryDetailScreen.vue, /home/user/yui/web/src/components/PhotoPicker.vue | N-3, N-4 | T-1108-01 | 1.0 | 未着手 |
| T-1108-07 | 触り心地: タップ領域 44px 以上、フォーカスリング（`ember`）、下部タブの安全領域（`viewport-fit=cover`、`env(safe-area-inset-bottom)`）、iOS でズームしないよう入力欄 16px 以上（`prefers-reduced-motion` は T-1104-06 で済み） | /home/user/yui/web/src/style.css, /home/user/yui/web/src/components/BottomNav.vue | N-3, N-12 | T-1108-01 | 0.25 | 未着手 |
| T-1108-08 | 日の終わりの確認（デモが通るか）: 本番に deploy し、スマホ実機（iPhone Safari と Android Chrome のどちらか 1 台以上）で D1〜D4 を通す。写真は実機のカメラロールから（HEIC が JPEG に変換されて届くかを確認。届かなければリスク R-5 の対処） | （確認のみ） | N-3, F2-5, requirements 第7節 | T-1108-02〜07 | 1.0 | 未着手 |

11/8 合計: 8.0h。超過したら T-1108-06 の縦横比対応と T-1108-05 の履歴の時系列並びを落とす。

## 7. 11/9 ふりかえり（余裕があれば）、README、デモ動画

| ID | タスク | 成果物 | 受け入れ条件 | 依存 | 見積(h) | 状態 |
|---|---|---|---|---|---|---|
| T-1109-01 | 午前の判断: 11/8 までの残課題が 0 なら F8 に着手。1 つでも残っていれば F8 を落とし、残課題 → README → 動画の順にする | （判断のみ。結果を本書の状態欄に書く） | なし | T-1108-08 | 0.0 | 未着手 |
| T-1109-02 | F8 ふりかえり（P1）の Worker: 人物（確定済み `person` の value）または期間で記憶を集め（0 件なら呼ばない）、スキーマ `retrospect`（段落ごとに `text` 200 文字以下、`memory_id`、`evidence`）、検証（`memory_id` が集めた集合にある、`evidence` が本文の部分文字列）、保存せず `ai_runs(kind='retrospect')` のみ記録。パスは `POST /api/retrospects`（requirements 第8節 #7） | /home/user/yui/worker/src/ai/retrospect.ts, /home/user/yui/worker/src/routes/retrospects.ts, /home/user/yui/worker/src/ai/schemas.ts, /home/user/yui/worker/src/ai/prompts.ts | F8-1, F8-2, F8-3, X-9 | T-1109-01 | 2.0 | 未着手 |
| T-1109-03 | S4 ふりかえりの画面: 人物（確定済み person の一覧から選ぶ）か期間を選んで語りを読む。段落タップで引用元の S3 へ。0 段落は「まだ語れるほど集まっていないようです」。導線は S2 の上部に小さく | /home/user/yui/web/src/screens/RetrospectScreen.vue, /home/user/yui/web/src/App.vue, /home/user/yui/web/src/api.ts | F8-4, X-9 | T-1109-02 | 1.5 | 未着手 |
| T-1109-04 | README 仕上げ: 何ができるか（3 つの原則）、デモの 4 シナリオ、仕組み（図は architecture 1 章から要約）、Claude の使いどころ（C1〜C3 と引用検証）、セットアップ（docs/setup-cloudflare.md へ）、スクリーンショット 3 枚（S1 に札が出た状態、S2、S3）、ライセンス。「ハッカソン期間内に書いた」ことを明記 | /home/user/yui/README.md, /home/user/yui/docs/screenshots/*.png | 提出要件 | T-1108-08 | 1.0 | 未着手 |
| T-1109-05 | デモ動画の台本: 3 分以内、スマホ縦。順に D1（梅干し → 青梅、札が静かに出る）→ D2（電気代、何も出ない。「出ない日があっていい」）→ D3（花の写真。F7 が通っていれば写真候補に「ちがう」、通っていなければ候補「場所: 公園」に「ちがう」。記憶に残らない）→ D4（はると、「そうだった」）。候補や札の文言は収録時の実出力を使い、台本には固定しない（「桜でしょうか」が出る保証はない）。字幕の文言に「AI」「生成」「送信」を使わない | /home/user/yui/docs/demo-script.md | requirements 第7節, X-12 | T-1109-04 | 0.5 | 未着手 |
| T-1109-06 | デモ動画の収録と書き出し: 本番環境、実機の画面収録。収録前に `ANTHROPIC_MODEL` と `effort` を固定、過去記憶は D1 / D4 の 2 件だけにした専用アカウントで。NG なら撮り直し（2 回まで）。字幕を付けて書き出し | 動画ファイル（リポジトリに入れない。提出フォームへ） | 提出要件 | T-1109-05 | 1.5 | 未着手 |
| T-1109-07 | 機能凍結と最終 deploy: `pnpm typecheck && pnpm test && pnpm build` → `pnpm run deploy` → 本番で D1〜D4 を最後に 1 回通す。以降は文言と README 以外を触らない | （確認のみ） | S-1, N-9, requirements 第7節 | T-1109-06 | 1.0 | 未着手 |

11/9 合計: 7.5h（F8 の 3.5h は余裕があるときだけ。無ければ 4.0h。11/7 の F7 を回す枠にもなる）。F9 検索（P1）は本計画に入れない（やらないことリスト参照）。

## 8. 11/10 提出

| ID | タスク | 成果物 | 受け入れ条件 | 依存 | 見積(h) | 状態 |
|---|---|---|---|---|---|---|
| T-1110-01 | README の最終読み合わせ（リンク切れ、スクリーンショット、セットアップ手順を別環境の目で追う） | /home/user/yui/README.md | 提出要件 | T-1109-07 | 0.5 | 未着手 |
| T-1110-02 | デモ動画のアップロード（提出フォームの指定先）と再生確認 | （フォーム） | 提出要件 | T-1109-06 | 0.5 | 未着手 |
| T-1110-03 | 提出フォーム記入: プロジェクト名「そういえば。」、一行説明、リポジトリ URL、動画 URL、Claude の使いどころ（C1〜C3 と引用検証を 3 文で）、チーム 1 名。提出前に J-8 の確認 | （フォーム） | 提出要件 | T-1110-01, T-1110-02 | 1.0 | 未着手 |
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
| @cloudflare/vitest-pool-workers による統合テスト | 1 人 1 週間ではセットアップ負担が大きい。scripts/smoke.sh で代替 | architecture 11.2 |
| HEIC の変換ライブラリ | JPEG / PNG のみ受け付ける。端末側変換に頼る | requirements 第8節 #5 |
| tool use（`tool_choice` 強制）の実装 | Structured Outputs に決定済み。二重実装しない | ADR-0005 |
| AI の再試行、キュー、バッチ | 失敗は静かに `failed`。SDK の `maxRetries` も 0。1 記憶あたり C1 1 回 + C2 1 回（+ C3 1 回）固定 | 仕様 5 節、9 節、requirements N-7 |
| AI とのチャット、人格、アバター、「質問する」導線 | 製品の核に反する | 仕様 3.2 節、X-13 |
| 自動タグの一括確定、自動アルバム | 推測を事実にしない | 仕様 3.2 節、原則 1 |
| ユーザー由来の fact を作る API（`POST /api/memories/:id/facts` など） | 仕様 8 節にも architecture 5 章にも無い。写真候補も `PATCH /api/facts/:id` で足りる | J-7 (5)、requirements F7 |
| D1 のバックアップ、複数環境（staging） | 期間中は不要 | 仕様 5 節 |
| スキーマ変更（0002 以降のマイグレーション） | 0001 で足りる。差異は値の形で吸収 | requirements 第8節 |

## 10. リスク表

| ID | リスク | 兆候 | 対処 | 影響するタスク |
|---|---|---|---|---|
| R-1 | Cloudflare Access の設定に時間がかかる（AUD タグ、ドメイン、OTP メールの到達、JWKS の `iss`） | 11/4 の T-1104-15 / 16 が夕方までに終わらない | 11/4 の残り 1.0h を充てる。それでも終わらなければ 11/4 中は本番認証を諦め、ローカル `X-Dev-User` で 11/5〜11/6 を進める。Access は 11/7 の T-1107-08 までに通ればよい。`workers.dev` を Access で守る形（J-3 既定）から始め、カスタムドメインは後回し。JWT 検証は T-1104-09 のテストで担保済み | T-1104-15, T-1104-16, T-1107-08 |
| R-2 | Anthropic API のレート制限、混雑（429 / 529）、応答が 10 秒を超える | `ai_runs.status='failed'` が続く、`error` に 429 / overloaded、D1 で札が 10 秒以内に出ない | 再試行はしない（`maxRetries: 0`。仕様 5 節・9 節、N-7。architecture 6.1 / 6.6 も 0）。`effort` を C2 `low`、C1 `medium` から始め、計測して下げる。過去記憶の送信を 200 → 100 件に落とす切替を env で持つ。デモ収録は過去記憶 2 件の専用アカウントで、混雑時間帯を避ける。ポーリング打ち切り後に開き直せば届く設計（architecture 1.1）なので動画は「少し待つ」カットを許容 | T-1106-10, T-1107-08, T-1109-06 |
| R-3 | D1 の書き込み制限（1 リクエストあたりの文数、`waitUntil` 中の接続、外部キー） | `waitUntil` 内の INSERT が失敗する、`D1_ERROR` | 候補・札の保存は `batch()` で 1 往復にまとめる。削除後に届いた結果は外部キー失敗を握って `failed`（architecture 4.6）。書き込み量は 1 記憶あたり数行なので無料枠で足りる。D1 の読み取りは一覧 20 件 + 過去 200 件に固定 | T-1106-05, T-1106-06, T-1105-05 |
| R-4 | 構造化出力の呼び方で 400 が返る（`output_config` の名称差、SDK の版） | T-1106-01 で 400 が返る | 方式は ADR-0005 で決定済み（Structured Outputs）。400 が出たら SDK の版と `output_config.format` の綴り、スキーマの `additionalProperties: false` を疑う。tool use の併設はしない。それでも駄目なら `claude-sonnet-5-5` で同じ呼び方を試す | T-1106-01, T-1106-10 |
| R-5 | 写真の HEIC（iPhone の既定形式）が JPEG に変換されず届く、または 10MB を超える | 415 / 413 が実機で出る | `accept="image/jpeg,image/png"` で Safari の自動変換に頼る。届かなければ画面で「写真は JPEG か PNG で」と案内し、デモは JPEG を事前に用意。縮小は T-1107-00 の Canvas（`canvas.toBlob("image/jpeg", 0.85)`）で画面側に実装済み（依存なし）。HEIC デコードのライブラリは入れない | T-1107-00, T-1108-08 |
| R-6 | 引用検証で正しい提案まで捨てる（モデルが句読点や空白を変える） | D1 で札が `empty` になる、`ai_runs` が `empty` 続き | プロンプトで「一字も変えない」を強調し、`evidence` は短め（1 文以内）を指示。検証は X-7 どおり完全一致のまま（緩めない）。捨てた件数を `console.log` に出して観察する | T-1106-03, T-1107-05 |
| R-7 | D2（電気代）で関係のない札が出る | D2 で 1 件以上保存される | システムプロンプトの「無理に結びつけない」「確かな 1 件」を強め、`effort` を上げる。D2 はプロンプト変更のたびに再確認（T-1107-05） | T-1106-02, T-1107-05 |
| R-8 | 1 人開発で見積超過 | 各日の「日の終わりの確認」が通らない | 翌日の P1（T-1107-06/07、T-1109-02/03）から落とす。11/8 の磨きは T-1108-00〜03 を優先。11/9 の午前に凍結判断（T-1109-01） | 全体 |
| R-9 | `wrangler` / Vite / Tailwind v4 のバージョン差で雛形が動かない | T-1104-02 で失敗 | ロックファイルに固定し、更新しない。`compatibility_date` は変えない | T-1104-01, T-1104-02 |
| R-10 | 本番でのデモ中に実データが混ざる | 動画に関係ない記憶が写る | デモ専用のメールアドレスでログインし、D1 / D4 の過去記憶だけを手で入れておく。seed SQL は本番には流さない | T-1107-08, T-1109-06 |

## 11. 日の終わりの確認（共通手順）

1. `pnpm typecheck && pnpm test && pnpm build` が終了コード 0
2. `pnpm dev:worker` を起動して `bash scripts/smoke.sh` を通す（その日の API 追加に合わせてスクリプトを育てる。docs に curl を重複して書かない）
3. その日の対象シナリオを画面で通す（11/4: ログイン、11/5: 登録〜削除、11/6: D1 と D2、11/7 以降: D1〜D4）
4. 通らなかった項目は、翌日の先頭タスクとして本書に追記する（ID は `T-mmdd-00` で割り込み。11/5、11/7、11/8 の `-00` は本書の時点で予約済みなので `-00b` のように枝番にする）
5. 本書の状態欄を更新し、「作ったもの / 次にすること / 開発者の判断が必要なこと」を報告する
