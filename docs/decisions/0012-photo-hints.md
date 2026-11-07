# ADR-0012: 写真からの気づき候補（F7）は、写真そのものを根拠にして本文の候補と同じ所に置く

- 日付: 2026-11-07
- 状態: 採用
- 関連: requirements F7・第8節 #4・X-6・N-5、tasks T-1107-06 / T-1107-07、spec 第2節 C3、ADR-0005（Structured Outputs）

## 背景

C3「写真からの気づき候補」は、写っている物事・季節・場所の種類の候補を「〜でしょうか」の形で出す（spec 第2節）。
本文の候補（C2）は「提案には必ず原文の引用」（原則 3）で守っているが、写真から見えたものは本文に書かれていないので引用を持てない。
一方でスキーマ（0001_init.sql）は `source='ai'` の行に `evidence` を必須にしている。
また写真には人が写ることがあり、誰か・何歳か・どんな気持ちかを推しはかって候補に出すと、推測を事実のように見せることになる（原則 1）。

tasks の T-1107-07 はこの ADR を「ADR-0006」として予定していたが、0006 は書き込み禁止フックの方針で使われているため 0012 にした。

## 決定

1. 根拠は本文の引用の代わりに写真そのものにする。写真候補も `memory_facts` に `source='ai'`・`status='candidate'` で入れ、
   `evidence` に `photo:<photo_key>` を入れる（requirements 第8節 #4 のとおり）。
   - 確定・却下は本文の候補と同じ `PATCH /api/facts/:id`。新しい API も `source='user'` の行も作らない
   - 引用の照合（X-6 / X-7）は本文由来の候補だけにかける。写真候補の検証は kind（thing / place）・前後の空白と空・(kind, value) の重複・先頭 5 件
   - 本文の候補と (kind, value) が同じでも別の行として残す（F7-7）。同じ記憶に同じ写真候補が既にあれば足さない
   - 画面は `evidence` が `photo:` で始まる行に「写真から」と添え、候補のあいだは値に「でしょうか」を付けて尋ねる（引用の「」は付けない）。
     確かめた値は言い切り（「桜」）、却下は打ち消し線で行として残す。読み上げは「写真から、桜でしょうか」の順
2. 人物は推しはからない。スキーマの `kind` を `thing` / `place` の enum に絞り（`person` と `date` は写真からは出さない）、
   Worker も kind でもう一度捨てる。prompt で、誰なのか・年齢・性別・表情や感情・人数を推測しないこと、人が写っていても
   「人」「子ども」「家族」のような候補にしないこと、店名や地名を推測しないことを決める。季節は「桜」「紅葉」「雪」のような物事（thing）で表す。
   value に年齢や感情の語が混ざった thing は prompt で禁じるだけで、Worker は kind でしか捨てない（F7-4）
3. 失敗は静かに何も出さない。API の失敗・refusal・JSON の崩れは `ai_runs(kind='photo', status='failed')` に理由を残すだけで（記憶の削除は、ADR-0013 で記録ごと同じ batch で消す形に改めた）、
   候補は増えず、画面には何も出さない（ポーリングは pending=false で止まる）。再試行しない（`maxRetries: 0`、タイムアウト 20 秒は C1 / C2 と同じ）
4. 走らせ方: `PUT /api/memories/:id/photo` が保存に成功したら、R2 のオブジェクトが 6,291,456 バイト以下で、その記憶に `photo` の記録が
   まだ無いときだけ、200 を返す前に `ai_runs(kind='photo', status='running')` を作り、`waitUntil` で 1 回だけ Claude を呼ぶ
   （R2 から読んだ写真を base64 の画像ブロックにし、本文を添える。Structured Outputs のスキーマ `photo_hints`、effort は low）。
   写真を差し替えても 2 回目は走らせない（N-5）。`GET /api/memories/:id/facts` と `GET /api/memories/:id` の `facts.pending` は
   `facts` か `photo` のどちらかが running の間 true にし、画面は写真候補が届くまで取り直す

## 影響

- worker/src/ai/photo.ts（実行）、schemas.ts（`PHOTO_HINTS_SCHEMA`）、prompts.ts（`PHOTO_SYSTEM`）、verify.ts（`verifyPhotoHints`）、
  client.ts（画像ブロック）、routes/photos.ts（`afterPhoto` の起動口）、routes/facts.ts・routes/memories.ts（pending）
- web/src/components/FactChips.vue（写真候補の見せ方）、web/src/screens/MemoryDetailScreen.vue（S3 で写真を添えたら取り直す）
- 確定した写真候補は本文の確定事実と同じく想起（C1）の入力に「もの: 桜」の形で入る。却下・候補のままのものは入らない（X-2）
- 写真から出た候補であることは `evidence` と画面の「写真から」で残る（原則 1 の「AI 由来の痕跡」）
- 実際の Claude（Opus 5.5）で、写真付きの呼び出しが 10 秒・20 秒の予算に収まるかはまだ測っていない
