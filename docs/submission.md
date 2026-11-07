# 提出（Built with Claude: Japan 2026）

**提出締切は 2026-11-08（日）20:00 JST**（11/7 に届いた案内）。第 1 ラウンドの審査（すべての提出作品から上位 6 チームを選ぶ）は 11/9、
上位 6 チームの最終審査（事前収録のデモ 3 分を再生し、審査員が話し合う）は 11/10 13:00〜14:30。デモ動画の構成は `docs/demo-video.md`。

## 提出物

| 提出物 | いまの状態 | 置き場・メモ |
|---|---|---|
| プロジェクト名 | 「そういえば。」 | |
| 選択したテーマ | 【要記入: 1 か 2】 | |
| プロジェクトの説明（フォーマット指定あり、500 字以内） | 下の下書き。フォーマットは案内に合わせて組み直す | 【要記入: 指定のフォーマット】 |
| デモ動画（3 分以内、YouTube・Loom など） | 構成は `docs/demo-video.md`。流れは開発者が練る | 3 分を超えると減点、3 分より後は見ない。期間中に作った機能だけを映す |
| 公開 GitHub リポジトリ | 新しいリポジトリに差し替える（下の「リポジトリの差し替え」） | |
| Claude Code での開発の感想など | 下の下書き | |

## 審査の観点（案内の要点）

- **インパクト（30%）**: 課題が自分の仕事・暮らし・技術・趣味、または日本の具体的な現場から出発しているか。誰が・どんな場面で・どれくらい困っているか。ハッカソン後も誰がどんな場面で使い続けるか。
  テーマ 1 は「その世界に身を置いてきた人だから見えた足りないもの」、テーマ 2 は「これまで届いていなかった具体的な人と、その人を阻んでいた壁を取り除くこと」
- **デモ（25%）**: 冒頭で誰の・どんな課題を・どう解決するかが明確か。前提知識の無い人にも操作の流れで価値が分かるか。最後まで見たくなるか
- **Claude の活用（25%）**: 基本を超えた創造的な使い方。Claude Code を開発の中心に据えて何ができたか。モデルや機能（Skills・サブエージェント・MCP・フック）を目的に応じて使い分けたか
- **深さと実行力（20%）**: 最初のアイデアから試行錯誤して磨いたか。設計と実装の作り込み。困っている人が安心してそのまま使える仕上がりか
- 審査の禁止事項に当たるものは失格

## リポジトリの差し替え

いまの `neuronest-jp/yui` は非公開で、説明文と `main` は別作品（雪かき）のまま。根元に期間前（11/2）のコミットがある。
そこで、**期間中の履歴だけ**を新しい名前のリポジトリに出す。中身（最後の tree）はこのブランチと同じにする。

- 作り方: 使い捨ての複製で `git replace --graft 32147a9` → `git filter-branch` で、そういえば。の最初のコミット（2026-11-03、旧コードを消して始めた 32147a9）を根にする。
  作者・日付・メッセージはそのまま。11/7 に複製で試し、103 コミット、tree が HEAD と同じ、旧コミットが残らないことを確かめた。手元のリポジトリと `yui` は変えない
- 期間前の名残: 32147a9 で残した設定ファイル（`.editorconfig`、`.gitignore`、`LICENSE`）と、README の空行や「## 開発」「pnpm install」「MIT」の行だけ（ADR-0002。`git blame` で確かめた）。コードは無い
- 新しいリポジトリの名前（案）: `neuronest-jp/souieba`（アプリの appId `jp.neuronest.souieba` と同じ）【要確認】
- 説明文（案）: 「ひとことと写真 1 枚を残しておくと、あとで書いたひとことに関係のある昔の記憶が、そのときの言葉のまま『そういえば。』と浮かぶ iPhone アプリ。Built with Claude: Japan 2026」
- 公開は提出の直前でもよい。先に非公開で作って押し上げ、README の見え方を確かめてから公開に切り替える

## 提出前の確かめごと

- [ ] 新しいリポジトリを非公開で作り、期間中だけの履歴を押し上げる
- [ ] README を GitHub 上で読む（画像・リンク・見出し）。`.dev.vars` や秘密が無いことを確かめる
- [ ] 公開に切り替える。ログインしていない窓で開けるか確かめる
- [ ] 本番の Worker を deploy し（`GET /api/today` を含む）、本番の `/api/health` が 200 を返す
- [ ] デモ動画を書き出し（2:50 以内）、限定公開で上げ、ログインしていない窓で再生できる
- [ ] テーマ・説明・感想を提出フォームに入れる（説明は 500 字以内）

## 本番の手順（開発者が上から打つ。fish）

11/7 の点検（本番の手順の担当）がまとめたもの。deploy・secret・D1 / R2 の作成は開発者が行う。値（招待コード・JWT_SECRET・API キー）はチャット・文書・コミットに書かない。
`<UDID>` は `xcrun devicectl list devices`、チーム ID は自分の Apple Developer のもの（`set -x DEVELOPMENT_TEAM …`）。

### 0. 準備

```fish
cd ~/github/souieba
git status --short; git log --oneline -1
set -x PATH $PWD/node_modules/.bin $PATH
pnpm typecheck; and pnpm test; and pnpm check:words; and pnpm build
```

### 1. Cloudflare にログイン

```fish
pnpm exec wrangler login
pnpm exec wrangler whoami
```

### 2. D1

```fish
pnpm exec wrangler d1 create souieba
# 設定に足すかを聞かれたら No。wrangler.toml の database_id（00000000-…）を、出力の値に手で置き換える
grep -c '^\[\[d1_databases\]\]' wrangler.toml   # 1
grep -n database_id wrangler.toml                 # 0000 でないこと
pnpm db:migrate:remote                            # 0001_init.sql と 0002_login_attempts.sql
pnpm exec wrangler d1 migrations list souieba --remote
```

### 3. R2

```fish
pnpm exec wrangler r2 bucket create souieba-photos
pnpm exec wrangler r2 bucket list
```

### 4. 最初の deploy（secret を入れるまでログインは 503 のままでよい）

```fish
pnpm run deploy        # pnpm deploy と打たない（pnpm の組み込みコマンドと衝突する）
set -x URL https://souieba.<サブドメイン>.workers.dev
curl -s $URL/api/health
```

### 5. secret

```fish
set c1 (openssl rand -hex 8); echo $c1   # 本人に渡す分だけ控える
# 1 行で、末尾にカンマを付けない。人を増やすときは printf '%s=%s,%s=%s' $c1 you@… $c2 …
printf '%s=%s' $c1 you@example.com | pnpm exec wrangler secret put INVITE_CODE
openssl rand -base64 48 | tr -d '\n' | pnpm exec wrangler secret put JWT_SECRET   # 32 文字以上
pnpm exec wrangler secret put ANTHROPIC_API_KEY                                    # 貼り付けて Enter
pnpm exec wrangler secret list    # 3 つ出る
set -e c1
```

Anthropic Console で、月の利用上限を決めておく。

### 6. 疎通の確認（ログインは同じ IP から 1 分に 10 回まで）

```fish
env EXPECT_PRODUCTION=1 bash scripts/smoke.sh $URL
read -s -x SMOKE_INVITE_CODE; set -x SMOKE_EMAIL you@example.com
env EXPECT_PRODUCTION=1 bash scripts/smoke.sh $URL     # /api/today と /api/connections も見る
pnpm exec wrangler d1 execute souieba --remote --command "SELECT kind,status,substr(error,1,80) FROM ai_runs ORDER BY created_at DESC LIMIT 4"   # succeeded か empty
set -e SMOKE_INVITE_CODE
```

### 7. アプリを本番向けに作り直して実機に入れる

```fish
set -e VITE_API_BASE        # export が残っていると .env.production より優先される
printf 'VITE_API_BASE=%s\n' $URL > web/.env.production
pnpm cap:sync               # VITE_API_BASE が空なら止まる
grep -ohE 'https?://[A-Za-z0-9.:-]+' ios/App/App/public/assets/*.js | sort -u   # $URL があり、192.168 が無い
```

ビルドと入れ込みは `.claude/skills/iphone-install` の 4 と同じ。最初はログイン画面に戻る（LAN のトークンが 401 になる）のが正しい。招待コードとメールで入る。

### LAN で撮るとき

```fish
ipconfig getifaddr en0
pnpm db:seed:local          # 撮り直すたびに（.claude/skills/demo-reset。実機で書いたものも消える）
env LAN_PORT=8788 LAN_EMAIL=demo@example.com pnpm dev:worker:lan
env VITE_API_BASE=http://<LAN の IP>:8788 pnpm cap:sync
```

本番にデモの記憶を入れるかは撮る場所で決める。LAN で撮るなら本番に seed は入れない。本番で撮るなら `pnpm db:seed:remote` を流し、INVITE_CODE に `<コード>=demo@example.com` を足す。

## プロジェクトの説明（下書き）

フォーマットの指定に合わせて組み直す。2 段落目の冒頭は、開発者の 11/7 のメッセージの言葉から。500 字以内に収める（数え方は下の python の 1 行）。

> 「そういえば。」は、ひとことと写真 1 枚を残しておくと、あとで新しいひとことを書いたとき、関係のある昔の記憶が、そのときの言葉のまま浮かんでくる iPhone アプリです。
> 自分の生活は自分でどうにかするしかない。でも、自分の記憶はいつまでもあるわけじゃない。読み返すきっかけが無いまま、昔の悩みも、パートナーの好きなものも、子どもが初めて立った日も眠ってしまいます。
> そこで、今日のひとことを書くことそのものを、思い出すきっかけにしました。Claude が同じ人の過去の記憶を読み、本当に関係のあるものだけを最大 3 件、理由と当時の原文の引用を添えて返します。Worker が引用を原文と照らし、本文に無い引用は捨てます。関係が無ければ何も出しません。人や場所、写真から見えたもの（「桜でしょうか」）は候補のままで、本人が「そう」と頷くまで事実にしません。
> 開発では Claude Code を中心に置き、複数のエージェントで案を比べ、見直しの指摘は別のエージェントが反証してから直しました（4 回）。iOS Simulator の MCP、秘密を守るフック、くり返す手順の Skills も使い分けました。

## Claude Code での開発の感想（下書きの材料）

開発者自身の言葉で書く。材料は 11/7 時点の事実だけ（数字の根拠は README の「Claude Code でどう作ったか」と ADR）。

- **仕様から組み直せた**: 仕様の原本が手元に無い状態から、依頼文をもとに Claude Code が同じ章立てで仕様書を組み直し、答えの無い確認事項には既定値を置いて ADR に残した（ADR-0001、ADR-0003）
- **「信じない」作りを一緒に詰めた**: Structured Outputs で形を縛り、Worker で引用を一字ずつ照らす。見直しの 1 回目の直後に、候補の値まで本文と照らす直し（98e6c2c）や、年を当てはめた日付候補を出さない直し（9e295f8）が入った
- **見つける役と反証する役を分けた**: 見直しは 4 回。見つける役の指摘を別のエージェントが反証してから直し、反証された指摘は直さなかった（ADR-0011 の 11・12 節）。もっともらしいだけの指摘に振り回されなかった
- **案を並べて選べた**: 見た目とつながり画面を、3 体ずつ並行で見本にさせて選んだ（ADR-0010、ADR-0009）。試して戻した判断（iOS 標準の見た目、ADR-0008）も記録に残っている
- **実機の手ざわりは人の指が要った**: 鍵盤の高さや「保存する」の位置は Simulator の MCP で測れた。けれど、ダブルタップで拡大してしまうこと、触覚の強さ、つながりの上下が逆に感じることは、開発者が実機で触って初めて分かった（ADR-0011 の 13 節、ADR-0009 の追記）
- **止まったことも**: 見直しの途中で利用の上限に当たり、5 体が何も返さずに終わった。「0 件」を「問題なし」と読まず、上限が戻ってから流し直した
- **最後の点検で穴が見つかった**: 提出前夜の点検で、写真から候補を出す機能（C3）がまだ無く、デモの 1 本が撮れないと分かった。仕様と受け入れ条件が決まっていたので、その夜のうちに作れた
- **守りは仕組みで**: 秘密と署名ファイルへの書き込みはフックで拒み（回帰テスト 39 件）、画面の「AI」「生成」「送信」は CI で止めた。言葉で頼むより確かだった
