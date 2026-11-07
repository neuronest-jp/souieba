# そういえば。 機能要件と受け入れ条件

- 根拠: docs/spec.md v0.3（ADR-0001 で正本にした。v0.3 の変更点は ADR-0007）。章番号は同書のもの
- 既定値: ADR-0003、デザイン基盤: ADR-0004、Claude の出力形式: ADR-0005、配布（Capacitor）と認証（招待コード + JWT）: ADR-0007
- スキーマ: worker/migrations/0001_init.sql（本書はスキーマを変更しない。差異は第8節に列挙）
- 書き方: 受け入れ条件は Given / When / Then / 検証。ID は `F5-3` のように「機能-連番」。横断条件は `X-`、非機能は `N-`、11/4 スコープは `S-`

## 1. 用語定義

| 用語 | 定義 | 対応するデータ |
|---|---|---|
| 記憶 | ユーザーが残した1件の出来事。ひとこと（本文）、起きた日、写真1枚（任意）から成る | `memories` 1行 |
| ひとこと | 記憶の本文。1〜2000 文字の日本語テキスト。画面では「きょうのひとこと」 | `memories.body` |
| 候補 | ひとこと（または写真）から AI が抽出した、人物・場所・日付・もの。ユーザーが決めるまで事実ではない | `memory_facts.status = 'candidate'` |
| 確定 | ユーザーが候補に「そう」と答えた状態。確定した事実だけが検索と想起の入力になる。「ちがう」は却下 | `memory_facts.status = 'confirmed'`（却下は `'rejected'`） |
| そういえば（札） | 新しい記憶を書いたとき、関係のある昔の記憶が1〜3枚現れるカード。理由と根拠を伴う | `recalls` 1行 = 札1枚 |
| 根拠 | 提案（候補・札・語り）に必ず付く、元の記憶本文からの逐語引用。本文に部分文字列として存在しないものは破棄する。写真由来の候補だけは引用の代わりに写真そのものを根拠とする（F7） | `memory_facts.evidence`、`recalls.evidence` |
| 反応 | 札に対する「そうだった」「関係ないかも」。記録するだけで学習には使わない | `recalls.feedback` |
| 起きた日 | 記憶の出来事が起きた日と精度（日/月/年/不明） | `memories.happened_on`, `happened_on_precision` |

## 2. 共通の前提

| 項目 | 内容 |
|---|---|
| ユーザーの単位 | `user_id` はログイン時に入力したメールアドレス（小文字化。JWT の `sub`。第10節）。すべての API は自分の `user_id` のデータだけを返す。他人のデータは存在しないものとして扱い 404 を返す |
| 配布と呼び出し元 | アプリは Capacitor（iOS / Android）の WebView で動き、API を `VITE_API_BASE`（ビルド時の環境変数。`https://<api-domain>`）に向けて呼ぶ。Web の開発（`pnpm dev`）では `VITE_API_BASE` を空にし、同一オリジンの `/api` を Vite が 8787 に中継する。Workers Static Assets の配信は開発用プレビューだけ（第12節） |
| CORS | Worker は `capacitor://localhost`（iOS）、`https://localhost`（Android）、`http://localhost:5173`（Vite）、`http://localhost` だけを `Access-Control-Allow-Origin` に返す（worker/src/cors.ts で固定。設定項目ではない）。許可ヘッダは `Authorization` / `Content-Type` / `X-Dev-User`。Cookie は使わない（`credentials: false`） |
| ID と日時 | ID は UUID 文字列。日時は ISO 8601（UTC）。起きた日は `YYYY-MM-DD`。「今日」は `Asia/Tokyo` の今日（日本語のみのアプリ、第3.2節） |
| エラー形式 | `{ "error": { "code": string, "message": string } }`。`code` は `validation`（400）、`unauthorized`（401）、`not_found`（404）、`too_large`（413）、`unsupported_media`（415）、`too_many`（429。ログインの回数制限）、`internal`（500。D1・R2 の失敗や想定外の例外。詳細は返さない）、`auth_unavailable`（503。`INVITE_CODE` / `JWT_SECRET` が未設定）のいずれか |
| Claude の出力形式 | ADR-0005 に従う。JSON Schema の強制は Structured Outputs（`output_config.format`）で行い、`tool_choice` の強制（`any` / `tool`）は使わない（現行モデルは 400 を返す）。スキーマ名は `extract_facts` / `recall` / `photo_hints` / `retrospect` |
| AI 処理の状態 | `ai_runs` は Claude を呼ぶ処理の「予約票」でもある。`POST /api/memories` のハンドラ内（201 を返す前）に `status='running'` の行を同期的に INSERT し、`ctx.waitUntil` の中で `succeeded` / `empty` / `failed` に更新する。`kind='facts'` は常に、`kind='recall'` は過去記憶が 1 件以上あるときだけ、`kind='photo'` は `PUT /api/memories/:id/photo` のハンドラ内で作る。`GET /facts` `GET /recalls` の `status` は「当該 `memory_id`・`kind` に `running` の行があれば `pending`、それ以外（行なしを含む）は `done`」（`GET /facts` は `kind='facts'` と `kind='photo'` のどちらかが `running` なら `pending`。F7）。`running` のまま `created_at` から 60 秒を超えた行は GET 時に `done` 扱いにする（画面は何も出さない）。`waitUntil` の中は全体を try/catch で包み、例外時は `failed` に更新する |
| 文字数の扱い | 文字数は JS の `Array.from(s).length` で数える。Claude の出力の `reason`（80 文字）、`text`（200 文字）を超えた場合は末尾を切り詰めて保存する（破棄しない）。引用 `evidence` は切り詰めない（切ると部分文字列でなくなり得る。長くてもそのまま X-7 の検証に回す） |
| 画面の言葉 | 「AI」「生成」「送信」を画面に出さない（ADR-0004）。エラーは短い日本語で静かに。例「うまく保存できませんでした。もう少ししてから、もう一度」 |
| 検証方法 | 受け入れ条件の「検証」列は次のいずれか。**単体**: vitest（Claude は必ずモック。`worker/test/`）。**API**: ローカル Worker（`pnpm dev:worker`）に curl。**画面**: ブラウザで目視。**通し**: 実 API を呼んで目視（Claude の実出力に依存するため自動テストにしない。期待値は実出力の細部に依存しない形で書く） |
| 優先度 | P0: 11/10 までに必ず動く。P1: 時間があれば。P2: 提出後（本書では扱わない） |

## 3. 機能要件（第4節 F1〜F9）

### F1 ログイン（P0）

概要: 招待コードとメールアドレスでログインする（第10節、ADR-0007）。パスワードは無い。アプリは `POST /api/auth/login { invite_code, email }` を呼び、Worker は `INVITE_CODE`（wrangler secret）と定数時間で比較して、一致すれば `JWT_SECRET`（wrangler secret）で署名した HS256 の JWT `{ sub: <email 小文字>, iat, exp }`（有効 90 日）を返す。アプリは JWT を `@capacitor/preferences`（ネイティブは端末の設定領域、Web は localStorage）に保存し、以後すべての API に `Authorization: Bearer <jwt>` を付ける。Worker は署名・`exp`・`sub` の形を検証し、`sub` を `user_id` にする。

S0 ようこそ はログイン画面そのもの。保存したトークンが無いとき、または `/api/*` が 401 を返したときに表示する（トークンは消す）。ログアウトや JWT の失効は作らない（90 日で切れる。`JWT_SECRET` を変えると全員がログアウトになる）。

| 入力 | 出力 |
|---|---|
| `POST /api/auth/login` JSON `{ invite_code, email }`（認証不要） | 200 `{ token, expires_at, user_id }`。`expires_at` は ISO 8601、`user_id` は小文字化したメール |
| ヘッダ `Authorization: Bearer <jwt>`（本番・ローカルとも）、または `X-Dev-User`（`ENVIRONMENT=development` のみ） | `GET /api/me` → `{ user_id, display_name, since }`。初回は `users` に行を作る |

ログインのエラー: 400 `validation`（コードかメールが空、JSON でない、メールの形が違う）、401 `unauthorized`「招待コードかメールアドレスが違います」（コードとメールのどちらが違うかは言わない）、429 `too_many`（同一 IP から 1 分に 10 回を超えた。D1 `login_attempts` で数える。worker/migrations/0002_login_attempts.sql）、503 `auth_unavailable`（`INVITE_CODE` か `JWT_SECRET` が未設定）。

受け入れ条件

| ID | Given | When | Then | 検証 |
|---|---|---|---|---|
| F1-1 | `INVITE_CODE`（`<コード>=a@example.com` を含む対応表）と `JWT_SECRET` が設定済み | `POST /api/auth/login { invite_code: <a@example.com のコード>, email: " A@Example.com " }` | 200。`token` は 3 分割の JWT で、ヘッダ `alg = "HS256"`、ペイロード `sub = "a@example.com"`、`exp - iat = 7776000`（90 日）。`user_id = "a@example.com"`、`expires_at` は `exp` と同じ時刻 | 単体 |
| F1-2 | 同上 | F1-1 の `token` を `Authorization: Bearer` に付けて `GET /api/me` | 200、`user_id = "a@example.com"`。`users` に `id = "a@example.com"` の行があり、2 回目で `last_seen_at` が更新される | 単体 |
| F1-3 | 同上 | `invite_code` が違う（1 文字違い、長さ違いを含む）。または正しいコードに対応表と別のメールを入れる、他人のコードに自分のメールを入れる | 401 `unauthorized`、`message = "招待コードかメールアドレスが違います"`。`login_attempts` に `ok = 0` の行が 1 行増える。トークンは返さない | 単体 |
| F1-4 | 同上 | `invite_code` または `email` が空、本文が JSON でない、`email` が `a@b.c` の形でない、または 255 文字以上 | 400 `validation`。`login_attempts` には書かない | 単体 |
| F1-5 | 同一 IP（`cf-connecting-ip`）から直近 1 分に 10 回の試行がある | 11 回目の `POST /api/auth/login`（コードが正しくても） | 429 `too_many`。トークンは返さない。1 分後の試行は再び受け付ける | 単体（`now` を差し替える） |
| F1-6 | `INVITE_CODE` または `JWT_SECRET` が未設定。または `INVITE_CODE` が対応表の形でない（production で `=` の無い値、空のコード、メールの形違い、同じコードが 2 回） | `POST /api/auth/login` | 503 `auth_unavailable`。401 と区別する。理由はログにだけ出す。画面は「いま、うまくつながりません」 | 単体 |
| F1-7 | `exp` が過去の JWT、署名が別の secret の JWT、`alg` が `none` / `RS256` の JWT、3 分割でない文字列 | `GET /api/memories` | いずれも 401 `unauthorized`。本文に理由は出さず、`console.warn("auth rejected", { reason, path })` にだけ残す | 単体 |
| F1-8 | 本番（`ENVIRONMENT` が `development` 以外） | `X-Dev-User: a@example.com` だけで `GET /api/me` | 401。ヘッダは無視される | 単体、通し |
| F1-9 | `pnpm dev:worker`（`ENVIRONMENT=development`） | `X-Dev-User: you@example.com` で `GET /api/me` | 200、`user_id = "you@example.com"`。`Authorization` と `X-Dev-User` の両方があれば JWT を使う | API |
| F1-10 | アプリにトークンが無い（初回起動、または 401 で消した後） | 起動 | S0 ようこそ（アプリ名、一行の説明、招待コードとメールアドレスの入力欄、「はじめる」）が出る。コードとメールの両方が入るまで「はじめる」は押せない | 画面 |
| F1-11 | S0 | 正しいコードとメールで「はじめる」 | `POST /api/auth/login` が 200 → トークンを `@capacitor/preferences`（キー `souieba.token`）に保存 → S1 きょう が開く。アプリを終了して再起動しても S0 を経ずに S1 が開く（トークンの保持） | 画面（Web はブラウザの再読み込み、ネイティブはアプリの再起動） |
| F1-12 | S0 | コードが違う（401）、または入力の形が違う（400） | 「招待コードかメールアドレスが違うようです」を一文だけ `text-ink-soft` で出す。入力は消さない | 画面 |
| F1-13 | S0 | 429 | 「少し待ってから、もう一度」 | 画面 |
| F1-14 | S0 | 503、ネットワーク断、その他 | 「いま、うまくつながりません」 | 画面 |
| F1-15 | ログイン済み（S1〜S3 のどこか） | いずれかの `/api/*` が 401 を返す（期限切れ、`JWT_SECRET` の変更） | 保存したトークンを消し、`souieba:unauthorized` イベントで S0 に戻る。文言は出さない | 画面 |

エラー時: 401 のとき画面はトークンを消して S0 に戻す。503 `auth_unavailable` は 401 と区別し、画面は「いま、うまくつながりません」を出す（トークンは消さない）。

### F2 記憶の登録（P0）

概要: ひとことと起きた日、写真1枚で記憶を保存する。保存直後に F4（候補）と F5（札）が非同期で動く。

| 入力 | 出力 |
|---|---|
| `POST /api/memories` JSON `{ body, happened_on?, happened_on_precision? }` | 201、記憶をそのまま返す（`{ id, body, happened_on, happened_on_precision, photo_key, photo_content_type, created_at, updated_at }`。architecture 5.4 と同じフラット形）。201 を返す前に `ai_runs` の `facts`（常に）と `recall`（過去記憶が 1 件以上）を `running` で INSERT する（第2節） |
| `PUT /api/memories/:id/photo` multipart、フィールド名 `photo`、`image/jpeg` または `image/png`、10,485,760 バイト以下 | 200、`{ photo_key }`。R2 にオブジェクトがあり `memories.photo_key`, `photo_content_type` が入る。F7 が有効なら 200 を返す前に `ai_runs(kind='photo', status='running')` を INSERT する（F7 の上限を超えるときは作らない） |

既定値: `happened_on` 省略時は Worker が `Asia/Tokyo` の今日を入れる（画面も同じ値を送る）。`happened_on_precision` 省略時 `day`。`precision = month` は `YYYY-MM-01`、`year` は `YYYY-01-01`、`unknown` は `happened_on = NULL`。

写真の縮小: 画面は保存前に、長辺 1600px 以下・JPEG 品質 0.85 程度に縮小してから PUT する（Canvas API。依存を増やさない。縮小後は常に `image/jpeg`）。理由は F7 の Claude への送信上限（画像 1 枚 10MB、base64 後のサイズ。Anthropic の Vision ドキュメントで確認）。Worker は縮小しない。API 直接の PUT（curl）は縮小前のバイト列をそのまま受け付ける。

受け入れ条件

| ID | Given | When | Then | 検証 |
|---|---|---|---|---|
| F2-1 | ログイン済み | `body = "スーパーで青梅を見かけた"`（12文字）で POST | 201。D1 `memories` に1行。`happened_on` = JST の今日、`precision = 'day'`、`photo_key IS NULL`。`ai_runs(kind='facts', status='running')` が 201 の時点で存在する | 単体 |
| F2-2 | ログイン済み | `body` が空文字、または空白のみ | 400 `validation`。行は作られない。画面では「保存する」が押せない | 単体、画面 |
| F2-3 | ログイン済み | `body` が 2000 文字 | 201。2001 文字なら 400 `validation`（文字数は JS の `Array.from(body).length` で数える。サロゲートペアを1文字とする） | 単体 |
| F2-4 | ログイン済み | `happened_on_precision = "unknown"` | 201。`happened_on IS NULL`。一覧では「いつだったか」と表示する | 単体、画面 |
| F2-5 | 記憶 M が自分のもの | 9 MB の JPEG（縮小前のバイト列）を `PUT /api/memories/M/photo` | 200。R2 に `photo_key` のオブジェクト。`GET /api/photos/:key` が同じバイト列を `Content-Type: image/jpeg` で返す | API |
| F2-6 | 記憶 M が自分のもの | 10,485,761 バイトの PNG を PUT | 413 `too_large`。R2 に書かれない。画面では「写真が大きすぎるみたいです（10MB まで）」 | 単体、画面 |
| F2-7 | 記憶 M が自分のもの | `image/gif` を PUT | 415 `unsupported_media` | 単体 |
| F2-8 | 記憶 M が他人のもの | PUT photo | 404 | 単体 |
| F2-9 | S1 | 「いつ？」をタップ | 日 / 月 / 年 / いつだったか を選べる。選んだ精度に応じて `happened_on_precision` と `happened_on`（既定値の規則で丸めた値）が POST に入る。既定は今日・`day` | 画面 |
| F2-10 | S1、4000×3000px・8MB の JPEG を選ぶ | 保存 | PUT されるオブジェクトは長辺 1600px 以下の `image/jpeg`。R2 のオブジェクトサイズは 2MB 未満 | 画面 |

エラー時: 保存に失敗したら（`internal` を含む）本文は画面に残し、消さない。写真の保存だけ失敗したら記憶は残し「写真だけ、あとでもう一度」と出す。

### F3 記憶の一覧・詳細・削除（P0）

概要: S2 これまで（時系列一覧）、S3 記憶の詳細、削除。

| 入力 | 出力 |
|---|---|
| `GET /api/memories?cursor=` | `{ items: [{ id, body, happened_on, happened_on_precision, photo_key, created_at }], next_cursor }`。1ページ 20 件 |
| `GET /api/memories/:id` | `{ memory, facts: { pending, items }, recalls: { pending, items }, recalled_by: { items } }`（J-7）。`facts` は全 status（candidate / confirmed / rejected）を返す。`recalls` はこの記憶が新しい側の札、`recalled_by` はこの記憶が思い出された側の札 |
| `DELETE /api/memories/:id` | 204 |

事実の表示: API は全 status を返す。S1（保存直後）は candidate と confirmed を並べ、rejected は薄く残す（F4-4）。S3 は confirmed だけを「確定済みの事実」として見せる（第6節 S3）。

受け入れ条件

| ID | Given | When | Then | 検証 |
|---|---|---|---|---|
| F3-1 | 起きた日が 2026-06-15、2026-11-03、NULL、2024-01-01 の4件 | `GET /api/memories` | 順序は 2026-11-03, 2026-06-15, 2024-01-01, NULL（`happened_on DESC, created_at DESC`。不明は最後） | 単体 |
| F3-2 | 同じ起きた日の2件（作成順 A, B） | 一覧 | B が A より上 | 単体 |
| F3-3 | 25 件ある | 1ページ目、`next_cursor` で2ページ目 | 20 件 + 5 件。重複も欠落もない。2ページ目の `next_cursor` は null | 単体 |
| F3-4 | 記憶 M（写真あり、確定事実2件、札1枚） | `DELETE /api/memories/M` | 204。`memories`, `memory_facts`, `recalls`（`memory_id` または `related_memory_id` が M）と、M の `ai_runs` の記録（同じ batch。11/7 から）が消え、R2 のオブジェクトも消える。直後の `GET /api/memories/M` は 404、`GET /api/photos/:key` も 404 | 単体 |
| F3-5 | 記憶 M が他人のもの | `GET` / `DELETE /api/memories/M` | いずれも 404。削除されない | 単体 |
| F3-6 | 記憶が 0 件 | S2 を開く | 空状態の一行「まだ何もありません。きょうのひとことから」。スピナーは出さず、読み込み中は薄い文字で「よみこみ中」 | 画面 |
| F3-7 | S3 を開く | 「消す」を押す | 一度だけ確認（「この記憶を消しますか」「消す」「やめる」）。「消す」で即時削除し S2 へ戻る。元に戻す機能は提供しない | 画面 |
| F3-8 | 記憶 M に candidate 1 件、confirmed 1 件、rejected 1 件 | `GET /api/memories/M`、S3 を開く | API は 3 件すべてを返す。S3 に見えるのは confirmed の 1 件だけ | 単体、画面 |

エラー時: 一覧取得失敗は「読み込めませんでした」と再読み込みの導線。削除失敗は記憶を残したまま「消せませんでした」。

### F4 候補抽出（P0、C2）

概要: 登録直後、ひとことから人物・場所・日付・ものの候補を抽出して並べる。ユーザーが「そう」「ちがう」で決める。確定した事実は検索（F9）と想起（F5）の入力になる。

| 入力 | 出力 |
|---|---|
| Claude（Structured Outputs、スキーマ名 `extract_facts`。ADR-0005）へ: `body` のみ | `[{ kind, value, evidence }]`。`evidence` は `body` の逐語引用 |
| `GET /api/memories/:id/facts` | `{ pending: boolean, items: [{ id, kind, value, status, source, evidence }] }`。`pending` の導出は第2節「AI 処理の状態」（写真からの気づき候補 F7 の実行中も `pending`） |
| `PATCH /api/facts/:id` JSON `{ status: "confirmed" \| "rejected" }` | 200、更新後の fact。`decided_at` を設定 |

Worker の検証と保存（この順に適用する）: (1) `evidence` が空、または `body` の部分文字列でないもの（X-6, X-7）、`kind` が 4 種以外のもの、`date` 以外で `value` が `body` の部分文字列でないもの（F4-9）を捨てる → (2) `(kind, value)` が同じものは最初の 1 件を残して除く → (3) 残りを `source='ai'`, `status='candidate'` で保存。0 件なら `ai_runs.status='empty'`。`value` も照合するのは、引用は本文にあっても値が推測（「はると（息子）」「祖母」）だと、根拠付きの候補に見えたまま「そう」で確定事実になり、想起の入力に入るため（原則 1・3）。`date` は相対表現を解いた値（「先月」→ `2026-10`）が正しいので、形と実在だけを見る。

日付候補の精度: `memory_facts` に精度の列はないため `value` の長さで表す（`YYYY-MM-DD` = 日、`YYYY-MM` = 月、`YYYY` = 年）。不明なら候補を出さない。起きた日が「いつだったか」（`happened_on` が NULL）の記憶では年の根拠が本文にしか無いので、`value` の年（4 桁。半角か全角）が `body` に無い `date` 候補は Worker が捨てる（F4-10。どの形にも年が要るため、年を当てはめた推測が根拠付きの候補に見えるのを防ぐ。前後に数字が続く並び（「12000円」の 2000）は年として数えない）。画面では精度に応じて語尾を付けて表示する（`2026-06-15` → 「2026年6月15日」、`2026-06` → 「2026年6月ごろ」、`2024` → 「2024年ごろ」）。確定しても `happened_on` には反映しない（X-3）。

受け入れ条件

| ID | Given | When | Then | 検証 |
|---|---|---|---|---|
| F4-1 | `body = "おばあちゃんは毎年6月になると、縁側で梅干しを漬けていた"` を登録 | 10 秒以内に `GET /facts` | `pending = false`。`kind='person'` と `kind='thing'` の候補が 1 件以上あり、すべて `status = 'candidate'`, `source = 'ai'`、`evidence` はすべて本文の部分文字列 | 通し |
| F4-2 | Claude が `evidence = "祖母"` の候補を返した（本文に「祖母」はない） | Worker の検証 | その候補は D1 に保存されず、画面にも出ない。他の候補は残る | 単体 |
| F4-3 | 候補 C（candidate） | `PATCH /api/facts/C { status: "confirmed" }` | 200。`status = 'confirmed'`, `decided_at` が非 NULL。画面では「そう」が moss 色で選択状態になる | 単体、画面 |
| F4-4 | 候補 C（candidate） | `{ status: "rejected" }` | `status = 'rejected'`。画面からは薄く消える（行自体は削除しない）。F5 と F9 の入力に含まれない | 単体、画面 |
| F4-5 | Claude のモックが空配列を返す | `GET /facts` | `pending = false`, `items = []`、`ai_runs(kind='facts', status='empty')`。画面には候補の枠も見出しも出ない | 単体、画面（モック） |
| F4-6 | 他人の候補 C | `PATCH /api/facts/C` | 404 | 単体 |
| F4-7 | Claude が `thing: 梅干し` を 2 件（evidence はどちらも本文にある）返した | Worker の検証 | 保存は 1 件 | 単体 |
| F4-8 | Claude が `kind='date', value='2026-06'` を返した | 画面 | 「2026年6月ごろ」と表示される | 単体（表示関数）、画面 |
| F4-9 | `body = "はると、今日補助輪なしで乗れた"`、Claude が `person: はると（息子）`（`evidence = "はると"`）と `person: はると` を返した | Worker の検証 | 保存は `はると` の 1 件だけ（`value` が本文に無い候補は捨てる）。`date` の `value`（`先月` → `2026-10`）はこの照合から外す | 単体 |
| F4-10 | 起きた日を「いつだったか」にして `body = "きのう公園で花を見た"` を登録、Claude が `date: 2026-11-06`（`evidence = "きのう"`）を返した | Worker の検証 | 保存しない（本文に年が無い）。`body` に `2019年` があれば `2019-06-15` は残る。起きた日がある記憶（D4 の「今日」→ `2026-11-07`）はこれまでどおり残る | 単体 |

エラー時: Claude 呼び出し失敗（HTTP エラー、タイムアウト、JSON 不正、`stop_reason='max_tokens'`）は `ai_runs(kind='facts', status='failed')` を記録し、`pending = false`, `items = []` を返す。`stop_reason='refusal'`（HTTP 200）も失敗と同じ扱い: `status='failed'`、`error` に `refusal:<stop_details.category>` を記録、画面は静か（ADR-0005）。再試行はしない（第9節）。

### F5 そういえば（P0、C1）

概要: 登録直後、同じユーザーの過去の記憶から本当に関係のあるものだけを最大3件選び、札として出す。関係がなければ 0 件（何も出さない）。

| 入力 | 出力 |
|---|---|
| Claude（Structured Outputs、スキーマ名 `recall`。ADR-0005）へ: 新しい記憶の `body` + 過去記憶 `[{ id, happened_on, body, facts(confirmed のみ) }]` を `created_at DESC` で最大 200 件 | `[{ related_memory_id, reason, evidence }]` 最大 3 件。`evidence` は related 側 `body` の逐語引用 |
| `GET /api/memories/:id/recalls` | `{ pending: boolean, items: [{ id, related_memory: { id, body, happened_on, photo_key }, reason, evidence, feedback }] }`。`pending` の導出は第2節「AI 処理の状態」 |

受け入れ条件

| ID | Given | When | Then | 検証 |
|---|---|---|---|---|
| F5-1 | 過去に「おばあちゃんは毎年6月になると、縁側で梅干しを漬けていた」がある | 「スーパーで青梅を見かけた」を登録し 10 秒以内に `GET /recalls` | `pending = false`, 札 1 枚。`related_memory_id` が梅干しの記憶、`evidence` がその本文の部分文字列、`reason` が 1〜80 文字 | 通し |
| F5-2 | 過去に梅干し・三輪車など 2 件 | 「電気代を払った。先月より少し安かった」を登録 | `pending = false`, `items = []`。画面には札も「関連なし」の文言も出ない。`ai_runs(kind='recall', status='empty')` | 通し |
| F5-3 | Claude が 5 件返した | Worker の検証 | この順に適用する: (1) `evidence` が空または related 側 `body` に含まれないもの、`related_memory_id` が自分の記憶でない・送った 200 件に無い・新しい記憶自身と同じものを捨てる → (2) `related_memory_id` の重複を除く（最初の 1 件を残す） → (3) 残りの先頭から最大 3 件を保存。残り 0 なら `status='empty'` | 単体 |
| F5-4 | 過去の記憶が 0 件 | 最初の記憶を登録 | `ai_runs(kind='recall')` を作らず、Claude の recall も呼ばない。`items = []`, `pending = false` | 単体 |
| F5-5 | 過去の記憶が 250 件 | 登録 | Claude へ送るのは `created_at DESC` 上位 200 件。`ai_runs.input_tokens` が記録される | 単体（モックで入力件数を数える） |
| F5-6 | 札が 1 枚ある | 札を開く | S3 相当の詳細（昔の本文全文、写真、起きた日）と根拠の引用が本文中で強調される。「そうだった」「関係ないかも」が押せる | 画面 |
| F5-7 | Claude が同じ `related_memory_id` を 2 件返した | Worker の検証 | 保存は 1 件。`recalls` の `UNIQUE (memory_id, related_memory_id)` で INSERT が失敗しない | 単体 |
| F5-8 | Claude が 5 件返し、先頭 3 件のうち 2 件の `evidence` が本文に無い | Worker の検証 | 保存は 3 件（有効な 4〜5 件目が繰り上がる） | 単体 |
| F5-9 | `POST` 直後、`waitUntil` がまだ `ai_runs` を更新していない | `GET /recalls` | `pending = true`（`running` の行があるため）。`done` と誤判定しない | 単体 |
| F5-10 | `ai_runs(kind='recall', status='running')` の `created_at` が 61 秒前 | `GET /recalls` | `pending = false`, `items = []` | 単体 |

エラー時: 失敗（HTTP エラー、タイムアウト、JSON 不正、`max_tokens`）は `ai_runs.status = 'failed'`、`pending = false`, `items = []`。`stop_reason='refusal'`（HTTP 200）も同じ扱いで `error` に `refusal:<stop_details.category>` を記録（ADR-0005）。画面は静かなまま。再試行しない。

### F6 反応（P0）

概要: 札に「そうだった」「関係ないかも」を記録する。学習には使わない。

| 入力 | 出力 |
|---|---|
| `PATCH /api/recalls/:id` JSON `{ feedback: "helpful" \| "not_related" \| "none" }` | 200、更新後の recall |

受け入れ条件

| ID | Given | When | Then | 検証 |
|---|---|---|---|---|
| F6-1 | 札 R（feedback none） | 「そうだった」 | `feedback = 'helpful'`。札に moss 色の印。札は消えない | 単体、画面 |
| F6-2 | 札 R | 「関係ないかも」 | `feedback = 'not_related'`。札は薄くなるが残る。関連記憶は削除されない | 単体、画面 |
| F6-3 | 札 R（helpful） | もう一度「そうだった」 | `feedback = 'none'` に戻る（トグル） | 単体、画面 |
| F6-4 | 反応済みの札がある | 次の記憶を登録 | Claude への入力に `feedback` は含まれない（prompt と入力 JSON に `feedback` キーが無い） | 単体 |
| F6-5 | 他人の札 | PATCH | 404 | 単体 |

エラー時: 更新失敗（`internal` を含む）は印を元に戻し「記録できませんでした」。

### F7 写真からの気づき候補（P1、C3）

状態: 実装済み（11/7、ADR-0012。worker/src/ai/photo.ts、web/src/components/FactChips.vue）。実際の Claude と実機での確認は未了。

概要: 写真から、写っている物事・場所の種類の候補を「〜でしょうか」の形で出す。人物の同定、年齢、感情は断定しない。季節は「桜」「紅葉」「雪」のように写っている物事（`thing`）として表す（`date` は精度を決められないため写真からは出さない）。

| 入力 | 出力 |
|---|---|
| Claude（Structured Outputs、スキーマ名 `photo_hints`。ADR-0005）へ: 写真（R2 から読んで base64）と `body` | `[{ kind: "thing" \| "place", value }]` 最大 5 件 |
| `GET /api/memories/:id/facts` の `facts` に含める（F4 と同じ形） | 写真候補も `memory_facts` に `source='ai'`, `status='candidate'` で保存する。`evidence` には写真由来を示す固定文字列 `photo:<photo_key>` を入れる（スキーマの `source='ai'` は `evidence` 必須）。画面は `evidence` が `photo:` で始まる候補を「写真から」と添え、`value` に「でしょうか」を付けて表示する（引用「」としては出さない）。確定・却下は F4 と同じ `PATCH /api/facts/:id` |

送信上限: Worker は画像を縮小しない。R2 のオブジェクトが 6,291,456 バイト（6 MiB。base64 後 8 MiB で API の 10MB 上限に収まる）を超えるときは `photo` を呼ばず `ai_runs` も作らない。画面側は F2 の縮小で通常 2MB 未満になる。解像度は API 側で長辺 2576px に縮小されるため Worker では扱わない。

X-6 / X-7 の引用検証は本文由来の候補（`evidence` が `photo:` で始まらないもの）だけに適用する。写真候補は (1) `kind` が `thing` / `place` 以外を捨てる → (2) `(kind, value)` の重複を除く → (3) 先頭から最大 5 件を保存。

受け入れ条件

| ID | Given | When | Then | 検証 |
|---|---|---|---|---|
| F7-1 | 公園の花の写真を添えて「公園で花が咲いていた」を登録 | 10 秒以内に `GET /facts` | `facts` に `source='ai'`, `status='candidate'`, `evidence='photo:<photo_key>'` の候補が 0〜5 件。`kind` は `thing` または `place`。画面では「写真から」と添えて語尾はすべて「でしょうか」 | 通し |
| F7-2 | 写真候補「桜でしょうか」（candidate） | 「ちがう」 | `status='rejected'`。`memories.body` は「公園で花が咲いていた」のまま。再読み込み後は薄く残り、F5・F9 の入力に含まれない | 単体、画面 |
| F7-3 | 写真候補「桜でしょうか」（candidate） | 「そう」 | `status='confirmed'`, `source='ai'`, `evidence='photo:<photo_key>'` のまま。S3 に「桜」が確定済みの事実として出る | 単体、画面 |
| F7-4 | Claude のモックが `kind='person'` と `kind='date'` を返した | Worker の検証 | いずれも保存されない（年齢・感情の語を `value` に含む `thing` も prompt で禁じるが、Worker は `kind` でだけ捨てる） | 単体 |
| F7-5 | 写真なしの記憶 | 登録 | `ai_runs(kind='photo')` が作られない | 単体 |
| F7-6 | 7 MB の JPEG を curl で PUT | PUT | 200 で保存される。`ai_runs(kind='photo')` は作られず、`GET /facts` の `status` は `photo` の影響を受けない | 単体 |
| F7-7 | 写真候補「公園でしょうか」と本文候補 `place: 公園`（evidence「公園」） | `GET /facts` | 両方が candidate として返る（写真候補と本文候補は `(kind, value)` が同じでも別行。開発者の判断で片方に寄せてよい） | 単体 |

エラー時: 失敗（`refusal` を含む）は `ai_runs(kind='photo', status='failed')`。候補は増えない。画面は静か。

### F8 ふりかえり（P1、C4）

概要: 人物（確定済み person の value）または期間（起きた日の範囲）を軸に、記憶を時系列の短い語りにまとめる。各段落に引用元の記憶 ID と逐語引用を付ける。

| 入力 | 出力 |
|---|---|
| `POST /api/retrospects` JSON `{ person?: string, from?: "YYYY-MM-DD", to?: "YYYY-MM-DD" }`（いずれか必須） | `{ paragraphs: [{ text, memory_id, evidence }] }`。Claude（Structured Outputs、スキーマ名 `retrospect`）を同期で呼ぶ。D1 には `ai_runs(kind='retrospect')` のみ記録し、語りは保存しない |

受け入れ条件

| ID | Given | When | Then | 検証 |
|---|---|---|---|---|
| F8-1 | `person = "はると"` が確定済みの記憶 3 件 | POST | 段落 1〜3 本。各段落の `memory_id` はその 3 件のいずれか、`evidence` はその本文の部分文字列、`text` は 200 文字以下（超過は末尾を切り詰める。第2節） | 通し |
| F8-2 | Claude が `evidence` の無い段落、または本文に無い引用の段落を返した | Worker の検証 | その段落は捨てる。全段落が捨てられたら `paragraphs = []`、画面は「まだ語れるほど集まっていないようです」 | 単体 |
| F8-3 | 該当する記憶が 0 件 | POST | Claude を呼ばず `paragraphs = []` | 単体 |
| F8-4 | 語りを表示 | 段落をタップ | 引用元の記憶の詳細（S3）へ移動できる | 画面 |

エラー時: 失敗（`refusal` を含む）は `ai_runs.status='failed'`、`paragraphs = []`。

### F9 検索（P1）

概要: 本文と確定した事実の部分一致。

| 入力 | 出力 |
|---|---|
| `GET /api/memories?q=梅` | F3 と同じ形。`body LIKE ? ESCAPE '\'` または `memory_facts(status='confirmed').value LIKE ? ESCAPE '\'` の記憶。`q` は先頭 100 文字で切り、`\` `%` `_` を `\` でエスケープしてから `%...%` で包む |

受け入れ条件

| ID | Given | When | Then | 検証 |
|---|---|---|---|---|
| F9-1 | 本文に「梅干し」を含む記憶 A、確定事実 `thing: 青梅` の記憶 B、候補のまま `thing: 梅` の記憶 C（本文に「梅」なし） | `q=梅` | A と B が返り、C は返らない | 単体 |
| F9-2 | 却下された `place: 公園` の記憶 D（本文に「公園」なし） | `q=公園` | D は返らない | 単体 |
| F9-3 | `q` が空 | GET | 検索せず通常の一覧 | 単体 |
| F9-4 | 該当 0 件 | S2 | 「見つかりませんでした」と検索語を消す導線 | 画面 |
| F9-5 | 本文に「100%」を含む記憶 E、「100点」を含む記憶 F | `q=100%` | E だけが返る（`%` はワイルドカードにならない） | 単体 |

エラー時: 通常の一覧と同じ。

## 4. 製品原則の横断的受け入れ条件

| ID | 原則 | Given | When | Then | 検証 |
|---|---|---|---|---|---|
| X-1 | 1 推測を事実にしない | `source='ai'` の fact（本文由来・写真由来とも） | 挿入直後 | `status` は必ず `'candidate'`。`confirmed` にするのは `PATCH /api/facts/:id` だけ | 単体 |
| X-2 | 1 | 候補のままの fact | F5・F9 の入力生成 | `status='confirmed'` 以外は含まれない。`memories.body` も変更されない | 単体 |
| X-3 | 1 | 日付候補を確定 | PATCH | `memories.happened_on` は自動では変わらない（変えるのはユーザーの編集だけ。編集は P2） | 単体 |
| X-4 | 2 関係なければ提案しない | Claude が空配列 | recalls | `ai_runs.status='empty'`。画面に札も「見つかりませんでした」等の文言も出ない。S1 は保存直後の静かな状態のまま | 単体、画面（モック） |
| X-5 | 2 | 札が 0 件 | 1 分経過 | 画面は変わらない（ポーリングは `pending = false` で止まる） | 画面 |
| X-6 | 3 根拠 | `evidence` が引用元 body の部分文字列でない本文由来の提案（候補・札・語りの段落） | Worker の検証 | 保存も表示もされない。`evidence` が空文字のものも同じ。写真由来の候補（`evidence` が `photo:` で始まる）は対象外（F7） | 単体 |
| X-7 | 3 | `evidence` を照合 | 比較 | 正規化（空白除去、全角半角変換）をしない。完全な部分文字列一致（`body.includes(evidence)`）だけを採用する | 単体 |
| X-8 | 3 | 札を表示 | 画面 | `reason` と `evidence` の両方が札に見える。引用は「」で囲む | 画面 |
| X-9 | 4 創作しない | ふりかえりの段落 | 検証 | `evidence` 検証で表示前に捨てる（F8-2）。画面に出る段落は必ず `memory_id` を持つ | 単体 |
| X-10 | 5 ユーザーのもの | 削除 | DELETE | 即時に D1 と R2 から消える。ゴミ箱や猶予期間はない | 単体 |
| X-11 | 5 | ユーザー A が登録 | Claude への入力 | 過去記憶は `user_id = A` のものだけ（SQL に `WHERE user_id = ?` がある単体テスト） | 単体 |
| X-12 | UI | すべての画面 | テキストを走査 | 「AI」「生成」「送信」が出ない。`web/src` の `.vue` を grep して UI 文字列にこれらの語が無い | 単体（grep） |
| X-13 | UI | S1 | 表示 | 入力欄、起きた日（既定: 今日。「いつ？」で日/月/年/いつだったかを選べる）、写真ボタン、保存ボタンだけ。会話の吹き出しや「質問する」導線がない | 画面 |

## 5. 非機能要件の受け入れ条件（第5節）

| ID | 項目 | Given | When | Then | 検証 |
|---|---|---|---|---|---|
| N-1 | 想起の応答 | 過去記憶 50 件 | 登録 | `POST /api/memories` は 1 秒以内に 201 を返す（Claude 呼び出しは `ctx.waitUntil`）。札は登録から 10 秒以内に画面に出る | 通し |
| N-2 | ポーリング | 登録直後 | S1 | `GET /facts` と `GET /recalls` を 2 秒間隔で呼び、両方 `pending = false` で止める。30 秒で `done` にならなければ止めて何も出さない | 画面 |
| N-3 | 画面 | 幅 375px（iPhone SE 相当） | S1〜S3 | 横スクロールが出ない。本文の `font-size` が 17px 以上、行間 1.8 | 画面 |
| N-4 | 画面 | 幅 1280px | S1〜S3 | 本文列の最大幅 560px で中央寄せ。崩れない | 画面 |
| N-5 | コスト | 1 件の記憶 | 登録から 1 分後 | `ai_runs` は `kind='facts'` 1 行、`kind='recall'` 0〜1 行（過去記憶が無ければ 0）、写真があり上限内なら `kind='photo'` 1 行。同じ `memory_id`・`kind` の 2 行目は作られない | 単体 |
| N-6 | コスト | 過去記憶 300 件 | 登録 | Claude への過去記憶は 200 件ちょうど | 単体 |
| N-7 | 失敗時 | Anthropic API が 500 | 登録 | 再試行しない（`maxRetries: 0`）。`ai_runs.status='failed'`, `error` に要約。`pending = false` で画面は静か | 単体 |
| N-7b | 失敗時 | Anthropic API が HTTP 200 で `stop_reason='refusal'` | 登録 | `ai_runs.status='failed'`, `error = 'refusal:<stop_details.category>'`（category が null なら `refusal:unknown`）。保存 0 件、画面は静か（ADR-0005） | 単体 |
| N-8 | セキュリティ | リポジトリ | `git ls-files` | `.dev.vars`、`web/.env.production`、`web/.env.local`、`ios/` `android/` 配下の署名ファイル（`*.mobileprovision`、`*.p12`、`*.keystore`、`*.jks`、`key.properties`、`google-services.json`、`GoogleService-Info.plist`）が含まれない（`.dev.vars.example`、`web/.env.example` は含む）。`wrangler.toml` と文書に `ANTHROPIC_API_KEY` / `INVITE_CODE` / `JWT_SECRET` の値が無い（`dev` / `dev-only-secret` は開発専用の既定値で秘密ではない） | 単体（シェル） |
| N-9 | セキュリティ | 本番 | `curl` で `Authorization` なし `/api/memories`、`X-Dev-User` だけの `/api/me` | いずれも 401。`/api/health` と `POST /api/auth/login` だけが認証なしで到達できる（`/api/health` は 200） | 通し |
| N-9b | セキュリティ | 本番 | `POST /api/auth/login` を同一 IP から 1 分に 11 回 | 11 回目が 429。招待コードの総当たりを遅らせる（F1-5） | 通し |
| N-9c | セキュリティ | 本番 | `Origin: https://evil.example` で `OPTIONS /api/me` | `Access-Control-Allow-Origin` が返らない。`Origin: capacitor://localhost` なら同じ値が返る（第2節 CORS） | 通し |
| N-10 | 可用性 | `wrangler.toml` | 確認 | D1 バインディング 1 本（`souieba`）、R2 バケット 1 本（`souieba-photos`）、Worker 名 `souieba` | 単体（grep） |
| N-11 | デザイン基盤 | `web/src/style.css` | 確認 | ADR-0004 の 10 トークンが `@theme` に定義され、`.vue` に `#` 始まりの色指定が無い | 単体（grep） |
| N-12 | 札の動き | 札が出る | 表示 | 600ms のフェード + 上方向スライド。音や通知は出ない | 画面 |

## 6. 11/4 スコープの受け入れ条件

対象: プロジェクト雛形、D1 マイグレーション適用、デザイン基盤、`/api/health`、招待コード + JWT のログイン疎通、`wrangler deploy`。当初は Cloudflare Access の疎通だったが ADR-0007 で置き換えた（コミット e6908c6）。

| ID | Given | When | Then | 検証 |
|---|---|---|---|---|
| S-1 | クリーンな clone | `pnpm install && pnpm typecheck && pnpm test && pnpm build` | すべて終了コード 0。`pnpm build` は `wrangler deploy --dry-run` まで通る | API（シェル） |
| S-2 | ローカル | `pnpm db:migrate:local` | `users`, `memories`, `memory_facts`, `recalls`, `ai_runs`, `login_attempts` の 6 テーブルができる（0001 と 0002）。二度目の実行は何も適用せず成功する | API（シェル） |
| S-3 | リモート | `pnpm db:migrate:remote` | 同じ 6 テーブル。`wrangler d1 migrations list souieba --remote` で 0001 と 0002 が適用済み | 通し |
| S-4 | `pnpm dev:worker` | `GET http://localhost:8787/api/health` | 200、`{ ok: true, service: "souieba", version: string, time: ISO8601 }`。認証ヘッダ不要 | API |
| S-5 | `pnpm dev:worker`（`ENVIRONMENT=development`） | `GET /api/me` に `X-Dev-User: you@example.com` | 200、`user_id = "you@example.com"` | API |
| S-5b | `pnpm dev:worker` と `pnpm dev` | ブラウザで `http://localhost:5173/`、開発者ツールで `/api/me` | 画面の開発サーバが `X-Dev-User` を自動で付け、`/api/me` が 200。S0 を経ずに S1 が開く | 画面 |
| S-5c | `pnpm dev:worker` | `POST /api/auth/login { invite_code: "dev", email: "you@example.com" }`（`dev:worker` が渡す開発専用の既定値）→ 返った `token` で `GET /api/me` | 200 → 200、`user_id = "you@example.com"`。`bash scripts/smoke.sh` がこの流れを含む | API |
| S-6 | `pnpm dev:worker`（`ENVIRONMENT=development`） | `X-Dev-User` なしで `GET /api/me` | 401 | API |
| S-7 | `pnpm dev:worker`（`ENVIRONMENT=development`） | `X-Dev-User: not-an-email` | 401（`@` を含む簡易検証） | API |
| S-8 | 本番（`ENVIRONMENT` 未設定または `production`） | `X-Dev-User: you@example.com` だけで `GET /api/me` | 401。ヘッダは無視される | 単体、通し |
| S-9 | 本番 | 有効な JWT と `X-Dev-User: other@example.com` の両方 | 200、`user_id` は JWT の `sub`。`X-Dev-User` は使われない | 単体 |
| S-10 | 本番 | `curl -d '{"invite_code":"<本物>","email":"you@example.com"}' https://<api-domain>/api/auth/login` → 返った `token` で `GET /api/me` | 200 → 200、`user_id = "you@example.com"`。`X-Dev-User` だけでは 401（S-8）。アプリ（または `pnpm preview` の画面）から同じコードとメールで「はじめる」→ S1 が開く | 通し |
| S-11 | 本番 | `pnpm run deploy` | `/api/health` が 200。`/api/*` 配下の未知パス（例 `/api/nothing`）は `not_found` の JSON 404。開発用プレビューとして Static Assets から `index.html` が配信され、それ以外の未知パスは SPA の `index.html` を返す（配布には使わない。第12節） | 通し |
| S-12 | `web/src/style.css` | ブラウザで S1 | 背景 `#FAF5EC`、見出しが Zen Maru Gothic、本文が Noto Sans JP（読み込み前は system-ui）。本文 17px | 画面 |
| S-13 | `.claude/settings.json` | Claude Code が `.dev.vars` または `demo/photos/x.jpg` に Write | フックが拒否する（`.dev.vars.example` は書ける） | 単体（フックに JSON を流す） |

## 7. デモ4シナリオと受け入れ条件の対応（第11節）

| デモ | 示す原則 | 担保する受け入れ条件 | 前提フィクスチャ |
|---|---|---|---|
| D1 祖母の梅干し | 想起 + 根拠 | F2-1, F4-1, F5-1, F5-6, X-6, X-8, N-1, N-12 | 過去記憶「おばあちゃんは毎年6月になると、縁側で梅干しを漬けていた」 |
| D2 電気代 | 関係なければ提案しない | F5-2, X-4, X-5, N-2。通しでは本文候補（`thing: 電気代` など）が出てもよい。示す原則は「札が 0 件」であって候補 0 件ではない | D1・D4 の過去記憶が入った状態 |
| D3 公園の花 | 推測を事実にしない | F2-5, F2-10, F7-1, F7-2, X-1, X-2（F7 が間に合わない場合は F4 の `place: 公園` 候補を「ちがう」にする F4-4, X-2 で代替） | 公園の花の写真（demo/photos/、開発者が置く）、本文「公園で花が咲いていた」 |
| D4 はるとの自転車 | 想起 + 成長 | F2-1, F4-1 相当（`person` の候補が 1 件以上）, F4-3, F5-1 相当（`evidence` が「はるとが三輪車で転んで泣いた」の部分文字列）, F6-1, X-8 | 過去記憶「はるとが三輪車で転んで泣いた」 |

共通: 4 本とも同じユーザー `demo@example.com`（ローカルは `X-Dev-User`）で、`demo/fixtures/` の seed SQL を投入してから通す。D2 は D1 と D4 の過去記憶がある状態で札が 0 件であることを見せる。通しの期待値は Claude の実出力の細部（候補の語、引用の切れ目）に依存させない。

## 8. 仕様書・スキーマとの差異と判断事項

| # | 内容 | 本書での扱い |
|---|---|---|
| 1 | 第7節 `users` に `last_seen_at` が無いがスキーマにはある。`memories.photo_content_type` も同様 | スキーマに従う（F1-1, F2-5） |
| 2 | 第9節は失敗時 `failed` のみ記すが、スキーマは `empty` を持つ | 0 件は `empty`、検証で全件破棄も `empty`（X-4） |
| 3 | C2 は日付候補に精度を付けるが `memory_facts` に精度の列が無い | `value` の長さ（10/7/4 文字）で表し、画面は「〜ごろ」で精度を見せる（F4）。確定しても起きた日には反映しない（X-3）。日付候補の確定時に起きた日へ反映するかは開発者判断（反映するなら P2 の編集と同じ扱い） |
| 4 | C3 写真候補は本文の引用を持てないが、スキーマは `source='ai'` に `evidence` 必須 | 写真候補も `memory_facts` に `source='ai'`, `status='candidate'` で保存し、`evidence` に `photo:<photo_key>` を入れる（F7）。引用検証（X-6/X-7）は本文由来だけに限定する。これにより候補 → PATCH で確定の流れが F4 と共通になり、AI 由来の痕跡が残る（原則 1）。Worker はステートレスで、D1 以外に候補を置く場所がない（KV/DO はスタック外）ための判断。ADR-0012 に記録した（11/7、F7 実装済み） |
| 5 | F2「HEIC 変換済み」の変換主体が不明。ブラウザで HEIC を JPEG に変換するには依存追加が要る | 受け付けるのは JPEG/PNG のみ、HEIC は端末側で変換済みの前提（F2-7）。ネイティブでは `@capacitor/camera` が JPEG で返す（#17）。Web の `<input type="file">` フォールバックでは iPhone の Safari が `accept="image/jpeg,image/png"` で自動変換することが多い。画面の縮小（Canvas）も JPEG/PNG だけを対象にする |
| 6 | 精度 month/year のときの `happened_on` の値が未定義 | `YYYY-MM-01` / `YYYY-01-01` を置く（F2 既定値）。並び順の都合 |
| 7 | 第8節 F8 の API は `POST /api/memories/:id/retrospect` だが、語りの軸は人物/期間で記憶単位ではない | `POST /api/retrospects` に変更を提案（F8）。語りは保存しない（保存先のテーブルが無い） |
| 8 | F9 検索の API が第8節に無い | `GET /api/memories?q=` を提案 |
| 9 | 一覧のページサイズ（20）、ポーリング間隔（2 秒）と打ち切り（30 秒）、`reason` の長さ（80 文字）、`running` の見なし終了（60 秒）、写真の縮小値（長辺 1600px、品質 0.85）、Claude へ送る写真の上限（6 MiB）は本書で決めた値 | 変更可。ADR 不要の範囲。超過時は切り詰め（第2節） |
| 10 | D3 の「桜でしょうか」は写真由来の候補で、F7（P1）に依存する | F7 が間に合わない場合の代替手順を第7節に記した |
| 11 | 第3.1節 5 の「学習には使わず記録のみ」を F6-4 で検証可能にした（Claude 入力に `feedback` を含めない） | 仕様の意図どおり |
| 12 | 第2節・第9節の「tool use による JSON Schema 強制」 | ADR-0005 に従い Structured Outputs（`output_config.format`）で行う。スキーマ名（`extract_facts` 等）はログと単体テストの識別子として残す |
| 13 | 旧 v0.2 では Cloudflare Access がホスト全体を守るため S0 が本番で表示されず、S0 の定義に無理があった | ADR-0007 で認証を招待コード + JWT に変え、S0 をログイン画面そのものにした（F1-10〜F1-15）。Access・JWKS・OTP 前提の記述は本書から除いた。JWT の失効（ログアウト）は作らない。`JWT_SECRET` のローテーションで全員ログアウト |
| 17 | `@capacitor/camera` が返す写真の形式 | ネイティブでは `CameraResultType.DataUrl`（JPEG、品質 85、長辺 1600px）で受け取るため HEIC は来ない。Web の `<input type="file">` フォールバックは #5 のまま。縮小（F2-10）は両経路で画面側が行う |
| 14 | `happened_on` 省略時の「今日」のタイムゾーン | Worker・画面とも `Asia/Tokyo`（第2節、F2-1）。UTC と日付が変わる時間帯（JST 0〜9 時）の検証がぶれない |
| 15 | エラー `code` の名前が docs/architecture.md（`internal_error`, `payload_too_large`）と本書（`internal`, `too_large`）で異なる | 本書の名前を正とし、architecture.md の追従を提案。実装は 1 箇所（`worker/src/errors.ts` 相当）に集める |
| 16 | ポーリングの打ち切り | 30 秒で統一済み（本書 N-2、architecture 7.2、wireframes 2.6）。想起は 10 秒以内が目標だが Opus の遅い応答に余裕を持たせる |

補足: `.dev.vars` の表記は Write ツールの対象パスだけがフックで拒否されるため、本文中に書く分には問題ない（S-13 で確認）。

## F3 追記: これまでを年月で探す（11/7、ADR-0015）

概要: S2 の一覧を起きた日の年月で区切り、区切りの札（左上に浮かぶ）を押すと「年月で探す」のシートから月を選んで、その月から一覧を読み直せる。

| 入力 | 出力 |
|---|---|
| `GET /api/memories/months` | `{ months: [{ month: "YYYY-MM", count }], years_only: [{ year: "YYYY", count }], undated: n }`。自分の記憶だけ、新しい順 |
| `GET /api/memories?month=YYYY-MM`（`year=YYYY` / `undated=1`） | その区切りのいちばん新しい記憶から、F3-1 の並びのまま 20 件と `next_cursor`。`cursor` があれば `cursor` を優先 |

受け入れ条件

| ID | Given | When | Then | 検証 |
|---|---|---|---|---|
| F3-M1 | 自分の記憶（2026-11 に day 2 件と month 1 件、2025 年だけ 1 件、日付なし 2 件など）とほかの人の記憶 | `GET /api/memories/months` | 年月ごと・年だけ・日付なしの件数が新しい順。ほかの人の記憶は数えない。記憶が無ければ空 | 単体 |
| F3-M2 | 2025-12-31 と 2026-01-01 の記憶 | `GET /api/memories?month=2025-12` | 2025-12-31 から始まり、2026-01-01 は入らない。日付なしまで並びのまま続く。記憶の無い月なら、それより前のいちばん新しい記憶から | 単体 |
| F3-M3 | 2025-05 に 5 件 | `?month=2025-05&limit=2` から `next_cursor` でたどる | 重複も欠落もなく続く。`cursor` と別の `month` を両方付けたら `cursor` の続き | 単体 |
| F3-M4 | — | `month=2025-13`、`year=25`、`undated=yes`、`month` と `year` の両方 など | 400 `validation` | 単体 |
| F3-M5 | 精度 day・month・year・unknown の記憶 | S2 を開く | 区切りの札は「2025年 11月」（day と month）、「2023年」（year）、最後に「日付なし」。札は見出し（h2）として読まれ、ボタンの名前は「2025年 11月。年月で探す」 | 画面 |
| F3-M6 | S2 | 札を押す | 下からのシート「年月で探す」。年ごとに 12 か月のマス、記憶のある月だけ押せて件数（読み上げは「2025年 11月、3 こ」）。無い月は薄く押せない | 画面 |
| F3-M7 | シート | 月を押す | その月から読み直して先頭へ。先頭に「いちばん新しいひとことへ」。押すといちばん新しい記憶から読み直し、ボタンは消える | 画面 |
| F3-M8 | 月から読み直した S2 | S3 を開いて戻る | 同じ月からの一覧のまま（取り直しも同じ月から）。位置もそのまま | 画面 |

エラー時: 件数が読めなければシートの中に「読み込めませんでした」と「もう一度」。読み直しに失敗したら一覧の所に「読み込めませんでした」「もう一度」（同じ月から）と「いちばん新しいひとことへ」。
