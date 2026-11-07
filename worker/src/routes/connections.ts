// GET /api/connections（つながり）。書いたひとことと、そのとき浮かんだ昔のひとことの組を新しい順に返す。
// 反応は今ある PATCH /api/recalls/:id をそのまま使う（ここには作らない）。
import { Hono } from "hono";
import { listBeads, listConnections, type BeadRow, type ConnectionRow } from "../db/recalls";
import type { Env, Variables } from "../env";

export const connectionJson = (r: ConnectionRow) => ({
  id: r.id,
  reason: r.reason,
  evidence: r.evidence,
  feedback: r.feedback,
  created_at: r.created_at,
  // 書いたひとこと（新しい側）
  memory: { id: r.m_id, body: r.m_body, happened_on: r.m_happened_on, happened_on_precision: r.m_happened_on_precision, photo_key: r.m_photo_key },
  // 思い出した昔のひとこと
  related_memory: { id: r.rm_id, body: r.rm_body, happened_on: r.rm_happened_on, happened_on_precision: r.rm_happened_on_precision, photo_key: r.rm_photo_key },
});

export const connectionsRoute = () => {
  const app = new Hono<{ Bindings: Env; Variables: Variables }>();
  app.get("/", async (c) => {
    const user = c.get("user");
    // 組と粒を 1 往復で読む（D1 の batch は 1 トランザクション。2 つの読みが食い違わない）
    const [conn, beads] = await c.env.DB.batch([listConnections(c.env.DB, user.id), listBeads(c.env.DB, user.id)]);
    const items = ((conn?.results ?? []) as ConnectionRow[]).map(connectionJson);
    const beadItems = ((beads?.results ?? []) as BeadRow[]).map((b) => ({ happened_on: b.happened_on, happened_on_precision: b.happened_on_precision }));
    return c.json({ items, beads: beadItems });
  });
  return app;
};
