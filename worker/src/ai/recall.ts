// C1 想起の実行（architecture 6.2 / 6.5 / 6.6）。
import { listConfirmedFactsByMemory } from "../db/facts";
import { finishAiRun, startAiRun } from "../db/ai_runs";
import type { MemoryRow } from "../db/memories";
import { insertRecalls, listPastMemories, PAST_LIMIT_DEFAULT } from "../db/recalls";
import type { Env } from "../env";
import { type AiCaller, callClaude } from "./client";
import { RECALL_SYSTEM, recallUserMessage, type PastMemoryForPrompt } from "./prompts";
import { RECALL_SCHEMA } from "./schemas";
import { verifyRecall } from "./verify";

export type RecallDeps = { call?: AiCaller; now?: () => Date; effort?: "low" | "medium" | "high"; pastLimit?: number };

// 同期部分: 過去記憶が 1 件以上あるときだけ running を作る。0 件なら null（ai_runs も作らない）。
export async function beginRecall(env: Env, userId: string, memory: MemoryRow, deps: RecallDeps = {}): Promise<{ runId: string; past: MemoryRow[] } | null> {
  const past = await listPastMemories(env.DB, userId, memory.id, deps.pastLimit ?? PAST_LIMIT_DEFAULT);
  if (past.length === 0) return null;
  const now = (deps.now ? deps.now() : new Date()).toISOString();
  const runId = await startAiRun(env.DB, { userId, memoryId: memory.id, kind: "recall", model: env.ANTHROPIC_MODEL, now });
  return { runId, past };
}

export async function runRecall(env: Env, runId: string, memory: MemoryRow, past: MemoryRow[], deps: RecallDeps = {}): Promise<void> {
  const call = deps.call ?? callClaude;
  const nowIso = () => (deps.now ? deps.now() : new Date()).toISOString();
  try {
    const facts = await listConfirmedFactsByMemory(env.DB, past.map((p) => p.id));
    const forPrompt: PastMemoryForPrompt[] = past.map((p) => ({ id: p.id, body: p.body, happened_on: p.happened_on, happened_on_precision: p.happened_on_precision, facts: facts.get(p.id) ?? [] }));
    const res = await call(env, { system: RECALL_SYSTEM, user: recallUserMessage(memory, forPrompt), schema: RECALL_SCHEMA as unknown as Record<string, unknown>, effort: deps.effort ?? "medium" });
    if (!res.ok) {
      await finishAiRun(env.DB, runId, { status: "failed", error: res.error, input_tokens: res.input_tokens, output_tokens: res.output_tokens, model: res.model, now: nowIso() });
      return;
    }
    const bodies = new Map(past.map((p) => [p.id, p.body]));
    const { items, stats } = verifyRecall(res.json, bodies, memory.id);
    if (stats.dropped.length) console.log("recall dropped", memory.id, JSON.stringify(stats.dropped.map((d) => d.reason)));
    if (items.length === 0) {
      await finishAiRun(env.DB, runId, { status: "empty", input_tokens: res.input_tokens, output_tokens: res.output_tokens, model: res.model, now: nowIso() });
      return;
    }
    await insertRecalls(env.DB, memory.id, items, nowIso());
    await finishAiRun(env.DB, runId, { status: "succeeded", input_tokens: res.input_tokens, output_tokens: res.output_tokens, model: res.model, now: nowIso() });
  } catch (e) {
    console.error("runRecall failed", memory.id, e);
    try {
      await finishAiRun(env.DB, runId, { status: "failed", error: e instanceof Error ? e.message : String(e), now: nowIso() });
    } catch {
      /* 無視 */
    }
  }
}
