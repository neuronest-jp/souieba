// POST /api/auth/login: 招待コード + メール → JWT（有効 90 日）。ADR-0007、spec 第10節。
import { Hono } from "hono";
import { EMAIL_RE, normalizeEmail } from "../auth";
import type { Env, Variables } from "../env";
import { ApiError } from "../errors";
import { signJwt, timingSafeEqual } from "../jwt";

export const TOKEN_TTL_SECONDS = 90 * 24 * 60 * 60;
export const LOGIN_LIMIT_PER_MINUTE = 10;

export type AuthDeps = { now?: () => number };

// 本番では Cloudflare が cf-connecting-ip を必ず付ける（偽装不可）。ローカルや無いときは 1 つのバケットにまとめる。
const clientIp = (c: { req: { header: (n: string) => string | undefined } }): string => c.req.header("cf-connecting-ip") ?? "unknown";

export const MIN_SECRET_LENGTH = 32;
export const isWeakSecret = (env: Pick<Env, "ENVIRONMENT" | "JWT_SECRET">): boolean =>
  env.ENVIRONMENT !== "development" && (env.JWT_SECRET ?? "").length < MIN_SECRET_LENGTH;

export const authRoutes = (deps: AuthDeps = {}) => {
  const app = new Hono<{ Bindings: Env; Variables: Variables }>();
  const nowSec = () => (deps.now ? deps.now() : Math.floor(Date.now() / 1000));

  app.post("/login", async (c) => {
    if (!c.env.INVITE_CODE || !c.env.JWT_SECRET || isWeakSecret(c.env)) {
      console.error("INVITE_CODE / JWT_SECRET が未設定か短すぎる");
      throw new ApiError(503, "auth_unavailable", "いま、ログインの準備ができていません");
    }
    let json: unknown;
    try {
      json = await c.req.json();
    } catch {
      throw new ApiError(400, "validation", "招待コードとメールアドレスを入れてください");
    }
    const o = (typeof json === "object" && json !== null ? json : {}) as Record<string, unknown>;
    const code = typeof o.invite_code === "string" ? o.invite_code.trim() : "";
    const email = typeof o.email === "string" ? normalizeEmail(o.email) : "";
    if (!code || !email) throw new ApiError(400, "validation", "招待コードとメールアドレスを入れてください");
    if (email.length > 254 || !EMAIL_RE.test(email)) throw new ApiError(400, "validation", "メールアドレスの形が違います");

    // レート制限（同一 IP、直近 1 分）。先に自分の試行を記録してから数える（並行リクエストでも上限を超えない）。
    const ip = clientIp(c);
    const now = nowSec();
    const nowIso = new Date(now * 1000).toISOString();
    const since = new Date((now - 60) * 1000).toISOString();
    const ok = timingSafeEqual(code, c.env.INVITE_CODE);
    const [, , recent] = await c.env.DB.batch([
      // 古い記録は 1 時間で消す（0002 のコメントどおり、定期の cron は持たない）
      c.env.DB.prepare("DELETE FROM login_attempts WHERE created_at < ?1").bind(new Date((now - 3600) * 1000).toISOString()),
      c.env.DB.prepare("INSERT INTO login_attempts (id, ip, ok, created_at) VALUES (?1, ?2, ?3, ?4)").bind(crypto.randomUUID(), ip, ok ? 1 : 0, nowIso),
      c.env.DB.prepare("SELECT count(*) AS n FROM login_attempts WHERE ip = ?1 AND created_at > ?2").bind(ip, since),
    ]);
    const n = (recent?.results?.[0] as { n: number } | undefined)?.n ?? 0;
    if (n > LOGIN_LIMIT_PER_MINUTE) {
      c.header("Retry-After", "60");
      throw new ApiError(429, "too_many", "少し待ってから、もう一度お試しください");
    }
    if (!ok) throw new ApiError(401, "unauthorized", "招待コードかメールアドレスが違います");

    const exp = now + TOKEN_TTL_SECONDS;
    const token = await signJwt({ sub: email, iat: now, exp }, c.env.JWT_SECRET);
    return c.json({ token, expires_at: new Date(exp * 1000).toISOString(), user_id: email });
  });

  return app;
};
