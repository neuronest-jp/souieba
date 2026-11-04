// recalls: 「そういえば。」の札。
import type { VerifiedRecall } from "../ai/verify";
import type { MemoryRow, RecallRow } from "./memories";

export const PAST_LIMIT_DEFAULT = 200;

// 同一ユーザーの過去記憶（自分自身を除く、created_at DESC）。
export async function listPastMemories(db: D1Database, userId: string, excludeId: string, limit: number): Promise<MemoryRow[]> {
  const { results } = await db
    .prepare(
      "SELECT id, user_id, body, happened_on, happened_on_precision, photo_key, photo_content_type, created_at, updated_at FROM memories WHERE user_id = ?1 AND id != ?2 ORDER BY created_at DESC LIMIT ?3",
    )
    .bind(userId, excludeId, limit)
    .all<MemoryRow>();
  return results ?? [];
}

// UNIQUE (memory_id, related_memory_id) の衝突は INSERT OR IGNORE で無視する。
// 外部キー違反は OR IGNORE では無視されないため、Claude を待つ間に消された相手の札は先に除く（他の札を道連れにしない）。
export async function insertRecalls(db: D1Database, memoryId: string, recalls: VerifiedRecall[], now: string): Promise<void> {
  if (recalls.length === 0) return;
  const ids = recalls.map((r) => r.related_memory_id);
  const placeholders = ids.map((_, i) => `?${i + 1}`).join(",");
  const { results } = await db.prepare(`SELECT id FROM memories WHERE id IN (${placeholders})`).bind(...ids).all<{ id: string }>();
  const alive = new Set((results ?? []).map((r) => r.id));
  const kept = recalls.filter((r) => alive.has(r.related_memory_id));
  if (kept.length === 0) return;
  const stmts = kept.map((r) =>
    db
      .prepare("INSERT OR IGNORE INTO recalls (id, memory_id, related_memory_id, reason, evidence, feedback, created_at) VALUES (?1, ?2, ?3, ?4, ?5, 'none', ?6)")
      .bind(crypto.randomUUID(), memoryId, r.related_memory_id, r.reason, r.evidence, now),
  );
  await db.batch(stmts);
}

export async function getRecallForUser(db: D1Database, userId: string, recallId: string): Promise<RecallRow | null> {
  return db
    .prepare(
      "SELECT r.id, r.memory_id, r.related_memory_id, r.reason, r.evidence, r.feedback, r.created_at FROM recalls r JOIN memories m ON m.id = r.memory_id WHERE r.id = ?1 AND m.user_id = ?2",
    )
    .bind(recallId, userId)
    .first<RecallRow>();
}

export async function setRecallFeedback(db: D1Database, recallId: string, feedback: "none" | "helpful" | "not_related"): Promise<void> {
  await db.prepare("UPDATE recalls SET feedback = ?2 WHERE id = ?1").bind(recallId, feedback).run();
}
