// ことばの地図で Claude を呼ぶ所（ADR-0014）。POST /api/keywords の中で同期に 1 回だけ呼ぶ（再試行しない）。
// ai_runs には kind='retrospect'（memory_id は NULL）で残す。Claude の答えを確かめて（verifyKeywords）、言葉の一覧だけを R2 に置く。
// 失敗したら R2 には触らない（前の地図はそのまま残る）。例外は握って failed にする（静かな失敗。architecture 6.6）
import { finishAiRun, startAiRun } from "../db/ai_runs";
import type { Env } from "../env";
import type { CountMemory } from "../keywords/count";
import { type StoredMap, writeStoredMap } from "../keywords/store";
import { countChars } from "../validate";
import { type AiCaller, callClaude, type Effort } from "./client";
import { KEYWORDS_SYSTEM, keywordsUserMessage } from "./prompts";
import { KEYWORDS_SCHEMA } from "./schemas";
import { verifyKeywords } from "./verify";

// 渡すのは新しい順に 200 件まで。ただし本文の合計が 60,000 字を越える前で止める（1 件 2,000 字までなので、長い記憶が続いても待ち時間と量を抑える）
export const KEYWORDS_INPUT_LIMIT = 200;
export const KEYWORDS_INPUT_CHARS = 60_000;
// 全記憶を一度に読むので、ほかの呼び出し（20 秒）より長く待つ
export const KEYWORDS_TIMEOUT_MS = 60_000;

export type KeywordsDeps = { call?: AiCaller; now?: () => Date; effort?: Effort };

/** 新しい順に、本文の合計が maxChars に収まるところまで（1 件目は必ず入れる） */
export const pickForPrompt = <T extends Pick<CountMemory, "body">>(rows: readonly T[], maxChars = KEYWORDS_INPUT_CHARS): T[] => {
  const out: T[] = [];
  let total = 0;
  for (const r of rows) {
    const n = countChars(r.body);
    if (out.length > 0 && total + n > maxChars) break;
    out.push(r);
    total += n;
  }
  return out;
};

export type CollectResult = { ok: true; stored: StoredMap } | { ok: false; error: string };

/**
 * memories: Claude に渡す記憶（新しい順）。memoryCount: いまの記憶の総数（R2 に残す）。previous: いま置いてある地図。
 * 言葉が 1 つも残らなかったとき、前の地図があれば上書きしない（ok: false）。前の地図が無ければ空の地図を置く（画面は「もう少し書きためると」）
 */
export async function collectKeywords(
  env: Env,
  userId: string,
  memories: readonly CountMemory[],
  memoryCount: number,
  previous: StoredMap | null,
  deps: KeywordsDeps = {},
): Promise<CollectResult> {
  const call = deps.call ?? callClaude;
  const nowIso = () => (deps.now ? deps.now() : new Date()).toISOString();
  // 地図の時刻は記憶を読んだとき（待っている間に書いた記憶は「新しいひとこと」として数える）
  const generatedAt = nowIso();
  const runId = await startAiRun(env.DB, { userId, memoryId: null, kind: "retrospect", model: env.ANTHROPIC_MODEL, now: generatedAt });
  try {
    const res = await call(env, {
      system: KEYWORDS_SYSTEM,
      user: keywordsUserMessage(memories),
      schema: KEYWORDS_SCHEMA as unknown as Record<string, unknown>,
      effort: deps.effort ?? "low",
      timeout_ms: KEYWORDS_TIMEOUT_MS,
    });
    if (!res.ok) {
      await finishAiRun(env.DB, runId, { status: "failed", error: res.error, input_tokens: res.input_tokens, output_tokens: res.output_tokens, model: res.model, now: nowIso() });
      return { ok: false, error: res.error };
    }
    const { items, stats } = verifyKeywords(res.json, memories.map((m) => m.body));
    // ログに個人の識別子（メールアドレス）は出さない。手がかりは ai_runs の id
    if (stats.dropped.length) console.log("keywords dropped", runId, JSON.stringify(stats.dropped.map((d) => d.reason)));
    const usage = { input_tokens: res.input_tokens, output_tokens: res.output_tokens, model: res.model };
    if (items.length === 0 && previous) {
      await finishAiRun(env.DB, runId, { status: "empty", ...usage, now: nowIso() });
      return { ok: false, error: "empty" };
    }
    const stored: StoredMap = { version: 1, generated_at: generatedAt, memory_count: memoryCount, keywords: items };
    await writeStoredMap(env.PHOTOS, userId, stored);
    await finishAiRun(env.DB, runId, { status: items.length === 0 ? "empty" : "succeeded", ...usage, now: nowIso() });
    return { ok: true, stored };
  } catch (e) {
    console.error("collectKeywords failed", runId, e instanceof Error ? e.message : String(e));
    try {
      await finishAiRun(env.DB, runId, { status: "failed", error: e instanceof Error ? e.message : String(e), now: nowIso() });
    } catch {
      /* 無視 */
    }
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
