// GET /api/memories/:id/facts と PATCH /api/facts/:id（J-7 (2)）。
import { Hono } from "hono";
import { decideFact, getFactForUser } from "../db/facts";
import { getMemory, isPending, listFacts } from "../db/memories";
import type { Env, Variables } from "../env";
import { ApiError } from "../errors";

export const memoryFactsRoute = () => {
  const app = new Hono<{ Bindings: Env; Variables: Variables }>();
  app.get("/:id/facts", async (c) => {
    const user = c.get("user");
    const id = c.req.param("id");
    if (!(await getMemory(c.env.DB, user.id, id))) throw new ApiError(404, "not_found", "見つかりません");
    const now = new Date().toISOString();
    // pending を先に読み、items は後で読む。裏の処理は候補の INSERT → ai_runs の更新の順にコミットするので、
    // pending=false が見えた時点で items はそろっている（並行に読むと pending=false・items=[] になり得て、画面のポーリングが止まる）
    const pending = await isPending(c.env.DB, id, "facts", now);
    const items = await listFacts(c.env.DB, id);
    return c.json({ pending, items: items.map(({ memory_id: _m, ...f }) => f) });
  });
  return app;
};

export const factsRoute = () => {
  const app = new Hono<{ Bindings: Env; Variables: Variables }>();
  app.patch("/:id", async (c) => {
    const user = c.get("user");
    const id = c.req.param("id");
    let json: unknown;
    try {
      json = await c.req.json();
    } catch {
      throw new ApiError(400, "validation", "status を入れてください");
    }
    const status = (json as { status?: unknown })?.status;
    if (status !== "confirmed" && status !== "rejected") throw new ApiError(400, "validation", "status は confirmed か rejected です");
    const fact = await getFactForUser(c.env.DB, user.id, id);
    if (!fact) throw new ApiError(404, "not_found", "見つかりません");
    const now = new Date().toISOString();
    await decideFact(c.env.DB, id, status, now);
    return c.json({ id, status, decided_at: now });
  });
  return app;
};
