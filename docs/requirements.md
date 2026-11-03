# そういえば。 機能要件と受け入れ条件

- 根拠: docs/spec.md v0.2（再構成ドラフト、ADR-0001）。章番号は同書のもの
- 既定値: ADR-0003、デザイン基盤: ADR-0004
- スキーマ: worker/migrations/0001_init.sql（本書はスキーマを変更しない。差異は第8節に列挙）
- 書き方: 受け入れ条件は Given / When / Then。ID は `F5-3` のように「機能-連番」。横断条件は `X-`、非機能は `N-`、11/4 スコープは `S-`

## 1. 用語定義

| 用語 | 定義 | 対応するデータ |
|---|---|---|
| 記憶 | ユーザーが残した1件の出来事。ひとこと（本文）、起きた日、写真1枚（任意）から成る | `memories` 1行 |
| ひとこと | 記憶の本文。1〜2000 文字の日本語テキスト。画面では「きょうのひとこと」 | `memories.body` |
| 候補 | ひとこと（または写真）から AI が抽出した、人物・場所・日付・もの。ユーザーが決めるまで事実ではない | `memory_facts.status = 'candidate'` |
| 確定 | ユーザーが候補に「そう」と答えた状態。確定した事実だけが検索と想起の入力になる。「ちがう」は却下 | `memory_facts.status = 'confirmed'`（却下は `'rejected'`） |
| そういえば（札） | 新しい記憶を書いたとき、関係のある昔の記憶が1〜3枚現れるカード。理由と根拠を伴う | `recalls` 1行 = 札1枚 |
| 根拠 | 提案（候補・札・語り）に必ず付く、元の記憶本文からの逐語引用。本文に部分文字列として存在しないものは破棄する | `memory_facts.evidence`、`recalls.evidence` |
| 反応 | 札に対する「そうだった」「関係ないかも」。記録するだけで学習には使わない | `recalls.feedback` |
| 起きた日 | 記憶の出来事が起きた日と精度（日/月/年/不明） | `memories.happened_on`, `happened_on_precision` |

## 2. 共通の前提

| 項目 | 内容 |
|---|---|
| ユーザーの単位 | `user_id` はログインメールアドレス（第10節）。すべての API は自分の `user_id` のデータだけを返す。他人のデータは存在しないものとして扱い 404 を返す |
| ID と日時 | ID は UUID 文字列。日時は ISO 8601（UTC）。起きた日は `YYYY-MM-DD` |
| エラー形式 | `{ "error": { "code": string, "message": string } }`。`code` は `validation`、`unauthorized`、`not_found`、`too_large`、`unsupported_media` のいずれか |
| 画面の言葉 | 「AI」「生成」「送信」を画面に出さない（ADR-0004）。エラーは短い日本語で静かに。例「うまく保存できませんでした。もう少ししてから、もう一度」 |
| 優先度 | P0: 11/10 までに必ず動く。P1: 時間があれば。P2: 提出後（本書では扱わない） |

## 3. 機能要件（第4節 F1〜F9）

### F1 ログイン（P0）

概要: Cloudflare Access（メール OTP）でログインする。Worker は `Cf-Access-Jwt-Assertion` を JWKS で検証し、`email` を `user_id` にする（第10節）。

| 入力 | 出力 |
|---|---|
| ヘッダ `Cf-Access-Jwt-Assertion`（本番）、または `X-Dev-User`（`ENVIRONMENT=development` のみ） | `GET /api/me` → `{ user_id, display_name }`。初回は `users` に行を作る |

受け入れ条件

| ID | Given | When | Then |
|---|---|---|---|
| F1-1 | 本番環境、有効な JWT（`aud`・`iss` が設定値と一致、`exp` が未来、`email` = `a@example.com`） | `GET /api/me` | 200、`user_id = "a@example.com"`。`users` に `id = "a@example.com"` の行があり `last_seen_at` が更新される |
| F1-2 | 本番環境、JWT なし | `GET /api/me` | 401、`error.code = "unauthorized"`。D1 にも R2 にも触れない |
| F1-3 | 本番環境、`exp` が過去の JWT | `GET /api/memories` | 401 |
| F1-4 | 本番環境、`aud` が別アプリの JWT | `GET /api/memories` | 401 |
| F1-5 | 未ログインで画面を開く | `/` を表示 | S0 ようこそ（アプリ名、一行の説明、「はじめる」）が出る。「はじめる」は Access のログイン画面へ遷移する |
| F1-6 | ログイン済み | `/` を表示 | S1 きょう が開く。画面にメールアドレス入力やパスワード欄はない |

エラー時: 401 のとき画面は S0 に戻す。JWKS 取得に失敗したときも 401（200 にしない）。

### F2 記憶の登録（P0）

概要: ひとことと起きた日、写真1枚で記憶を保存する。保存直後に F4（候補）と F5（札）が非同期で動く。

| 入力 | 出力 |
|---|---|
| `POST /api/memories` JSON `{ body, happened_on?, happened_on_precision? }` | 201、`{ memory }`（`id`, `body`, `happened_on`, `happened_on_precision`, `photo_key`, `created_at`） |
| `PUT /api/memories/:id/photo` multipart、フィールド名 `photo`、`image/jpeg` または `image/png`、10,485,760 バイト以下 | 200、`{ photo_key }`。R2 にオブジェクトがあり `memories.photo_key`, `photo_content_type` が入る |

既定値: `happened_on` 省略時はユーザーのローカル日付の今日（画面が付与）、`happened_on_precision` 省略時 `day`。`precision = month` は `YYYY-MM-01`、`year` は `YYYY-01-01`、`unknown` は `happened_on = NULL`。

受け入れ条件

| ID | Given | When | Then |
|---|---|---|---|
| F2-1 | ログイン済み | `body = "スーパーで青梅を見かけた"`（12文字）で POST | 201。D1 `memories` に1行。`happened_on` は今日、`precision = 'day'`、`photo_key IS NULL` |
| F2-2 | ログイン済み | `body` が空文字、または空白のみ | 400 `validation`。行は作られない。画面では「保存する」が押せない |
| F2-3 | ログイン済み | `body` が 2000 文字 | 201。2001 文字なら 400 `validation`（文字数は JS の `Array.from(body).length` で数える。サロゲートペアを1文字とする） |
| F2-4 | ログイン済み | `happened_on_precision = "unknown"` | 201。`happened_on IS NULL`。一覧では「いつだったか」と表示する |
| F2-5 | 記憶 M が自分のもの | 9 MB の JPEG を `PUT /api/memories/M/photo` | 200。R2 に `photo_key` のオブジェクト。`GET /api/photos/:key` が同じバイト列を `Content-Type: image/jpeg` で返す |
| F2-6 | 記憶 M が自分のもの | 10,485,761 バイトの PNG を PUT | 413 `too_large`。R2 に書かれない。画面では「写真が大きすぎるみたいです（10MB まで）」 |
| F2-7 | 記憶 M が自分のもの | `image/gif` を PUT | 415 `unsupported_media` |
| F2-8 | 記憶 M が他人のもの | PUT photo | 404 |

エラー時: 保存に失敗したら本文は画面に残し、消さない。写真の保存だけ失敗したら記憶は残し「写真だけ、あとでもう一度」と出す。

### F3 記憶の一覧・詳細・削除（P0）

概要: S2 これまで（時系列一覧）、S3 記憶の詳細、削除。

| 入力 | 出力 |
|---|---|
| `GET /api/memories?cursor=` | `{ items: [{ id, body, happened_on, happened_on_precision, photo_key, created_at }], next_cursor }`。1ページ 20 件 |
| `GET /api/memories/:id` | `{ memory, facts: [...], recalls: [...], recalled_by: [...] }`。`recalls` はこの記憶が新しい側の札、`recalled_by` はこの記憶が思い出された側の札 |
| `DELETE /api/memories/:id` | 204 |

受け入れ条件

| ID | Given | When | Then |
|---|---|---|---|
| F3-1 | 起きた日が 2026-06-15、2026-11-03、NULL、2024-01-01 の4件 | `GET /api/memories` | 順序は 2026-11-03, 2026-06-15, 2024-01-01, NULL（`happened_on DESC, created_at DESC`。不明は最後） |
| F3-2 | 同じ起きた日の2件（作成順 A, B） | 一覧 | B が A より上 |
| F3-3 | 25 件ある | 1ページ目、`next_cursor` で2ページ目 | 20 件 + 5 件。重複も欠落もない。2ページ目の `next_cursor` は null |
| F3-4 | 記憶 M（写真あり、確定事実2件、札1枚） | `DELETE /api/memories/M` | 204。`memories`, `memory_facts`, `recalls`（`memory_id` または `related_memory_id` が M）が消え、R2 のオブジェクトも消える。直後の `GET /api/memories/M` は 404、`GET /api/photos/:key` も 404 |
| F3-5 | 記憶 M が他人のもの | `GET` / `DELETE /api/memories/M` | いずれも 404。削除されない |
| F3-6 | 記憶が 0 件 | S2 を開く | 空状態の一行「まだ何もありません。きょうのひとことから」。スピナーは出さず、読み込み中は薄い文字で「よみこみ中」 |
| F3-7 | S3 を開く | 「消す」を押す | 一度だけ確認（「この記憶を消しますか」「消す」「やめる」）。「消す」で即時削除し S2 へ戻る。元に戻す機能は提供しない |

エラー時: 一覧取得失敗は「読み込めませんでした」と再読み込みの導線。削除失敗は記憶を残したまま「消せませんでした」。

### F4 候補抽出（P0、C2）

概要: 登録直後、ひとことから人物・場所・日付・ものの候補を抽出して並べる。ユーザーが「そう」「ちがう」で決める。確定した事実は検索（F9）と想起（F5）の入力になる。

| 入力 | 出力 |
|---|---|
| Claude（tool use、`extract_facts`）へ: `body` のみ | `[{ kind, value, evidence }]`。`evidence` は `body` の逐語引用 |
| `GET /api/memories/:id/facts` | `{ status: "pending" \| "done", facts: [{ id, kind, value, status, source, evidence }] }` |
| `PATCH /api/facts/:id` JSON `{ status: "confirmed" \| "rejected" }` | 200、更新後の fact。`decided_at` を設定 |

日付候補の精度: `memory_facts` に精度の列はないため `value` の長さで表す（`YYYY-MM-DD` = 日、`YYYY-MM` = 月、`YYYY` = 年）。不明なら候補を出さない。

受け入れ条件

| ID | Given | When | Then |
|---|---|---|---|
| F4-1 | `body = "おばあちゃんは毎年6月になると、縁側で梅干しを漬けていた"` を登録 | 10 秒以内に `GET /facts` | `status = "done"`。候補に `person: おばあちゃん`（evidence「おばあちゃん」）、`thing: 梅干し`（evidence「梅干し」）が含まれ、すべて `status = 'candidate'`, `source = 'ai'` |
| F4-2 | Claude が `evidence = "祖母"` の候補を返した（本文に「祖母」はない） | Worker の検証 | その候補は D1 に保存されず、画面にも出ない。他の候補は残る |
| F4-3 | 候補 C（candidate） | `PATCH /api/facts/C { status: "confirmed" }` | 200。`status = 'confirmed'`, `decided_at` が非 NULL。画面では「そう」が moss 色で選択状態になる |
| F4-4 | 候補 C（candidate） | `{ status: "rejected" }` | `status = 'rejected'`。画面からは薄く消える（行自体は削除しない）。F5 と F9 の入力に含まれない |
| F4-5 | 候補が 0 件（例「電気代を払った。先月より少し安かった」で Claude が空配列） | `GET /facts` | `status = "done"`, `facts = []`。画面には候補の枠も見出しも出ない |
| F4-6 | 他人の候補 C | `PATCH /api/facts/C` | 404 |

エラー時: Claude 呼び出し失敗は `ai_runs(kind='facts', status='failed')` を記録し、`status = "done"`, `facts = []` を返す。画面には何も出さない。再試行はしない（第9節）。

### F5 そういえば（P0、C1）

概要: 登録直後、同じユーザーの過去の記憶から本当に関係のあるものだけを最大3件選び、札として出す。関係がなければ 0 件（何も出さない）。

| 入力 | 出力 |
|---|---|
| Claude（tool use、`recall`）へ: 新しい記憶の `body` + 過去記憶 `[{ id, happened_on, body, facts(confirmed のみ) }]` を `created_at DESC` で最大 200 件 | `[{ related_memory_id, reason, evidence }]` 最大 3 件。`evidence` は related 側 `body` の逐語引用 |
| `GET /api/memories/:id/recalls` | `{ status: "pending" \| "done", recalls: [{ id, related_memory: { id, body, happened_on, photo_key }, reason, evidence, feedback }] }` |

受け入れ条件

| ID | Given | When | Then |
|---|---|---|---|
| F5-1 | 過去に「おばあちゃんは毎年6月になると、縁側で梅干しを漬けていた」がある | 「スーパーで青梅を見かけた」を登録し 10 秒以内に `GET /recalls` | `status = "done"`, 札 1 枚。`related_memory_id` が梅干しの記憶、`evidence` がその本文の部分文字列（例「梅干しを漬けていた」）、`reason` が 1〜80 文字 |
| F5-2 | 過去に梅干し・三輪車など 2 件 | 「電気代を払った。先月より少し安かった」を登録 | `status = "done"`, `recalls = []`。画面には札も「関連なし」の文言も出ない。`ai_runs(kind='recall', status='empty')` |
| F5-3 | Claude が 5 件返した | Worker の検証 | 保存は先頭から最大 3 件。`evidence` が related 側 `body` に含まれないもの、`related_memory_id` が自分の記憶でない・送った 200 件に無い・新しい記憶自身と同じものは捨てる。残り 0 なら 0 件扱い |
| F5-4 | 過去の記憶が 0 件 | 最初の記憶を登録 | Claude の recall を呼ばない。`recalls = []`, `status = "done"` |
| F5-5 | 過去の記憶が 250 件 | 登録 | Claude へ送るのは `created_at DESC` 上位 200 件。`ai_runs.input_tokens` が記録される |
| F5-6 | 札が 1 枚ある | 札を開く | S3 相当の詳細（昔の本文全文、写真、起きた日）と根拠の引用が本文中で強調される。「そうだった」「関係ないかも」が押せる |

エラー時: 失敗は `ai_runs.status = 'failed'`、`status = "done"`, `recalls = []`。画面は静かなまま。再試行しない。

### F6 反応（P0）

概要: 札に「そうだった」「関係ないかも」を記録する。学習には使わない。

| 入力 | 出力 |
|---|---|
| `PATCH /api/recalls/:id` JSON `{ feedback: "helpful" \| "not_related" \| "none" }` | 200、更新後の recall |

受け入れ条件

| ID | Given | When | Then |
|---|---|---|---|
| F6-1 | 札 R（feedback none） | 「そうだった」 | `feedback = 'helpful'`。札に moss 色の印。札は消えない |
| F6-2 | 札 R | 「関係ないかも」 | `feedback = 'not_related'`。札は薄くなるが残る。関連記憶は削除されない |
| F6-3 | 札 R（helpful） | もう一度「そうだった」 | `feedback = 'none'` に戻る（トグル） |
| F6-4 | 反応済みの札がある | 次の記憶を登録 | Claude への入力に `feedback` は含まれない（prompt と入力 JSON に `feedback` キーが無い） |
| F6-5 | 他人の札 | PATCH | 404 |

エラー時: 更新失敗は印を元に戻し「記録できませんでした」。

### F7 写真からの気づき候補（P1、C3）

概要: 写真から、写っている物事・季節・場所の種類の候補を「〜でしょうか」の形で出す。人物の同定、年齢、感情は断定しない。

| 入力 | 出力 |
|---|---|
| Claude（tool use、`photo_hints`）へ: 写真（base64）と `body` | `[{ kind: "thing" \| "place" \| "date", value }]` 最大 5 件。画面では `value` に「でしょうか」を付けて表示 |
| `GET /api/memories/:id/facts` の `photo_hints: [...]`（D1 には保存しない。第8節参照） | ユーザーが「そう」を押したときだけ `memory_facts` に `source='user'`, `evidence NULL` で `confirmed` 保存 |

受け入れ条件

| ID | Given | When | Then |
|---|---|---|---|
| F7-1 | 公園の花の写真を添えて「公園で花が咲いていた」を登録 | 10 秒以内に `GET /facts` | `photo_hints` に `thing: 桜`（画面では「桜でしょうか」）など 0〜5 件。画面上の語尾はすべて「でしょうか」 |
| F7-2 | 写真候補「桜でしょうか」 | 「ちがう」 | `memory_facts` に行は作られない。再読み込み後も候補は出ない。本文は「公園で花が咲いていた」のまま |
| F7-3 | 写真候補「桜でしょうか」 | 「そう」 | `memory_facts` に `kind='thing', value='桜', status='confirmed', source='user'` 1行 |
| F7-4 | 人物が写った写真 | 候補 | `kind='person'` の候補、年齢、感情（「楽しそう」など）の候補は返されない（Worker が `kind='person'` を捨てる） |
| F7-5 | 写真なしの記憶 | 登録 | `ai_runs(kind='photo')` が作られない |

エラー時: 失敗は `ai_runs(kind='photo', status='failed')`。`photo_hints = []`。

### F8 ふりかえり（P1、C4）

概要: 人物（確定済み person の value）または期間（起きた日の範囲）を軸に、記憶を時系列の短い語りにまとめる。各段落に引用元の記憶 ID と逐語引用を付ける。

| 入力 | 出力 |
|---|---|
| `POST /api/retrospects` JSON `{ person?: string, from?: "YYYY-MM-DD", to?: "YYYY-MM-DD" }`（いずれか必須） | `{ paragraphs: [{ text, memory_id, evidence }] }`。D1 には `ai_runs(kind='retrospect')` のみ記録し、語りは保存しない |

受け入れ条件

| ID | Given | When | Then |
|---|---|---|---|
| F8-1 | `person = "はると"` が確定済みの記憶 3 件 | POST | 段落 1〜3 本。各段落の `memory_id` はその 3 件のいずれか、`evidence` はその本文の部分文字列、`text` は 200 文字以下 |
| F8-2 | Claude が `evidence` の無い段落、または本文に無い引用の段落を返した | Worker の検証 | その段落は捨てる。全段落が捨てられたら `paragraphs = []`、画面は「まだ語れるほど集まっていないようです」 |
| F8-3 | 該当する記憶が 0 件 | POST | Claude を呼ばず `paragraphs = []` |
| F8-4 | 語りを表示 | 段落をタップ | 引用元の記憶の詳細（S3）へ移動できる |

エラー時: 失敗は `ai_runs.status='failed'`、`paragraphs = []`。

### F9 検索（P1）

概要: 本文と確定した事実の部分一致。

| 入力 | 出力 |
|---|---|
| `GET /api/memories?q=梅` | F3 と同じ形。`body LIKE '%梅%'` または `memory_facts(status='confirmed').value LIKE '%梅%'` の記憶 |

受け入れ条件

| ID | Given | When | Then |
|---|---|---|---|
| F9-1 | 本文に「梅干し」を含む記憶 A、確定事実 `thing: 青梅` の記憶 B、候補のまま `thing: 梅` の記憶 C（本文に「梅」なし） | `q=梅` | A と B が返り、C は返らない |
| F9-2 | 却下された `place: 公園` の記憶 D（本文に「公園」なし） | `q=公園` | D は返らない |
| F9-3 | `q` が空 | GET | 検索せず通常の一覧 |
| F9-4 | 該当 0 件 | S2 | 「見つかりませんでした」と検索語を消す導線 |

エラー時: 通常の一覧と同じ。

## 4. 製品原則の横断的受け入れ条件

| ID | 原則 | Given | When | Then |
|---|---|---|---|---|
| X-1 | 1 推測を事実にしない | `source='ai'` の fact | 挿入直後 | `status` は必ず `'candidate'`。`confirmed` にするのは `PATCH /api/facts/:id` だけ |
| X-2 | 1 | 候補のままの fact | F5・F9 の入力生成 | `status='confirmed'` 以外は含まれない。`memories.body` も変更されない |
| X-3 | 1 | 日付候補を確定 | PATCH | `memories.happened_on` は自動では変わらない（変えるのはユーザーの編集だけ。編集は P2） |
| X-4 | 2 関係なければ提案しない | Claude が空配列 | recalls | `ai_runs.status='empty'`。画面に札も「見つかりませんでした」等の文言も出ない。S1 は保存直後の静かな状態のまま |
| X-5 | 2 | 札が 0 件 | 1 分経過 | 画面は変わらない（ポーリングは `status="done"` で止まる） |
| X-6 | 3 根拠 | `evidence` が引用元 body の部分文字列でない提案（候補・札・語りの段落） | Worker の検証 | 保存も表示もされない。`evidence` が空文字のものも同じ |
| X-7 | 3 | `evidence` を照合 | 比較 | 正規化（空白除去、全角半角変換）をしない。完全な部分文字列一致（`body.includes(evidence)`）だけを採用する |
| X-8 | 3 | 札を表示 | 画面 | `reason` と `evidence` の両方が札に見える。引用は「」で囲む |
| X-9 | 4 創作しない | ふりかえりの段落 | 検証 | `evidence` 検証で表示前に捨てる（F8-2）。画面に出る段落は必ず `memory_id` を持つ |
| X-10 | 5 ユーザーのもの | 削除 | DELETE | 即時に D1 と R2 から消える。ゴミ箱や猶予期間はない |
| X-11 | 5 | ユーザー A が登録 | Claude への入力 | 過去記憶は `user_id = A` のものだけ（SQL に `WHERE user_id = ?` がある単体テスト） |
| X-12 | UI | すべての画面 | テキストを走査 | 「AI」「生成」「送信」が出ない。`web/src` の `.vue` を grep して UI 文字列にこれらの語が無い |
| X-13 | UI | S1 | 表示 | 入力欄が一つと写真ボタン、保存ボタンだけ。会話の吹き出しや「質問する」導線がない |

## 5. 非機能要件の受け入れ条件（第5節）

| ID | 項目 | Given | When | Then |
|---|---|---|---|---|
| N-1 | 想起の応答 | 過去記憶 50 件 | 登録 | `POST /api/memories` は 1 秒以内に 201 を返す（Claude 呼び出しは `ctx.waitUntil`）。札は登録から 10 秒以内に画面に出る |
| N-2 | ポーリング | 登録直後 | S1 | `GET /facts` と `GET /recalls` を 2 秒間隔で呼び、両方 `status="done"` で止める。30 秒で `done` にならなければ止めて何も出さない |
| N-3 | 画面 | 幅 375px（iPhone SE 相当） | S1〜S3 | 横スクロールが出ない。本文の `font-size` が 17px 以上、行間 1.8 |
| N-4 | 画面 | 幅 1280px | S1〜S3 | 本文列の最大幅 640px で中央寄せ。崩れない |
| N-5 | コスト | 1 件の記憶 | 登録から 1 分後 | `ai_runs` は `kind='facts'` 1 行、`kind='recall'` 0〜1 行（過去記憶が無ければ 0）、写真があれば `kind='photo'` 1 行。同じ `memory_id`・`kind` の 2 行目は作られない |
| N-6 | コスト | 過去記憶 300 件 | 登録 | Claude への過去記憶は 200 件ちょうど |
| N-7 | 失敗時 | Anthropic API が 500 | 登録 | 再試行しない（`maxRetries: 0`）。`ai_runs.status='failed'`, `error` に要約 |
| N-8 | セキュリティ | リポジトリ | `git ls-files` | ローカル秘密ファイル（dev vars）が含まれない。`wrangler.toml` に `ANTHROPIC_API_KEY` の値が無い |
| N-9 | セキュリティ | 本番 | `curl` で JWT なし `/api/memories` | 401。`/api/health` だけ 200 |
| N-10 | 可用性 | `wrangler.toml` | 確認 | D1 バインディング 1 本（`souieba`）、R2 バケット 1 本（`souieba-photos`）、Worker 名 `souieba` |
| N-11 | デザイン基盤 | `web/src/style.css` | 確認 | ADR-0004 の 10 トークンが `@theme` に定義され、`.vue` に `#` 始まりの色指定が無い |
| N-12 | 札の動き | 札が出る | 表示 | 600ms のフェード + 上方向スライド。音や通知は出ない |

## 6. 11/4 スコープの受け入れ条件

対象: プロジェクト雛形、D1 マイグレーション適用、デザイン基盤、`/api/health`、Access 疎通、`wrangler deploy`。

| ID | Given | When | Then |
|---|---|---|---|
| S-1 | クリーンな clone | `pnpm install && pnpm typecheck && pnpm test && pnpm build` | すべて終了コード 0。`pnpm build` は `wrangler deploy --dry-run` まで通る |
| S-2 | ローカル | `pnpm db:migrate:local` | `users`, `memories`, `memory_facts`, `recalls`, `ai_runs` の 5 テーブルができる。二度目の実行は何も適用せず成功する |
| S-3 | リモート | `pnpm db:migrate:remote` | 同じ 5 テーブル。`wrangler d1 migrations list souieba --remote` で 0001 が適用済み |
| S-4 | `pnpm dev` | `GET http://localhost:8787/api/health` | 200、`{ ok: true, service: "souieba", version: string, time: ISO8601 }`。認証ヘッダ不要 |
| S-5 | `pnpm dev`（`ENVIRONMENT=development`） | `GET /api/me` に `X-Dev-User: you@example.com` | 200、`user_id = "you@example.com"` |
| S-6 | `pnpm dev`（`ENVIRONMENT=development`） | `X-Dev-User` なしで `GET /api/me` | 401 |
| S-7 | `pnpm dev`（`ENVIRONMENT=development`） | `X-Dev-User: not-an-email` | 401（`@` を含む簡易検証） |
| S-8 | 本番（`ENVIRONMENT` 未設定または `production`） | `X-Dev-User: you@example.com` だけで `GET /api/me` | 401。ヘッダは無視される |
| S-9 | 本番 | 有効な JWT と `X-Dev-User: other@example.com` の両方 | 200、`user_id` は JWT の `email`。`X-Dev-User` は使われない |
| S-10 | 本番 | ブラウザで `https://<worker>.workers.dev/` | Access のメール OTP を経て S0/S1 が表示される。`Cf-Access-Jwt-Assertion` が Worker に届き `GET /api/me` が 200 |
| S-11 | 本番 | `pnpm deploy` | Static Assets から `index.html` が配信され、`/api/health` が 200。`/api/*` 以外の未知パスは SPA の `index.html` を返す |
| S-12 | `web/src/style.css` | ブラウザで S0 | 背景 `#FAF5EC`、見出しが Zen Maru Gothic、本文が Noto Sans JP（読み込み前は system-ui）。本文 17px |
| S-13 | `.claude/settings.json` | Claude Code がローカル秘密ファイル（dev vars）または `demo/photos/x.jpg` に Write | フックが拒否する |

## 7. デモ4シナリオと受け入れ条件の対応（第11節）

| デモ | 示す原則 | 担保する受け入れ条件 | 前提フィクスチャ |
|---|---|---|---|
| D1 祖母の梅干し | 想起 + 根拠 | F2-1, F4-1, F5-1, F5-6, X-6, X-8, N-1, N-12 | 過去記憶「おばあちゃんは毎年6月になると、縁側で梅干しを漬けていた」 |
| D2 電気代 | 関係なければ提案しない | F4-5, F5-2, X-4, X-5, N-2 | D1・D4 の過去記憶が入った状態 |
| D3 公園の花 | 推測を事実にしない | F2-5, F7-1, F7-2, X-1, X-2（F7 が間に合わない場合は F4 の `place: 公園` 候補を「ちがう」にする F4-4, X-2 で代替） | 公園の花の写真（demo/photos/、開発者が置く）、本文「公園で花が咲いていた」 |
| D4 はるとの自転車 | 想起 + 成長 | F2-1, F4-1 相当（`person: はると`）, F4-3, F5-1 相当（evidence「三輪車で転んで泣いた」）, F6-1, X-8 | 過去記憶「はるとが三輪車で転んで泣いた」 |

共通: 4 本とも同じユーザー `demo@example.com`（ローカルは `X-Dev-User`）で、`demo/fixtures/` の seed SQL を投入してから通す。D2 は D1 と D4 の過去記憶がある状態で札が 0 件であることを見せる。

## 8. 仕様書・スキーマとの差異と判断事項

| # | 内容 | 本書での扱い |
|---|---|---|
| 1 | 第7節 `users` に `last_seen_at` が無いがスキーマにはある。`memories.photo_content_type` も同様 | スキーマに従う（F1-1, F2-5） |
| 2 | 第9節は失敗時 `failed` のみ記すが、スキーマは `empty` を持つ | 0 件は `empty`、検証で全件破棄も `empty`（X-4） |
| 3 | C2 は日付候補に精度を付けるが `memory_facts` に精度の列が無い | `value` の長さ（10/7/4 文字）で表す。開発者の判断待ち |
| 4 | C3 写真候補は本文の引用を持てないが、スキーマは `source='ai'` に `evidence` 必須 | 写真候補は D1 に保存せず画面にだけ出し、確定時に `source='user'` で保存する（F7）。`source='ai'` として残らない点が「AI 由来の記録」としては不正確。開発者の判断待ち |
| 5 | F2「HEIC 変換済み」の変換主体が不明。ブラウザで HEIC を JPEG に変換するには依存追加が要る | 受け付けるのは JPEG/PNG のみ、HEIC は端末側で変換済みの前提（F2-7）。iPhone の Safari は `accept="image/jpeg,image/png"` で自動変換することが多い |
| 6 | 精度 month/year のときの `happened_on` の値が未定義 | `YYYY-MM-01` / `YYYY-01-01` を置く（F2 既定値）。並び順の都合 |
| 7 | 第8節 F8 の API は `POST /api/memories/:id/retrospect` だが、語りの軸は人物/期間で記憶単位ではない | `POST /api/retrospects` に変更を提案（F8）。語りは保存しない（保存先のテーブルが無い） |
| 8 | F9 検索の API が第8節に無い | `GET /api/memories?q=` を提案 |
| 9 | 一覧のページサイズ（20）、ポーリング間隔（2 秒）と打ち切り（30 秒）、`reason` の長さ（80 文字）は本書で決めた値 | 変更可。ADR 不要の範囲 |
| 10 | D3 の「桜でしょうか」は写真由来の候補で、F7（P1）に依存する | F7 が間に合わない場合の代替手順を第7節に記した |
| 11 | 第3.1節 5 の「学習には使わず記録のみ」を F6-4 で検証可能にした（Claude 入力に `feedback` を含めない） | 仕様の意図どおり |
