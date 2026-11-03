// 認証ミドルウェア。本番は Cloudflare Access の JWT、ローカル（ENVIRONMENT=development）だけ X-Dev-User。
import type { MiddlewareHandler } from "hono";
import { AccessVerifyError, fetchJwksCached, verifyAccessJwt } from "./access";
import { isDevelopment, type Env, type Variables } from "./env";
import { ApiError } from "./errors";

export const ACCESS_JWT_HEADER = "Cf-Access-Jwt-Assertion";
export const DEV_USER_HEADER = "X-Dev-User";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type ResolveUserDeps = {
  fetchJwks?: typeof fetchJwksCached;
  now?: () => number;
};

// リクエストからユーザー（メール）を決める。決められなければ null。
export async function resolveUserId(
  req: Request,
  env: Pick<Env, "ENVIRONMENT" | "ACCESS_TEAM_DOMAIN" | "ACCESS_AUD">,
  deps: ResolveUserDeps = {},
): Promise<{ userId: string; via: "access" | "dev" } | { userId: null; reason: string; upstream?: boolean }> {
  const jwt = req.headers.get(ACCESS_JWT_HEADER);
  if (jwt) {
    try {
      const claims = await verifyAccessJwt(jwt, {
        teamDomain: env.ACCESS_TEAM_DOMAIN,
        aud: env.ACCESS_AUD,
        fetchJwks: deps.fetchJwks ?? fetchJwksCached,
        now: deps.now,
      });
      return { userId: claims.email, via: "access" };
    } catch (e) {
      const reason = e instanceof AccessVerifyError ? e.reason : "verify_failed";
      // JWKS が取れないのは利用者の問題ではなく上流の障害。401 と区別する。
      const upstream = reason === "jwks_fetch_failed" || reason === "jwks_malformed";
      return { userId: null, reason, upstream };
    }
  }

  // ローカル専用。本番ではヘッダがあっても無視する。
  if (isDevelopment(env)) {
    const dev = req.headers.get(DEV_USER_HEADER)?.trim().toLowerCase();
    if (dev && EMAIL_RE.test(dev)) return { userId: dev, via: "dev" };
  }

  return { userId: null, reason: "no_credentials" };
}

export const requireUser = (deps: ResolveUserDeps = {}): MiddlewareHandler<{ Bindings: Env; Variables: Variables }> =>
  async (c, next) => {
    const r = await resolveUserId(c.req.raw, c.env, deps);
    if (r.userId === null) {
      // 内部理由は本文に出さずログにだけ残す（検証ロジックの手がかりを外に出さない）
      console.warn("auth rejected", { reason: r.reason, path: new URL(c.req.url).pathname });
      if (r.upstream) {
        throw new ApiError(503, "auth_unavailable", "いま、ログインの確認ができません。少し待ってからもう一度お試しください");
      }
      throw new ApiError(401, "unauthorized", "ログインが必要です");
    }
    c.set("user", { id: r.userId });
    await next();
  };
