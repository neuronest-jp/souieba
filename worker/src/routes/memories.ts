// /api/memories の経路。requirements F2 / F3、architecture 5.3〜5.6、tasks J-7。
import { Hono } from "hono";
import { decodeCursor, encodeCursor } from "../cursor";
import {
  clampLimit,
  countUndated,
  deleteMemory,
  getMemory,
  insertMemory,
  isPending,
  listFacts,
  listMemories,
  listMonthCounts,
  listRecalledBy,
  listRecalls,
  listYearOnlyCounts,
  type MemoryRow,
  type RecallWithMemory,
} from "../db/memories";
import type { Env, Variables } from "../env";
import { ApiError } from "../errors";
import { parseListStart, parseMemoryInput, todayInTokyo } from "../validate";

export type MemoryJson = Omit<MemoryRow, "user_id">;

export const toMemoryJson = (m: MemoryRow): MemoryJson => ({
  id: m.id,
  body: m.body,
  happened_on: m.happened_on,
  happened_on_precision: m.happened_on_precision,
  photo_key: m.photo_key,
  photo_content_type: m.photo_content_type,
  created_at: m.created_at,
  updated_at: m.updated_at,
});

const recallJson = (r: RecallWithMemory, side: "related_memory" | "memory") => ({
  id: r.id,
  reason: r.reason,
  evidence: r.evidence,
  feedback: r.feedback,
  created_at: r.created_at,
  [side]: {
    id: r.rm_id,
    body: r.rm_body,
    happened_on: r.rm_happened_on,
    happened_on_precision: r.rm_happened_on_precision,
    photo_key: r.rm_photo_key,
  },
});

// 保存後の AI 処理（候補抽出と想起）の起動口。11/6 で中身を入れる。
export type AfterSave = (args: { env: Env; userId: string; memory: MemoryRow; waitUntil: (p: Promise<unknown>) => void }) => Promise<void>;
export const noAfterSave: AfterSave = async () => {};

export type MemoriesDeps = {
  afterSave?: AfterSave;
  now?: () => Date;
};

export const memoriesRoutes = (deps: MemoriesDeps = {}) => {
  const app = new Hono<{ Bindings: Env; Variables: Variables }>();
  const nowIso = () => (deps.now ? deps.now() : new Date()).toISOString();
  const afterSave = deps.afterSave ?? noAfterSave;

  app.post("/", async (c) => {
    const user = c.get("user");
    let json: unknown;
    try {
      json = await c.req.json();
    } catch {
      throw new ApiError(400, "validation", "本文がありません");
    }
    const input = parseMemoryInput(json, todayInTokyo(deps.now ? deps.now() : new Date()));
    const memory = await insertMemory(c.env.DB, user.id, input, nowIso());
    // 201 を返す前に AI 処理の記録を作る（afterSave 側の責務。waitUntil で続きを走らせる）。
    // ここで失敗しても記憶は保存済みなので 201 を返す。AI は「静かな失敗」（architecture 6.6）。
    try {
      await afterSave({ env: c.env, userId: user.id, memory, waitUntil: (p) => c.executionCtx.waitUntil(p) });
    } catch (e) {
      console.error("afterSave failed", memory.id, e);
    }
    return c.json(toMemoryJson(memory), 201);
  });

  // month / year / undated（年月で探す。ADR-0015）はその区切りのいちばん新しい行から始める。形の誤りは cursor があっても 400。
  // cursor があれば cursor を優先する（続きの位置は cursor が持つ。画面は続きを読むとき始まりを付けない）
  app.get("/", async (c) => {
    const user = c.get("user");
    const cursor = decodeCursor(c.req.query("cursor"));
    const before = parseListStart({ month: c.req.query("month"), year: c.req.query("year"), undated: c.req.query("undated") });
    const limit = clampLimit(c.req.query("limit"));
    const { items, nextCursor } = await listMemories(c.env.DB, user.id, cursor, limit, cursor ? null : before);
    return c.json({ items: items.map(toMemoryJson), next_cursor: nextCursor ? encodeCursor(nextCursor) : null });
  });

  // 起きた日の年月ごとの件数（新しい順）。自分の記憶だけ。/:id より先に置く（months を id として読まない）
  app.get("/months", async (c) => {
    const user = c.get("user");
    const [months, years, undated] = await c.env.DB.batch([
      listMonthCounts(c.env.DB, user.id),
      listYearOnlyCounts(c.env.DB, user.id),
      countUndated(c.env.DB, user.id),
    ]);
    return c.json({
      months: ((months?.results ?? []) as Array<{ month: string; n: number }>).map((r) => ({ month: r.month, count: Number(r.n) })),
      years_only: ((years?.results ?? []) as Array<{ year: string; n: number }>).map((r) => ({ year: r.year, count: Number(r.n) })),
      undated: Number(((undated?.results ?? []) as Array<{ n: number }>)[0]?.n ?? 0),
    });
  });

  app.get("/:id", async (c) => {
    const user = c.get("user");
    const id = c.req.param("id");
    const memory = await getMemory(c.env.DB, user.id, id);
    if (!memory) throw new ApiError(404, "not_found", "見つかりません");
    const now = nowIso();
    // pending を先に読み、items は後で読む（insert → finish の順にコミットされるため。facts.ts の GET を参照）。
    // facts の pending には写真からの気づき候補（kind='photo'）も入れる（GET /facts と同じ。requirements F7）
    const [textPending, photoPending, recallPending] = await Promise.all([
      isPending(c.env.DB, id, "facts", now),
      isPending(c.env.DB, id, "photo", now),
      isPending(c.env.DB, id, "recall", now),
    ]);
    const factsPending = textPending || photoPending;
    const [facts, recalls, recalledBy] = await Promise.all([listFacts(c.env.DB, id), listRecalls(c.env.DB, id), listRecalledBy(c.env.DB, id)]);
    return c.json({
      memory: toMemoryJson(memory),
      facts: { pending: factsPending, items: facts.map(({ memory_id: _m, ...f }) => f) },
      recalls: { pending: recallPending, items: recalls.map((r) => recallJson(r, "related_memory")) },
      recalled_by: { items: recalledBy.map((r) => recallJson(r, "memory")) },
    });
  });

  app.delete("/:id", async (c) => {
    const user = c.get("user");
    const id = c.req.param("id");
    const memory = await getMemory(c.env.DB, user.id, id);
    if (!memory) throw new ApiError(404, "not_found", "見つかりません");
    // D1 を先に消し、成功してから R2 の写真を消す。D1 が失敗したら 500 で、記憶も写真も残る（F3「削除失敗は記憶を残したまま」）。
    // 間に並行して消されていたら deleted は null。もう無いので 204 のまま返す。
    const deleted = await deleteMemory(c.env.DB, user.id, id);
    if (deleted?.photo_key) {
      try {
        await c.env.PHOTOS.delete(deleted.photo_key);
      } catch (e) {
        // D1 の行はもう無く、写真は誰からも参照されない（キーは推測できない）。ログに残して続ける
        console.error("photo delete failed", deleted.photo_key, e);
      }
    }
    return c.body(null, 204);
  });

  return app;
};
