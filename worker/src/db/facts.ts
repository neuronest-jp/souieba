// memory_facts: 候補（AI）と確定（ユーザー）。
import type { FactRow } from "./memories";
import type { VerifiedFact } from "../ai/verify";

export async function insertCandidateFacts(db: D1Database, memoryId: string, facts: VerifiedFact[], now: string): Promise<void> {
  if (facts.length === 0) return;
  const stmts = facts.map((f) =>
    db
      .prepare("INSERT INTO memory_facts (id, memory_id, kind, value, status, source, evidence, created_at) VALUES (?1, ?2, ?3, ?4, 'candidate', 'ai', ?5, ?6)")
      .bind(crypto.randomUUID(), memoryId, f.kind, f.value, f.evidence, now),
  );
  await db.batch(stmts);
}

// 所有者のものだけ。memories を JOIN して user_id で絞る。
export async function getFactForUser(db: D1Database, userId: string, factId: string): Promise<FactRow | null> {
  return db
    .prepare(
      "SELECT f.id, f.memory_id, f.kind, f.value, f.status, f.source, f.evidence, f.created_at, f.decided_at FROM memory_facts f JOIN memories m ON m.id = f.memory_id WHERE f.id = ?1 AND m.user_id = ?2",
    )
    .bind(factId, userId)
    .first<FactRow>();
}

export async function decideFact(db: D1Database, factId: string, status: "confirmed" | "rejected", now: string): Promise<void> {
  await db.prepare("UPDATE memory_facts SET status = ?2, decided_at = ?3 WHERE id = ?1").bind(factId, status, now).run();
}

export async function listConfirmedFactsByMemory(db: D1Database, memoryIds: string[]): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  if (memoryIds.length === 0) return out;
  // D1 のバインド上限を避けるため 100 件ずつ
  for (let i = 0; i < memoryIds.length; i += 100) {
    const chunk = memoryIds.slice(i, i + 100);
    const placeholders = chunk.map((_, k) => `?${k + 1}`).join(",");
    const { results } = await db
      .prepare(`SELECT memory_id, kind, value FROM memory_facts WHERE status = 'confirmed' AND memory_id IN (${placeholders}) ORDER BY created_at`)
      .bind(...chunk)
      .all<{ memory_id: string; kind: string; value: string }>();
    for (const r of results ?? []) {
      const label = { person: "人物", place: "場所", date: "日付", thing: "もの" }[r.kind] ?? r.kind;
      const arr = out.get(r.memory_id) ?? [];
      arr.push(`${label}: ${r.value}`);
      out.set(r.memory_id, arr);
    }
  }
  return out;
}
