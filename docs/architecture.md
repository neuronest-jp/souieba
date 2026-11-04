# アーキテクチャ

「そういえば。」の技術構成。基本要件は docs/spec.md（以下「仕様」）。章番号は仕様のもの。
既定値は ADR-0003、デザインは ADR-0004、配布（Capacitor）と認証（招待コード + JWT）は ADR-0007 に従う。D1 スキーマは worker/migrations/（0001_init.sql、0002_login_attempts.sql）を正とする。

## 1. 全体図

```
 Capacitor アプリ（iOS / Android の WebView で Vue 3 SPA）        開発プレビュー（ブラウザ）
   origin: capacitor://localhost（iOS）/ https://localhost（Android）    http://localhost:5173（vite dev）
        │  HTTPS、VITE_API_BASE（https://<api-domain>）                   │  /api を 8787 へ中継（X-Dev-User を付与）
        │  Authorization: Bearer <JWT>                                    │  または pnpm preview（8787 一本）
        ▼                                                                ▼
 Cloudflare Worker「souieba」
   ├─ /api/*          → Hono（run_worker_first）。CORS は許可オリジン固定（3.4）
   │     ├─ POST /api/auth/login   … 招待コード + メール → HS256 JWT（90 日）。IP ごとに 1 分 10 回
   │     ├─ Bearer JWT 検証 → user_id（= sub = email）。development のみ X-Dev-User も可
   │     ├─ D1 "souieba"            … users / memories / memory_facts / recalls / ai_runs / login_attempts
   │     ├─ R2 "souieba-photos"     … 写真の実体
   │     └─ Anthropic API（@anthropic-ai/sdk）… C1 想起 / C2 候補抽出
   └─ それ以外        → Workers Static Assets（web/dist、SPA フォールバック）。開発用プレビューだけで、配布には使わない
```

- 配布はアプリストア経由ではなく、ハッカソン期間中は Xcode / Android Studio からのインストール（docs/setup-capacitor.md）。App Store / Play への提出は対象外
- アプリは画面を端末内に持ち、Worker には `/api/*` だけを呼ぶ。Worker の URL はビルド時の `VITE_API_BASE` で決まる

### 1.1 記憶を保存したときの流れ（仕様 5 章: 10 秒以内）

```
 画面                 Worker                            Anthropic API
  │ POST /api/memories  │                                     │
  │────────────────────▶│ D1 に memories を INSERT            │
  │                     │ ai_runs(kind=facts,  status=running)│
  │                     │ ai_runs(kind=recall, status=running)│  ← 過去記憶が 1 件以上あるときだけ
  │ 201 {memory}        │                                     │
  │◀────────────────────│ ctx.executionCtx.waitUntil(         │
  │                     │   runFacts(), runRecall() )  ──────▶│  C2 候補抽出
  │                     │                              ──────▶│  C1 想起
  │ GET .../facts   (2 秒ごと、最大 30 秒 = 15 回)            │
  │────────────────────▶│ pending=true …                       │
  │                     │ 検証（引用 ⊂ 本文）→ D1 に保存       │◀── JSON
  │                     │ ai_runs を succeeded / empty / failed │
  │ GET .../recalls     │                                     │
  │────────────────────▶│ pending=false, items=[…]             │
  │◀────────────────────│                                     │
```

- レスポンスは AI を待たずに返す。AI 呼び出しは `waitUntil` で続行する
- 画面は facts と recalls を 2 秒間隔でポーリングし、両方の `pending` が false になるか 30 秒（15 回）経ったら止める（requirements N-2）
- 30 秒以内に終わらなかった分は、次に詳細画面を開いたときに表示される（再試行はしない。仕様 9 章）
- 過去記憶が 0 件のときは C1 を起動せず、`ai_runs(kind=recall)` の行も作らない（requirements N-5。6.2）

## 2. リポジトリ構成と責務

仕様 13 章の構成をそのまま使う。単一 `package.json`（pnpm、ワークスペース無し）。

| パス | 責務 |
|---|---|
| `wrangler.toml` | ルートに置く。Worker 名 `souieba`、D1 / R2 バインディング、`[assets]`、`[vars]` |
| `vite.config.ts` | ルートに置く。`root: "web"`、`build.outDir: "dist"`（= `web/dist`）、`server.proxy` |
| `capacitor.config.ts` | ルートに置く。appId `jp.neuronest.souieba`、appName「そういえば。」、`webDir: "web/dist"`、地の色 `#FAF5EC`、SplashScreen / StatusBar の設定 |
| `ios/` `android/` | `cap add` が生成したネイティブプロジェクト。git にコミットする（`Pods/`、`build/`、`public/`、署名ファイルは除く。.gitignore とフックで保護） |
| `web/index.html` | SPA の入口。Google Fonts の link と `#app`。`viewport-fit=cover` |
| `web/src/` | Vue 3 + TS。`main.ts`、`App.vue`、`style.css`、`api.ts`（API クライアント。`VITE_API_BASE`、Bearer、401 で `souieba:unauthorized`）、`auth.ts`（トークンの保持。`@capacitor/preferences`）、`camera.ts`（写真の取得。ネイティブは `@capacitor/camera`、Web は `<input type="file">`）、`native.ts`（ステータスバーとスプラッシュ。Web では何もしない）、`photo.ts`（縮小）、`date.ts`、`screens/`（S0〜S3）、`components/`、`composables/` |
| `web/.env.example` | `VITE_API_BASE` の見本。実際の値は `web/.env.production` / `web/.env.local`（git に入れない） |
| `worker/src/` | Hono。`index.ts`（app とルート登録）、`jwt.ts`（HS256 の署名と検証、定数時間比較。純粋ロジック）、`auth.ts`（認証ミドルウェア。Bearer と `X-Dev-User` の振り分け）、`cors.ts`（許可オリジン）、`routes/auth.ts`（`POST /api/auth/login`）、`env.ts`、`errors.ts`、`routes/`、`ai/`（prompt・schema・検証）、`db/`、`r2.ts` |
| `worker/migrations/` | D1 マイグレーション。`0001_init.sql`（記憶のスキーマ。変更しない）と `0002_login_attempts.sql`（ログインのレート制限） |
| `worker/test/` | vitest（Node 環境）の単体テスト |
| `demo/fixtures/` | デモ 4 シナリオの JSON と seed SQL |
| `demo/photos/` | 開発者が置く。Claude Code は書き込まない |
| `docs/` | 仕様、要件、本書、ワイヤーフレーム、タスク、Cloudflare 手順、ADR |

### 2.1 wrangler.toml の要点

```toml
name = "souieba"
main = "worker/src/index.ts"
compatibility_date = "2026-11-01"
compatibility_flags = ["nodejs_compat"]   # @anthropic-ai/sdk のため

# 当面（tasks J-3）: workers_dev = true（既定）のまま *.workers.dev を API の URL にする（アプリの VITE_API_BASE に書く）。
# カスタムドメインが用意できたら、次の 2 行をセットで有効にする（片方だけだとどの URL からも到達できなくなる）。
# URL を変えたらアプリを VITE_API_BASE を変えてビルドし直す。
# workers_dev = false
# routes = [{ pattern = "souieba.<domain>", custom_domain = true }]

[assets]
directory = "web/dist"
binding = "ASSETS"
not_found_handling = "single-page-application"
run_worker_first = ["/api/*"]              # /api/* だけ Worker、それ以外は Static Assets

[[d1_databases]]
binding = "DB"
database_name = "souieba"
database_id = "<setup-cloudflare.md の手順で埋める>"
migrations_dir = "worker/migrations"       # 既定は ./migrations なので必須。無いと db:migrate:local が何も見つけない

[[r2_buckets]]
binding = "PHOTOS"
bucket_name = "souieba-photos"

[vars]
ENVIRONMENT = "production"
ANTHROPIC_MODEL = "claude-opus-5-5"       # 既定。コスト優先時は claude-sonnet-5-5（ADR-0003 / 0005）
APP_VERSION = "0.1.0"
# 秘密（ANTHROPIC_API_KEY, INVITE_CODE, JWT_SECRET）は wrangler secret put で入れる。ここには書かない
```

- `/api/*` 以外は Worker のコードを通らず Static Assets が返す。SPA の深いパス（`/#/...` ではなく `/memories/x` のような形）を使わないので `single-page-application` でも実害はないが、念のため指定する
- `web/dist` は git に入れない。`pnpm build:web` が生成し、Static Assets（開発プレビュー）と `cap sync`（アプリ）の両方がこれを使う

## 3. 認証（仕様 10 章、F1、ADR-0007）

招待コード + メールアドレスで Worker が JWT を発行し、アプリはそれを保持して `Authorization: Bearer` で送る。Cloudflare 側の前段認証は置かない（Capacitor の WebView の origin `capacitor://localhost` では Cookie もログインリダイレクトも成立しない。ADR-0007）。パスワード、メール送信、外部 IdP は無い。

### 3.1 ログイン: POST /api/auth/login（worker/src/routes/auth.ts）

| 手順 | 内容 |
|---|---|
| 1 | `INVITE_CODE` と `JWT_SECRET`（wrangler secret）が無ければ 503 `auth_unavailable`「いま、ログインの準備ができていません」。`console.error` に残す |
| 2 | 本文 JSON `{ invite_code, email }` を読む。JSON でない、どちらかが空、`email` が `^[^\s@]+@[^\s@]+\.[^\s@]+$` に合わない、または 255 文字以上なら 400 `validation`。`email` は trim して小文字化 |
| 3 | レート制限: 呼び出し元 IP（`cf-connecting-ip`、無ければ `getConnInfo`、取れなければ `"unknown"`）で `login_attempts` を数え、直近 60 秒に 10 件以上なら 429 `too_many`「少し待ってから、もう一度お試しください」。この時点では行を増やさない |
| 4 | `invite_code` と `INVITE_CODE` を定数時間比較（`timingSafeEqual`。長さ違いも同じ時間）。結果を `login_attempts (id, ip, ok, created_at)` に 1 行 INSERT |
| 5 | 不一致なら 401 `unauthorized`「招待コードかメールアドレスが違います」。コードとメールのどちらが違うかは言わない |
| 6 | 一致なら `{ sub: email, iat: now, exp: now + 90 日 }` を `JWT_SECRET` で HS256 署名し、200 `{ token, expires_at, user_id }` を返す |

- JWT は `worker/src/jwt.ts` に WebCrypto（`HMAC` / `SHA-256`）で書く。外部ライブラリは入れない。鍵は `JWT_SECRET` の 1 本だけで、鍵の取得や `kid` の解決は無い
- 招待コードは全員で 1 つ。ユーザーの識別はメールアドレスで、メールの所有確認はしない（招待コードを渡した相手だけが使う前提。ハッカソン期間の割り切り）
- 失効（ログアウト）は作らない。90 日で切れる。`JWT_SECRET` を変えると全員のトークンが無効になる（`wrangler secret put JWT_SECRET` で入れ直すだけ）
- `login_attempts` は増え続けるが、1 分 10 回の上限があるので量は小さい。期間中は掃除しない

### 3.2 Bearer の検証（worker/src/auth.ts `requireUser`）

`/api/health` と `/api/auth/*` 以外の `/api/*` に掛ける。

| 手順 | 内容 |
|---|---|
| 1 | `Authorization` ヘッダがあれば `Bearer <token>` の形を確認。形が違えば 401（`bad_authorization`） |
| 2 | `JWT_SECRET` が無ければ 401（`not_configured`。ログに出る） |
| 3 | `verifyJwt`: 3 分割、ヘッダの `alg === "HS256"`（`none` や RS256 は拒否）、`crypto.subtle.verify` で署名、`exp > now`、`sub` が `@` を含む文字列、`iat` が数値。どれかが落ちれば 401 |
| 4 | `sub` を小文字化してメールの形を確認し、`user_id` にする |
| 5 | `Authorization` が無く `ENVIRONMENT === "development"` のときだけ `X-Dev-User: <email>` を受け付ける（3.3）。それも無ければ 401（`no_credentials`） |
| 6 | 401 の本文は常に `{"error":{"code":"unauthorized","message":"ログインが必要です"}}`。理由コードは本文に出さず `console.warn("auth rejected", { reason, path })` にだけ残す（`wrangler tail` で見る） |
| 7 | `users` に upsert（初回は `created_at`、毎回 `last_seen_at`）。Hono の `c.set("user", …)` に載せる |

### 3.3 ローカル代替: X-Dev-User

- `ENVIRONMENT === "development"` のときだけ `X-Dev-User: <email>` を受け付け、JWT 検証を省略する。`Authorization` と両方あれば JWT を使う
- `ENVIRONMENT` が development 以外なら、このヘッダは読まない（存在しても無視して 401）
- ローカルでは `pnpm dev:worker` / `pnpm preview` が `wrangler dev --var ENVIRONMENT:development --var INVITE_CODE:dev --var JWT_SECRET:dev-only-secret` で起動する（9.2）。開発専用の既定値なので、ローカルでも招待コード `dev` でログインの流れを試せる。`.dev.vars` があればそちらが優先。`wrangler.toml` の `[vars]` は `production` のままなので、デプロイ先で誤って有効になることはない

### 3.4 CORS（worker/src/cors.ts）

| 項目 | 値 |
|---|---|
| 許可オリジン | `capacitor://localhost`（iOS）、`https://localhost`（Android）、`http://localhost:5173`（vite dev）、`http://localhost`。それ以外には `Access-Control-Allow-Origin` を返さない |
| メソッド | GET / POST / PUT / PATCH / DELETE / OPTIONS |
| 許可ヘッダ | `Authorization`、`Content-Type`、`X-Dev-User` |
| credentials | false（Cookie は使わない） |
| maxAge | 600 秒 |

値はコードに固定し、環境変数にしない（Cloudflare 側の設定も不要）。`/api/*` 全体に `app.use("/api/*", apiCors())` で掛ける。

### 3.5 トークンの保存（web/src/auth.ts）

| 項目 | 内容 |
|---|---|
| 置き場所 | `@capacitor/preferences`。iOS は `UserDefaults`、Android は `SharedPreferences`、Web（開発プレビュー）は `localStorage`。キーは `souieba.token`（JWT）と `souieba.user`（メール） |
| 読み込み | 起動時に `loadToken()` で 1 回読み、以後はメモリにキャッシュ（`getTokenSync()`）。`api.ts` は毎リクエストで `Authorization: Bearer` を付ける（`auth: false` の `health` / `login` を除く） |
| 401 を受けたら | `clearToken()` して `window.dispatchEvent(new Event("souieba:unauthorized"))`。`App.vue` が受けて S0 に戻す（wireframes 0 節） |
| ネットワーク断 | `ApiError(0, "network", "いま、うまくつながりません")`。トークンは消さない |
| 本番の URL | `VITE_API_BASE`（ビルド時）。Web の開発では空で同一オリジンの `/api` |

### 3.6 到達経路の担保

| 対策 | 内容 |
|---|---|
| 認証なしで到達できる口 | `GET /api/health`（死活確認。秘密は返さない）と `POST /api/auth/login`（レート制限あり）だけ。それ以外の `/api/*` は常に Bearer を検証する |
| Static Assets | 画面の静的ファイルは誰でも取得できるが、データは API 経由でしか出ないので問題ない。配布には使わない（開発プレビュー） |
| 入口の URL | 当面は `souieba.<account>.workers.dev`。カスタムドメインに変えるときは `routes`（custom_domain）と `workers_dev = false` をセットで入れ、アプリの `VITE_API_BASE` を変えてビルドし直す |
| 招待コードの総当たり | 12 文字以上のランダム文字列（setup-cloudflare.md）+ 1 分 10 回の制限。定数時間比較で長さや前方一致を漏らさない |

本番の受け入れ条件は「`Authorization` なしの curl で `/api/memories` が 401、`X-Dev-User` だけでも 401、`/api/health` は 200、`POST /api/auth/login` に正しいコードで 200 → その `token` で `/api/me` が 200」（requirements N-9 / S-10、setup-cloudflare.md 7 節）。

## 4. データモデル（仕様 7 章、0001_init.sql）

ID は UUID 文字列（`crypto.randomUUID()`）。日時は ISO 8601 の UTC 文字列。D1 は外部キー制約を有効にして動くため、`ON DELETE CASCADE` が効く。

### 4.1 users

| 列 | 意味 |
|---|---|
| id | メールアドレス（JWT の `sub`、小文字。ローカルでは `X-Dev-User`）。user_id として全テーブルから参照 |
| display_name | 表示名。初期は NULL（画面はメールのローカル部を仮表示） |
| created_at / last_seen_at | 初回 / 直近の API 呼び出し時刻 |

### 4.2 memories

| 列 | 意味 |
|---|---|
| user_id | 所有者。すべてのクエリで `WHERE user_id = ?` を付ける |
| body | ひとこと本文。1〜2000 文字（CHECK と Worker の両方で検証） |
| happened_on | 起きた日 `YYYY-MM-DD`。precision が `unknown` のときは NULL |
| happened_on_precision | `day` / `month` / `year` / `unknown`。`month` のときは `YYYY-MM-01`、`year` のときは `YYYY-01-01` を happened_on に入れ、画面は精度に応じて「2024年6月」「2024年」と表示する |
| photo_key / photo_content_type | R2 のキーと MIME。写真なしは NULL |
| created_at / updated_at | 登録 / 更新時刻 |

一覧の並び順（F3「起きた日の降順」）: `ORDER BY COALESCE(happened_on, '') DESC, created_at DESC, id DESC`。日付不明は末尾に来る。

### 4.3 memory_facts（C2 の候補と確定事実）

| 列 | 意味 |
|---|---|
| kind | `person` / `place` / `date` / `thing` |
| value | 正規化した値。`date` は `YYYY-MM-DD` / `YYYY-MM` / `YYYY` のいずれか（精度に対応） |
| status | 下記の状態遷移 |
| source | `user`（写真候補 F7 を確定したとき。requirements 第8節 #4）/ `ai`（C2 の候補） |
| evidence | 本文からの逐語引用。`source = 'ai'` では必須（CHECK） |
| decided_at | confirmed / rejected にした時刻 |

状態遷移:

```
 candidate ──「そう」──▶ confirmed
     │                       ▲  │
     └──「ちがう」──▶ rejected ◀─┘   （confirmed ⇄ rejected は訂正として許可。candidate には戻さない）
```

- 検索（P1）と想起の入力に使うのは `confirmed` だけ（原則 1）
- `rejected` は画面に出さないが、行としては残す（D3「候補は確定されず記憶に残らない」の記録。C2 は登録直後に 1 回しか走らないので、再提示の抑止には使わない）
- 日付精度は facts には列がないため、`value` の長さ（10 / 7 / 4 文字）で表す。候補の `date_precision` は value の形に変換して保存する

### 4.4 recalls（「そういえば。」の札）

| 列 | 意味 |
|---|---|
| memory_id | 新しく書いた記憶（札が付く側） |
| related_memory_id | 思い出された昔の記憶。同一ユーザーのものに限る（Worker で検証） |
| reason | なぜ関係があるか（短文、画面に出す） |
| evidence | related 側 body からの逐語引用（検証済み） |
| feedback | `none` → `helpful`（そうだった）/ `not_related`（関係ないかも）。何度でも変更可。学習には使わない（F6） |

`UNIQUE (memory_id, related_memory_id)` により同じ組は 1 枚だけ。

### 4.5 ai_runs（記録のみ、画面に出さない）

```
 running ──▶ succeeded   （1 件以上保存した）
         ──▶ empty       （0 件。関係なし、または検証で全件破棄）
         ──▶ failed      （API エラー、タイムアウト、JSON 不正、stop_reason が refusal / max_tokens）
```

`input_tokens` / `output_tokens` はレスポンスの `usage` から、`error` は例外メッセージの先頭 500 文字を入れる。`memory_id` は参照制約を持たないので、記憶削除後も記録は残る。

### 4.6 削除（F3、原則 5）

`DELETE /api/memories/:id` の順序:

1. 所有者確認（`user_id` 一致、無ければ 404）
2. `photo_key` があれば R2 の `delete(photo_key)`（失敗しても続行し、`console.error` に残す）
3. `DELETE FROM memories WHERE id = ? AND user_id = ?`
4. CASCADE で `memory_facts`、`recalls`（memory_id 側も related_memory_id 側も）が消える。他の記憶に付いていた札も、この記憶を指すものは消える
5. 進行中の `waitUntil` が後から結果を保存しようとした場合、`memories` が無いので INSERT が外部キーで失敗する。例外は握りつぶして `ai_runs.status = failed` にする

### 4.7 login_attempts（0002_login_attempts.sql。認証のレート制限）

| 列 | 意味 |
|---|---|
| id | UUID |
| ip | 呼び出し元 IP（`cf-connecting-ip`）。取れなければ `unknown` |
| ok | 1 = 招待コード一致、0 = 不一致 |
| created_at | 試行時刻（ISO 8601） |

`idx_login_attempts_ip_time (ip, created_at)` で直近 1 分の件数を数える（3.1）。ユーザーとは結び付けない（ログイン前なので `user_id` が無い）。

## 5. API 仕様（仕様 8 章）

共通:

- すべて `/api/*`、JSON（写真の PUT と GET を除く）。`/api/health` と `POST /api/auth/login` 以外は 3 章の認証（`Authorization: Bearer`）が必要
- 他ユーザーの資源は存在しないものとして扱い 404 を返す（403 で存在を漏らさない）
- エラー形式: `{"error": {"code": "...", "message": "..."}}`。`message` は日本語で、画面にそのまま出せる短い文
- requirements.md との読み替え（tasks J-7）: requirements の `{status: "pending"|"done", facts|recalls: [...]}` は本書の `{pending: boolean, items: [...]}` に、`PATCH /api/facts/:id` の本体は requirements と同じ `{status: "confirmed" | "rejected"}`（tasks J-7 (2)。保存する値と同じ語）。エラーコード名は requirements の短い形（`validation` / `too_large` / `unsupported_media`）に本書を揃えた

| code | HTTP | 例 |
|---|---|---|
| `unauthorized` | 401 | Bearer が無い / 無効 / 期限切れ。`POST /api/auth/login` では招待コードの不一致 |
| `validation` | 400 | 本文が空、精度の値が不正、日付の形式違い。ログインではコードかメールが空、メールの形が違う |
| `not_found` | 404 | 記憶・候補・札が無い、または他ユーザーのもの |
| `too_large` | 413 | 写真が 10MB 超 |
| `unsupported_media` | 415 | JPEG / PNG 以外 |
| `too_many` | 429 | `POST /api/auth/login` が同一 IP から 1 分に 10 回を超えた |
| `internal` | 500 | D1 / R2 の失敗。詳細は返さない（worker/src/index.ts の `onError` が使っている名前） |
| `auth_unavailable` | 503 | `INVITE_CODE` / `JWT_SECRET` が未設定（ログインできない） |

### 5.0 POST /api/auth/login（認証不要）

```json
→ {"invite_code": "<招待コード>", "email": "You@Example.com"}
200 {"token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJ5b3VAZXhhbXBsZS5jb20iLCJpYXQiOjE3NjIyMjQwMDAsImV4cCI6MTc3MDAwMDAwMH0.…",
     "expires_at": "2027-02-02T01:23:45.000Z", "user_id": "you@example.com"}
```

- 検証と手順は 3.1。401 の本文は `{"error":{"code":"unauthorized","message":"招待コードかメールアドレスが違います"}}`、429 は `too_many`、400 は `validation`、503 は `auth_unavailable`
- `token` は HS256 の JWT `{ sub, iat, exp }`。有効 90 日。アプリは `@capacitor/preferences` に保存し、以後 `Authorization: Bearer <token>` を付ける（3.5）
- CORS のプリフライト（`OPTIONS`）は `apiCors()` が返す。許可オリジン以外からは `Access-Control-Allow-Origin` が付かない

### 5.1 GET /api/health（認証不要）

```json
200 {"ok": true, "service": "souieba", "version": "0.1.0", "time": "2026-11-04T01:23:45.000Z"}
```

### 5.2 GET /api/me

```json
200 {"user_id": "dev@example.com", "display_name": null, "since": "2026-11-04T01:23:45.000Z"}
```

### 5.3 GET /api/memories?cursor=&limit=20

```json
200 {
  "items": [
    {"id": "9b1c…", "body": "スーパーで青梅を見かけた", "happened_on": "2026-11-04",
     "happened_on_precision": "day", "photo_key": "photos/you@example.com/9b1c…/a1.jpg",
     "created_at": "2026-11-04T01:23:45.000Z"}
  ],
  "next_cursor": "eyJoIjoiMjAyNi0xMS0wNCIsImMiOiIuLi4iLCJpIjoiOWIxYy4uLiJ9"
}
```

- `limit` は 1〜50、既定 20。`next_cursor` は最後の行の `(COALESCE(happened_on,''), created_at, id)` を base64url にしたキーセットカーソル。末尾では null
- 一覧は本文全文を返す（画面側で 1 行目だけ表示）。2000 文字 × 20 件なので許容

### 5.4 POST /api/memories

```json
→ {"body": "スーパーで青梅を見かけた", "happened_on": "2026-11-04", "happened_on_precision": "day"}
201 {"id": "9b1c…", "body": "…", "happened_on": "2026-11-04", "happened_on_precision": "day",
     "photo_key": null, "photo_content_type": null,
     "created_at": "…", "updated_at": "…"}
```

- 検証: `body` は trim 後 1〜2000 文字（`Array.from(body).length`。F2-3）。`happened_on_precision` は省略時 `day`。`unknown` なら `happened_on` は無視して NULL。`day` は `YYYY-MM-DD`、`month` は `YYYY-MM`（`-01` を補う）、`year` は `YYYY`（`-01-01` を補う）。未来日は許可（予定を書く人もいる）
- `happened_on` は画面がユーザーのローカル日付で付ける。省略（`undefined` / `null`）なら Worker が `Asia/Tokyo` の今日を補う（`validate.ts` の `todayInTokyo`。requirements F2 既定値）。空文字は「消した」状態なので 400 `validation`
- 成功後、`waitUntil` で C2（facts）と C1（recall）を起動する（6 章）

### 5.5 GET /api/memories/:id

```json
200 {
  "memory": {"id": "9b1c…", "body": "…", "happened_on": "…", "happened_on_precision": "day",
             "photo_key": "…", "photo_content_type": "image/jpeg", "created_at": "…", "updated_at": "…"},
  "facts":       {"pending": false, "items": [ …5.9 と同じ… ]},
  "recalls":     {"pending": false, "items": [ …5.11 と同じ… ]},
  "recalled_by": {"items": [
    {"id": "r02…", "reason": "…", "evidence": "…", "feedback": "none", "created_at": "…",
     "memory": {"id": "c3d4…", "body": "…全文…", "happened_on": "2026-11-04",
                "happened_on_precision": "day", "photo_key": null}}
  ]}
}
```

- `recalls` はこの記憶が新しい側（`memory_id`）の札、`recalled_by` はこの記憶が思い出された側（`related_memory_id`）の札。仕様 6 章 S3「関連する『そういえば。』の履歴」は両方を並べる
- `recalled_by` の `memory` は札が付いた新しい方の記憶。`pending` は持たない（他の記憶の想起が進行中かどうかはこの画面に関係しない）

### 5.6 DELETE /api/memories/:id

`204`（本文なし）。4.6 の順序で削除。

### 5.7 PUT /api/memories/:id/photo（multipart/form-data、フィールド名 `photo`）

```json
200 {"photo_key": "photos/you@example.com/9b1c…/3f2a….jpg", "photo_content_type": "image/jpeg"}
```

- 許可する MIME: `image/jpeg`、`image/png`。サイズ 10MB 以下。`Content-Length` と実体の両方で確認
- キーは `photos/<user_id>/<memory_id>/<uuid>.<jpg|png>`。前の写真があれば R2 から削除してから差し替える
- R2 `put` に `httpMetadata.contentType` を付ける
- HEIC は受け付けない。ネイティブでは `@capacitor/camera` が JPEG（品質 85、長辺 1600px）で返す。Web のフォールバック `<input type="file" accept="image/jpeg,image/png">` は iOS の Safari が JPEG に変換して渡す

### 5.8 GET /api/photos/*

- `*` は 5.7 のキー全体。先頭が `photos/<自分の user_id>/` でなければ 404
- `200` で R2 のボディを流す。`Content-Type` は保存したもの、`Cache-Control: private, max-age=3600`
- 認証は他の API と同じ Bearer（3.2）。画面は `photoUrl(key)` = `${VITE_API_BASE}/api/photos/<key>` を `<img src>` に入れている（Web の開発では Vite の proxy が `X-Dev-User` を付けるので表示できる）
- **解消済み（web/src/components/PhotoImg.vue が Bearer 付きで取得して blob URL で表示する。T-1107-00b）（ADR-0007 の追従漏れ）**: `<img src>` は `Authorization` ヘッダを付けられないため、ネイティブアプリでは写真の GET が 401 になる。対処の候補は (a) 画面側で `fetch` + Bearer → `URL.createObjectURL` で描く（Worker の変更なし。`web/src/api.ts` に `fetchPhoto` を足し、`MemoryCard` / `MemoryDetailScreen` / `TodayScreen` の `<img>` を置き換える）、(b) 短命の署名付きクエリ（`?t=<JWT>`）を許す。(a) を既定とし、tasks.md の 11/7 に T-1107-00b として置く
- 仕様 8 章の `/api/photos/:key` は Hono の `/api/photos/*` で受ける（キーに `/` と `@` を含むため）。画面は `photo_key` をそのまま `/api/photos/` に連結し、スラッシュをエンコードしない

### 5.9 GET /api/memories/:id/facts

```json
200 {
  "pending": false,
  "items": [
    {"id": "f01…", "kind": "person", "value": "おばあちゃん", "status": "candidate",
     "source": "ai", "evidence": "おばあちゃんは毎年6月になると", "created_at": "…", "decided_at": null}
  ]
}
```

- `pending` は `ai_runs(kind='facts', memory_id=?)` の最新が `running` のとき true。記録が無いとき（seed データなど）は false
- `rejected` も返す（画面は出さない）。画面は candidate を「候補」、confirmed を「事実」として描く

### 5.10 PATCH /api/facts/:id

```json
→ {"status": "confirmed"}      または {"status": "rejected"}
200 {"id": "f01…", "status": "confirmed", "decided_at": "…"}
```

### 5.11 GET /api/memories/:id/recalls

```json
200 {
  "pending": false,
  "items": [
    {"id": "r01…", "reason": "同じ青梅と梅干しの記憶",
     "evidence": "おばあちゃんは毎年6月になると、庭の梅で梅干しを漬けていた",
     "feedback": "none", "created_at": "…",
     "related_memory": {"id": "77ab…", "body": "…全文…", "happened_on": "2019-06-10",
                        "happened_on_precision": "month", "photo_key": null}}
  ]
}
```

- `pending` の判定は 5.9 と同じ（`kind='recall'`）
- 画面は `pending=false` かつ `items` が空なら何も出さない（F5「静かに」）

### 5.12 PATCH /api/recalls/:id

```json
→ {"feedback": "helpful"}      // "helpful" | "not_related" | "none"
200 {"id": "r01…", "feedback": "helpful"}
```

### 5.13 POST /api/memories/:id/retrospect（P1、F8）

本書では枠だけ決める。`→ {"axis": "person", "value": "はると"}` または `{"axis": "period", "from": "2024-01", "to": "2024-12"}`。レスポンスは `{"paragraphs": [{"text": "…", "memory_id": "…", "evidence": "…"}]}`。保存はしない（毎回生成、`ai_runs.kind='retrospect'` に記録）。実装は 11/9 に時間があれば。

## 6. AI 呼び出し（仕様 2 章、9 章）

### 6.1 方式: JSON Schema による形の固定

ADR-0005 に従い Structured Outputs を採用する。仕様 9 章は「tool use で JSON Schema を強制（`tool_choice: {type: "tool"}`）」としているが、既定モデル `claude-opus-5-5` とコスト優先時の `claude-sonnet-5-5`（ADR-0003 / 0005）は、強制 `tool_choice`（`any` / `tool`）を 400 で拒否する（`auto` のみ）。目的は「必ずスキーマ通りの JSON を 1 つ受け取る」ことなので、同じ Messages API の構造化出力 `output_config.format`（`type: "json_schema"`）で形を固定する。tool use との違いは出力が `tool_use` ブロックではなく `text` ブロックの JSON 文字列になる点だけで、Worker 側の検証と保存は変わらない。

| 項目 | 値 |
|---|---|
| SDK | `@anthropic-ai/sdk`（Workers の fetch で動く。`nodejs_compat` を付ける） |
| クライアント | `new Anthropic({ apiKey: env.ANTHROPIC_API_KEY, maxRetries: 0, timeout: 20_000 })`（再試行は SDK の自動分も 0。仕様 9 章、requirements N-7）。リクエストごとに生成（Worker はモジュールスコープで env を持てない） |
| model | `env.ANTHROPIC_MODEL`（既定 `claude-opus-5-5`。コスト優先時 `claude-sonnet-5-5`） |
| max_tokens | 4096（出力は最大 3 件の短い JSON。`stop_reason === "max_tokens"` なら failed） |
| thinking | 指定しない（既定の adaptive）。`output_config.effort` は C2 を `low`、C1 を `medium` から始め、10 秒の予算内に収まるよう計測して決める |
| output_config.format | `{ type: "json_schema", schema: <6.2 / 6.3> }` |
| 結果の取り出し | `content` から `type === "text"` の最初のブロックを `JSON.parse`。`stop_reason` が `refusal` なら failed |

補足: モデルを `claude-sonnet-5` / `claude-opus-5`（1 世代前）に戻せば `tool_choice: {type: "tool", name}` も使えるため、`worker/src/ai/client.ts` は「スキーマと応答 JSON」を境界にし、呼び出し方式を 1 か所に閉じ込める。

### 6.2 C1 想起: スキーマ `recall`

```json
{
  "type": "object",
  "properties": {
    "items": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "related_memory_id": {"type": "string", "description": "関係のある過去の記憶の id（入力に含まれるものだけ）"},
          "reason":            {"type": "string", "description": "なぜ関係があるか。日本語で 80 文字以内の一文"},
          "evidence":          {"type": "string", "description": "その過去の記憶の本文からの逐語引用。一字も変えない"}
        },
        "required": ["related_memory_id", "reason", "evidence"],
        "additionalProperties": false
      }
    }
  },
  "required": ["items"],
  "additionalProperties": false
}
```

`maxItems` は構造化出力で保証されないため、プロンプトで「最大 3 件」と伝え、Worker で先頭 3 件に切る。

入力（user メッセージ）:

```
<new_memory happened_on="2026-11-04">スーパーで青梅を見かけた</new_memory>
<past_memories>
  <memory id="77ab…" happened_on="2019-06" facts="人物: おばあちゃん / 場所: 庭">おばあちゃんは毎年6月になると、庭の梅で梅干しを漬けていた</memory>
  …
</past_memories>
```

- 過去記憶は同一ユーザーの直近 200 件（`created_at DESC`）。本文は各 2000 文字以下（スキーマ上そうなっている）。確定済み事実（`status='confirmed'`）だけを `facts` 属性に付ける
- 過去記憶が 0 件なら C1 を起動せず、`ai_runs(kind='recall')` の行も作らない（requirements F5-5 / N-5「過去記憶が無ければ 0 行」）。画面の `pending` 判定は「記録が無ければ false」なので影響しない
- 本文に `</memory>` のような文字列があってもタグとして解釈されないよう、`<` `>` `&` `"` はエスケープする

### 6.3 C2 候補抽出: スキーマ `facts`

```json
{
  "type": "object",
  "properties": {
    "items": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "kind":           {"type": "string", "enum": ["person", "place", "date", "thing"]},
          "value":          {"type": "string", "description": "候補の値。date は YYYY-MM-DD / YYYY-MM / YYYY"},
          "evidence":       {"type": "string", "description": "本文からの逐語引用。一字も変えない"},
          "date_precision": {"type": "string", "enum": ["day", "month", "year", "unknown"], "description": "kind が date のときの精度。他は unknown"}
        },
        "required": ["kind", "value", "evidence", "date_precision"],
        "additionalProperties": false
      }
    }
  },
  "required": ["items"],
  "additionalProperties": false
}
```

入力: `<memory happened_on="2026-11-04" precision="day">本文</memory>`。「昨日」「先月」のような相対表現は `happened_on` を基準に解く。

### 6.4 システムプロンプトの要点（両方に共通、日本語）

| 要点 | 文面の骨子 |
|---|---|
| 役割 | 「あなたは一人の人の日記のような短い記憶を静かに読む係です。会話はしません」 |
| 関係なければ空 | 「本当に関係があるものだけを選びます。無ければ `items` を空配列にします。無理に結びつけません」（C1） |
| 逐語引用 | 「`evidence` は元の本文から一字も変えずに切り出します。要約や言い換えは引用ではありません」 |
| 創作禁止 | 「本文にない人物・場所・出来事を足しません。写真の内容や一般常識から補いません」 |
| 件数 | 「最大 3 件。多く出すより、確かな 1 件を選びます」（C1） |
| 断定しない | 「候補は仮のものです。人物の年齢や感情、関係性は推測しません」（C2） |
| 出力 | 「JSON 以外は書きません」 |

プロンプトは `worker/src/ai/prompts.ts` に定数で置き、キャッシュのために固定文（system）を先、可変（user）を後にする。

### 6.5 Worker 側の検証（原則 3）

| 検証 | 落ちたとき |
|---|---|
| `evidence` が空でなく、引用元 body に部分文字列として含まれる（C1 は related の body、C2 は新しい記憶の body）。`body.includes(evidence)` だけで判定し、NFC 正規化・trim・全角半角変換はしない（requirements X-7。逐語引用の原則 3） | その項目を捨てる |
| C1: `related_memory_id` が入力に含めた 200 件の id にある（= 同一ユーザー、存在する） | 捨てる |
| C1: 同じ `related_memory_id` の重複 | 2 件目以降を捨てる |
| C1: `related_memory_id` が新しい記憶自身 | 捨てる |
| C1: `reason` が空、または 80 文字超（`Array.from` で数える。requirements F5-1） | 捨てる |
| 件数 | 先頭 3 件に切る（C1）。C2 は 10 件に切る |
| C2: `date` の `value` が精度に合う形（`YYYY-MM-DD` / `YYYY-MM` / `YYYY`、実在する日付） | 捨てる |
| C2: `evidence` と `value` が空 | 捨てる |
| C2: 同じ (kind, value) の重複 | 2 件目以降を捨てる |

1 件も残らなければ `ai_runs.status = 'empty'`。検証関数は純粋関数にして `worker/test/` で検証する。

### 6.6 失敗時の静かな振る舞い

- API エラー、タイムアウト（20 秒）、JSON パース失敗、`refusal` / `max_tokens`: 何も保存せず `ai_runs.status = 'failed'`、`error` に理由を記録。画面には何も出ない（ポーリングは `pending=false` で終わる）
- 再試行はしない。SDK の自動再試行も `maxRetries: 0` で切る。429 / 5xx も 1 回で `failed`（仕様 9 章、requirements N-7。10 秒の予算内で待って再送しても打ち切りに掛かるだけ）
- C1 と C2 は独立した `waitUntil` で走らせ、片方の失敗が他方に影響しない
- `ANTHROPIC_API_KEY` が未設定のローカルでも登録・一覧・削除は動く（AI は failed として記録）

## 7. 画面側（仕様 6 章）

### 7.1 Vue 3 の構成: vue-router は入れない

| 判断 | 理由 |
|---|---|
| vue-router を入れない | 画面は S0〜S3 の 4 つで、遷移は「きょう ⇄ これまで → 詳細」だけ。依存最小限の方針（仕様 12 章）。SPA のパスルーティングを持たないので Static Assets のフォールバックにも頼らない。Capacitor の WebView でもハッシュ遷移はそのまま動く |
| 代わりにハッシュ | `#today`（S1、既定）/ `#past`（S2）/ `#memory/<id>`（S3）。`composables/useScreen.ts` が `location.hash` を ref に写し、`hashchange` で戻るボタンに追従する。20 行程度 |
| S0 | ログイン画面（招待コードとメールアドレス、「はじめる」。wireframes 1 節）。起動時に `loadToken()` → `GET /api/me` を試し、トークンが無いか 401 なら S0。他のエラーでトークンがあれば「いま、うまくつながりません」+「もう一度」。ログイン成功で `saveToken` → S1 |
| 401 | どの画面でも `api.ts` が 401 を受けたら `clearToken()` して `souieba:unauthorized` を dispatch。`App.vue` が `signed_out` に戻す |
| ネイティブだけの処理 | `native.ts` の `setupNative()`（ステータスバーを明るい地に濃い文字、Android は背景 `#FAF5EC`）と `hideSplash()`（起動の判定が終わってから隠す）。`Capacitor.isNativePlatform()` が false なら何もしない |
| 写真の取得 | `camera.ts` の `pickPhoto()`。ネイティブは `@capacitor/camera`（撮る / ライブラリから選ぶ を OS のシートで。文言「写真を添える」「撮る」「ライブラリから選ぶ」「やめる」）。Web は `<input type="file" accept="image/jpeg,image/png">`。どちらも `File` を返し、`photo.ts` で縮小してから PUT |
| セーフエリア | `App.vue` の `.safe-area` が `env(safe-area-inset-*)` を padding にする。`index.html` は `viewport-fit=cover` |

```
web/src/
  main.ts            setupNative() → createApp(App).mount("#app")
  App.vue            起動の判定（loading / signed_out / ready / trouble）と useScreen() で S0〜S3 を切り替える。下部に「きょう / これまで」の 2 タブ
  style.css          Tailwind v4 と @theme（8 章）、.safe-area
  api.ts             fetch ラッパと 5 章のレスポンス型。VITE_API_BASE、Authorization: Bearer、401 で souieba:unauthorized。ローカルの X-Dev-User は Vite の proxy が付けるため画面側では触らない
  auth.ts            loadToken / getTokenSync / saveToken / clearToken（@capacitor/preferences）
  camera.ts          pickPhoto（@capacitor/camera、Web は input type=file）
  native.ts          isNative / setupNative / hideSplash（status-bar、splash-screen）
  photo.ts           shrinkPhoto（長辺 1600px、JPEG 0.85）
  date.ts            happened_on と精度の表示（「2024年6月」「いつだったか」）、ローカル日付の今日
  composables/useScreen.ts    ハッシュ ⇄ 画面
  composables/usePolling.ts   2 秒間隔・最大 30 秒（15 回）
  screens/WelcomeScreen.vue / TodayScreen.vue / TimelineScreen.vue / MemoryDetailScreen.vue
  components/BottomNav.vue / MemoryCard.vue / FactChips.vue / RecallCard.vue / PhotoPicker.vue
```

### 7.2 ポーリング

- 保存直後、`usePolling(() => Promise.all([getFacts(id), getRecalls(id)]))` を開始。2 秒間隔、両方の `pending` が false になった時点で止める。30 秒（15 回目）で打ち切る（requirements N-2、tasks T-1106-08。API の timeout 20 秒と保存の遅延を吸収できる長さ）
- 札（RecallCard）は結果が初めて届いたときに ADR-0004 の 600ms フェードで現れる。0 件なら何も描かない。「読み込み中」の表示も出さない（静かに待つ）
- 候補（FactChips）は届き次第、本文の下に並ぶ。「そう」「ちがう」はその場で PATCH し、楽観更新する

### 7.3 エラーの見せ方

- 保存失敗だけ「保存できませんでした。もう一度お試しください」と本文の下に小さく出す。AI の失敗は画面に出さない
- 画面に「AI」「生成」「送信」という語を出さない。ボタンは「保存する」「そう」「ちがう」「そうだった」「関係ないかも」「消す」

## 8. デザイン基盤（ADR-0004）

### 8.1 web/src/style.css

```css
@import "tailwindcss";

@theme {
  --color-paper: #FAF5EC;
  --color-card: #FFFDF8;
  --color-ink: #3A3230;
  --color-ink-soft: #6F655D;
  --color-ink-faint: #A69C92;
  --color-line: #E6DCCD;
  --color-ember: #C9684A;
  --color-ember-soft: #F3DED3;
  --color-moss: #7E9478;
  --color-moss-soft: #E3EADF;

  --font-sans: "Noto Sans JP", system-ui, "Hiragino Sans", "Yu Gothic", sans-serif;
  --font-display: "Zen Maru Gothic", "Noto Sans JP", system-ui, "Hiragino Sans", "Yu Gothic", sans-serif;

  --text-body: 17px;
  --text-body--line-height: 1.8;
  --text-note: 14px;
  --text-title: 22px;
  --text-hero: 28px;

  --radius-card: 20px;
  --radius-pill: 999px;
  --shadow-card: 0 1px 2px rgb(58 50 48 / 0.06);
}

@layer base {
  html { background: var(--color-paper); color: var(--color-ink); font-family: var(--font-sans); }
  body { font-size: var(--text-body); line-height: 1.8; }
}
```

- これで `bg-paper` `text-ink-soft` `border-line` `font-display` `text-body` `rounded-card` `shadow-card` などのユーティリティが生える。コンポーネントは色を直書きしない
- 札の出現: `@keyframes rise { from { opacity: 0; transform: translateY(8px) } to { opacity: 1; transform: none } }` と `.rise { animation: rise 600ms ease-out both }` を `@layer components` に置く。`prefers-reduced-motion: reduce` ではアニメーションを無効化
- ダークモードは作らない（ADR-0004）

### 8.2 Google Fonts（web/index.html）

```html
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet"
      href="https://fonts.googleapis.com/css2?family=Noto+Sans+JP:wght@400;500;700&family=Zen+Maru+Gothic:wght@500;700&display=swap">
```

- `display=swap` で読み込み前はシステムフォントで表示（FOUT を許容）
- 日本語フォントは Google Fonts がユニコードレンジで分割配信するため、全体をダウンロードしない
- セルフホストしない（依存と容量を増やさない）

## 9. ローカル開発

### 9.1 方式: vite dev（5173）+ /api を wrangler dev（8787）へプロキシ

| 候補 | 評価 |
|---|---|
| A. `vite build --watch` + `wrangler dev`（8787 一本） | 本番と同じ経路で確認できる。ただし HMR が無く、画面を磨く 11/8 の作業で毎回フルリロードになる |
| B. `vite dev`（5173）+ `/api` を 8787 へプロキシ（採用） | HMR が効く。`X-Dev-User` を Vite の proxy で付与でき、画面コードにローカル専用の分岐が要らない |

本番相当の確認（Static Assets の配信、SPA フォールバック、`run_worker_first`）は `pnpm build` のあと `wrangler dev` を 8787 で開いて行う。

```ts
// vite.config.ts
import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  root: "web",
  plugins: [vue(), tailwindcss()],
  build: { outDir: "dist", emptyOutDir: true },
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: "http://localhost:8787",
        changeOrigin: false,
        headers: { "X-Dev-User": process.env.DEV_USER ?? "dev@example.com" },
      },
    },
  },
});
```

### 9.2 コマンド（package.json）

| script | 内容 |
|---|---|
| `dev` | `vite`（5173。別ターミナルで `dev:worker`） |
| `dev:worker` | `mkdir -p web/dist && wrangler dev --var ENVIRONMENT:development --var INVITE_CODE:dev --var JWT_SECRET:dev-only-secret`（8787。`web/dist` が無いと wrangler が起動を拒否するため空でも作る。`.dev.vars` の `ANTHROPIC_API_KEY` も読む。招待コードと署名鍵は開発専用の既定値） |
| `preview` | `pnpm build:web && wrangler dev --var ENVIRONMENT:development --var INVITE_CODE:dev --var JWT_SECRET:dev-only-secret`（本番相当: 画面を Worker から配信、8787 一本。ブラウザで S0 → 招待コード `dev` でログインの流れを試せる） |
| `build:web` | `vue-tsc -p web/tsconfig.json --noEmit && vite build` |
| `build` | `pnpm build:web && wrangler deploy --dry-run --outdir dist/worker` |
| `deploy` | `pnpm build:web && wrangler deploy` |
| `cap:sync` | `pnpm build:web && cap sync`（`web/dist` を `ios/` と `android/` にコピーし、プラグインを揃える。`VITE_API_BASE` はこのビルドで埋め込まれる） |
| `cap:ios` / `cap:android` | `pnpm cap:sync && cap open ios` / `cap open android`（Xcode / Android Studio を開く。Mac で実行。9.4） |
| `db:migrate:local` / `db:migrate:remote` | `wrangler d1 migrations apply souieba --local` / `--remote` |
| `db:seed:local` / `db:seed:remote` | `wrangler d1 execute souieba --local --file demo/fixtures/seed.sql` / `--remote` |
| `test` / `test:watch` | `vitest run` / `vitest` |
| `typecheck` | `tsc -p worker/tsconfig.json --noEmit && tsc -p worker/tsconfig.test.json --noEmit && vue-tsc -p web/tsconfig.json --noEmit` |

`ENVIRONMENT=development` は `--var` で渡す（`wrangler.toml` の `production` を上書き）。`.dev.vars` に書いても同じ結果になるのでどちらでも可。CLAUDE.md と README もこの形（画面 5173、Worker 8787）になっている。

### 9.3 .dev.vars.example と web/.env.example

```
# .dev.vars.example（Worker）
ANTHROPIC_API_KEY=sk-ant-...
ANTHROPIC_MODEL=claude-opus-5-5
ENVIRONMENT=development
INVITE_CODE=dev
JWT_SECRET=dev-only-secret-change-me
```

```
# web/.env.example（画面。ネイティブのビルド時だけ使う）
VITE_API_BASE=https://souieba.example.workers.dev
```

`ENVIRONMENT` / `INVITE_CODE` / `JWT_SECRET` は 9.2 の `--var` でも渡るので、`.dev.vars` に書かなくても動く（書けばそちらが優先）。`ANTHROPIC_MODEL` を省けば `wrangler.toml` の `[vars]` が使われる。`.dev.vars`、`web/.env.production`、`web/.env.local` は gitignore 済みで、Claude Code は `.dev.vars` に書き込まない。

### 9.4 Capacitor（アプリとしての確認。docs/setup-capacitor.md）

```
 pnpm build:web ──▶ web/dist ──▶ pnpm exec cap sync ──▶ ios/App/public、android/app/src/main/assets/public
                                                        │
                                   pnpm exec cap open ios      → Xcode: シミュレータ / 実機で ▶
                                   pnpm exec cap open android  → Android Studio: エミュレータ / 実機で ▶
```

| 項目 | 内容 |
|---|---|
| API の向き先 | `web/.env.local`（開発）/ `web/.env.production`（配布）に `VITE_API_BASE` を書いてから `build:web`。iOS シミュレータからローカルの Worker は `http://localhost:8787`、Android エミュレータは `http://10.0.2.2:8787`、実機は `http://<Mac の LAN IP>:8787`（`wrangler dev --ip 0.0.0.0`）。本番は `https://` |
| この環境（Linux）でできること | `cap add ios` / `cap add android` と `cap sync` まで。iOS のビルドと Android SDK の導入は開発者の Mac で行う |
| 更新の流れ | 画面を変えたら `pnpm cap:sync`（または `cap:ios` / `cap:android`）。ネイティブ側（`Info.plist`、`AndroidManifest.xml`、アイコン、スプラッシュ画像）は `ios/` `android/` を直接編集し、git にコミットする |
| 署名 | `*.mobileprovision`、`*.p12`、`*.keystore`、`key.properties`、`google-services.json`、`GoogleService-Info.plist` などは gitignore とフック（ADR-0007 7）で保護。Claude Code は書き込まない |
| 配布 | ハッカソン期間中は Xcode / Android Studio から直接インストール。App Store / Play への提出は対象外 |

## 10. 環境変数と secret

| 名前 | 種別 | 置き場所 | 用途 |
|---|---|---|---|
| `ANTHROPIC_API_KEY` | secret | `wrangler secret put` / ローカルは `.dev.vars` | Anthropic API |
| `INVITE_CODE` | secret | `wrangler secret put` / ローカルは `.dev.vars` または `dev:worker` の既定値 `dev` | 招待コード。開発者が決める 12 文字以上のランダム文字列。コードや文書に値を書かない |
| `JWT_SECRET` | secret | `wrangler secret put` / ローカルは `.dev.vars` または `dev:worker` の既定値 `dev-only-secret` | JWT の HS256 署名鍵。32 文字以上（`openssl rand -base64 48` など）。変えると全員ログアウト |
| `ANTHROPIC_MODEL` | var | `wrangler.toml [vars]` | 既定 `claude-opus-5-5`。コスト優先時 `claude-sonnet-5-5`（ADR-0003 / 0005） |
| `ENVIRONMENT` | var | `wrangler.toml` は `production`、ローカルは `wrangler dev --var ENVIRONMENT:development`（または `.dev.vars`） | `X-Dev-User` の受理 |
| `APP_VERSION` | var | `wrangler.toml [vars]` | `/api/health` の `version` |
| `VITE_API_BASE` | 画面のビルド時変数 | `web/.env.production` / `web/.env.local`（git に入れない）。見本は `web/.env.example` | アプリが叩く API のベース URL。Web の開発では空（同一オリジン） |

Hono の `Bindings` 型（worker/src/env.ts）:

```ts
type Env = {
  DB: D1Database; PHOTOS: R2Bucket; ASSETS: Fetcher;
  ENVIRONMENT: "development" | "production" | string; ANTHROPIC_MODEL: string; APP_VERSION: string;
  ANTHROPIC_API_KEY?: string; INVITE_CODE?: string; JWT_SECRET?: string;   // wrangler secret（未設定なら 503 / failed）
};
```

## 11. テスト方針

### 11.1 vitest（Node 環境）で純粋ロジックを試す

| 対象 | ファイル | 内容 |
|---|---|---|
| 引用検証 | `worker/test/evidence.test.ts` | 部分一致、空、全角半角や前後空白を同一視しない（正規化しない。X-7）、`reason` の長さ、`related_memory_id` の所有チェック、3 件制限、重複除去 |
| JWT と招待コード | `worker/test/jwt.test.ts`、`worker/test/app.test.ts` | `signJwt` → `verifyJwt` の往復、`exp` 切れ・署名改ざん・別 secret・`alg: none`・3 分割でない文字列を拒否、`timingSafeEqual` の長さ違い。`POST /api/auth/login` の 200 / 400 / 401 / 429（`now` を差し替えて 1 分の窓を確認）/ 503、Bearer で `/api/me` が 200、`X-Dev-User` が production で無視される |
| 日付精度 | `worker/test/date-precision.test.ts` | `day/month/year/unknown` と `happened_on` の正規化、C2 の `date` 値の形式検証、実在しない日付の拒否 |
| 入力検証 | `worker/test/validate.test.ts` | 本文長、精度の値、写真 MIME とサイズ |
| カーソル | `worker/test/cursor.test.ts` | エンコード/デコードの往復、壊れたカーソルの拒否 |

Node 20 以上では `globalThis.crypto` が WebCrypto なので、Worker と同じコードがそのまま動く。D1 や R2 を使う層は薄く保ち（SQL を組む関数と、それを実行する関数を分ける）、SQL 文字列の組み立てだけを単体テストする。

### 11.2 Worker 統合テスト: @cloudflare/vitest-pool-workers は入れない

- 理由: 依存を増やさない方針。1 人 1 週間でセットアップ（vitest の二重設定、miniflare のバインディング定義）に時間を割くより、純粋ロジックのテストと手動スモークの方が割に合う
- 代わりに `scripts/smoke.sh` を正とする（`pnpm dev:worker` を起動してから `bash scripts/smoke.sh`。health、認証なし 401、`X-Dev-User`、`POST /api/auth/login` の 401 / 400 と開発用コード `dev` でのログイン → Bearer で `/api/me`、記憶の登録〜削除、写真、SPA の HTML を確認する。本番 URL には `EXPECT_PRODUCTION=1` を付ける）。記憶の API ができたら以下を同スクリプトに足す
- 写真の PUT は手元の任意の JPEG を指定する（`demo/photos/` は開発者が置くため存在しないことがある）。`jq` が無ければ `grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4` で代用する

```sh
H='X-Dev-User: dev@example.com'
ID=$(curl -s -H "$H" -H 'Content-Type: application/json' \
  -d '{"body":"スーパーで青梅を見かけた","happened_on":"2026-11-04","happened_on_precision":"day"}' \
  localhost:8787/api/memories | jq -r .id)        # jq が無ければ上の grep で代用
sleep 8
curl -s -H "$H" localhost:8787/api/memories/$ID/facts
curl -s -H "$H" localhost:8787/api/memories/$ID/recalls
curl -s -H "$H" -X PUT -F photo=@/path/to/any.jpg localhost:8787/api/memories/$ID/photo
curl -s -H "$H" -X DELETE -o /dev/null -w '%{http_code}\n' localhost:8787/api/memories/$ID
```

### 11.3 デモ 4 シナリオ（仕様 11 章）の確認

`demo/fixtures/seed.sql` を `db:seed:local` で入れ、D1〜D4 を上のスモークと画面で通す。D2（電気代）は `recalls` が 0 件で `ai_runs.status='empty'` になること、D3（公園の花）は「ちがう」のあと `status='rejected'` で画面から消えることを確認する。

## 12. 他文書との整合（判断事項）

本書を正として揃えたい点。各文書の担当が追従する。

| # | 内容 | 本書の立場 | 追従が必要な文書 |
|---|---|---|---|
| 1 | `/api/health` の受け入れ条件 | 認証なしの curl で 200（3.6）。ADR-0007 で Cloudflare 側の前段認証が無くなり、v0.2 の読み替えは不要になった | 解消済み（requirements N-9、setup-cloudflare.md 7 節） |
| 2 | ポーリング打ち切り | 30 秒（15 回）。requirements N-2、tasks T-1106-08 と同じ | wireframes.md 2.6（15 秒 → 30 秒） |
| 3 | 既定モデル | `claude-opus-5-5`（ADR-0003 / 0005） | 解消済み（tasks J-5 も opus） |
| 4 | API レスポンスの形とエラーコード名 | `{pending, items}`、`{status: confirmed|rejected}`（J-7 (2)）、`recalled_by`、`validation` / `too_large` / `unsupported_media` / `internal`（5 章） | requirements F3 / F4 / F5（tasks J-7 のとおり本書に寄せる） |
| 5 | `ai_runs(kind='recall')` | 過去記憶 0 件なら行を作らない（6.2）。requirements N-5 と同じ | なし |
| 6 | 認証と配布（ADR-0007） | 招待コード + HS256 JWT、Capacitor。`ACCESS_*` は廃止し `INVITE_CODE` / `JWT_SECRET` に置き換えた（3 章、10 章） | requirements F1、wireframes S0、setup-cloudflare.md、tasks.md（追従済み） |
| 7 | ネイティブでの写真表示 | `<img src>` では Bearer を付けられない（5.8）。画面側で `fetch` + Bearer → `createObjectURL` にするのを既定案とする | tasks.md T-1107-00b（開発者の確認が要る） |
