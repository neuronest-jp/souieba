-- そういえば。 初期スキーマ
-- 日時は ISO 8601 文字列（UTC）。ID は UUID 文字列。

CREATE TABLE users (
  id            TEXT PRIMARY KEY,              -- メールアドレス（Cloudflare Access の email）
  display_name  TEXT,
  created_at    TEXT NOT NULL,
  last_seen_at  TEXT NOT NULL
);

CREATE TABLE memories (
  id                    TEXT PRIMARY KEY,
  user_id               TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body                  TEXT NOT NULL CHECK (length(body) BETWEEN 1 AND 2000),
  happened_on           TEXT,                  -- 'YYYY-MM-DD'。precision が unknown のときは NULL
  happened_on_precision TEXT NOT NULL DEFAULT 'day'
                        CHECK (happened_on_precision IN ('day','month','year','unknown')),
  photo_key             TEXT,                  -- R2 のオブジェクトキー。無ければ NULL
  photo_content_type    TEXT,
  created_at            TEXT NOT NULL,
  updated_at            TEXT NOT NULL
);
CREATE INDEX idx_memories_user_happened ON memories(user_id, happened_on DESC, created_at DESC);

-- 人物・場所・日付・もの。AI が出すものは必ず candidate で入り、ユーザーが confirmed / rejected にする。
CREATE TABLE memory_facts (
  id          TEXT PRIMARY KEY,
  memory_id   TEXT NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
  kind        TEXT NOT NULL CHECK (kind IN ('person','place','date','thing')),
  value       TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'candidate'
              CHECK (status IN ('candidate','confirmed','rejected')),
  source      TEXT NOT NULL CHECK (source IN ('user','ai')),
  evidence    TEXT,                             -- 本文からの逐語引用。source='ai' のとき必須
  created_at  TEXT NOT NULL,
  decided_at  TEXT,
  CHECK (source = 'user' OR (evidence IS NOT NULL AND length(evidence) > 0))
);
CREATE INDEX idx_memory_facts_memory ON memory_facts(memory_id);

-- 「そういえば。」の札。memory_id が新しい記憶、related_memory_id が思い出された昔の記憶。
CREATE TABLE recalls (
  id                 TEXT PRIMARY KEY,
  memory_id          TEXT NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
  related_memory_id  TEXT NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
  reason             TEXT NOT NULL,             -- なぜ関係があるか（短文）
  evidence           TEXT NOT NULL,             -- related 側 body からの逐語引用
  feedback           TEXT NOT NULL DEFAULT 'none'
                     CHECK (feedback IN ('none','helpful','not_related')),
  created_at         TEXT NOT NULL,
  UNIQUE (memory_id, related_memory_id)
);
CREATE INDEX idx_recalls_memory ON recalls(memory_id);

-- Claude 呼び出しの記録。画面には出さない。
CREATE TABLE ai_runs (
  id             TEXT PRIMARY KEY,
  user_id        TEXT NOT NULL,
  memory_id      TEXT,
  kind           TEXT NOT NULL CHECK (kind IN ('recall','facts','photo','retrospect')),
  model          TEXT NOT NULL,
  status         TEXT NOT NULL CHECK (status IN ('running','succeeded','failed','empty')),
  input_tokens   INTEGER,
  output_tokens  INTEGER,
  error          TEXT,
  created_at     TEXT NOT NULL,
  finished_at    TEXT
);
CREATE INDEX idx_ai_runs_memory ON ai_runs(memory_id);
