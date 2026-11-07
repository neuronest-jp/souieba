// ことばの地図（ADR-0014）の D1 の読み。全クエリに user_id の条件を付ける（X-11）。
// 文の頭は SELECT のままにする（db.batch に束ねる。テスト用 D1 の batch が見分ける）
import { LIST_ORDER } from "./memories";
import type { CountMemory } from "../keywords/count";

export const KEYWORD_COLUMNS = "id, body, happened_on, happened_on_precision, created_at";

// Claude に渡す記憶（新しい順に limit 件まで。起きた日が「いつだったか」のものも入れる。並びは一覧と同じ）
export function listForKeywords(db: D1Database, userId: string, limit: number): D1PreparedStatement {
  return db.prepare(`SELECT ${KEYWORD_COLUMNS} FROM memories WHERE user_id = ?1 ${LIST_ORDER} LIMIT ?2`).bind(userId, limit);
}

// 数え直しに使う記憶（起きた日の年が分かるものだけ。新しい順に limit 件まで）
export function listForCount(db: D1Database, userId: string, limit: number): D1PreparedStatement {
  return db
    .prepare(
      `SELECT ${KEYWORD_COLUMNS} FROM memories WHERE user_id = ?1 AND happened_on IS NOT NULL AND happened_on_precision != 'unknown' ${LIST_ORDER} LIMIT ?2`,
    )
    .bind(userId, limit);
}

// 地図を作ったあとに書いた記憶の数（created_at が generated_at より後）
export function countWrittenAfter(db: D1Database, userId: string, sinceIso: string): D1PreparedStatement {
  return db.prepare("SELECT COUNT(*) AS n FROM memories WHERE user_id = ?1 AND created_at > ?2").bind(userId, sinceIso);
}

export type { CountMemory };
