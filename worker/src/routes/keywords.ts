// /api/keywords（ことばの地図。ADR-0014、architecture 第13節）。
//   POST: その人の記憶を新しい順に読み、Claude に言葉を選ばせて R2 に置き、数え直した地図を返す（同期。Claude を 1 回呼ぶ）
//   GET:  R2 の言葉の一覧を、いまの D1 の本文で数え直して地図を返す（Claude は呼ばない）
// 返す形はどちらも { map, stale_count, memory_count, reason? }（POST は refreshed も）。自分の記憶だけを読む（X-11）
import { Hono } from "hono";
import { collectKeywords, KEYWORDS_INPUT_LIMIT, pickForPrompt, type KeywordsDeps } from "../ai/keywords";
import { countWrittenAfter, listForCount, listForKeywords } from "../db/keywords";
import { countMemories } from "../db/memories";
import type { Env, Variables } from "../env";
import { ApiError } from "../errors";
import { buildKeywordMap, type CountMemory, type KeywordMap } from "../keywords/count";
import { readStoredMap, type StoredMap } from "../keywords/store";

// 記憶がこれより少ないうちは Claude を呼ばない（くり返し出てくる言葉がまだ無い）
export const KEYWORDS_MIN_MEMORIES = 8;
// 数え直しに読む記憶の上限（新しい順）
export const KEYWORDS_COUNT_LIMIT = 2000;

export type KeywordsResponse = {
  map: KeywordMap | null;
  stale_count: number;
  memory_count: number;
  reason?: "few";
  refreshed?: boolean;
};

const nOf = (r: D1Result | undefined): number => ((r?.results ?? [])[0] as { n?: number } | undefined)?.n ?? 0;

/** stored を渡さなければ R2 から読む */
export async function mapResponse(env: Env, userId: string, stored?: StoredMap | null): Promise<KeywordsResponse> {
  const s = stored === undefined ? await readStoredMap(env.PHOTOS, userId) : stored;
  if (!s) {
    const row = await countMemories(env.DB, userId).first<{ n: number }>();
    const memoryCount = row?.n ?? 0;
    return { map: null, stale_count: 0, memory_count: memoryCount, ...(memoryCount < KEYWORDS_MIN_MEMORIES ? { reason: "few" as const } : {}) };
  }
  // 数と件数と本文を 1 往復で読む（D1 の batch は 1 トランザクション。読みが食い違わない）
  const [count, stale, rows] = await env.DB.batch([
    countMemories(env.DB, userId),
    countWrittenAfter(env.DB, userId, s.generated_at),
    listForCount(env.DB, userId, KEYWORDS_COUNT_LIMIT),
  ]);
  const memoryCount = nOf(count);
  return {
    map: buildKeywordMap(s, (rows?.results ?? []) as CountMemory[]),
    stale_count: nOf(stale),
    memory_count: memoryCount,
    ...(memoryCount < KEYWORDS_MIN_MEMORIES ? { reason: "few" as const } : {}),
  };
}

export const keywordsRoute = (deps: KeywordsDeps = {}) => {
  const app = new Hono<{ Bindings: Env; Variables: Variables }>();

  app.get("/", async (c) => c.json(await mapResponse(c.env, c.get("user").id)));

  app.post("/", async (c) => {
    const user = c.get("user");
    const [count, rows] = await c.env.DB.batch([countMemories(c.env.DB, user.id), listForKeywords(c.env.DB, user.id, KEYWORDS_INPUT_LIMIT)]);
    const memoryCount = nOf(count);
    if (memoryCount < KEYWORDS_MIN_MEMORIES) throw new ApiError(400, "few", "もう少し書きためると、ことばの地図ができます");
    const previous = await readStoredMap(c.env.PHOTOS, user.id);
    const memories = pickForPrompt((rows?.results ?? []) as CountMemory[]);
    const work = collectKeywords(c.env, user.id, memories, memoryCount, previous, deps);
    // 待っている間に画面を離れて接続が切れても、集めた地図は置いておく（次に開いたとき GET で出る）
    try {
      c.executionCtx.waitUntil(work);
    } catch {
      /* ExecutionContext の無い呼び出し（テストの一部）ではそのまま待つ */
    }
    const result = await work;
    if (result.ok) return c.json({ ...(await mapResponse(c.env, user.id, result.stored)), refreshed: true } satisfies KeywordsResponse);
    // Claude の失敗では地図を壊さない。前の地図があればそれを返す（画面は「集めなおせませんでした」と添えて、地図はそのまま）
    if (previous) return c.json({ ...(await mapResponse(c.env, user.id, previous)), refreshed: false } satisfies KeywordsResponse);
    throw new ApiError(502, "unavailable", "いまは、ことばを集められませんでした。少し待ってからもう一度どうぞ");
  });

  return app;
};
