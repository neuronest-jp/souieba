// C2 候補抽出の実行（architecture 6.3 / 6.5 / 6.6）。
import { insertCandidateFacts } from "../db/facts";
import { finishAiRun, startAiRun } from "../db/ai_runs";
import type { MemoryRow } from "../db/memories";
import type { Env } from "../env";
import { type AiCaller, callClaude } from "./client";
import { FACTS_SYSTEM, factsUserMessage } from "./prompts";
import { FACTS_SCHEMA } from "./schemas";
import { verifyFacts } from "./verify";

export type FactsDeps = { call?: AiCaller; now?: () => Date; effort?: "low" | "medium" | "high" };

// 同期部分: ai_runs に running を作る（201 の前に呼ぶ）。
export async function beginFacts(env: Env, userId: string, memory: MemoryRow, deps: FactsDeps = {}): Promise<string> {
  const now = (deps.now ? deps.now() : new Date()).toISOString();
  return startAiRun(env.DB, { userId, memoryId: memory.id, kind: "facts", model: env.ANTHROPIC_MODEL, now });
}

// 非同期部分: Claude を呼び、検証して保存する（waitUntil の中）。例外は握って failed にする。
export async function runFacts(env: Env, runId: string, memory: MemoryRow, deps: FactsDeps = {}): Promise<void> {
  const call = deps.call ?? callClaude;
  const nowIso = () => (deps.now ? deps.now() : new Date()).toISOString();
  try {
    const res = await call(env, { system: FACTS_SYSTEM, user: factsUserMessage(memory), schema: FACTS_SCHEMA as unknown as Record<string, unknown>, effort: deps.effort ?? "low" });
    if (!res.ok) {
      await finishAiRun(env.DB, runId, { status: "failed", error: res.error, input_tokens: res.input_tokens, output_tokens: res.output_tokens, model: res.model, now: nowIso() });
      return;
    }
    // 起きた日の扱いはプロンプト（happenedAttr）と同じ: 精度が unknown なら不明
    const happenedOn = memory.happened_on_precision === "unknown" ? null : memory.happened_on;
    const { items, stats } = verifyFacts(res.json, memory.body, happenedOn);
    if (stats.dropped.length) console.log("facts dropped", memory.id, JSON.stringify(stats.dropped.map((d) => d.reason)));
    if (items.length === 0) {
      await finishAiRun(env.DB, runId, { status: "empty", input_tokens: res.input_tokens, output_tokens: res.output_tokens, model: res.model, now: nowIso() });
      return;
    }
    await insertCandidateFacts(env.DB, memory.id, items, nowIso());
    await finishAiRun(env.DB, runId, { status: "succeeded", input_tokens: res.input_tokens, output_tokens: res.output_tokens, model: res.model, now: nowIso() });
  } catch (e) {
    // 記憶が先に削除された場合の外部キー失敗なども、ここで握って failed にする
    console.error("runFacts failed", memory.id, e);
    try {
      await finishAiRun(env.DB, runId, { status: "failed", error: e instanceof Error ? e.message : String(e), now: nowIso() });
    } catch {
      /* ai_runs 自体が消えている等 */
    }
  }
}
