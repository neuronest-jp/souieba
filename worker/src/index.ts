import { Hono } from "hono";
import { requireUser, type ResolveUserDeps } from "./auth";
import { apiCors } from "./cors";
import { type Env, type Variables } from "./env";
import { ApiError, errorBody } from "./errors";
import { authRoutes, type AuthDeps } from "./routes/auth";
import { memoriesRoutes, type MemoriesDeps } from "./routes/memories";
import { getPhotoRoute, putPhotoRoute } from "./routes/photos";

export type AppType = Hono<{ Bindings: Env; Variables: Variables }>;
export type AppDeps = ResolveUserDeps & { memories?: MemoriesDeps; auth?: AuthDeps };

// Worker 本体。/api/* だけここに来る（wrangler.toml の run_worker_first）。それ以外は Static Assets が開発用プレビューを返す。
export const createApp = (deps: AppDeps = {}): AppType => {
  const app = new Hono<{ Bindings: Env; Variables: Variables }>();

  app.use("/api/*", apiCors());

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
      time: new Date().toISOString(),
    }),
  );

  // ログイン（認証不要）
  app.route("/api/auth", authRoutes(deps.auth));

  const authed = new Hono<{ Bindings: Env; Variables: Variables }>();
  authed.use("*", requireUser(deps));

  // 自分が誰か（users の行は requireUser が作っている）。
  authed.get("/me", async (c) => {
    const user = c.get("user");
    const now = new Date().toISOString();
    const row = await c.env.DB.prepare("SELECT id, display_name, created_at FROM users WHERE id = ?1")
      .bind(user.id)
      .first<{ id: string; display_name: string | null; created_at: string }>();
    return c.json({
      user_id: user.id,
      display_name: row?.display_name ?? null,
      since: row?.created_at ?? now,
    });
  });

  authed.route("/memories", memoriesRoutes(deps.memories));
  authed.route("/memories", putPhotoRoute());
  authed.route("/photos", getPhotoRoute());

  app.route("/api", authed);
  return app;
};

const app = createApp();
export default app;
