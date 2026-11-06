# Cloudflare 設定手順書（D1 / R2 / secret / deploy）

- 対象: そういえば。（Worker 名 `souieba`、D1 名 `souieba`、R2 バケット `souieba-photos`。ADR-0003）
- 実行者: 開発者の手元（Claude Code の環境には Cloudflare の認証が無い。ADR-0003）
- 根拠: docs/spec.md 第 5 節（セキュリティ）、第 8 節（API）、第 10 節（認証）、第 12 節（スタック）。docs/architecture.md 第 3 節・第 10 節。docs/tasks.md T-1104-14〜16、J-1、J-3。ADR-0007（招待コード + JWT）
- 表記: 「要確認」と書いた箇所は、Cloudflare の画面名や制約を断定していない。実際の画面で確かめること
- アプリ（iOS / Android）のビルドは docs/setup-capacitor.md。本書は Worker 側だけ

## 0. 全体の流れ

| 順 | 作業 | 使うもの | 所要 |
|---|---|---|---|
| 1 | 準備（Node / pnpm / wrangler login / アカウント ID） | ターミナル | 10 分 |
| 2 | D1 作成 → `database_id` を wrangler.toml に書く → マイグレーション | ターミナル | 10 分 |
| 3 | R2 バケット作成 | ターミナル | 2 分 |
| 4 | secret（`ANTHROPIC_API_KEY`、`INVITE_CODE`、`JWT_SECRET`）と `[vars]` | ターミナル + wrangler.toml | 10 分 |
| 5 | 最初の deploy（`pnpm run deploy`）と URL の確認 | ターミナル | 10 分 |
| 6 | 疎通確認（`/api/health` → `/api/auth/login` → `/api/me`） | curl | 10 分 |
| 7 | ローカル環境（.dev.vars） | ターミナル | 5 分 |
| 8 | アプリの `VITE_API_BASE` に 5 の URL を書く | docs/setup-capacitor.md | 5 分 |

認証は Worker 自身が行う（招待コード + JWT。architecture.md 3 章）。Cloudflare 側に認証やアクセス制御の設定は要らない。CORS も Worker のコード（worker/src/cors.ts）で固定しているので設定不要。

ドメインは未定のため、以下では次の 2 通りを並記する。どちらにしてもアプリの `VITE_API_BASE` にその URL を書いてビルドする（第 8 節）。

| 呼び方 | 内容 | 既定 |
|---|---|---|
| A. workers.dev | `https://souieba.<サブドメイン>.workers.dev` | tasks.md J-3 の当面の既定 |
| B. 独自ドメイン | `https://souieba.example.jp` のようなサブドメイン（Cloudflare 管理のゾーン） | 提出前の切替候補。切り替えたらアプリを `VITE_API_BASE` を変えてビルドし直す |

## 1. 準備

### 1.1 ツール

| ツール | 版 | 確認 |
|---|---|---|
| Node | 22 以上（package.json `engines`） | `node -v` |
| pnpm | 10（`packageManager: pnpm@10.28.0`。`corepack enable` で揃う） | `pnpm -v` |
| wrangler | 4 系（devDependencies。グローバル導入は不要） | `pnpm exec wrangler --version` |
| openssl | `JWT_SECRET` の生成に使う（macOS / Linux に入っている） | `openssl version` |

```sh
cd <リポジトリ>
pnpm install
pnpm exec wrangler --version
```

以下、`wrangler` と書いたものはすべて `pnpm exec wrangler` の意味。

### 1.2 ログインとアカウント ID

```sh
pnpm exec wrangler login      # ブラウザが開く。Cloudflare アカウントで許可する
pnpm exec wrangler whoami     # アカウント名と Account ID が表に出る
```

- Account ID は `whoami` の表、またはダッシュボードの「Workers & Pages」概要ページ右側（要確認）で確認できる
- アカウントが複数ある場合は、`wrangler.toml` に `account_id = "..."` を足すか、環境変数 `CLOUDFLARE_ACCOUNT_ID` を設定する。1 つだけなら不要
- 第 10 節のチェックリストに控える

## 2. D1

### 2.1 作成

```sh
pnpm exec wrangler d1 create souieba
```

出力に `database_id = "xxxxxxxx-xxxx-...."` を含む設定の断片が出る。

### 2.2 wrangler.toml に書く

`wrangler.toml` の `[[d1_databases]]` にある仮の値 `00000000-0000-0000-0000-000000000000` を、出力の `database_id` で置き換える。他の行（`binding = "DB"`, `database_name = "souieba"`, `migrations_dir = "worker/migrations"`）は変えない。

```toml
[[d1_databases]]
binding = "DB"
database_name = "souieba"
database_id = "<2.1 の出力>"
migrations_dir = "worker/migrations"
```

### 2.3 マイグレーション適用

```sh
pnpm db:migrate:remote        # = wrangler d1 migrations apply souieba --remote
pnpm exec wrangler d1 migrations list souieba --remote
```

- 適用前に一覧と確認プロンプトが出る。`0001_init.sql` と `0002_login_attempts.sql` の 2 件が出れば正しい
- 確認: `migrations list` で 0001 と 0002 が適用済み（未適用の一覧に出ない）になっている（requirements S-3）
- テーブルを直接見たいときは `pnpm exec wrangler d1 execute souieba --remote --command "SELECT name FROM sqlite_master WHERE type='table'"`。`users / memories / memory_facts / recalls / ai_runs / login_attempts` の 6 つと `d1_migrations` を含んでいればよい。`_cf_KV` など D1 内部のテーブルが混ざって出ても問題ない
- `login_attempts` はログインのレート制限用（同一 IP から 1 分 10 回）。0002 を忘れると `POST /api/auth/login` が 500 になる
- デモデータは本番には入れない（`db:seed:remote` はデモ当日に判断する。tasks.md 参照）

## 3. R2

```sh
pnpm exec wrangler r2 bucket create souieba-photos
pnpm exec wrangler r2 bucket list      # souieba-photos が出る
```

- 公開バケットにしない。写真は Worker の `GET /api/photos/:key` 経由でしか配信しない（architecture.md 5.8）
- `wrangler.toml` の `[[r2_buckets]]`（`binding = "PHOTOS"`, `bucket_name = "souieba-photos"`）はそのまま
- 初回の R2 利用時にダッシュボードで R2 の有効化（支払い方法の登録）を求められることがある（要確認）

## 4. secret と vars

### 4.1 secret（秘密）

3 つとも `wrangler secret put` で入れる。`wrangler.toml`、`.dev.vars.example`、文書、チャットに値を書かない（spec 第 5 節、第 12 節、ADR-0007 6）。

| 名前 | 内容 | 決め方 |
|---|---|---|
| `ANTHROPIC_API_KEY` | Anthropic API のキー | Anthropic Console で発行 |
| `INVITE_CODE` | 招待コードとメールの対応表。**1 人 1 つのコード**で、そのコードは対応するメールでしか入れない（ADR-0007 2026-11-06 追記） | `コード=メール` を使う人ごとに 1 つ書き、`,` でつなぐ（形は下）。コードは 12 文字以上のランダム文字列で、`=` と `,` を含めない。`openssl rand -hex 8`（16 文字）で作る。推測されやすい語（アプリ名、日付）を避ける |
| `JWT_SECRET` | JWT（HS256）の署名鍵 | 32 文字以上。`openssl rand -base64 48` の出力をそのまま貼る。人が入力するものではないので長くてよい |

```sh
pnpm exec wrangler secret put ANTHROPIC_API_KEY
pnpm exec wrangler secret put INVITE_CODE
pnpm exec wrangler secret put JWT_SECRET
# それぞれ値の入力を求められる。貼り付けて Enter（画面に表示されない）
```

`INVITE_CODE` に貼る値の形（下はダミー。本物の値はここにもチャットにも書かない）:

```text
0123456789abcdef=you@example.com,fedcba9876543210=family@example.com
```

- 1 行（改行なし）。人を足すときは `,コード=メール` を後ろに足して `wrangler secret put INVITE_CODE` を入れ直す（全体の置き換えになる）
- メールは大文字小文字と前後の空白を無視して比べる。同じコードを 2 回書く、コードが空、メールの形が違う、`=` の無い値（旧形式）のどれかがあると、ログインは全員 503 `auth_unavailable` になる（理由は `wrangler tail` のログにだけ出る）

- Worker がまだ無い状態で実行すると、wrangler が「Worker を作るか」と聞くことがある（要確認）。迷うなら第 5 節の最初の deploy の後に実行する
- 確認: `pnpm exec wrangler secret list` に 3 つが出る（値は出ない）
- `INVITE_CODE` と `JWT_SECRET` が無い（または `INVITE_CODE` の形が壊れている）と `POST /api/auth/login` は 503 `auth_unavailable` を返し、アプリは「いま、うまくつながりません」になる（requirements F1-6）
- `JWT_SECRET` を変えると、発行済みのトークンがすべて無効になり、全員がログイン画面に戻る（意図したログアウト手段としても使える）。`INVITE_CODE` を変えても発行済みのトークンは有効のまま（特定の人だけ締め出す手段は無い）
- 招待コードは、その人のぶんだけを本人に口頭やメッセージで直接伝える。リポジトリや README には書かない

### 4.2 vars（秘密でない設定）

`wrangler.toml` の `[vars]` に書く。ダッシュボードで変更しても次の deploy で `wrangler.toml` の値に戻るので、必ずファイル側を直す。

| 名前 | 値 | いつ埋めるか |
|---|---|---|
| `ENVIRONMENT` | `"production"` | 既に書いてある。変えない（`development` にすると `X-Dev-User` が通る） |
| `ANTHROPIC_MODEL` | `"claude-opus-5-5"`（コスト優先なら `"claude-sonnet-5-5"`。ADR-0003 / 0005） | 既に書いてある |
| `APP_VERSION` | `"0.1.0"` | 既に書いてある |

認証に関する `[vars]` は無い（`INVITE_CODE` / `JWT_SECRET` は 4.1 の secret）。

## 5. deploy

### 5.1 dry-run と本番 deploy

```sh
pnpm build            # 画面ビルド + wrangler deploy --dry-run（何も公開しない）
pnpm run deploy       # 画面ビルド + wrangler deploy
```

- 必ず `pnpm run deploy` と打つ。`pnpm deploy` は pnpm の組み込みコマンド（workspace 用）と衝突し、package.json の `deploy` スクリプトは実行されない（pnpm 10.28.0 では `ERR_PNPM_CANNOT_DEPLOY  A deploy is only possible from inside a workspace` で止まる）。`pnpm build` / `pnpm dev` / `pnpm preview` / `pnpm db:*` は組み込みと衝突しないのでそのままでよい
- `pnpm run deploy` の出力に公開 URL（`https://souieba.<サブドメイン>.workers.dev`）が出る。これがアプリの `VITE_API_BASE`（第 8 節）
- `<サブドメイン>` はアカウントごとに 1 つ。初回は wrangler が登録を促す（要確認）
- 一緒に deploy される画面（Static Assets）は開発用プレビュー。ブラウザで `$URL/` を開くとアプリと同じログイン画面が出るので、アプリを入れていない端末での確認に使える
- ログ: `pnpm exec wrangler tail` で本番のリクエストとエラーを流し見できる。認証で拒否した理由コード（第 9 節）もここに出る

### 5.2 A. workers.dev のまま使う場合

追加設定は不要。URL を第 10 節のチェックリストに控える。

バージョンごとの Preview URL（`<id>-souieba.<サブドメイン>.workers.dev` の形）は要らないので、`wrangler.toml` のトップレベルに次の 1 行を足して再 deploy し、閉じておく（任意。`/api/*` は Worker 自身が JWT を検証するので、開いていてもデータは読めない）。

```toml
preview_urls = false                      # バージョンごとの Preview URL を出さない
```

### 5.3 B. 独自ドメインのサブドメインを使う場合

前提: 対象ドメイン（例 `example.jp`）が同じ Cloudflare アカウントのゾーンとして登録されている。

`wrangler.toml` に以下を足して `pnpm run deploy` する。

```toml
workers_dev = false                       # *.workers.dev の入口を閉じる（architecture.md 3.6）
routes = [
  { pattern = "souieba.example.jp", custom_domain = true },
]
```

- `custom_domain = true` にすると、DNS レコードと証明書は Cloudflare が自動で作る（手動で CNAME を作らない。要確認）
- 切替後は `https://souieba.<サブドメイン>.workers.dev` が 404 になることを確認する
- アプリの `VITE_API_BASE` を新しいホスト名に変えてビルドし直し、端末に入れ直す（第 8 節）。古いビルドのアプリは API に届かなくなる

## 6. CORS（設定不要）

アプリの WebView（`capacitor://localhost`、`https://localhost`）と開発サーバ（`http://localhost:5173`、`http://localhost`）だけを Worker のコード（worker/src/cors.ts）が許可している。Cloudflare のダッシュボードや Transform Rules で CORS ヘッダを足さない（二重に付くとブラウザが拒否する）。許可オリジンを増やしたいときはコードを変えて deploy する。

## 7. 疎通確認（curl）

```sh
URL=https://souieba.<サブドメイン>.workers.dev     # または https://souieba.example.jp
```

### 7.1 認証なし

```sh
curl -si "$URL/api/health" | head -20
curl -si "$URL/api/me" | head -20
curl -si -H "X-Dev-User: a@example.com" "$URL/api/me" | head -20
```

| 要求 | 期待 |
|---|---|
| `/api/health` | 200、`{"ok":true,"service":"souieba","version":"0.1.0","time":"..."}`（requirements S-11、N-9） |
| `/api/me`（ヘッダなし） | 401、`{"error":{"code":"unauthorized","message":"ログインが必要です"}}`（N-9。理由コード `no_credentials` は本文には出ず `wrangler tail` に出る） |
| `/api/me`（`X-Dev-User` だけ） | 401。本番ではこのヘッダは無視される（S-8）。200 になったら `[vars]` の `ENVIRONMENT` が `production` でない |

### 7.2 ログイン → JWT → /api/me

```sh
curl -si -H 'content-type: application/json' \
  -d '{"invite_code":"wrong","email":"you@example.com"}' "$URL/api/auth/login" | head -20
# → 401 {"error":{"code":"unauthorized","message":"招待コードかメールアドレスが違います"}}

TOKEN=$(curl -s -H 'content-type: application/json' \
  -d '{"invite_code":"<4.1 の対応表で you@example.com に割り当てたコード>","email":"you@example.com"}' "$URL/api/auth/login" \
  | sed -n 's/.*"token":"\([^"]*\)".*/\1/p')
echo "$TOKEN" | cut -c1-20      # eyJhbGciOiJIUzI1NiIs… と出れば発行できている

curl -s -H "Authorization: Bearer $TOKEN" "$URL/api/me"
# → {"user_id":"you@example.com","display_name":null,"since":"..."}（S-10）
```

| 症状 | 原因 |
|---|---|
| 503 `auth_unavailable` | `INVITE_CODE` か `JWT_SECRET` が secret に無い、`INVITE_CODE` が対応表の形でない（4.1） |
| 400 `validation` | 本文の JSON が壊れている、`email` の形が違う |
| 429 `too_many` | 同じ IP から 1 分に 10 回を超えた。1 分待つ |
| 500 | `login_attempts` テーブルが無い（2.3 の 0002 を適用していない） |

- まとめて流すなら `EXPECT_PRODUCTION=1 bash scripts/smoke.sh "$URL"`（health、`X-Dev-User` が通らないこと、ログインの 401 / 400、SPA の HTML）。
  対応表の 1 行を環境変数 `SMOKE_INVITE_CODE` / `SMOKE_EMAIL` で渡すと、ログイン → 他人のメールで 401 → 記憶の登録 → 詳細 → 写真の PUT / GET → 削除 → 404 まで通す（1 件登録して最後に消す）。
  2 人目（`SMOKE_OTHER_INVITE_CODE` / `SMOKE_OTHER_EMAIL`）も渡すと「別のユーザーで 404」も確かめる。値はスクリプトにもログにも出ない（curl へは標準入力で渡す）。
  fish なら `read -s -x SMOKE_INVITE_CODE` で読み込み、`set -x SMOKE_EMAIL you@example.com` のあとに `env EXPECT_PRODUCTION=1 bash scripts/smoke.sh $URL`
- 招待コードを端末の履歴に残したくなければ、`read -s CODE` で読み込んでから `-d "{\"invite_code\":\"$CODE\",...}"` にする

### 7.3 画面（開発用プレビュー、任意）

1. ブラウザで `$URL/` を開く → S0 ようこそ（招待コードとメールアドレスの入力欄、「はじめる」）
2. 招待コードとメールを入れて「はじめる」→ S1 きょう が出る（トークンは localStorage に入る）
3. 同じタブで `$URL/なにか/深いパス` → HTML（SPA の index.html）が返る（S-11）

アプリ本体での確認は docs/setup-capacitor.md。

## 8. アプリの向き先（VITE_API_BASE）

5.1 で出た URL（B なら 5.3 のホスト名）を、`web/.env.production` に書いてアプリをビルドする。

```sh
printf 'VITE_API_BASE=%s\n' "$URL" > web/.env.production   # git には入れない（.gitignore 済み）
pnpm cap:sync                                              # build:web → cap sync
```

- 見本は `web/.env.example`。Web の開発（`pnpm dev`）では書かない（同一オリジンの `/api` を Vite が中継する）
- URL を変えたら（A → B の切替など）ビルドし直して端末に入れ直す

## 9. ローカル

Claude Code は `.dev.vars` に書き込めない（フックで拒否。CLAUDE.md）。開発者が手元で作る。

```sh
cp .dev.vars.example .dev.vars
# エディタで ANTHROPIC_API_KEY を本物に置き換える。ENVIRONMENT=development のまま
```

| 名前 | 値 |
|---|---|
| `ANTHROPIC_API_KEY` | 本物のキー |
| `ANTHROPIC_MODEL` | `claude-opus-5-5`（本番と同じ） |
| `ENVIRONMENT` | `development`。これにより Worker が `X-Dev-User: <メール>` を受け付ける（spec 第 10 節） |
| `INVITE_CODE` | ローカル用の招待コード。`dev` のままでよい（development だけ、`=` の無い値はどのメールでも入れる。本番のコードを書かない） |
| `JWT_SECRET` | ローカル用の署名鍵。`dev-only-secret-change-me` のままでよい |

```sh
pnpm db:migrate:local   # ローカル D1（.wrangler/ 配下）。0001 と 0002
pnpm dev:worker         # http://localhost:8787
pnpm dev                # http://localhost:5173（/api を 8787 に中継し X-Dev-User を付ける）
bash scripts/smoke.sh   # health 200 / 認証なし 401 / X-Dev-User 200 / ログイン dev → JWT → /api/me / 登録〜削除 / 画面が HTML
pnpm preview            # 本番と同じ配信形（画面を Worker から配信）。S0 で招待コード dev とメールを入れてログインを試せる
```

- `.dev.vars` は `.gitignore` 済み。`git status` に出ないことを確認する（N-8）
- `pnpm dev:worker` と `pnpm preview` は `--var ENVIRONMENT:development --var INVITE_CODE:dev --var JWT_SECRET:dev-only-secret` を渡すので、`.dev.vars` に無くても development で動く。`.dev.vars` に書いた値はそちらが優先される（要確認: wrangler の版によって `--var` と `.dev.vars` の優先順位が異なることがある。`pnpm dev:worker` の起動ログの `Using vars defined in .dev.vars` を見る）
- 本番相当の認証確認（`X-Dev-User` が無視される）: `.dev.vars` は編集せず、`pnpm build:web && pnpm exec wrangler dev --var ENVIRONMENT:production --var INVITE_CODE:dev=you@example.com --var JWT_SECRET:dev-only-secret-0123456789abcdef0123` で起動する（production では対応表の形と 32 文字以上の署名鍵が要る）。`/api/me` は `X-Dev-User` を付けても 401、`POST /api/auth/login` に `dev` と `you@example.com` でログインすれば Bearer で 200、他のメールなら 401 になる（S-8、S-10）。`EXPECT_PRODUCTION=1 bash scripts/smoke.sh` で一括確認できる

## 10. よくある失敗と対処

認証で拒否したときの本文は常に `{"error":{"code":"unauthorized","message":"ログインが必要です"}}`（401）で、理由コードは本文に出さない（検証ロジックの手がかりを外に出さないため。worker/src/auth.ts）。理由コードは `pnpm exec wrangler tail` の `auth rejected { reason, path }` ログで見る。

| 症状 / 理由コード | 原因 | 対処 |
|---|---|---|
| `POST /api/auth/login` が 503 `auth_unavailable` | `INVITE_CODE` か `JWT_SECRET` が secret に無い、`INVITE_CODE` が対応表の形でない | 4.1 の `wrangler secret put` → `wrangler secret list` で確認。形の誤りは `wrangler tail` の `invite` の理由（`entry_2_bad_email` など。値は出ない） |
| `POST /api/auth/login` が 401 | 招待コードが違う（大文字小文字、全角）か、そのコードに割り当てたのと別のメールを入れた | 4.1 で入れた対応表と照合。入れ直すなら `wrangler secret put INVITE_CODE`（発行済みトークンは有効のまま） |
| `POST /api/auth/login` が 429 `too_many` | 同一 IP から 1 分 10 回を超えた（デモの練習で連打したときなど） | 1 分待つ。回数の上限は worker/src/routes/auth.ts の `LOGIN_LIMIT_PER_MINUTE` |
| `POST /api/auth/login` が 500 | `login_attempts` が無い | 2.3 で 0002 を適用 |
| `401` / reason `not_configured` | Bearer は来ているのに `JWT_SECRET` が無い | 4.1 |
| `401` / reason `bad_signature` | `JWT_SECRET` を変えた後の古いトークン、または別環境（ローカル `dev-only-secret`）で発行したトークンを本番に送っている | アプリでログインし直す（アプリは 401 を受けると自動で S0 に戻る） |
| `401` / reason `expired` | 90 日が過ぎた | ログインし直す |
| `401` / reason `bad_alg` / `malformed` | `Authorization` の値が JWT でない | `Bearer <token>` の形と、`token` が 3 分割であることを確認 |
| `401` / reason `no_credentials` がアプリで出る | トークンが保存されていない、または `VITE_API_BASE` が違う Worker を指している | アプリでログインし直す。`web/.env.production` の URL を確認（第 8 節） |
| アプリから API に届かない（ネットワークエラー、「いま、うまくつながりません」） | `VITE_API_BASE` の誤り、`http://` を本番で使っている（iOS が拒否）、CORS の不一致 | 第 8 節。本番は `https://`。CORS は Worker 側で固定なので、ブラウザのコンソールに CORS エラーが出るなら origin が `capacitor://localhost` / `https://localhost` 以外になっている（capacitor.config.ts の `server` を変えていないか） |
| アプリ、`pnpm preview`、デプロイ先のプレビュー画面で `/api/photos/...` の画像だけ出ない（`pnpm dev` の 5173 では出る） | `<img src>` には Bearer を付けられず、Vite の proxy（`X-Dev-User`）が無い経路では 401 になる（architecture.md 5.8 の解消済み（web/src/components/PhotoImg.vue が Bearer 付きで取得して blob URL で表示する。T-1107-00b）） | tasks.md T-1107-00b |
| deploy 時 `database_id` の検証エラー / D1 にアクセスできない | `wrangler.toml` が仮の `00000000-...` のまま | 2.2 で置き換える |
| `pnpm db:migrate:remote` が「database not found」 | `database_name` / `database_id` と作成したものが一致しない | `pnpm exec wrangler d1 list` で照合 |
| `pnpm deploy` が `ERR_PNPM_CANNOT_DEPLOY` で止まる | pnpm の組み込みコマンドが呼ばれている | `pnpm run deploy` と打つ（5.1） |
| deploy 時 `assets` のディレクトリが無い / 空 | `web/dist` が無い（`vite build` を飛ばして `wrangler deploy` を直接叩いた） | `pnpm run deploy`（`build:web` を含む）を使う。手で叩くなら先に `pnpm build:web` |
| 画面は出るが写真の保存で 500 | R2 バケットが無い、または `bucket_name` 違い | 3 節。`wrangler r2 bucket list` で照合 |
| 想起や候補が一切出ない（`ai_runs.status = failed`） | `ANTHROPIC_API_KEY` 未設定・誤り、`ANTHROPIC_MODEL` 名の誤り | `wrangler secret list` と `[vars]` を確認。`wrangler tail` でエラー本文を見る。画面には何も出さない仕様（spec 第 9 節） |

## 11. チェックリスト（開発者が値を埋める）

| 項目 | 値 | 取得元 |
|---|---|---|
| Account ID | | 1.2 `wrangler whoami` |
| workers.dev サブドメイン | | 5.1 `pnpm run deploy` の出力 |
| 公開 URL（A または B）= `VITE_API_BASE` | | 5.2 / 5.3 / 8 |
| D1 `database_id` | | 2.1 `wrangler d1 create souieba` |
| R2 バケット | `souieba-photos` | 3 |
| `ANTHROPIC_API_KEY` を secret に登録した | はい / いいえ | 4.1 `wrangler secret list` |
| `INVITE_CODE` を secret に登録した（値はここに書かない。誰に渡したかだけ） | はい / いいえ、渡した相手: | 4.1 |
| `JWT_SECRET` を secret に登録した（値はここに書かない） | はい / いいえ | 4.1 |
| `.dev.vars` を手元に作った | はい / いいえ | 9 |
| `web/.env.production` を手元に作った | はい / いいえ | 8 |

| 確認項目 | 結果 |
|---|---|
| 0001 と 0002 のマイグレーションが適用済み（S-3） | |
| 認証なし `/api/health` が 200（S-11、N-9） | |
| 認証なし `/api/me` が 401（N-9） | |
| `X-Dev-User` が本番で無視される（S-8） | |
| 違う招待コードで `/api/auth/login` が 401（F1-3） | |
| 正しい招待コードで `/api/auth/login` が 200 → その `token` で `/api/me` がメールを返す（S-10） | |
| アプリ（またはプレビュー画面）で招待コードとメールを入れて S1 が開く（F1-11） | |
| 深いパスが HTML を返す（S-11） | |
| `git ls-files` に `.dev.vars` と `web/.env.production` が無い（N-8） | |

## 12. 開発者の判断が必要なこと

| # | 内容 | 既定 |
|---|---|---|
| 1 | ドメインを A（workers.dev）と B（独自ドメイン）のどちらにするか。切り替えるとアプリのビルドが要る | A から始め、提出前に B にするなら 11/8 までに |
| 2 | 招待コードを誰に渡すか（審査員や家族に触ってもらうか）。1 人 1 つのコードで、そのコードは対応表のメールでしか入れない。渡す人ごとに対応表へ 1 つ足す | 開発者と、デモに協力してもらう人だけ |
| 3 | `JWT_SECRET` のローテーション（全員ログアウト）を提出前に行うか | 行わない（発行済みトークンは 90 日有効） |
| 4 | `ANTHROPIC_MODEL` を Opus のままにするか Sonnet にするか（コスト） | `claude-opus-5-5`（ADR-0003 / 0005） |
| 5 | ネイティブでの写真表示（architecture.md 5.8 の `<img>` と Bearer の問題）をどの方式で直すか | 画面側で `fetch` + Bearer → `createObjectURL`（tasks.md T-1107-00b） |
