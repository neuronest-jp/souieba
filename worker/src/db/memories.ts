// memories の D1 アクセス層。全クエリに user_id の条件を付ける（X-11）。
import type { Cursor } from "../cursor";
import type { MemoryInput } from "../validate";

export type MemoryRow = {
  id: string;
  user_id: string;
  body: string;
  happened_on: string | null;
  happened_on_precision: "day" | "month" | "year" | "unknown";
  photo_key: string | null;
  photo_content_type: string | null;
  created_at: string;
  updated_at: string;
};

export type FactRow = {
  id: string;
  memory_id: string;
  kind: "person" | "place" | "date" | "thing";
  value: string;
  status: "candidate" | "confirmed" | "rejected";
  source: "user" | "ai";
  evidence: string | null;
  created_at: string;
  decided_at: string | null;
};

export type RecallRow = {
  id: string;
  memory_id: string;
  related_memory_id: string;
  reason: string;
  evidence: string;
  feedback: "none" | "helpful" | "not_related";
  created_at: string;
};

export const MEMORY_COLUMNS =
  "id, user_id, body, happened_on, happened_on_precision, photo_key, photo_content_type, created_at, updated_at";

export const LIST_LIMIT_DEFAULT = 20;
export const LIST_LIMIT_MAX = 50;

// 一覧の並び: 起きた日の降順、同じ日は作成の降順、不明（NULL）は最後。
export const LIST_ORDER = "ORDER BY COALESCE(happened_on,'') DESC, created_at DESC, id DESC";

// before: 一覧の始まり（年月で探す。validate.ts の parseListStart）。COALESCE(happened_on,'') がこれより小さい行から始める。
// cursor があれば cursor を優先する（続きの位置は cursor が持っている）
export const buildListSql = (cursor: Cursor | null, before: string | null = null): { sql: string; bindCount: number } => {
  const base = `SELECT ${MEMORY_COLUMNS} FROM memories WHERE user_id = ?1`;
  if (!cursor) {
    if (before !== null) return { sql: `${base} AND COALESCE(happened_on,'') < ?2 ${LIST_ORDER} LIMIT ?3`, bindCount: 3 };
    return { sql: `${base} ${LIST_ORDER} LIMIT ?2`, bindCount: 2 };
  }
  // (h, c, i) より「前」（降順なので小さい側）の行だけ
  const cond =
    "(COALESCE(happened_on,'') < ?2 OR (COALESCE(happened_on,'') = ?2 AND created_at < ?3)" +
    " OR (COALESCE(happened_on,'') = ?2 AND created_at = ?3 AND id < ?4))";
  return { sql: `${base} AND ${cond} ${LIST_ORDER} LIMIT ?5`, bindCount: 5 };
};

export const clampLimit = (raw: string | undefined): number => {
  if (raw === undefined || raw === "") return LIST_LIMIT_DEFAULT;
  const n = Number(raw);
  if (!Number.isInteger(n)) return LIST_LIMIT_DEFAULT;
  return Math.min(LIST_LIMIT_MAX, Math.max(1, n));
};

export async function insertMemory(db: D1Database, userId: string, input: MemoryInput, now: string): Promise<MemoryRow> {
  const id = crypto.randomUUID();
  await db
    .prepare(
      `INSERT INTO memories (id, user_id, body, happened_on, happened_on_precision, photo_key, photo_content_type, created_at, updated_at)
       VALUES (?1, ?2, ?3, ?4, ?5, NULL, NULL, ?6, ?6)`,
    )
    .bind(id, userId, input.body, input.happened_on, input.happened_on_precision, now)
    .run();
  return {
    id,
    user_id: userId,
    body: input.body,
    happened_on: input.happened_on,
    happened_on_precision: input.happened_on_precision,
    photo_key: null,
    photo_content_type: null,
    created_at: now,
    updated_at: now,
  };
}

export async function listMemories(
  db: D1Database,
  userId: string,
  cursor: Cursor | null,
  limit: number,
  before: string | null = null,
): Promise<{ items: MemoryRow[]; nextCursor: Cursor | null }> {
  const { sql } = buildListSql(cursor, before);
  const stmt = cursor
    ? db.prepare(sql).bind(userId, cursor.h, cursor.c, cursor.i, limit + 1)
    : before !== null
      ? db.prepare(sql).bind(userId, before, limit + 1)
      : db.prepare(sql).bind(userId, limit + 1);
  const { results } = await stmt.all<MemoryRow>();
  const rows = results ?? [];
  const items = rows.slice(0, limit);
  const last = items[items.length - 1];
  const nextCursor = rows.length > limit && last ? { h: last.happened_on ?? "", c: last.created_at, i: last.id } : null;
  return { items, nextCursor };
}

export async function getMemory(db: D1Database, userId: string, id: string): Promise<MemoryRow | null> {
  return db.prepare(`SELECT ${MEMORY_COLUMNS} FROM memories WHERE id = ?1 AND user_id = ?2`).bind(id, userId).first<MemoryRow>();
}

// 消した行の photo_key を返す（消す行が無ければ null）。RETURNING で削除した時点の値を受け取るので、
// 直前に写真が差し替わっていても新しい方のキーが返る。
// 候補と札は ON DELETE CASCADE で消える。ai_runs（Claude 呼び出しの記録）は外部キーを持たないので、同じ batch で消す
// （原則 5「削除は即時」。batch は 1 トランザクションなので、記憶の削除が失敗すれば記録も残る）
export async function deleteMemory(db: D1Database, userId: string, id: string): Promise<{ photo_key: string | null } | null> {
  const [, deleted] = await db.batch([
    db.prepare("DELETE FROM ai_runs WHERE memory_id = ?1 AND user_id = ?2").bind(id, userId),
    db.prepare("DELETE FROM memories WHERE id = ?1 AND user_id = ?2 RETURNING photo_key").bind(id, userId),
  ]);
  return ((deleted?.results ?? []) as Array<{ photo_key: string | null }>)[0] ?? null;
}

export async function listFacts(db: D1Database, memoryId: string): Promise<FactRow[]> {
  const { results } = await db
    .prepare("SELECT id, memory_id, kind, value, status, source, evidence, created_at, decided_at FROM memory_facts WHERE memory_id = ?1 ORDER BY created_at, id")
    .bind(memoryId)
    .all<FactRow>();
  return results ?? [];
}

export type RecallWithMemory = RecallRow & {
  rm_id: string;
  rm_body: string;
  rm_happened_on: string | null;
  rm_happened_on_precision: MemoryRow["happened_on_precision"];
  rm_photo_key: string | null;
};

const RECALL_JOIN_COLUMNS =
  "r.id, r.memory_id, r.related_memory_id, r.reason, r.evidence, r.feedback, r.created_at, " +
  "m.id AS rm_id, m.body AS rm_body, m.happened_on AS rm_happened_on, m.happened_on_precision AS rm_happened_on_precision, m.photo_key AS rm_photo_key";

// この記憶を書いたときに浮かんだ札（相手 = 昔の記憶）
export async function listRecalls(db: D1Database, memoryId: string): Promise<RecallWithMemory[]> {
  const { results } = await db
    .prepare(`SELECT ${RECALL_JOIN_COLUMNS} FROM recalls r JOIN memories m ON m.id = r.related_memory_id WHERE r.memory_id = ?1 ORDER BY r.created_at, r.id`)
    .bind(memoryId)
    .all<RecallWithMemory>();
  return results ?? [];
}

// この記憶が思い出された側の札（相手 = 新しい記憶）
export async function listRecalledBy(db: D1Database, memoryId: string): Promise<RecallWithMemory[]> {
  const { results } = await db
    .prepare(`SELECT ${RECALL_JOIN_COLUMNS} FROM recalls r JOIN memories m ON m.id = r.memory_id WHERE r.related_memory_id = ?1 ORDER BY r.created_at DESC, r.id`)
    .bind(memoryId)
    .all<RecallWithMemory>();
  return results ?? [];
}

// AI 処理が進行中か。running の行が 60 秒以内にあれば true（古い running は done 扱い）。
export async function isPending(db: D1Database, memoryId: string, kind: "facts" | "recall" | "photo", now: string): Promise<boolean> {
  const since = new Date(new Date(now).getTime() - 60_000).toISOString();
  const row = await db
    .prepare("SELECT 1 AS x FROM ai_runs WHERE memory_id = ?1 AND kind = ?2 AND status = 'running' AND created_at > ?3 LIMIT 1")
    .bind(memoryId, kind, since)
    .first<{ x: number }>();
  return row !== null;
}

// ---------------------------------------------------------------
// GET /api/today（書く画面 S1 の「このごろ」「あの日のひとこと」と総数）。どれも束ねた文（D1PreparedStatement）を返し、
// 呼ぶ側（routes/today.ts）が db.batch([...]) で 1 往復にまとめる。文の頭は SELECT のままにする（テスト用 D1 の batch が見分ける）
// ---------------------------------------------------------------

export const WRITTEN_LIMIT = 500;
export const THAT_DAY_LIMIT = 50;

export type ThatDayRow = Pick<MemoryRow, "id" | "body" | "happened_on" | "happened_on_precision" | "photo_key">;

// [fromIso, toIso) に書いた（created_at）記憶の時刻。Asia/Tokyo の日付への読み替えは呼ぶ側がする
export function listWrittenAt(db: D1Database, userId: string, fromIso: string, toIso: string): D1PreparedStatement {
  return db
    .prepare("SELECT created_at FROM memories WHERE user_id = ?1 AND created_at >= ?2 AND created_at < ?3 ORDER BY created_at LIMIT ?4")
    .bind(userId, fromIso, toIso, WRITTEN_LIMIT);
}

// あの日のひとこと（日）: 起きた日が day 精度で、月日が monthDays（きょうの前後 3 日の MM-DD）のどれか、起きた日が latest 以前。
// beforeIso より前に書いたものだけ（きょう書いたものを、その場で「あの日」として返さない）
export function listThatDayNear(db: D1Database, userId: string, monthDays: string[], latest: string, beforeIso: string): D1PreparedStatement {
  const marks = monthDays.map((_, i) => `?${i + 4}`).join(",");
  return db
    .prepare(
      `SELECT id, body, happened_on, happened_on_precision, photo_key FROM memories WHERE user_id = ?1 AND happened_on_precision = 'day' ` +
        `AND happened_on <= ?2 AND created_at < ?3 AND substr(happened_on, 6, 5) IN (${marks}) ` +
        `ORDER BY happened_on DESC, id LIMIT ${THAT_DAY_LIMIT}`,
    )
    .bind(userId, latest, beforeIso, ...monthDays);
}

// あの日のひとこと（月）: 日の候補が無いときに使う。起きた日の月がきょうと同じで（day 精度と month 精度）、年が去年以前
export function listThatDayMonth(db: D1Database, userId: string, month: string, year: string, beforeIso: string): D1PreparedStatement {
  return db
    .prepare(
      "SELECT id, body, happened_on, happened_on_precision, photo_key FROM memories WHERE user_id = ?1 " +
        "AND happened_on_precision IN ('day','month') AND substr(happened_on, 6, 2) = ?2 AND substr(happened_on, 1, 4) < ?3 AND created_at < ?4 " +
        `ORDER BY happened_on DESC, id LIMIT ${THAT_DAY_LIMIT}`,
    )
    .bind(userId, month, year, beforeIso);
}

export function countMemories(db: D1Database, userId: string): D1PreparedStatement {
  return db.prepare("SELECT COUNT(*) AS n FROM memories WHERE user_id = ?1").bind(userId);
}

// ---------------------------------------------------------------
// GET /api/memories/months（S2 の「年月で探す」。ADR-0015）。起きた日の年月ごとの件数。どれも束ねた文で、呼ぶ側が db.batch で 1 往復にする。
// 区切りは画面と同じ: 精度 day と month はその年月、year は年だけ、日付の無いもの（unknown）は日付なし。どの行もどれか 1 つに入る
// ---------------------------------------------------------------

export function listMonthCounts(db: D1Database, userId: string): D1PreparedStatement {
  return db
    .prepare(
      "SELECT substr(happened_on, 1, 7) AS month, COUNT(*) AS n FROM memories WHERE user_id = ?1 " +
        "AND happened_on IS NOT NULL AND happened_on_precision IN ('day','month') GROUP BY month ORDER BY month DESC",
    )
    .bind(userId);
}

export function listYearOnlyCounts(db: D1Database, userId: string): D1PreparedStatement {
  return db
    .prepare(
      "SELECT substr(happened_on, 1, 4) AS year, COUNT(*) AS n FROM memories WHERE user_id = ?1 " +
        "AND happened_on IS NOT NULL AND happened_on_precision = 'year' GROUP BY year ORDER BY year DESC",
    )
    .bind(userId);
}

export function countUndated(db: D1Database, userId: string): D1PreparedStatement {
  return db
    .prepare("SELECT COUNT(*) AS n FROM memories WHERE user_id = ?1 AND (happened_on IS NULL OR happened_on_precision = 'unknown')")
    .bind(userId);
}
