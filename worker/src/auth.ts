// 認証ミドルウェア（ADR-0007）。Authorization: Bearer <JWT> を検証し、sub（メール）を user_id にする。
// ローカル（ENVIRONMENT=development）だけ X-Dev-User も受け付ける。
import type { MiddlewareHandler } from "hono";
import { touchUser } from "./db/users";
import { isDevelopment, type Env, type Variables } from "./env";
import { ApiError } from "./errors";
import { JwtError, verifyJwt } from "./jwt";

export const DEV_USER_HEADER = "X-Dev-User";
export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type ResolveUserDeps = {
  now?: () => number; // 秒
};

export const normalizeEmail = (raw: string): string => raw.trim().toLowerCase();

// リクエストからユーザー（メール）を決める。決められなければ null。
export async function resolveUserId(
  req: Request,
  env: Pick<Env, "ENVIRONMENT" | "JWT_SECRET">,
  deps: ResolveUserDeps = {},
): Promise<{ userId: string; via: "jwt" | "dev" } | { userId: null; reason: string }> {
  const authz = req.headers.get("authorization");
  if (authz) {
    const m = /^Bearer\s+(.+)$/i.exec(authz.trim());
    if (!m || !m[1]) return { userId: null, reason: "bad_authorization" };
    if (!env.JWT_SECRET || (env.ENVIRONMENT !== "development" && env.JWT_SECRET.length < 32)) {
      return { userId: null, reason: "not_configured" };
    }
    try {
      const claims = await verifyJwt(m[1], env.JWT_SECRET, deps.now ? deps.now() : undefined);
      const email = normalizeEmail(claims.sub);
      if (!EMAIL_RE.test(email)) return { userId: null, reason: "bad_sub" };
      return { userId: email, via: "jwt" };
    } catch (e) {
      return { userId: null, reason: e instanceof JwtError ? e.reason : "verify_failed" };
    }
  }

  // ローカル専用。本番ではヘッダがあっても無視する。
  if (isDevelopment(env)) {
    const dev = req.headers.get(DEV_USER_HEADER);
    if (dev) {
      const email = normalizeEmail(dev);
      if (EMAIL_RE.test(email)) return { userId: email, via: "dev" };
    }
  }

  return { userId: null, reason: "no_credentials" };
}

export const requireUser = (deps: ResolveUserDeps = {}): MiddlewareHandler<{ Bindings: Env; Variables: Variables }> =>
  async (c, next) => {
    const r = await resolveUserId(c.req.raw, c.env, deps);
    if (r.userId === null) {
      // 内部理由は本文に出さずログにだけ残す
      console.warn("auth rejected", { reason: r.reason, path: new URL(c.req.url).pathname });
      throw new ApiError(401, "unauthorized", "ログインが必要です");
    }
    c.set("user", { id: r.userId });
    // 初回は users に行を作る（memories の外部キーの親）。以後は last_seen_at の更新だけ。
    await touchUser(c.env.DB, r.userId, new Date().toISOString());
    await next();
  };
