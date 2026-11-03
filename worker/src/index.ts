import { Hono } from "hono";
import { requireUser } from "./auth";
import { type Env, type Variables } from "./env";
import { ApiError, errorBody } from "./errors";

export type AppType = Hono<{ Bindings: Env; Variables: Variables }>;

// Worker 本体。/api/* だけここに来る（wrangler.toml の run_worker_first）。それ以外は Static Assets が SPA を返す。
export const createApp = (): AppType => {
  const app = new Hono<{ Bindings: Env; Variables: Variables }>();

  app.onError((err, c) => {
    if (err instanceof ApiError) return c.json(errorBody(err.code, err.message), err.status as 400);
    console.error("unhandled", err);
    return c.json(errorBody("internal", "うまくいきませんでした。少し待ってからもう一度お試しください"), 500);
  });

  app.notFound((c) => c.json(errorBody("not_found", "見つかりません"), 404));

  // 死活確認。秘密は返さない。
  app.get("/api/health", (c) =>
    c.json({
      ok: true,
      service: "souieba",
      version: c.env.APP_VERSION ?? "dev",
      environment: c.env.ENVIRONMENT ?? "unknown",
      time: new Date().toISOString(),
    }),
  );

  const authed = new Hono<{ Bindings: Env; Variables: Variables }>();
  authed.use("*", requireUser());

  // 自分が誰か。初回は users に作る。
  authed.get("/me", async (c) => {
    const user = c.get("user");
    const now = new Date().toISOString();
    await c.env.DB.prepare(
      `INSERT INTO users (id, display_name, created_at, last_seen_at) VALUES (?1, NULL, ?2, ?2)
       ON CONFLICT(id) DO UPDATE SET last_seen_at = ?2`,
    )
      .bind(user.id, now)
      .run();
    const row = await c.env.DB.prepare("SELECT id, display_name, created_at FROM users WHERE id = ?1")
      .bind(user.id)
      .first<{ id: string; display_name: string | null; created_at: string }>();
    return c.json({
      user_id: user.id,
      display_name: row?.display_name ?? null,
      since: row?.created_at ?? now,
    });
  });

  app.route("/api", authed);
  return app;
};

const app = createApp();
export default app;
