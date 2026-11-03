-- そういえば。 デモ用フィクスチャ（worker/migrations/0001_init.sql のスキーマに従う）
-- 投入: wrangler d1 execute souieba --local --file demo/fixtures/seed.sql
-- 何度流しても同じ状態になるよう、先にデモユーザーの行を消す（memories 以下は CASCADE で消える）。
-- 人名はすべて架空。日時は ISO 8601（UTC）。happened_on は 'YYYY-MM-DD'。

DELETE FROM ai_runs WHERE user_id IN ('demo@example.com', 'other@example.com');
DELETE FROM users   WHERE id      IN ('demo@example.com', 'other@example.com');

-- ---------------------------------------------------------------
-- ユーザー
-- ---------------------------------------------------------------
INSERT INTO users (id, display_name, created_at, last_seen_at) VALUES
  ('demo@example.com',  NULL, '2024-02-20T09:00:00.000Z', '2026-11-03T00:00:00.000Z'),
  ('other@example.com', NULL, '2025-03-01T09:00:00.000Z', '2026-11-03T00:00:00.000Z');

-- ---------------------------------------------------------------
-- 過去の記憶（demo@example.com、16 件、2024〜2026）
--   mem_d1_*   : D1「祖母の梅干し」の想起元（mem_d1_01）と、おばあちゃんの別の記憶
--   mem_d4_*   : D4「はるとの自転車」の想起元（mem_d4_01）と、はるとの別の記憶
--   mem_daily_*: 無関係な日常（買い物・天気・仕事・友人）。D2「電気代」で 0 件が正解になる土台
-- ---------------------------------------------------------------
INSERT INTO memories (id, user_id, body, happened_on, happened_on_precision, photo_key, photo_content_type, created_at, updated_at) VALUES
  ('mem_d4_02', 'demo@example.com',
   'はるとが初めて「ばあば」と言った。おばあちゃんが泣いて笑った。',
   '2024-02-20', 'day', NULL, NULL, '2024-02-20T11:30:00.000Z', '2024-02-20T11:30:00.000Z'),

  ('mem_daily_01', 'demo@example.com',
   'スーパーで牛乳と卵を買った。夕方のレジが混んでいた。',
   '2024-03-09', 'day', NULL, NULL, '2024-03-09T09:40:00.000Z', '2024-03-09T09:40:00.000Z'),

  ('mem_d4_01', 'demo@example.com',
   'はるとが三輪車で転んで泣いた。公園の坂道で膝をすりむいたのに、泣きやむとまた三輪車に乗りたがった。',
   '2024-04-14', 'day', NULL, NULL, '2024-04-14T07:15:00.000Z', '2024-04-14T07:15:00.000Z'),

  ('mem_d1_01', 'demo@example.com',
   'おばあちゃんは毎年6月になると、縁側で梅干しを漬けていた。青梅を水に浸けて、ひとつずつヘタを取るのを手伝った。',
   '2024-06-01', 'month', NULL, NULL, '2024-06-15T10:00:00.000Z', '2024-06-15T10:00:00.000Z'),

  ('mem_daily_02', 'demo@example.com',
   '朝から蝉がうるさい。今日は36度になるらしい。',
   '2024-08-02', 'day', NULL, NULL, '2024-08-01T22:50:00.000Z', '2024-08-01T22:50:00.000Z'),

  ('mem_daily_03', 'demo@example.com',
   '仕事の資料づくりが終わらず、終電で帰った。',
   '2024-11-18', 'day', NULL, NULL, '2024-11-18T15:20:00.000Z', '2024-11-18T15:20:00.000Z'),

  ('mem_d1_02', 'demo@example.com',
   'おばあちゃんの家で、こたつに入ってみかんを食べた。「もっと食べなさい」と何度も言われた。',
   '2025-01-12', 'day', NULL, NULL, '2025-01-12T08:30:00.000Z', '2025-01-12T08:30:00.000Z'),

  ('mem_daily_04', 'demo@example.com',
   '雪が少し積もった。駅までの道がつるつるで、何度か転びそうになった。',
   '2025-02-22', 'day', NULL, NULL, '2025-02-22T00:10:00.000Z', '2025-02-22T00:10:00.000Z'),

  ('mem_daily_05', 'demo@example.com',
   'ゆきと駅前の喫茶店でパンケーキを食べた。ゆきは相変わらずよく笑う。',
   '2025-05-11', 'day', NULL, NULL, '2025-05-11T06:00:00.000Z', '2025-05-11T06:00:00.000Z'),

  ('mem_daily_06', 'demo@example.com',
   '会社の健康診断だった。朝ごはん抜きがつらかった。',
   '2025-10-03', 'day', NULL, NULL, '2025-10-03T03:45:00.000Z', '2025-10-03T03:45:00.000Z'),

  ('mem_daily_07', 'demo@example.com',
   '初詣の帰りに甘酒を飲んだ。思ったより人が少なかった。',
   '2026-01-04', 'day', NULL, NULL, '2026-01-04T05:20:00.000Z', '2026-01-04T05:20:00.000Z'),

  ('mem_daily_08', 'demo@example.com',
   '近所の公園でゆきと弁当を食べた。風が強くて、レジャーシートが飛びそうになった。',
   '2026-04-06', 'day', NULL, NULL, '2026-04-06T04:00:00.000Z', '2026-04-06T04:00:00.000Z'),

  ('mem_daily_09', 'demo@example.com',
   '冷蔵庫が壊れた。新しいのを注文したけど、届くのは来週。',
   '2026-07-19', 'day', NULL, NULL, '2026-07-19T11:00:00.000Z', '2026-07-19T11:00:00.000Z'),

  ('mem_daily_10', 'demo@example.com',
   '仕事帰りに雨に降られた。傘を会社に忘れてきた。',
   '2026-09-28', 'day', NULL, NULL, '2026-09-28T10:30:00.000Z', '2026-09-28T10:30:00.000Z'),

  ('mem_daily_11', 'demo@example.com',
   '古い写真を整理していたら、半日たっていた。',
   '2026-10-01', 'month', NULL, NULL, '2026-10-12T09:00:00.000Z', '2026-10-12T09:00:00.000Z'),

  ('mem_daily_12', 'demo@example.com',
   '新しい靴を買った。少しきつい。',
   NULL, 'unknown', NULL, NULL, '2026-10-25T09:30:00.000Z', '2026-10-25T09:30:00.000Z');

-- 他ユーザーの記憶（1 件）。invalid/recall-related-other-user.json の検証用。想起の入力には絶対に含まれない。
INSERT INTO memories (id, user_id, body, happened_on, happened_on_precision, photo_key, photo_content_type, created_at, updated_at) VALUES
  ('mem_other_01', 'other@example.com',
   '梅酒を漬けた。青梅と氷砂糖を交互に入れた。',
   '2025-06-08', 'day', NULL, NULL, '2025-06-08T09:00:00.000Z', '2025-06-08T09:00:00.000Z');

-- ---------------------------------------------------------------
-- 確定済みの事実（source='user' は evidence NULL。source='ai' は evidence 必須）
-- confirmed だけが想起の入力（facts 属性）に乗る。rejected は画面に出ないが記録は残る。
-- ---------------------------------------------------------------
INSERT INTO memory_facts (id, memory_id, kind, value, status, source, evidence, created_at, decided_at) VALUES
  -- mem_d1_01 おばあちゃんの梅干し
  ('fact_d1_01_person', 'mem_d1_01', 'person', 'おばあちゃん', 'confirmed', 'user', NULL,
   '2024-06-15T10:01:00.000Z', '2024-06-15T10:01:00.000Z'),
  ('fact_d1_01_thing',  'mem_d1_01', 'thing',  '梅干し',       'confirmed', 'user', NULL,
   '2024-06-15T10:01:00.000Z', '2024-06-15T10:01:00.000Z'),
  ('fact_d1_01_place',  'mem_d1_01', 'place',  '縁側',         'confirmed', 'ai',   '縁側で梅干しを漬けていた',
   '2024-06-15T10:00:30.000Z', '2024-06-15T10:02:00.000Z'),
  ('fact_d1_01_date',   'mem_d1_01', 'date',   '2024-06',      'confirmed', 'ai',   '毎年6月になると',
   '2024-06-15T10:00:30.000Z', '2024-06-15T10:02:00.000Z'),

  -- mem_d1_02 こたつとみかん
  ('fact_d1_02_person', 'mem_d1_02', 'person', 'おばあちゃん', 'confirmed', 'user', NULL,
   '2025-01-12T08:31:00.000Z', '2025-01-12T08:31:00.000Z'),

  -- mem_d4_01 はるとの三輪車
  ('fact_d4_01_person', 'mem_d4_01', 'person', 'はると',       'confirmed', 'user', NULL,
   '2024-04-14T07:16:00.000Z', '2024-04-14T07:16:00.000Z'),
  ('fact_d4_01_thing',  'mem_d4_01', 'thing',  '三輪車',       'confirmed', 'user', NULL,
   '2024-04-14T07:16:00.000Z', '2024-04-14T07:16:00.000Z'),
  ('fact_d4_01_place',  'mem_d4_01', 'place',  '公園',         'confirmed', 'ai',   '公園の坂道で',
   '2024-04-14T07:15:30.000Z', '2024-04-14T07:17:00.000Z'),

  -- mem_d4_02 はじめての「ばあば」
  ('fact_d4_02_person1', 'mem_d4_02', 'person', 'はると',       'confirmed', 'user', NULL,
   '2024-02-20T11:31:00.000Z', '2024-02-20T11:31:00.000Z'),
  ('fact_d4_02_person2', 'mem_d4_02', 'person', 'おばあちゃん', 'confirmed', 'user', NULL,
   '2024-02-20T11:31:00.000Z', '2024-02-20T11:31:00.000Z'),

  -- mem_daily_05 ゆきと喫茶店
  ('fact_daily_05_person', 'mem_daily_05', 'person', 'ゆき',       'confirmed', 'user', NULL,
   '2025-05-11T06:01:00.000Z', '2025-05-11T06:01:00.000Z'),
  ('fact_daily_05_place',  'mem_daily_05', 'place',  '駅前の喫茶店', 'candidate', 'ai', '駅前の喫茶店で',
   '2025-05-11T06:00:30.000Z', NULL),

  -- mem_daily_08 公園で弁当（place は確定、「ゆき」の候補は却下した例）
  ('fact_daily_08_place',  'mem_daily_08', 'place',  '公園',  'confirmed', 'ai', '近所の公園で',
   '2026-04-06T04:00:30.000Z', '2026-04-06T04:02:00.000Z'),
  ('fact_daily_08_thing',  'mem_daily_08', 'thing',  '弁当',  'rejected',  'ai', '弁当を食べた',
   '2026-04-06T04:00:30.000Z', '2026-04-06T04:02:00.000Z');

-- ---------------------------------------------------------------
-- 過去に出た「そういえば。」の札（S3 の履歴と F6 の反応の表示確認用）
-- 人物が同じだけの組は原則 2 に反するので、本当に関係のある組（ゆきと食事）にしてある。
-- memory_id が新しい側、related_memory_id が思い出された側。evidence は related 側本文の逐語引用。
-- ---------------------------------------------------------------
INSERT INTO recalls (id, memory_id, related_memory_id, reason, evidence, feedback, created_at) VALUES
  ('recall_seed_01', 'mem_daily_08', 'mem_daily_05',
   'ゆきと一緒にごはんを食べた記憶',
   'ゆきと駅前の喫茶店でパンケーキを食べた',
   'helpful', '2026-04-06T04:00:40.000Z');

-- ---------------------------------------------------------------
-- Claude 呼び出しの記録（画面には出ない。pending 判定が false になることの確認用）
-- ---------------------------------------------------------------
INSERT INTO ai_runs (id, user_id, memory_id, kind, model, status, input_tokens, output_tokens, error, created_at, finished_at) VALUES
  ('run_seed_01', 'demo@example.com', 'mem_daily_08', 'facts',  'claude-opus-5-5', 'succeeded', 820,  96, NULL,
   '2026-04-06T04:00:05.000Z', '2026-04-06T04:00:30.000Z'),
  ('run_seed_02', 'demo@example.com', 'mem_daily_08', 'recall', 'claude-opus-5-5', 'succeeded', 2410, 120, NULL,
   '2026-04-06T04:00:05.000Z', '2026-04-06T04:00:40.000Z'),
  ('run_seed_03', 'demo@example.com', 'mem_daily_12', 'recall', 'claude-opus-5-5', 'empty', 3120, 18, NULL,
   '2026-10-25T09:30:05.000Z', '2026-10-25T09:30:11.000Z');
