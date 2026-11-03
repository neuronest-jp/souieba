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
): Promise<{ userId: string; via: "access" | "dev" } | { userId: null; reason: string }> {
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
      return { userId: null, reason };
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
      throw new ApiError(401, "unauthorized", `ログインが必要です (${r.reason})`);
    }
    c.set("user", { id: r.userId });
    await next();
  };
