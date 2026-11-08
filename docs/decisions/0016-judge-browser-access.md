# ADR-0016: 審査員が触れるブラウザ版を、乱数の名前の Worker から配信する

- 日付: 2026-11-08
- 状態: 採用

## 文脈

提出（11/8 20:00 JST）に向けて、審査員に実際に触ってもらえる場所が要る。iPhone のアプリは開発者の Mac から直接入れる配布しか無く（ADR-0011。App Store / TestFlight には出していない）、審査員の端末には入れられない。
画面は Capacitor の WebView で動く Vue の SPA で、ブラウザでもそのまま動く（写真はファイル選択に、トークンは localStorage に落ちる。web/src/camera.ts、web/src/auth.ts）。
ADR-0007 では Workers Static Assets の配信を「開発用プレビューだけ」としていた。
開発者の要望: URL は乱数にして、推測しにくくする。

## 決定

1. **Pages ではなく、API と同じ Worker から画面を配信する**（wrangler.toml の `[assets]`、`run_worker_first = ["/api/*"]`）。画面は同じオリジンの `/api` を叩くので、向き先（`VITE_API_BASE`）の設定も CORS の追加も要らない。
2. **配備する Worker の名前は乱数**（英字 1 字 + 16 進 20 桁）にし、`.wrangler/worker-name`（gitignore 済み）に置く。`pnpm run deploy`（scripts/deploy.sh）がそれを `--name` で渡す。wrangler.toml の `name = "souieba"` は手元（`wrangler dev`）と dry-run 用で、その名前では配備しない（`souieba.<account>.workers.dev` は推測できる）。名前はリポジトリ・README・文書に書かず、提出フォームにだけ書く。バージョンごとの Preview URL は閉じる（`preview_urls = false`）。
3. **検索に載せない**: `web/public/robots.txt`（すべて Disallow）、`web/public/_headers`（`X-Robots-Tag: noindex, nofollow`、`X-Frame-Options: DENY`、`X-Content-Type-Options: nosniff`、`Referrer-Policy: same-origin`）、index.html の `<meta name="robots">` と `<meta name="referrer" content="same-origin">`。字体を Google Fonts から読むときに、このページの場所を外に伝えない。
4. **審査員のアカウント**: 招待コードは 1 人 1 つのまま（ADR-0007 の対応表）。メールは利用者の id として使うだけで、実在しなくてよい（手渡す文面に「そのまま入れる」と書く）。空のアカウントでは「そういえば。」が出ないので、物語のデータ（88 件、demo/fixtures/story.py）を審査員ごとに id の前置きを変えて入れる（`--user` / `--prefix`、scripts/seed-story-for.sh）。
5. **秘密と Cloudflare の資源は開発者が手で**: `ANTHROPIC_API_KEY` / `INVITE_CODE` / `JWT_SECRET` の投入、D1 / R2 の作成、配備は docs/setup-cloudflare.md と docs/submission.md「本番の手順」のとおり開発者が行う。Claude Code が書くスクリプトは秘密を扱わない（CLAUDE.md）。

## 結果

- 画面を本番でも配信する（ADR-0007 の「開発用プレビューだけ」を改める。architecture.md 3.6 も直した）。データは Bearer の要る API 経由でしか出ないので、画面が見えること自体は問題ない。
- URL が分かっても、招待コードとメールの組が無ければ入れない。ログインは同じ IP から 1 分 10 回まで。
- 費用: 保存のたびに Claude を 2 回呼ぶ（C1 / C2）。Anthropic Console の月の使用上限で抑える。
- 審査が終わったら、`INVITE_CODE` から審査員の行を外して入れ直し、`JWT_SECRET` を替える（発行済みのトークンが無効になる）。審査員が書いた記憶は docs/setup-cloudflare.md 13 節の手順で消す。
- 画面の幅はスマートフォン向け。PC のブラウザでは幅いっぱいに広がるので、手渡す文面でスマートフォンを勧める。
- 乱数の名前は `.wrangler/worker-name` を失うと分からなくなる（ダッシュボードの Workers の一覧で見られる）。
