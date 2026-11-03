// Cloudflare Access の JWT（Cf-Access-Jwt-Assertion）を検証する。
// 依存なし。WebCrypto の RSASSA-PKCS1-v1_5 / SHA-256 で署名を確かめる。
//
// 検証すること:
//   - ヘッダ alg が RS256、kid が JWKS に存在する
//   - 署名が正しい
//   - iss が https://<team>.cloudflareaccess.com
//   - aud に Access アプリケーションの AUD タグが含まれる
//   - exp が未来、nbf があれば過去
//   - email クレームがある

export type Jwk = JsonWebKey & { kid?: string; alg?: string; use?: string };
export type Jwks = { keys: Jwk[] };

export type AccessClaims = {
  email: string;
  sub?: string;
  iss: string;
  aud: string | string[];
  exp: number;
  iat?: number;
  nbf?: number;
};

export type VerifyOptions = {
  teamDomain: string; // 例: "example"（example.cloudflareaccess.com）
  aud: string;
  fetchJwks: (certsUrl: string, opts?: { forceRefresh?: boolean }) => Promise<Jwks>;
  now?: () => number; // 秒。テスト用
};

export class AccessVerifyError extends Error {
  constructor(
    public readonly reason: string,
    message?: string,
  ) {
    super(message ?? reason);
  }
}

export const certsUrlFor = (teamDomain: string) =>
  `https://${teamDomain}.cloudflareaccess.com/cdn-cgi/access/certs`;

export const issuerFor = (teamDomain: string) => `https://${teamDomain}.cloudflareaccess.com`;

const base64UrlDecode = (s: string): Uint8Array => {
  const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/") + pad;
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
};

const decodeJson = <T>(segment: string): T => {
  try {
    return JSON.parse(new TextDecoder().decode(base64UrlDecode(segment))) as T;
  } catch {
    throw new AccessVerifyError("malformed", "JWT の内容を読めません");
  }
};

export async function verifyAccessJwt(token: string, opts: VerifyOptions): Promise<AccessClaims> {
  if (!opts.teamDomain || !opts.aud) {
    throw new AccessVerifyError("not_configured", "ACCESS_TEAM_DOMAIN / ACCESS_AUD が未設定です");
  }
  const parts = token.split(".");
  if (parts.length !== 3) throw new AccessVerifyError("malformed", "JWT の形式が違います");
  const [h, p, s] = parts as [string, string, string];

  const header = decodeJson<{ alg?: string; kid?: string; typ?: string }>(h);
  if (header.alg !== "RS256") throw new AccessVerifyError("bad_alg", "対応していない署名方式です");
  if (!header.kid) throw new AccessVerifyError("no_kid", "kid がありません");

  const certsUrl = certsUrlFor(opts.teamDomain);
  let jwks = await opts.fetchJwks(certsUrl);
  let jwk = jwks.keys.find((k) => k.kid === header.kid);
  if (!jwk) {
    // 鍵がローテーションされた直後はキャッシュに無い。1回だけ取り直す。
    jwks = await opts.fetchJwks(certsUrl, { forceRefresh: true });
    jwk = jwks.keys.find((k) => k.kid === header.kid);
  }
  if (!jwk) throw new AccessVerifyError("unknown_kid", "署名鍵が見つかりません");

  const key = await crypto.subtle.importKey(
    "jwk",
    { kty: jwk.kty, n: jwk.n, e: jwk.e, alg: "RS256", ext: true },
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["verify"],
  );
  const ok = await crypto.subtle.verify(
    "RSASSA-PKCS1-v1_5",
    key,
    base64UrlDecode(s),
    new TextEncoder().encode(`${h}.${p}`),
  );
  if (!ok) throw new AccessVerifyError("bad_signature", "署名が一致しません");

  const claims = decodeJson<Partial<AccessClaims>>(p);
  const now = opts.now ? opts.now() : Math.floor(Date.now() / 1000);

  if (claims.iss !== issuerFor(opts.teamDomain)) throw new AccessVerifyError("bad_iss", "発行者が違います");
  const auds = Array.isArray(claims.aud) ? claims.aud : claims.aud ? [claims.aud] : [];
  if (!auds.includes(opts.aud)) throw new AccessVerifyError("bad_aud", "AUD が一致しません");
  if (typeof claims.exp !== "number" || claims.exp <= now) throw new AccessVerifyError("expired", "期限切れです");
  if (typeof claims.nbf === "number" && claims.nbf > now) throw new AccessVerifyError("not_yet_valid", "まだ有効ではありません");
  if (typeof claims.email !== "string" || !claims.email.includes("@")) {
    throw new AccessVerifyError("no_email", "メールアドレスが含まれていません");
  }

  return {
    email: claims.email.toLowerCase(),
    sub: claims.sub,
    iss: claims.iss,
    aud: auds,
    exp: claims.exp,
    iat: claims.iat,
    nbf: claims.nbf,
  };
}

// JWKS を短時間（5分）メモリに持つ。Worker のアイソレートごとのキャッシュで十分。
const JWKS_TTL_MS = 5 * 60 * 1000;
let jwksCache: { url: string; jwks: Jwks; fetchedAt: number } | null = null;

export async function fetchJwksCached(certsUrl: string, opts: { forceRefresh?: boolean } = {}): Promise<Jwks> {
  const now = Date.now();
  if (!opts.forceRefresh && jwksCache && jwksCache.url === certsUrl && now - jwksCache.fetchedAt < JWKS_TTL_MS) {
    return jwksCache.jwks;
  }
  let res: Response;
  try {
    res = await fetch(certsUrl, { headers: { accept: "application/json" } });
  } catch (e) {
    throw new AccessVerifyError("jwks_fetch_failed", `JWKS を取得できません (${e instanceof Error ? e.message : "network"})`);
  }
  if (!res.ok) throw new AccessVerifyError("jwks_fetch_failed", `JWKS を取得できません (${res.status})`);
  const jwks = (await res.json()) as Jwks;
  if (!Array.isArray(jwks.keys)) throw new AccessVerifyError("jwks_malformed", "JWKS の形式が違います");
  jwksCache = { url: certsUrl, jwks, fetchedAt: now };
  return jwks;
}

export const resetJwksCacheForTests = () => {
  jwksCache = null;
};
