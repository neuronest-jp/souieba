// /api/memories の経路。requirements F2 / F3、architecture 5.3〜5.6、tasks J-7。
import { Hono } from "hono";
import { decodeCursor, encodeCursor } from "../cursor";
import {
  clampLimit,
  deleteMemory,
  getMemory,
  insertMemory,
  isPending,
  listFacts,
  listMemories,
  listRecalledBy,
  listRecalls,
  type MemoryRow,
  type RecallWithMemory,
} from "../db/memories";
import type { Env, Variables } from "../env";
import { ApiError } from "../errors";
import { parseMemoryInput, todayInTokyo } from "../validate";

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
    // 201 を返す前に AI 処理の記録を作る（afterSave 側の責務。waitUntil で続きを走らせる）
    await afterSave({ env: c.env, userId: user.id, memory, waitUntil: (p) => c.executionCtx.waitUntil(p) });
    return c.json(toMemoryJson(memory), 201);
  });

  app.get("/", async (c) => {
    const user = c.get("user");
    const cursor = decodeCursor(c.req.query("cursor"));
    const limit = clampLimit(c.req.query("limit"));
    const { items, nextCursor } = await listMemories(c.env.DB, user.id, cursor, limit);
    return c.json({ items: items.map(toMemoryJson), next_cursor: nextCursor ? encodeCursor(nextCursor) : null });
  });

  app.get("/:id", async (c) => {
    const user = c.get("user");
    const id = c.req.param("id");
    const memory = await getMemory(c.env.DB, user.id, id);
    if (!memory) throw new ApiError(404, "not_found", "見つかりません");
    const now = nowIso();
    const [facts, recalls, recalledBy, factsPending, recallPending] = await Promise.all([
      listFacts(c.env.DB, id),
      listRecalls(c.env.DB, id),
      listRecalledBy(c.env.DB, id),
      isPending(c.env.DB, id, "facts", now),
      isPending(c.env.DB, id, "recall", now),
    ]);
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
    if (memory.photo_key) {
      try {
        await c.env.PHOTOS.delete(memory.photo_key);
      } catch (e) {
        console.error("photo delete failed", memory.photo_key, e);
      }
    }
    await deleteMemory(c.env.DB, user.id, id);
    return c.body(null, 204);
  });

  return app;
};
