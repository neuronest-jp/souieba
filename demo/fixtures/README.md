# demo/fixtures: デモ4シナリオのフィクスチャ

docs/spec.md 第11節（D1〜D4）を通すための初期データと、Claude の出力を模したスタブ。
写真はここには入れない。開発者が権利を持つ写真だけを demo/photos/ に手で置く（Claude Code は書き込まない）。

## ファイル

| ファイル | 役割 |
|---|---|
| `seed.sql` | D1 に入れる初期データ。ユーザー `demo@example.com` の過去の記憶 16 件（2024〜2026）、確定済みの事実、過去の札 1 枚、Claude 呼び出しの記録。先頭でデモユーザーの行を消すので何度流しても同じ状態になる |
| `scenarios.json` | D1〜D4 それぞれの前提（seed の memory id）、入力（本文・起きた日・写真ファイル名）、期待する結果（札の件数、想起元、引用、候補とユーザー操作）、口頭で説明する台本 |
| `ai/recall-d1.json` | C1 想起の出力（D1）。札 1 枚、`mem_d1_01` を引用 |
| `ai/recall-d2-empty.json` | C1 想起の出力（D2）。`items` が空 |
| `ai/recall-d4.json` | C1 想起の出力（D4）。札 1 枚、`mem_d4_01` を引用 |
| `ai/facts-d1.json` | C2 候補抽出の出力（D1）。「青梅」「スーパー」 |
| `ai/facts-d3.json` | C2 候補抽出の出力（D3）。「公園」「花」 |
| `ai/photo-d3.json` | C3 写真候補の出力（D3）。「桜」「公園」「木」。画面では語尾に「でしょうか」を付ける |
| `invalid/recall-evidence-not-in-body.json` | 検証で弾かれるべき出力。`evidence` が `mem_d1_01` の本文に無い（言い換え） |
| `invalid/recall-related-other-user.json` | 検証で弾かれるべき出力。`related_memory_id` が他ユーザー `other@example.com` の記憶 |
| `invalid/recall-too-many.json` | 検証で先頭 3 件に切られるべき出力。4 件とも引用は正しい |

`ai/` と `invalid/` の JSON は、Structured Outputs（ADR-0005）で受け取る JSON そのもの（docs/architecture.md 6.2 / 6.3 のスキーマ）。
tool use に戻した場合も `tool_use.input` が同じ形になる。

## 投入

```sh
pnpm db:migrate:local                       # 先にスキーマ
wrangler d1 execute souieba --local --file demo/fixtures/seed.sql
# または pnpm db:seed:local
```

ローカルでは `X-Dev-User: demo@example.com` を付けると、この seed のユーザーとして見える（画面は `DEV_USER=demo@example.com pnpm dev`）。

## seed の中身

| id | 起きた日 | 本文の要点 | 役割 |
|---|---|---|---|
| mem_d4_02 | 2024-02-20 | はるとが初めて「ばあば」と言った | はると・おばあちゃんの別の記憶（D4 で出ないのが望ましい） |
| mem_daily_01 | 2024-03-09 | スーパーで牛乳と卵 | 無関係（「スーパー」が D1 と共通するだけ） |
| mem_d4_01 | 2024-04-14 | はるとが三輪車で転んで泣いた | D4 の想起元 |
| mem_d1_01 | 2024-06（月） | おばあちゃんが縁側で梅干しを漬けていた | D1 の想起元 |
| mem_daily_02 | 2024-08-02 | 蝉と猛暑 | 無関係（天気） |
| mem_daily_03 | 2024-11-18 | 終電で帰った | 無関係（仕事） |
| mem_d1_02 | 2025-01-12 | おばあちゃんの家でこたつとみかん | おばあちゃんの別の記憶（D1 で出ないのが望ましい）。過去の札 `recall_seed_01` が付く |
| mem_daily_04 | 2025-02-22 | 雪で転びそうになった | 無関係（「転ぶ」が D4 と共通するだけ） |
| mem_daily_05 | 2025-05-11 | ゆきと喫茶店 | 無関係（友人）。候補 1 件が candidate のまま |
| mem_daily_06 | 2025-10-03 | 健康診断 | 無関係 |
| mem_daily_07 | 2026-01-04 | 初詣の甘酒 | 無関係 |
| mem_daily_08 | 2026-04-06 | 公園でゆきと弁当 | 無関係（D3 で札が出ても可）。rejected の候補を 1 件持つ |
| mem_daily_09 | 2026-07-19 | 冷蔵庫が壊れた | 無関係（D2 で家電つながりに引かれないかの確認） |
| mem_daily_10 | 2026-09-28 | 雨に降られた | 無関係 |
| mem_daily_11 | 2026-10（月） | 古い写真の整理 | 無関係。精度 month の表示確認 |
| mem_daily_12 | 不明 | 新しい靴 | 無関係。精度 unknown（happened_on NULL）の並び順確認 |
| mem_other_01 | 2025-06-08 | 梅酒を漬けた（`other@example.com`） | 他ユーザー。想起の入力に乗らないこと、`invalid/recall-related-other-user.json` が弾かれることの確認 |

確定済みの事実（`status='confirmed'`）は `mem_d1_01`（おばあちゃん・梅干し・縁側・2024-06）、`mem_d4_01`（はると・三輪車・公園）、`mem_d4_02`、`mem_d1_02`、`mem_daily_05`、`mem_daily_08` に付けてある。
`source='user'` は `evidence` NULL、`source='ai'` は本文からの逐語引用（スキーマの CHECK に従う）。

## 写真（開発者が置く）

| ファイル名 | 使うシナリオ | 内容 |
|---|---|---|
| `park-flower.jpg` | D3 | 公園に咲く花（梅）。候補「桜でしょうか」に「ちがう」と答える流れに使う |
| `ume.jpg` | D1（任意） | 青梅。docs/architecture.md 11.2 のスモークでも参照 |

## スタブの使いどころ

- `worker/test/evidence.test.ts` の入力に `ai/` と `invalid/` を読み込み、引用検証（docs/architecture.md 6.5）が `ai/` を通し `invalid/` を落とすことを確かめる
- `ANTHROPIC_API_KEY` が無い環境で画面を確認するときの差し替え用。`ai/` の `evidence` は `seed.sql` の本文からコピーしているので、そのまま `recalls` に INSERT しても検証に通る
