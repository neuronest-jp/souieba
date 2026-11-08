# 提出（Built with Claude: Japan 2026）

**提出締切は 2026-11-08（日）20:00 JST**（11/7 に届いた案内）。第 1 ラウンドの審査（すべての提出作品から上位 6 チームを選ぶ）は 11/9、
上位 6 チームの最終審査（事前収録のデモ 3 分を再生し、審査員が話し合う）は 11/10 13:00〜14:30。デモ動画の構成は `docs/demo-video.md`。

## 提出物

| 提出物 | いまの状態 | 置き場・メモ |
|---|---|---|
| プロジェクト名 | 「そういえば。」 | |
| 選択したテーマ | テーマ 2（これまで届いていなかった人と、その人を阻んでいた壁。スマートフォンは毎日使っても、AI に暮らしのことを話す習慣がない人へ） | README の冒頭と同じ |
| プロジェクトの説明（フォーマット指定あり、500 字以内） | 下の下書き。フォーマットは案内に合わせて組み直す | 【要記入: 指定のフォーマット】 |
| デモ動画（3 分以内、YouTube・Loom など） | 構成は `docs/demo-video.md`。流れは開発者が練る | 3 分を超えると減点、3 分より後は見ない。期間中に作った機能だけを映す |
| 公開 GitHub リポジトリ | 新しいリポジトリに差し替える（下の「リポジトリの差し替え」） | |
| Claude Code での開発の感想など | 下の下書き | |
| 触れる場所（ブラウザ版） | 乱数の名前の Worker に配備（ADR-0016。下の「本番の手順」） | URL・招待コード・メールは提出フォームにだけ書く（README やリポジトリには書かない） |

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
- [ ] 本番の Worker を乱数の名前で deploy し（`pnpm run deploy`。下の 4）、本番の `/api/health` が 200 を返す
- [ ] 審査員のアカウント（招待コードと物語のデータ）を入れ、1 つで実際にログイン → 書く → 札が出るまで通す（下の 5・5b・6）
- [ ] デモ動画を書き出し（2:50 以内）、限定公開で上げ、ログインしていない窓で再生できる
- [ ] テーマ・説明・感想と、ブラウザ版の URL・招待コードを提出フォームに入れる（説明は 500 字以内。文面は下の「提出フォームに書く文面」）
- [ ] Anthropic Console で月の使用上限を決めた

## 本番の手順（開発者が上から打つ。fish）

11/7 の点検（本番の手順の担当）がまとめ、11/8 に審査員向けの配備（ADR-0016）に合わせて直したもの。deploy・secret・D1 / R2 の作成は開発者が行う。値（招待コード・JWT_SECRET・API キー）と Worker 名（URL）はチャット・文書・コミットに書かない。
Worker 名は `.wrangler/worker-name` の乱数で、`pnpm run deploy` が最初に作る。secret など Worker を指すコマンドにはすべて `--name $WORKER` を付ける（付けないと wrangler.toml の `souieba` という別の Worker が作られる）。
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

11/8 の `whoami` では scope に d1 / r2 が無かった（D1 / R2 を作る権限が無い）。2 の `d1 create` が権限で断られたら、`pnpm exec wrangler login` をやり直す（既定の scope で入り直す）。

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
pnpm run deploy        # pnpm deploy と打たない（pnpm の組み込みコマンドと衝突する）。初回は .wrangler/worker-name に乱数の名前を作ってから配備する
set -x WORKER (cat .wrangler/worker-name)
set -x URL https://$WORKER.<サブドメイン>.workers.dev   # サブドメインは deploy の出力の URL から
curl -s $URL/api/health
curl -sI $URL/ | grep -i -E 'x-robots-tag|x-frame-options'   # 検索よけのヘッダが付いている
curl -s $URL/robots.txt
```

`pnpm run deploy` は画面を `VITE_API_BASE` 空で組む（同じ Worker の `/api` を叩く）ので、`web/.env.local` に LAN の向き先が残っていてもよい。

### 5. secret（審査員のぶんも、対応表に 1 人 1 行）

招待コードは 1 人 1 つ（ADR-0007）。審査員の行のメールは実在しなくてよく、利用者の id として使うだけ（例: `judge1@example.com`〜`judge4@example.com`。手渡す文面に「そのまま入れる」と書く）。
値は端末にだけ控え、提出フォーム以外に書かない。

```fish
set c0 (openssl rand -hex 8)   # 自分のぶん
set c1 (openssl rand -hex 8); set c2 (openssl rand -hex 8); set c3 (openssl rand -hex 8); set c4 (openssl rand -hex 8)   # 審査員 1〜4
# 1 行で、末尾にカンマを付けない。人を足すときは ,コード=メール を後ろに足して入れ直す（全体の置き換え）
printf '%s=%s,%s=%s,%s=%s,%s=%s,%s=%s' $c0 you@example.com $c1 judge1@example.com $c2 judge2@example.com $c3 judge3@example.com $c4 judge4@example.com | pnpm exec wrangler secret put INVITE_CODE --name $WORKER
openssl rand -base64 48 | tr -d '\n' | pnpm exec wrangler secret put JWT_SECRET --name $WORKER   # 32 文字以上
pnpm exec wrangler secret put ANTHROPIC_API_KEY --name $WORKER                                    # 貼り付けて Enter
pnpm exec wrangler secret list --name $WORKER    # 3 つ出る
echo judge1 $c1; echo judge2 $c2; echo judge3 $c3; echo judge4 $c4   # 提出フォームに写したら消す
set -e c0 c1 c2 c3 c4
```

Anthropic Console で、月の利用上限を決めておく（保存のたびに Claude を 2 回呼ぶ）。

### 5b. 審査員のアカウントに物語のデータを入れる

空のアカウントでは「そういえば。」が出ない。物語のデータ（88 件、`demo/fixtures/story.py`）を、審査員ごとに id の前置きを変えて本番の D1 に入れる（ADR-0016）。

```fish
bash scripts/seed-story-for.sh judge1@example.com judge2@example.com judge3@example.com judge4@example.com
pnpm exec wrangler d1 execute souieba --remote --command "SELECT user_id, count(*) AS n FROM memories GROUP BY user_id"   # 各 88
```

入れ直すとその人の行は消えて入り直る（審査員が書いた記憶も消える）。

### 6. 疎通の確認（ログインは同じ IP から 1 分に 10 回まで）

```fish
env EXPECT_PRODUCTION=1 bash scripts/smoke.sh $URL
read -s -x SMOKE_INVITE_CODE; set -x SMOKE_EMAIL you@example.com
env EXPECT_PRODUCTION=1 bash scripts/smoke.sh $URL     # /api/today と /api/connections も見る
pnpm exec wrangler d1 execute souieba --remote --command "SELECT kind,status,substr(error,1,80) FROM ai_runs ORDER BY created_at DESC LIMIT 4"   # succeeded か empty
set -e SMOKE_INVITE_CODE
```

最後に、スマートフォンのブラウザで `$URL` を開き、審査員 1 の招待コードとメールで入る → 「三人で、山の上の展望台までドライブした」と書いて保存 → 展望台の札が 2 枚出る（2〜6 秒）。
確かめ終えたら、その記憶は詳細から消しておく（札も一緒に消える）。本番のログは `pnpm exec wrangler tail --name $WORKER`。

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

## 提出フォームに書く文面（審査員向け）

URL と招待コードはここにだけ書く（README・リポジトリ・チャットには書かない）。`<…>` を埋める。

> ブラウザで触れる版（iPhone のアプリと同じ画面。Cloudflare Workers 上）: <URL>
> スマートフォンのブラウザで開くのがおすすめです。ログイン画面に、次の招待コードとメールアドレスをそのまま入れてください（メールアドレスは利用者の ID として使うだけで、実在しません）。
> - 審査員 1: 招待コード <コード 1> / メールアドレス judge1@example.com
> - 審査員 2: 招待コード <コード 2> / メールアドレス judge2@example.com
> - （3・4 も同じ形）
> 架空の人物の記憶が 88 件（2020 年〜2026 年）入っています。「三人で、山の上の展望台までドライブした」「そろそろクリスマスのプレゼントを考えたい。みさきは何がうれしいかな」のように書いて保存すると、2〜6 秒ほどで、関係のある昔の記憶がそのときの言葉のまま浮かびます。関係が無ければ何も出ません（例:「シャンプーの詰め替えを買った」）。
> 「つながり」「これまで」「ことばの地図」も開けます。写真を添えると「〜でしょうか」の候補が出ます。
> 1 つの招待コードは 1 人分です。同じコードで入ると、同じ記憶が見えます。

## 審査のあと

- `INVITE_CODE` から審査員の行を外して入れ直し（5 と同じ形で、自分の行だけ）、`JWT_SECRET` を新しくする（発行済みのトークンが無効になる）
- 審査員が書いた記憶を消すなら docs/setup-cloudflare.md 13 節（メールは `judge1@example.com` など）
- Worker ごと止めるなら `pnpm exec wrangler delete --name $WORKER`（D1 / R2 は残る）

## プロジェクトの説明（下書き）

フォーマットの指定に合わせて組み直す。2 段落目の冒頭は、開発者の 11/7 のメッセージの言葉から。500 字以内に収める（数え方は下の python の 1 行）。

> 「そういえば。」は、ひとことと写真 1 枚を残しておくと、次に書いたとき、関係のある昔の記憶がそのときの言葉のまま浮かんでくる iPhone アプリです。
> 秋田で暮らすなかで、誰から何をもらったか、あの人は何が好きかという小さな記憶が、次の気遣いやつながりを支えていると気づきました。私自身は、Claude に以前の話を踏まえてもらえる便利さに助けられています。でもそれは、まだ AI と話す人のものです。何を話せばいいか分からず、些細なことを残す価値も見えていない人に、「覚えていてくれる」体験を届けたくて作りました。
> 入口は毎日のひとことです。Claude が同じ人の過去の記憶を読み、関係のあるものだけを最大 3 件、理由と当時の原文の引用を添えて返します。Worker が引用を原文と照らし、無ければ捨て、関係が無ければ何も出しません。人や場所、写真から見えたものは候補のままで、本人が「そう」と頷くまで事実にしません。
> 開発は Claude Code が中心です。複数のエージェントで案を比べ、見直しの指摘は別のエージェントが反証してから直し、MCP やフック、Skills も使い分けました。

## Claude Code での開発の感想（下書きの材料）

開発者自身の言葉で書く。材料は 11/7 時点の事実だけ（数字の根拠は README の「Claude Code でどう作ったか」と ADR）。

- **仕様から組み直せた**: 仕様の原本が手元に無い状態から、依頼文をもとに Claude Code が同じ章立てで仕様書を組み直し、答えの無い確認事項には既定値を置いて ADR に残した（ADR-0001、ADR-0003）
- **「信じない」作りを一緒に詰めた**: Structured Outputs で形を縛り、Worker で引用を一字ずつ照らす。見直しの 1 回目の直後に、候補の値まで本文と照らす直し（98e6c2c）や、年を当てはめた日付候補を出さない直し（9e295f8）が入った
- **見つける役と反証する役を分けた**: 見直しは 4 回。見つける役の指摘を別のエージェントが反証してから直し、反証された指摘は直さなかった（ADR-0011 の 11・12 節）。もっともらしいだけの指摘に振り回されなかった
- **案を並べて選べた**: 見た目とつながり画面を、3 体ずつ並行で見本にさせて選んだ（ADR-0010、ADR-0009）。試して戻した判断（iOS 標準の見た目、ADR-0008）も記録に残っている
- **実機の手ざわりは人の指が要った**: 鍵盤の高さや「保存する」の位置は Simulator の MCP で測れた。けれど、ダブルタップで拡大してしまうこと、触覚の強さ、つながりの上下が逆に感じることは、開発者が実機で触って初めて分かった（ADR-0011 の 13 節、ADR-0009 の追記）
- **止まったことも**: 見直しの途中で利用の上限に当たり、5 体が何も返さずに終わった。「0 件」を「問題なし」と読まず、上限が戻ってから流し直した
- **最後の点検で穴が見つかった**: 提出前夜の点検で、写真から候補を出す機能（C3）がまだ無く、デモの 1 本が撮れないと分かった。仕様と受け入れ条件が決まっていたので、その夜のうちに作れた
- **（開発者の言葉、11/8）ハッカソンを振り返って**: AI を使おうと思って使う人は、まだ少ない。少しずつ増えてきたが、何かのアプリを通じて AI を体験するだけに留まっていると思う。そういう人たちに「AI ってこんなに便利なんだよ」と伝えたい。今も昔も続いている地方・田舎の人とのつながりを、AI を使えばどこでもできるようになるかもしれない。そう考えられるいい機会だった
- **守りは仕組みで**: 秘密と署名ファイルへの書き込みはフックで拒み（回帰テスト 39 件）、画面の「AI」「生成」「送信」は CI で止めた。言葉で頼むより確かだった
