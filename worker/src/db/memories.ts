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

export const buildListSql = (cursor: Cursor | null): { sql: string; bindCount: number } => {
  const base = `SELECT ${MEMORY_COLUMNS} FROM memories WHERE user_id = ?1`;
  if (!cursor) return { sql: `${base} ${LIST_ORDER} LIMIT ?2`, bindCount: 2 };
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
): Promise<{ items: MemoryRow[]; nextCursor: Cursor | null }> {
  const { sql } = buildListSql(cursor);
  const stmt = cursor
    ? db.prepare(sql).bind(userId, cursor.h, cursor.c, cursor.i, limit + 1)
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

export async function deleteMemory(db: D1Database, userId: string, id: string): Promise<boolean> {
  const r = await db.prepare("DELETE FROM memories WHERE id = ?1 AND user_id = ?2").bind(id, userId).run();
  return (r.meta?.changes ?? 0) > 0;
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
