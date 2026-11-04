// POST /api/auth/login: 招待コード + メール → JWT（有効 90 日）。ADR-0007、spec 第10節。
import { Hono } from "hono";
import { getConnInfo } from "hono/cloudflare-workers";
import { EMAIL_RE, normalizeEmail } from "../auth";
import type { Env, Variables } from "../env";
import { ApiError } from "../errors";
import { signJwt, timingSafeEqual } from "../jwt";

export const TOKEN_TTL_SECONDS = 90 * 24 * 60 * 60;
export const LOGIN_LIMIT_PER_MINUTE = 10;

export type AuthDeps = { now?: () => number };

const clientIp = (c: { req: { raw: Request; header: (n: string) => string | undefined } }): string => {
  const cf = c.req.header("cf-connecting-ip");
  if (cf) return cf;
  try {
    const info = getConnInfo(c as never);
    if (info.remote.address) return info.remote.address;
  } catch {
    /* ローカルやテストでは取れない */
  }
  return "unknown";
};

export const authRoutes = (deps: AuthDeps = {}) => {
  const app = new Hono<{ Bindings: Env; Variables: Variables }>();
  const nowSec = () => (deps.now ? deps.now() : Math.floor(Date.now() / 1000));

  app.post("/login", async (c) => {
    if (!c.env.INVITE_CODE || !c.env.JWT_SECRET) {
      console.error("INVITE_CODE / JWT_SECRET が未設定");
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

    // レート制限（同一 IP、直近 1 分）
    const ip = clientIp(c);
    const now = nowSec();
    const since = new Date((now - 60) * 1000).toISOString();
    const recent = await c.env.DB.prepare("SELECT count(*) AS n FROM login_attempts WHERE ip = ?1 AND created_at > ?2")
      .bind(ip, since)
      .first<{ n: number }>();
    if ((recent?.n ?? 0) >= LOGIN_LIMIT_PER_MINUTE) {
      throw new ApiError(429, "too_many", "少し待ってから、もう一度お試しください");
    }
    const ok = timingSafeEqual(code, c.env.INVITE_CODE);
    await c.env.DB.prepare("INSERT INTO login_attempts (id, ip, ok, created_at) VALUES (?1, ?2, ?3, ?4)")
      .bind(crypto.randomUUID(), ip, ok ? 1 : 0, new Date(now * 1000).toISOString())
      .run();
    if (!ok) throw new ApiError(401, "unauthorized", "招待コードかメールアドレスが違います");

    const exp = now + TOKEN_TTL_SECONDS;
    const token = await signJwt({ sub: email, iat: now, exp }, c.env.JWT_SECRET);
    return c.json({ token, expires_at: new Date(exp * 1000).toISOString(), user_id: email });
  });

  return app;
};
