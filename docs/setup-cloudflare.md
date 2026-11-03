# Cloudflare 設定手順書（Access / D1 / R2 / secret / deploy）

- 対象: そういえば。（Worker 名 `souieba`、D1 名 `souieba`、R2 バケット `souieba-photos`。ADR-0003）
- 実行者: 開発者の手元（Claude Code の環境には Cloudflare の認証が無い。ADR-0003）
- 根拠: docs/spec.md 第 5 節（セキュリティ）、第 8 節（API）、第 10 節（認証）、第 12 節（スタック）。docs/architecture.md 第 3 節・第 10 節。docs/tasks.md T-1104-14〜16、J-3
- 表記: 「要確認」と書いた箇所は、Cloudflare の画面名や制約を断定していない。実際の画面で確かめること

## 0. 全体の流れ

| 順 | 作業 | 使うもの | 所要 |
|---|---|---|---|
| 1 | 準備（Node / pnpm / wrangler login / アカウント ID） | ターミナル | 10 分 |
| 2 | D1 作成 → `database_id` を wrangler.toml に書く → マイグレーション | ターミナル | 10 分 |
| 3 | R2 バケット作成 | ターミナル | 2 分 |
| 4 | secret（`ANTHROPIC_API_KEY`）と `[vars]` | ターミナル + wrangler.toml | 5 分 |
| 5 | 最初の deploy（`pnpm run deploy`）と URL の確認 | ターミナル | 10 分 |
| 6 | Cloudflare Access（Zero Trust）のアプリ作成 → `ACCESS_TEAM_DOMAIN` / `ACCESS_AUD` を書いて再 deploy | ブラウザ + ターミナル | 30 分 |
| 7 | 疎通確認 | curl + ブラウザ | 10 分 |
| 8 | ローカル環境（.dev.vars） | ターミナル | 5 分 |

Access の設定には Worker の URL（または独自ドメイン）が要るので、先に一度 deploy してから Access を作る順にしている。
最初の deploy の時点では Access が無いので `Cf-Access-Jwt-Assertion` ヘッダが届かず、`/api/*` は Worker 自身の検証で 401 を返す（理由コードは `no_credentials`。7.1 下段）。Access を作ったあとで `[vars]` の `ACCESS_TEAM_DOMAIN` / `ACCESS_AUD` を埋め忘れると、JWT は届くのに検証できず、理由コードが `not_configured` になる（第 9 節）。画面の静的ファイルだけは Access を設定するまで誰でも見られるが、データは無いので問題ない。

ドメインは未定のため、以下では次の 2 通りを並記する。

| 呼び方 | 内容 | 既定 |
|---|---|---|
| A. workers.dev | `https://souieba.<サブドメイン>.workers.dev` | tasks.md J-3 の当面の既定 |
| B. 独自ドメイン | `https://souieba.example.jp` のようなサブドメイン（Cloudflare 管理のゾーン） | 提出前の切替候補 |

## 1. 準備

### 1.1 ツール

| ツール | 版 | 確認 |
|---|---|---|
| Node | 22 以上（package.json `engines`） | `node -v` |
| pnpm | 10（`packageManager: pnpm@10.28.0`。`corepack enable` で揃う） | `pnpm -v` |
| wrangler | 4 系（devDependencies。グローバル導入は不要） | `pnpm exec wrangler --version` |

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

- 適用前に一覧と確認プロンプトが出る。`0001_init.sql` が 1 件出れば正しい
- 確認: `migrations list` で `0001_init.sql` が適用済み（未適用の一覧に出ない）になっている（requirements S-3）
- テーブルを直接見たいときは `pnpm exec wrangler d1 execute souieba --remote --command "SELECT name FROM sqlite_master WHERE type='table'"`。`users / memories / memory_facts / recalls / ai_runs` の 5 つと `d1_migrations` を含んでいればよい。`_cf_KV` など D1 内部のテーブルが混ざって出ても問題ない
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

`ANTHROPIC_API_KEY` だけが secret。`wrangler.toml` にも `.dev.vars.example` にも値を書かない（spec 第 5 節、第 12 節）。

```sh
pnpm exec wrangler secret put ANTHROPIC_API_KEY
# 値の入力を求められる。貼り付けて Enter（画面に表示されない）
```

- Worker がまだ無い状態で実行すると、wrangler が「Worker を作るか」と聞くことがある（要確認）。迷うなら第 5 節の最初の deploy の後に実行する
- 確認: `pnpm exec wrangler secret list` に `ANTHROPIC_API_KEY` が出る（値は出ない）

### 4.2 vars（秘密でない設定）

`wrangler.toml` の `[vars]` に書く。ダッシュボードで変更しても次の deploy で `wrangler.toml` の値に戻るので、必ずファイル側を直す。

| 名前 | 値 | いつ埋めるか |
|---|---|---|
| `ENVIRONMENT` | `"production"` | 既に書いてある。変えない |
| `ANTHROPIC_MODEL` | `"claude-opus-5-5"`（コスト優先なら `"claude-sonnet-5-5"`。ADR-0003 / 0005） | 既に書いてある |
| `ACCESS_TEAM_DOMAIN` | Team 名だけ（例 `"example"`）。`.cloudflareaccess.com` や `https://` は付けない（worker/src/access.ts が `https://<値>.cloudflareaccess.com` を組み立てる） | 第 6 節の後 |
| `ACCESS_AUD` | Access アプリの AUD タグ（64 桁の 16 進） | 第 6 節の後 |
| `APP_VERSION` | `"0.1.0"` | 既に書いてある |

## 5. deploy

### 5.1 dry-run と本番 deploy

```sh
pnpm build            # 画面ビルド + wrangler deploy --dry-run（何も公開しない）
pnpm run deploy       # 画面ビルド + wrangler deploy
```

- 必ず `pnpm run deploy` と打つ。`pnpm deploy` は pnpm の組み込みコマンド（workspace 用）と衝突し、package.json の `deploy` スクリプトは実行されない（pnpm 10.28.0 では `ERR_PNPM_CANNOT_DEPLOY  A deploy is only possible from inside a workspace` で止まる）。`pnpm build` / `pnpm dev` / `pnpm preview` / `pnpm db:*` は組み込みと衝突しないのでそのままでよい
- `pnpm run deploy` の出力に公開 URL（`https://souieba.<サブドメイン>.workers.dev`）が出る
- `<サブドメイン>` はアカウントごとに 1 つ。初回は wrangler が登録を促す（要確認）
- ログ: `pnpm exec wrangler tail` で本番のリクエストとエラーを流し見できる。認証で拒否した理由コード（第 9 節）もここに出る

### 5.2 A. workers.dev のまま使う場合

追加設定は不要。URL を第 10 節のチェックリストに控える。

バージョンごとの Preview URL（`<id>-souieba.<サブドメイン>.workers.dev` の形）が有効だと、Access の対象外の入口になり得る。`wrangler.toml` のトップレベルに次の 1 行を足して再 deploy し、閉じておく。

```toml
preview_urls = false                      # バージョンごとの Preview URL を出さない
```

- Workers の設定画面「Domains & Routes」（要確認）からも無効にできるが、ダッシュボードで変えても次の deploy で `wrangler.toml` の値に戻るので、ファイル側に書く
- `/api/*` は Worker 自身が JWT を検証するので、Preview URL から到達してもデータは読めないが、入口は閉じておく

### 5.3 B. 独自ドメインのサブドメインを使う場合

前提: 対象ドメイン（例 `example.jp`）が同じ Cloudflare アカウントのゾーンとして登録されている。

`wrangler.toml` に以下を足して `pnpm run deploy` する。

```toml
workers_dev = false                       # *.workers.dev の入口を閉じる（architecture.md 3.3）
routes = [
  { pattern = "souieba.example.jp", custom_domain = true },
]
```

- `custom_domain = true` にすると、DNS レコードと証明書は Cloudflare が自動で作る（手動で CNAME を作らない。要確認）
- 切替後は `https://souieba.<サブドメイン>.workers.dev` が 404 になることを確認する
- Access のアプリ（第 6 節）のドメインもこのホスト名にする。workers.dev で先に作っていた場合は、Access アプリのドメインを変更する（AUD は変わらないはずだが、要確認。変わっていれば `ACCESS_AUD` を更新して再 deploy）

## 6. Cloudflare Access（Zero Trust）

目的: アプリ全体（`/` と `/api/*` の両方、`/api/health` も含む）をメール OTP のログインの後ろに置く。Worker はさらに `Cf-Access-Jwt-Assertion` を自前で検証する（spec 第 10 節、architecture.md 3.3）。

`/api/health` だけは Worker 側で JWT を検証しない（spec 第 8 節「認証必須（`/api/health` を除く）」はこの意味）。それでも Access の前段は外さないので、外から curl しても 200 にはならない。`/api/health` を文字どおり公開したい場合だけ 6.6 を行う（開発者判断。第 11 節 #5）。

### 6.1 Team domain の確認

1. Cloudflare ダッシュボード → 「Zero Trust」を開く。初回は Team 名の入力と無料プランの選択がある（要確認）
2. Zero Trust の「Settings」→「Custom Pages」（要確認。版によっては「General」）に「Team domain」として `<team>.cloudflareaccess.com` が表示される
3. `<team>` の部分だけを `ACCESS_TEAM_DOMAIN` に書く

確認: ブラウザで `https://<team>.cloudflareaccess.com/cdn-cgi/access/certs` を開くと `{"keys":[...]}` の JSON が返る。これが Worker が取りに行く JWKS。

### 6.2 ログイン方法（One-time PIN）

Zero Trust →「Settings」→「Authentication」→「Login methods」（要確認）に「One-time PIN」があることを確認する。既定で有効なことが多いが、無ければ「Add new」から追加する。他の IdP は追加しない（パスワード無し、メールのみ。spec 3.1）。

### 6.3 Access アプリケーションの作成

Zero Trust →「Access」→「Applications」→「Add an application」→「Self-hosted」（要確認）。

| 項目 | 値 | 補足 |
|---|---|---|
| Application name | `souieba` | 任意 |
| Session Duration | 24 時間（任意。短いと OTP の再入力が増える） | デモ当日の直前に期限が切れないよう、デモ前にログインし直す |
| Application domain | A: `souieba.<サブドメイン>.workers.dev`、B: `souieba.example.jp` | パスは空（ホスト全体）。`/api` を別アプリにしない |
| Identity providers | One-time PIN だけを選ぶ | 「Accept all available identity providers」でも可だが、OTP 以外が無いことを確認 |
| Policy 名 | `allow-dev` など | |
| Policy action | Allow | |
| Policy include | 「Emails」に開発者のメール。審査員にも触ってもらうなら「Emails ending in」でドメイン、または複数メール | 誰を許可するかは開発者の判断（第 11 節） |
| App Launcher visibility | どちらでも | |

#### workers.dev を Application domain にできるかの注意（要確認）

- Access の Self-hosted アプリは、原則としてそのアカウントの Cloudflare ゾーン上のホスト名を対象にする。`*.workers.dev` は開発者自身のゾーンではないので、「Application domain」の入力で受け付けられるかを実際の画面で確認すること
- Workers の設定画面（「Settings」→「Domains & Routes」の workers.dev の行。要確認）に「Enable Cloudflare Access」のようなボタンがあり、そこから Access アプリを作れる版がある。ある場合はそちらを使うのが早い。作られたアプリは Zero Trust 側の Applications 一覧に出るので、ポリシー（Allow のメール）と AUD の取得は 6.3 / 6.4 と同じ
- どちらもできない場合は、workers.dev を Access で守ることを諦め、5.3 の独自ドメイン（B）に切り替える。tasks.md J-3 の「提出前の切替候補」を前倒しする

### 6.4 AUD タグの取得

作成後、Zero Trust →「Access」→「Applications」→ `souieba` →「Overview」または「Basic information」（要確認）に「Application Audience (AUD) Tag」がある。64 桁の 16 進文字列。コピーして `ACCESS_AUD` に書く。

### 6.5 vars を書いて再 deploy

```toml
[vars]
ENVIRONMENT = "production"
ANTHROPIC_MODEL = "claude-opus-5-5"
ACCESS_TEAM_DOMAIN = "<team>"        # 6.1
ACCESS_AUD = "<AUD タグ>"            # 6.4
APP_VERSION = "0.1.0"
```

```sh
pnpm run deploy
```

### 6.6 任意: `/api/health` だけを Access の外に出す（Bypass）

既定では行わない（architecture.md 3.3「ハッカソン期間中は不要」）。requirements N-9 / S-11 の「JWT なしの curl で `/api/health` が 200」を文字どおり満たしたい場合だけ、次を足す。

1. Zero Trust →「Access」→「Applications」→「Add an application」→「Self-hosted」で、6.3 と同じホストにパス `api/health` を付けたアプリをもう 1 つ作る（要確認。6.3 のアプリに 2 つめのドメイン行として足せる版もある）
2. ポリシーは action「Bypass」、include は「Everyone」
3. `curl -si "$URL/api/health"` が `{"ok":true,...}` と 200 になることを確認する。`/api/me` は引き続き 7.1 上段の状態（302 または 401/403）であること

- `/api/health` は `ok / service / version / time` の 4 項目しか返さず、秘密も利用者の情報も含まない（worker/src/index.ts）。公開しても漏れるものは無いが、未認証の到達経路を 1 つ増やすことになる
- 行わない場合、N-9 / S-11 / T-1104-16 / T-1110-04 の「`/api/health` が 200」は 7.2 の「ログイン後のブラウザで 200」の意味で読む

## 7. 疎通確認

### 7.1 ログインなし（curl）

```sh
URL=https://souieba.<サブドメイン>.workers.dev     # または https://souieba.example.jp
curl -si "$URL/api/me" | head -20
curl -si "$URL/api/health" | head -20
```

期待する結果:

| 状態 | `/api/me` | `/api/health` |
|---|---|---|
| Access が効いている | Access のログインページへの 302（`Location: https://<team>.cloudflareaccess.com/...`）または 401/403。JSON は返らない | 同じ（Access 配下に置くため 200 にならない。architecture.md 3.3。6.6 を行った場合だけ 200） |
| Access が効いていない（設定前・対象ドメインの不一致） | Worker の JSON `{"error":{"code":"unauthorized","message":"ログインが必要です"}}` と 401（理由コード `no_credentials` は本文には出ず `wrangler tail` に出る。第 9 節） | `{"ok":true,...}` と 200 |

- spec 第 8 節、requirements N-9 / S-11、tasks T-1104-16 / T-1110-04 の「`/api/health` が 200」は、architecture.md 3.3 に従い「Access ログイン後のブラウザで開くと 200」（7.2 の手順 4）の意味で読む。6.6 の Bypass を行った場合だけ、curl でも 200 になる
- 下段の状態で `/api/me` が 401 なら、Worker 自身の検証は動いている（N-9 の「JWT なし 401」）。上段に移るまで Access の設定を見直す
- `X-Dev-User` を付けても本番では無視される: `curl -si -H "X-Dev-User: a@example.com" "$URL/api/me"` が 200 になってはいけない（S-8）
- まとめて流すなら `EXPECT_PRODUCTION=1 bash scripts/smoke.sh "$URL"`。ただし Access が効いた後は `/api/health` が Access に止められて最初の項目で落ちるので、Access 設定前（下段の状態）と 6.6 を行った場合にだけ使える

### 7.2 ログインあり（ブラウザ）

1. ブラウザで `$URL/` を開く → Access のログイン画面 → メールを入力 → 届いた 6 桁のコードを入力
2. アプリの画面（S0 ではなく S1 「きょう」）が出る
3. 同じタブで `$URL/api/me` を開く → `{"user_id":"<あなたのメール>","display_name":null,"since":"..."}` が返る（S-10）
4. 同じタブで `$URL/api/health` を開く → `{"ok":true,"service":"souieba","version":"0.1.0","time":"..."}` が返る（S-11 / T-1110-04 の「`/api/health` が 200」はこれ）
5. `$URL/なにか/深いパス` → HTML（SPA の index.html）が返る（S-11）

`/api/me` が 401 になる場合は第 9 節を見る（理由コードは `wrangler tail` に出る）。

### 7.3 ログインあり（curl、任意）

ブラウザの開発者ツールで Cookie `CF_Authorization` の値を取り、次のように付ける（Access が Cookie を `Cf-Access-Jwt-Assertion` ヘッダに変換して Worker へ渡す。要確認）。

```sh
curl -s -H "Cookie: CF_Authorization=<値>" "$URL/api/me"
```

`cloudflared` を入れている場合は `cloudflared access login $URL` → `cloudflared access curl $URL/api/me` でも同じことができる（任意。プロジェクトの依存には入れない）。

## 8. ローカル

Claude Code は `.dev.vars` に書き込めない（フックで拒否。CLAUDE.md）。開発者が手元で作る。

```sh
cp .dev.vars.example .dev.vars
# エディタで ANTHROPIC_API_KEY を本物に置き換える。ENVIRONMENT=development のまま。ACCESS_* は空でよい
```

| 名前 | 値 |
|---|---|
| `ANTHROPIC_API_KEY` | 本物のキー |
| `ANTHROPIC_MODEL` | `claude-opus-5-5`（本番と同じ） |
| `ENVIRONMENT` | `development`。これにより Worker が `X-Dev-User: <メール>` を受け付ける（spec 第 10 節） |
| `ACCESS_TEAM_DOMAIN` / `ACCESS_AUD` | 空。ローカルでは Access を通さない |

```sh
pnpm db:migrate:local   # ローカル D1（.wrangler/ 配下）
pnpm dev:worker         # http://localhost:8787
pnpm dev                # http://localhost:5173（/api を 8787 に中継し X-Dev-User を付ける）
bash scripts/smoke.sh   # health 200 / 認証なし 401 / X-Dev-User 200 / 画面が HTML
pnpm preview            # 本番と同じ配信形（画面を Worker から配信）。認証は development のまま（T-1104-13）
```

- `.dev.vars` は `.gitignore` 済み。`git status` に出ないことを確認する（N-8）
- `pnpm dev:worker` と `pnpm preview` は `--var ENVIRONMENT:development` も渡すので、`.dev.vars` に `ENVIRONMENT` が無くても development になる（`--var` は `.dev.vars` より優先される）
- 本番相当の認証確認（Access なし、`X-Dev-User` も無視）: `.dev.vars` は編集せず、`pnpm build:web && pnpm exec wrangler dev --var ENVIRONMENT:production` で起動する。`--var` が `.dev.vars` の `ENVIRONMENT=development` より優先されるので、`/api/me` は `X-Dev-User` を付けても 401 になる（S-8）。`EXPECT_PRODUCTION=1 bash scripts/smoke.sh` で一括確認できる

## 9. よくある失敗と対処

認証で拒否したときの本文は常に `{"error":{"code":"unauthorized","message":"ログインが必要です"}}`（401）で、理由コードは本文に出さない（検証ロジックの手がかりを外に出さないため。worker/src/auth.ts）。理由コードは `pnpm exec wrangler tail` の `auth rejected { reason, path }` ログで見る。JWKS が取れない場合だけ 401 ではなく 503 `auth_unavailable` になる。

| 症状 / 理由コード | 原因 | 対処 |
|---|---|---|
| `401` / reason `not_configured` | Access は JWT を付けているのに `ACCESS_TEAM_DOMAIN` か `ACCESS_AUD` が空 | 6.5 の `[vars]` を埋めて `pnpm run deploy` |
| `401` / reason `bad_aud` | AUD 不一致。別の Access アプリの AUD を書いた、アプリを作り直した、コピー漏れ | 6.4 でアプリの AUD を取り直して `[vars]` を更新 → 再 deploy |
| `401` / reason `bad_iss` | `ACCESS_TEAM_DOMAIN` に `.cloudflareaccess.com` や `https://` を含めている、または Team 名が違う | Team 名だけにする。`iss` は `https://<team>.cloudflareaccess.com` と完全一致が必要 |
| `503 auth_unavailable` / reason `jwks_fetch_failed` | JWKS の URL が 404（Team 名の誤り）か、一時的な取得失敗 | ブラウザで `https://<team>.cloudflareaccess.com/cdn-cgi/access/certs` が JSON を返すか確認。Team 名が正しければ少し待って再読み込み |
| `401` / reason `unknown_kid` | 鍵のローテーション直後。Worker は `kid` 不一致で JWKS を 1 回取り直すが、それでも見つからない | 5 分（JWKS キャッシュの期限）待って再読み込み。続くなら `wrangler tail` で確認 |
| `401` / reason `expired` | Access のセッション切れ | ブラウザでログインし直す |
| `401` / reason `no_credentials` が本番で出る | Access を通っていない（対象ドメインが違う、Preview URL から来ている、Access アプリが無効） | 6.3 の Application domain と実際の URL を照合。7.1 の上段の状態になるまで直す |
| `/api/health` が Access なしで 200 のまま | Access アプリの対象に入っていない | 同上。パスを空（ホスト全体）にしているか確認。6.6 を意図して行った場合は正常 |
| deploy 時 `database_id` の検証エラー / D1 にアクセスできない | `wrangler.toml` が仮の `00000000-...` のまま | 2.2 で置き換える |
| `pnpm db:migrate:remote` が「database not found」 | `database_name` / `database_id` と作成したものが一致しない | `pnpm exec wrangler d1 list` で照合 |
| `pnpm deploy` が `ERR_PNPM_CANNOT_DEPLOY` で止まる | pnpm の組み込みコマンドが呼ばれている | `pnpm run deploy` と打つ（5.1） |
| deploy 時 `assets` のディレクトリが無い / 空 | `web/dist` が無い（`vite build` を飛ばして `wrangler deploy` を直接叩いた） | `pnpm run deploy`（`build:web` を含む）を使う。手で叩くなら先に `pnpm build:web` |
| 画面は出るが写真の保存で 500 | R2 バケットが無い、または `bucket_name` 違い | 3 節。`wrangler r2 bucket list` で照合 |
| 想起や候補が一切出ない（`ai_runs.status = failed`） | `ANTHROPIC_API_KEY` 未設定・誤り、`ANTHROPIC_MODEL` 名の誤り | `wrangler secret list` と `[vars]` を確認。`wrangler tail` でエラー本文を見る。画面には何も出さない仕様（spec 第 9 節） |
| OTP メールが届かない | 迷惑メール、ポリシーのメールと入力したメールの不一致 | Zero Trust →「Logs」→「Access」（要確認）で拒否理由を見る |
| ログイン後に無限リダイレクト | Access アプリのドメインと実際のホスト名の不一致（www の有無など） | 6.3 を修正 |

## 10. チェックリスト（開発者が値を埋める）

| 項目 | 値 | 取得元 |
|---|---|---|
| Account ID | | 1.2 `wrangler whoami` |
| workers.dev サブドメイン | | 5.1 `pnpm run deploy` の出力 |
| 公開 URL（A または B） | | 5.2 / 5.3 |
| D1 `database_id` | | 2.1 `wrangler d1 create souieba` |
| R2 バケット | `souieba-photos` | 3 |
| Team domain（`<team>` のみ） | | 6.1 |
| Access アプリ名 | `souieba` | 6.3 |
| Access AUD タグ | | 6.4 |
| Allow するメール | | 6.3 |
| `/api/health` の Bypass（6.6） | 行う / 行わない | 11 節 #5 |
| `ANTHROPIC_API_KEY` を secret に登録した | はい / いいえ | 4.1 `wrangler secret list` |
| `.dev.vars` を手元に作った | はい / いいえ | 8 |

| 確認項目 | 結果 |
|---|---|
| 0001 マイグレーションが適用済み（S-3） | |
| JWT なし `/api/me` が JSON の 200 を返さない（7.1 上段） | |
| ブラウザで OTP を経て S1 が出る（S-10） | |
| ログイン後 `/api/me` がメールを返す（S-10） | |
| ログイン後 `/api/health` が 200（S-11 / T-1110-04） | |
| 深いパスが HTML を返す（S-11） | |
| `X-Dev-User` が本番で無視される（S-8） | |
| `git ls-files` に `.dev.vars` が無い（N-8） | |

## 11. 開発者の判断が必要なこと

| # | 内容 | 既定 |
|---|---|---|
| 1 | ドメインを A（workers.dev）と B（独自ドメイン）のどちらにするか。A は Access の対象にできるか要確認（6.3） | A から始め、できなければ B |
| 2 | Access の Allow に入れるメール。審査員や家族に触ってもらうか | 開発者のメールのみ |
| 3 | Session Duration | 24 時間 |
| 4 | `ANTHROPIC_MODEL` を Opus のままにするか Sonnet にするか（コスト） | `claude-opus-5-5`（ADR-0003 / 0005） |
| 5 | `/api/health` を Access 配下のまま（N-9 / S-11 の「200」は「ログイン後のブラウザで」の意味に読む）にするか、6.6 の Bypass で文字どおり公開するか | Access 配下のまま（architecture.md 3.3） |
