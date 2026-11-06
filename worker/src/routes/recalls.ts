// GET /api/memories/:id/recalls と PATCH /api/recalls/:id（反応）。
import { Hono } from "hono";
import { getMemory, isPending, listRecalls, type RecallWithMemory } from "../db/memories";
import { getRecallForUser, setRecallFeedback } from "../db/recalls";
import type { Env, Variables } from "../env";
import { ApiError } from "../errors";

export const recallJsonForNew = (r: RecallWithMemory) => ({
  id: r.id,
  reason: r.reason,
  evidence: r.evidence,
  feedback: r.feedback,
  created_at: r.created_at,
  related_memory: { id: r.rm_id, body: r.rm_body, happened_on: r.rm_happened_on, happened_on_precision: r.rm_happened_on_precision, photo_key: r.rm_photo_key },
});

export const memoryRecallsRoute = () => {
  const app = new Hono<{ Bindings: Env; Variables: Variables }>();
  app.get("/:id/recalls", async (c) => {
    const user = c.get("user");
    const id = c.req.param("id");
    if (!(await getMemory(c.env.DB, user.id, id))) throw new ApiError(404, "not_found", "見つかりません");
    const now = new Date().toISOString();
    // pending を先に読む（理由は facts.ts の GET と同じ。札の INSERT → ai_runs の更新の順にコミットされる）
    const pending = await isPending(c.env.DB, id, "recall", now);
    const items = await listRecalls(c.env.DB, id);
    return c.json({ pending, items: items.map(recallJsonForNew) });
  });
  return app;
};

export const recallsRoute = () => {
  const app = new Hono<{ Bindings: Env; Variables: Variables }>();
  app.patch("/:id", async (c) => {
    const user = c.get("user");
    const id = c.req.param("id");
    let json: unknown;
    try {
      json = await c.req.json();
    } catch {
      throw new ApiError(400, "validation", "feedback を入れてください");
    }
    const feedback = (json as { feedback?: unknown })?.feedback;
    if (feedback !== "helpful" && feedback !== "not_related" && feedback !== "none") {
      throw new ApiError(400, "validation", "feedback は helpful / not_related / none です");
    }
    if (!(await getRecallForUser(c.env.DB, user.id, id))) throw new ApiError(404, "not_found", "見つかりません");
    await setRecallFeedback(c.env.DB, id, feedback);
    return c.json({ id, feedback });
  });
  return app;
};
