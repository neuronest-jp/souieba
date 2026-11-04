// ai_runs: Claude 呼び出しの記録。POST の中で running を同期 INSERT し、waitUntil の中で結果に更新する。
export type AiRunKind = "recall" | "facts" | "photo" | "retrospect";
export type AiRunStatus = "running" | "succeeded" | "failed" | "empty";

export async function startAiRun(db: D1Database, args: { userId: string; memoryId: string; kind: AiRunKind; model: string; now: string }): Promise<string> {
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
