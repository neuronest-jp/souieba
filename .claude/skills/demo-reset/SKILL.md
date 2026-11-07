---
name: demo-reset
description: デモの収録や通しの前に、ローカル D1 の demo@example.com をシード（demo/fixtures/seed.sql）の状態に戻し、D1〜D4 の前提がそろっているかを確かめる。「デモを撮る」「通しをする」「デモの DB を戻して」のときに使う。
---

# デモの DB を戻す

デモの 4 本（docs/spec.md 第 11 節、demo/fixtures/scenarios.json）は、過去の記憶 16 件がそろった `demo@example.com` で撮る。
試しに書いたひとことが残っていると、札の結果が変わる（D1 と同じ本文が過去にあると自分の言い換えを引く、家電の記憶があると D2 の電気代が家電につながる、など）。

## 1. 先に開発者に確かめる

`pnpm db:seed:local` は `demo@example.com` と `other@example.com` の D1 の行を消して入れ直す。実機で書いたものも消える。**流す前に開発者の了解を取る。**
R2 の写真は消えない（D1 の行が消えるので画面には出なくなる）。

## 2. 戻す

```sh
pnpm db:migrate:local
pnpm db:seed:local
```

LAN の Worker（`pnpm dev:worker:lan`）も既定の `.wrangler/state` を使うので、動かしたままでよい。
`pnpm dev:worker` を `--persist-to` 付きで別の DB にしているときは、その DB には入らない。

## 3. 前提を確かめる

```sh
pnpm exec wrangler d1 execute souieba --local --command \
  "SELECT count(*) AS n FROM memories WHERE user_id='demo@example.com'"
```

- 16 件であること。D1 の想起元 `mem_d1_01`（梅干し）と D4 の想起元 `mem_d4_01`（三輪車）があること
- 撮影の日（11/5〜11/11）の書く画面の「あの日のひとこと」は `mem_daily_06`（1 年まえの 11/8、手編みのマフラー）。このごろの押し葉は 11/4 と 11/6 に押してある
- 札の引用はモデルが選ぶ。11/7 の通しでは D1 が「青梅を水に浸けて、ひとつずつヘタを取るのを手伝った。」、D4 が「泣きやむとまた三輪車に乗りたがった。」だった。台本は実際の札に合わせて話す

## 4. 報告する

消したもの（件数）、入れ直した件数、確かめたこと、確かめていないこと（実機の画面）を短く伝える。
