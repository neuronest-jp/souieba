# そういえば。 仕様書 v0.2（再構成ドラフト）

> **このファイルについて**
> 開発者が書いた v0.2 の原本は、この作業ブランチの時点でリポジトリに存在しなかった。
> 本ファイルは、開発者からの依頼文（スタック・製品原則・作成順・11/4 スコープ・デモ4シナリオ）を
> もとに Claude Code が同じ章立てで再構成したドラフトである（docs/decisions/0001 参照）。
> 原本が届いたら、このファイルを原本で置き換え、差分があれば docs/requirements.md 以降を追従させる。

- 提出先: Built with Claude: Japan 2026 ハッカソン
- 提出期限: 2026-11-10 14:00 JST
- 開発者: 1人（neuronest.jp）
- 開発期間: 2026-11-03 〜 2026-11-10（期間前のコード・権利のない素材は持ち込まない）

## 1. コンセプト

「そういえば。」は、日々のちょっとした出来事をひとことと写真1枚で残しておくと、
あとで新しいひとことを書いたときに、関係のある昔の記憶が「そういえば。」と静かに浮かんでくるアプリ。

- 対象: 家族の思い出、亡くなった人との記憶、子どもの成長、自分の暮らしの記録を大切にしたい人
- 体験の核: 「書く」→「そういえば、あのときも」と思い出す →「そうだった」と頷く
- 使い心地: テクノロジーを意識させない温かい記憶のアプリ。AI チャット画面を中心に置かない
- 名前の由来: 日常会話で、ふと記憶がつながったときに出る「そういえば。」

### 1.1 製品原則（変更不可）

1. **AI の推測を事実として確定しない。** AI が出すのは常に「候補」。ユーザーが確定するまで記憶本文にも検索にも反映しない。
2. **関係なければ提案しない。** 「そういえば」は 0 件が正しい答えになり得る。無理に関連づけない。
3. **提案には必ず根拠（原文引用）を付ける。** 想起も候補も、元の記憶本文からの逐語引用を根拠として示す。引用が本文に存在しない提案は破棄する。
4. 創作しない。要約や語りでも、記憶本文にない出来事を足さない。
5. ユーザーの記憶はユーザーのもの。削除は即時、AI への送信はそのユーザーの記憶だけ。

## 2. Claude がいないと成り立たない部分

| # | 機能 | Claude の役割 | 原則との対応 |
|---|---|---|---|
| C1 | **そういえば（想起）** | 新しい記憶の本文と、同じユーザーの過去の記憶（本文・確定済み事実）を読み、本当に関係のあるものだけを最大3件選ぶ。それぞれに「なぜ関係があるか」と、過去の記憶本文からの逐語引用を付けて返す。関係がなければ空配列を返す | 原則 1,2,3 |
| C2 | **ひとことの整え（候補抽出）** | 本文から人物・場所・日付・もの の候補を抽出する。各候補に本文からの逐語引用を付ける。推測した日付は精度（日/月/年/不明）を明示する | 原則 1,3 |
| C3 | **写真からの気づき候補** | 写真を見て、写っている物事・季節・場所の種類の候補を出す。人物の同定・年齢・感情の断定はしない。候補は常に「〜でしょうか」の形 | 原則 1 |
| C4 | **ふりかえり（P1）** | 人物や期間を軸に、記憶を時系列の短い語りにまとめる。各段落に引用元の記憶 ID と逐語引用を付け、本文にない出来事を足さない | 原則 3,4 |

Claude の出力はすべて tool use による JSON Schema 強制出力で受け取り、Worker 側で「引用が原文に含まれるか」を検証してから保存・表示する。

## 3. ユーザー体験

### 3.1 主要な流れ

1. メールアドレスでログイン（Cloudflare Access のメール OTP。パスワードなし）
2. 「きょうのひとこと」を書く。写真を1枚添えてもよい。日付は既定で今日
3. 保存すると、本文から人物・場所・日付の候補が静かに並ぶ。タップで「そう」「ちがう」
4. 数秒後、関係のある昔の記憶があれば「そういえば。」の札が1〜3枚現れる。根拠の引用が添えてある
5. 札を開くと昔の記憶の詳細。「そうだった」「関係ないかも」で反応を返せる（学習には使わず記録のみ）
6. 一覧は時系列。写真と最初の一行だけの静かなリスト

### 3.2 やらないこと

- AI とのチャット、AI の人格、アバター
- 自動タグ付けの一括確定、自動アルバム
- 他ユーザーとの共有、通知（P2 以降）
- 多言語（日本語のみ）

## 4. 機能要件と優先度

### P0（11/10 までに必ず動く）

- F1 ログイン: Cloudflare Access（メール OTP）。Worker が JWT を検証し、メールを user_id にする
- F2 記憶の登録: 本文（必須、1〜2000 文字）、起きた日（既定: 今日。精度: 日/月/年/不明）、写真1枚（任意、JPEG/PNG/HEIC 変換済み、10MB 以下、R2 保存）
- F3 記憶の一覧・詳細・削除: 時系列（起きた日の降順）。削除は即時、物理削除（写真も削除）
- F4 候補抽出（C2）: 登録直後に人物・場所・日付・ものの候補を表示。確定/却下。確定した事実は検索と想起の入力になる
- F5 そういえば（C1）: 登録直後に最大3件。根拠引用付き。0件なら何も出さない（静かに）
- F6 反応: 想起に「そうだった」「関係ないかも」を記録

### P1（時間があれば）

- F7 写真からの気づき候補（C3）
- F8 ふりかえり（C4）: 人物または期間で1本の語りを生成
- F9 検索: 本文・確定事実の部分一致

### P2（提出後）

- 共有、通知、音声入力、エクスポート

## 5. 非機能要件

- 想起の応答: 登録から 10 秒以内に札が出る（Claude 呼び出しは `waitUntil` で非同期、画面はポーリング）
- 画面: スマホ縦持ち優先、PC でも崩れない。文字サイズは本文 17px 以上
- 可用性: 単一 Worker、D1 1 本、R2 1 バケット。バックアップはハッカソン期間中は不要
- コスト: Claude 呼び出しは 1 記憶あたり C1 1回 + C2 1回（+C3 1回）に固定。過去記憶の送信は直近 200 件まで
- セキュリティ: API キーは wrangler secret のみ。`.dev.vars` は gitignore。Access の JWT 検証なしに本番 API に到達できない

## 6. 画面一覧

| 画面 | 役割 |
|---|---|
| S0 ようこそ | 未ログイン時。アプリ名と一行の説明、「はじめる」（Access へ） |
| S1 きょう | 入力欄と写真ボタン。保存後、候補と「そういえば。」の札がこの画面に現れる |
| S2 これまで | 時系列の一覧 |
| S3 記憶の詳細 | 本文、写真、確定済みの事実、関連する「そういえば。」の履歴、削除 |
| S4 ふりかえり（P1） | 人物/期間を選んで語りを読む |

詳細は docs/wireframes.md。

## 7. データモデル（概要）

- `users`: id（メール）, display_name, created_at
- `memories`: id, user_id, body, happened_on, happened_on_precision, photo_key, created_at, updated_at
- `memory_facts`: id, memory_id, kind(person/place/date/thing), value, status(candidate/confirmed/rejected), source(user/ai), evidence, created_at, decided_at
- `recalls`: id, memory_id（新しい記憶）, related_memory_id, reason, evidence（related 側本文の逐語引用）, feedback(none/helpful/not_related), created_at
- `ai_runs`: id, user_id, memory_id, kind(recall/facts/photo/retrospect), model, status, input_tokens, output_tokens, error, created_at

詳細は docs/architecture.md と worker/migrations/。

## 8. API（概要）

すべて `/api/*`。認証必須（`/api/health` を除く）。

- `GET /api/health` → `{ ok, service, version, time }`
- `GET /api/me` → `{ user_id, display_name }`
- `GET /api/memories?cursor=` / `POST /api/memories` / `GET /api/memories/:id` / `DELETE /api/memories/:id`
- `PUT /api/memories/:id/photo`（multipart）/ `GET /api/photos/:key`
- `GET /api/memories/:id/facts` / `PATCH /api/facts/:id`（confirm/reject）
- `GET /api/memories/:id/recalls` / `PATCH /api/recalls/:id`（feedback）
- `POST /api/memories/:id/retrospect`（P1）

## 9. AI 呼び出しの設計

- `@anthropic-ai/sdk` を Worker から直接呼ぶ。モデル名は環境変数 `ANTHROPIC_MODEL`（既定 `claude-sonnet-5-5`）
- tool use で JSON Schema を強制（`tool_choice: {type: "tool", name: ...}`）
- 入力: 新しい記憶本文 + 過去記憶（id, happened_on, body, 確定事実）の直近 200 件
- 出力後の検証（Worker 側）: `evidence` が引用元 body に部分文字列として含まれない項目は捨てる。1 件も残らなければ 0 件扱い
- 失敗時: 画面には何も出さない。`ai_runs.status = failed` を記録。再試行はしない

## 10. 認証

- 本番: Cloudflare Access（メール OTP）。Worker は `Cf-Access-Jwt-Assertion` を `https://<team>.cloudflareaccess.com/cdn-cgi/access/certs` の JWKS で検証し、`aud` と `iss` と `exp` を確認し、`email` を user_id にする
- ローカル: `ENVIRONMENT=development` のときだけ `X-Dev-User: <email>` ヘッダを受け付ける。本番ではヘッダを無視する

## 11. デモシナリオ（4本）

| # | 名前 | 示す原則 | 流れ |
|---|---|---|---|
| D1 | 祖母の梅干し | 想起 + 根拠 | 過去「おばあちゃんは毎年6月になると…梅干しを漬けていた」がある状態で「スーパーで青梅を見かけた」を書く → 札が1枚、引用付き |
| D2 | 電気代 | 関係なければ提案しない | 「電気代を払った。先月より少し安かった」を書く → 札は出ない |
| D3 | 公園の花 | 推測を事実にしない | 公園の花の写真を添えて「公園で花が咲いていた」→ 候補「桜でしょうか」→ ユーザーが「ちがう（梅だった）」→ 候補は確定されず記憶に残らない |
| D4 | はるとの自転車 | 想起 + 成長 | 過去「はるとが三輪車で転んで泣いた」がある状態で「はると、今日補助輪なしで乗れた」→ 札が1枚、引用付き |

フィクスチャは demo/fixtures/ に置く。写真は開発者が権利を持つものだけを demo/photos/ に置く（Claude Code は書き込み禁止）。

## 12. スタック（変更不可）

- Cloudflare Workers + Hono + D1 + R2。Workers Static Assets で Vue 3 + Vite + TypeScript + Tailwind の SPA を同一 Worker から配信
- 認証: Cloudflare Access（メール OTP）
- AI: `@anthropic-ai/sdk`、tool use、モデル名は環境変数
- 秘密情報: wrangler secret のみ。`.dev.vars` は gitignore
- パッケージ: pnpm。依存は必要最小限

## 13. リポジトリ構成

```
.
├── .claude/
│   ├── settings.json         # フック: .dev.vars と demo/photos/ への書き込み禁止
│   └── hooks/guard-writes.mjs
├── CLAUDE.md                 # Claude Code 向けの作業規約
├── README.md
├── docs/
│   ├── spec.md               # 本書
│   ├── requirements.md       # 機能要件と受け入れ条件
│   ├── architecture.md
│   ├── wireframes.md
│   ├── tasks.md
│   ├── setup-cloudflare.md   # Access / D1 / R2 / secret の手順書
│   └── decisions/            # ADR
├── demo/
│   ├── fixtures/             # デモ4シナリオの JSON と seed SQL
│   └── photos/               # 開発者が置く（Claude Code 書き込み禁止）
├── web/                      # Vue 3 + Vite + Tailwind（Vite root）
│   ├── index.html
│   └── src/
├── worker/                   # Hono
│   ├── src/
│   ├── migrations/
│   └── test/
├── wrangler.toml
├── package.json
└── vite.config.ts
```

## 14. 作成順

1. README と .claude/ 構成
2. 機能要件と受け入れ条件（docs/requirements.md）
3. アーキテクチャ（docs/architecture.md）
4. D1 マイグレーション（worker/migrations/）
5. 主要画面ワイヤーフレーム（docs/wireframes.md、テキスト）
6. 実装タスク一覧（docs/tasks.md）
7. テストフィクスチャ初期セット（demo/fixtures/、デモ4シナリオを含む）

### 日程

| 日 | スコープ |
|---|---|
| 11/3 | 上記 1〜7 のドキュメント |
| 11/4 | プロジェクト雛形、D1 マイグレーション適用、Vue + Tailwind + カラー/フォントのデザイン基盤、ヘルスチェック API、Access 認証の疎通、wrangler deploy までの動作確認 |
| 11/5 | 記憶登録（F2）、一覧・詳細・削除（F3）、写真の R2 保存 |
| 11/6 | 候補抽出（F4, C2）と そういえば（F5, C1）、引用検証 |
| 11/7 | 反応（F6）、デモ4シナリオの通し、写真候補（F7, P1） |
| 11/8 | UI 磨き（空状態、読み込み、文字組み）、エラー時の静かな振る舞い |
| 11/9 | ふりかえり（F8, P1、余裕があれば）、README 仕上げ、デモ動画 |
| 11/10 | 提出（14:00 JST） |
