// ai_runs: Claude 呼び出しの記録。POST の中で running を同期 INSERT し、waitUntil の中で結果に更新する。
export type AiRunKind = "recall" | "facts" | "photo" | "retrospect";
export type AiRunStatus = "running" | "succeeded" | "failed" | "empty";

// memoryId は記憶ごとの処理（recall / facts / photo）で入れる。記憶をまたぐ処理（retrospect。ことばの地図、ADR-0014）は null
export async function startAiRun(db: D1Database, args: { userId: string; memoryId: string | null; kind: AiRunKind; model: string; now: string }): Promise<string> {
  const id = crypto.randomUUID();
  await db
    .prepare("INSERT INTO ai_runs (id, user_id, memory_id, kind, model, status, created_at) VALUES (?1, ?2, ?3, ?4, ?5, 'running', ?6)")
    .bind(id, args.userId, args.memoryId, args.kind, args.model, args.now)
    .run();
  return id;
}

export async function finishAiRun(
  db: D1Database,
  id: string,
  result: { status: Exclude<AiRunStatus, "running">; error?: string | null; input_tokens?: number | null; output_tokens?: number | null; model?: string; now: string },
): Promise<void> {
  await db
    .prepare("UPDATE ai_runs SET status = ?2, error = ?3, input_tokens = ?4, output_tokens = ?5, finished_at = ?6, model = COALESCE(?7, model) WHERE id = ?1")
    .bind(id, result.status, result.error ? result.error.slice(0, 500) : null, result.input_tokens ?? null, result.output_tokens ?? null, result.now, result.model ?? null)
    .run();
}

// この記憶にこの kind の記録が（状態を問わず）既にあるか。同じ memory_id・kind の 2 行目を作らないために使う（requirements N-5）
export async function hasAiRun(db: D1Database, memoryId: string, kind: AiRunKind): Promise<boolean> {
  const row = await db.prepare("SELECT 1 AS x FROM ai_runs WHERE memory_id = ?1 AND kind = ?2 LIMIT 1").bind(memoryId, kind).first<{ x: number }>();
  return row !== null;
}
