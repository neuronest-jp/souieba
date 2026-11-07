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

// ---------------------------------------------------------------
// GET /api/connections（つながり）。listConnections と listBeads は束ねた文（D1PreparedStatement）を返し、
// 呼ぶ側が db.batch([...]) で 1 往復にまとめる。
// ---------------------------------------------------------------

export const CONNECTIONS_LIMIT = 50;
export const BEADS_LIMIT = 500;

// 一組 = 一本の糸。m が書いたひとこと（新しい側 = recalls.memory_id）、rm が思い出された昔のひとこと。
// memories.ts の RECALL_JOIN_COLUMNS は m を相手側に使うので、ここでは使わない（m / rm の向きが逆になる）。
export type ConnectionRow = {
  id: string;
  reason: string;
  evidence: string;
  feedback: "none" | "helpful";
  created_at: string;
  m_id: string;
  m_body: string;
  m_happened_on: string | null;
  m_happened_on_precision: MemoryRow["happened_on_precision"];
  m_photo_key: string | null;
  rm_id: string;
  rm_body: string;
  rm_happened_on: string | null;
  rm_happened_on_precision: MemoryRow["happened_on_precision"];
  rm_photo_key: string | null;
};

export type BeadRow = {
  happened_on: string;
  happened_on_precision: Exclude<MemoryRow["happened_on_precision"], "unknown">;
};

// recalls には user_id が無いので、両端の memories で user_id を絞る（X-11）。片側だけ他人の記憶の札も出さない。
// not_related は出さない（原則 1・2。S3 で「関係ないかも」を外せば、またここに出る）。
// 文の頭は SELECT のままにする（テスト用 D1 の batch は先頭の SELECT で読み取りかどうかを見分ける）
export function listConnections(db: D1Database, userId: string, limit: number = CONNECTIONS_LIMIT): D1PreparedStatement {
  return db
    .prepare(
      "SELECT r.id, r.reason, r.evidence, r.feedback, r.created_at, " +
        "m.id AS m_id, m.body AS m_body, m.happened_on AS m_happened_on, m.happened_on_precision AS m_happened_on_precision, m.photo_key AS m_photo_key, " +
        "rm.id AS rm_id, rm.body AS rm_body, rm.happened_on AS rm_happened_on, rm.happened_on_precision AS rm_happened_on_precision, rm.photo_key AS rm_photo_key " +
        "FROM recalls r JOIN memories m ON m.id = r.memory_id JOIN memories rm ON rm.id = r.related_memory_id " +
        "WHERE m.user_id = ?1 AND rm.user_id = ?1 AND r.feedback != 'not_related' " +
        "ORDER BY r.created_at DESC, r.id DESC LIMIT ?2",
    )
    .bind(userId, limit);
}

// 糸の帯の粒: 起きた日がわかっている記憶の日付だけ（unknown は happened_on が NULL なので外れる）。
// 新しい順に 500 まで（idx_memories_user_happened を使う）
export function listBeads(db: D1Database, userId: string, limit: number = BEADS_LIMIT): D1PreparedStatement {
  return db
    .prepare(
      "SELECT happened_on, happened_on_precision FROM memories " +
        "WHERE user_id = ?1 AND happened_on IS NOT NULL AND happened_on_precision != 'unknown' " +
        "ORDER BY happened_on DESC LIMIT ?2",
    )
    .bind(userId, limit);
}
