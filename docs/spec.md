# そういえば。 仕様書 v0.3（再構成ドラフト）

> **このファイルについて**
> 開発者が書いた v0.2 の原本は、この作業ブランチの時点でリポジトリに存在しなかった。
> 本ファイルは、開発者からの依頼文（スタック・製品原則・作成順・11/4 スコープ・デモ4シナリオ）を
> もとに Claude Code が同じ章立てで再構成したドラフトである（docs/decisions/0001 参照）。
> 原本が届いたら、このファイルを原本で置き換え、差分があれば docs/requirements.md 以降を追従させる。

## 変更点（v0.2 → v0.3、2026-11-04）

| 変更 | 内容 | 理由 |
|---|---|---|
| 配布形態 PWA → Capacitor | Vue 3 + Vite + Tailwind の画面を Capacitor の WebView 内で動かし、iOS / Android のネイティブアプリとして配布する。Workers の Static Assets 配信は開発用プレビューとしてのみ残す | ホーム画面のアプリとして日々開いてもらう体験を優先する。写真の撮影・ライブラリ連携と、将来の通知（P1）をネイティブ API で扱える |
| 認証 Cloudflare Access → 招待コード + JWT | 初回起動時に招待コード（wrangler secret `INVITE_CODE`）とメールアドレスを入力し、Worker が HS256 の JWT（有効 90 日）を発行する。アプリは `@capacitor/preferences` に保存し、以降 `Authorization: Bearer` で送る。`user_id` は JWT の `sub`（メール） | WebView の `capacitor://localhost` オリジンでは Access の Cookie もログインリダイレクトも成立しない |
| 画像入力 `<input type="file">` → `@capacitor/camera` | 撮影またはライブラリから選ぶ。Web 実行時（開発プレビュー）は `<input type="file">` にフォールバック | ネイティブのカメラとライブラリを使う。R2 へのアップロードは引き続き Worker 経由の multipart（署名付き URL は使わない） |
| CORS | `capacitor://localhost`、`https://localhost`、`http://localhost:5173` を許可 | アプリの WebView と開発サーバから API を呼ぶ |
| セーフエリア・ステータスバー・スプラッシュ | `env(safe-area-inset-*)` に対応し、ステータスバー色とスプラッシュを ADR-0004 のカラーに合わせる | ネイティブアプリとしての見え方 |
| P1 通知 | `@capacitor/push-notifications` を候補にする。APNs / FCM の設定は 11/8 時点で P0 が完了している場合のみ | 期間内に完成しない機能を先に作らない |

詳細は docs/decisions/0007-capacitor-and-invite-jwt.md。

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

Claude の出力はすべて JSON Schema で形を強制した構造化出力（Structured Outputs、`output_config.format`。ADR-0005）で受け取り、Worker 側で「引用が原文に含まれるか」を検証してから保存・表示する。

## 3. ユーザー体験

### 3.1 主要な流れ

1. 初回だけ招待コードとメールアドレスでログイン（パスワードなし。以後は端末に保持したトークンで入る。第10節、ADR-0007）
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

- F1 ログイン: 招待コード + メールアドレス → Worker が HS256 の JWT（90 日）を発行し、以後 Bearer で検証してメールを user_id にする（第10節、ADR-0007）
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
- セキュリティ: API キー・`INVITE_CODE`・`JWT_SECRET` は wrangler secret のみ。`.dev.vars` は gitignore。Bearer の JWT 検証なしに本番 API（`/api/health` と `/api/auth/login` を除く）に到達できない

## 6. 画面一覧

| 画面 | 役割 |
|---|---|
| S0 ようこそ（ログイン） | 未ログイン時。アプリ名と一行の説明、招待コードとメールアドレスの入力欄、「はじめる」。成功すると JWT を端末に保存して S1 へ。1 画面だけで、パスワードは無い |
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

- `@anthropic-ai/sdk` を Worker から直接呼ぶ。モデル名は環境変数 `ANTHROPIC_MODEL`（既定 `claude-opus-5-5`、切替候補 `claude-sonnet-5-5`）
- JSON Schema で出力の形を強制する。依頼文では tool use（`tool_choice` 強制）だが、現行モデルは強制 tool_choice を拒否するため Structured Outputs（`output_config.format`）で行う（ADR-0005）
- 入力: 新しい記憶本文 + 過去記憶（id, happened_on, body, 確定事実）の直近 200 件
- 出力後の検証（Worker 側）: `evidence` が引用元 body に部分文字列として含まれない項目は捨てる。1 件も残らなければ 0 件扱い
- 失敗時: 画面には何も出さない。`ai_runs.status = failed` を記録。再試行はしない

## 10. 認証

- 方式: 招待コード + メールアドレス → HS256 の JWT（有効 90 日）。Cloudflare Access は使わない
- `POST /api/auth/login` に `{ invite_code, email }` を送る。Worker は `INVITE_CODE`（wrangler secret）と定数時間で比較し、一致すれば `JWT_SECRET`（wrangler secret）で署名した JWT `{ sub: <email 小文字>, iat, exp }` を返す。不一致は 401（コードとメールのどちらが違うかは言わない）
- アプリは JWT を `@capacitor/preferences` に保存し、全 API に `Authorization: Bearer <jwt>` を付ける。期限切れや 401 を受けたら保存を消して S0 に戻る
- Worker は Bearer を検証（署名、`exp`、`sub` がメール形式）し、`sub` を `user_id` にする。ローカル開発では `ENVIRONMENT=development` のときだけ `X-Dev-User` も受け付ける（本番では無視）
- 制約: メールの所有確認はしない（招待コードを渡した相手だけが使う前提。ADR-0007 の「既知の制約」）
- レート制限: `/api/auth/login` は同一 IP から 1 分に 10 回まで（D1 の `login_attempts` で数える。超えたら 429）
- CORS: `capacitor://localhost`、`https://localhost`、`http://localhost:5173` のみ `Access-Control-Allow-Origin` に返す。`Authorization` ヘッダを許可。Cookie は使わない

## 11. デモシナリオ（4本）

| # | 名前 | 示す原則 | 流れ |
|---|---|---|---|
| D1 | 祖母の梅干し | 想起 + 根拠 | 過去「おばあちゃんは毎年6月になると…梅干しを漬けていた」がある状態で「スーパーで青梅を見かけた」を書く → 札が1枚、引用付き |
| D2 | 電気代 | 関係なければ提案しない | 「電気代を払った。先月より少し安かった」を書く → 札は出ない |
| D3 | 公園の花 | 推測を事実にしない | 公園の花の写真を添えて「公園で花が咲いていた」→ 候補「桜でしょうか」→ ユーザーが「ちがう（梅だった）」→ 候補は確定されず記憶に残らない |
| D4 | はるとの自転車 | 想起 + 成長 | 過去「はるとが三輪車で転んで泣いた」がある状態で「はると、今日補助輪なしで乗れた」→ 札が1枚、引用付き |

フィクスチャは demo/fixtures/ に置く。写真は開発者が権利を持つものだけを demo/photos/ に置く（Claude Code は書き込み禁止）。

## 12. スタック（変更不可）

- API: Cloudflare Workers + Hono + D1 + R2
- アプリ: Capacitor（iOS / Android）の WebView で Vue 3 + Vite + TypeScript + Tailwind を動かす。`@capacitor/core`、`cli`、`ios`、`android`、`camera`、`preferences`、`status-bar`、`splash-screen`。appId `jp.neuronest.souieba`、表示名「そういえば。」
- 開発プレビュー: Workers Static Assets で同じ画面を同一 Worker から配信（配布には使わない）
- 認証: 招待コード + HS256 JWT（第10節）
- AI: `@anthropic-ai/sdk`、JSON Schema による構造化出力（ADR-0005）、モデル名は環境変数
- 秘密情報: wrangler secret のみ。`.dev.vars` は gitignore
- パッケージ: pnpm。依存は必要最小限

## 13. リポジトリ構成

```
.
├── .claude/
│   ├── settings.json         # フック: .dev.vars と demo/photos/ への書き込み禁止
│   └── hooks/guard-writes.mjs  # 秘密ファイル、demo/photos/、ios/ android/ の署名ファイル
├── CLAUDE.md                 # Claude Code 向けの作業規約
├── README.md
├── docs/
│   ├── spec.md               # 本書
│   ├── requirements.md       # 機能要件と受け入れ条件
│   ├── architecture.md
│   ├── wireframes.md
│   ├── tasks.md
│   ├── setup-cloudflare.md   # D1 / R2 / secret / deploy の手順書
│   ├── setup-capacitor.md    # iOS / Android のビルドと実機の手順書
│   └── decisions/            # ADR
├── demo/
│   ├── fixtures/             # デモ4シナリオの JSON と seed SQL
│   └── photos/               # 開発者が置く（Claude Code 書き込み禁止）
├── web/                      # Vue 3 + Vite + Tailwind（Vite root。Capacitor の webDir は web/dist）
│   ├── index.html
│   └── src/
├── ios/                      # Capacitor が生成（署名ファイルは書き込み禁止）
├── android/                  # Capacitor が生成（署名ファイルは書き込み禁止）
├── capacitor.config.ts
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
| 11/4 | プロジェクト雛形、D1 マイグレーション適用、Vue + Tailwind + カラー/フォントのデザイン基盤、ヘルスチェック API、認証の疎通（v0.3 で Access から招待コード + JWT に変更）、wrangler deploy までの動作確認 |
| 11/5 | 記憶登録（F2）、一覧・詳細・削除（F3）、写真の R2 保存 |
| 11/6 | 候補抽出（F4, C2）と そういえば（F5, C1）、引用検証 |
| 11/7 | 反応（F6）、デモ4シナリオの通し、写真候補（F7, P1） |
| 11/8 | UI 磨き（空状態、読み込み、文字組み）、エラー時の静かな振る舞い |
| 11/9 | ふりかえり（F8, P1、余裕があれば）、README 仕上げ、デモ動画 |
| 11/10 | 提出（14:00 JST） |
