// HS256 の JWT。依存なし（WebCrypto の HMAC）。
export type JwtClaims = { sub: string; iat: number; exp: number };

const enc = new TextEncoder();
const dec = new TextDecoder();

export const b64url = (bytes: Uint8Array): string => {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};
export const b64urlDecode = (s: string): Uint8Array => {
  const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/") + pad);
  return Uint8Array.from(bin, (ch) => ch.charCodeAt(0));
};

const hmacKey = (secret: string, usages: Array<"sign" | "verify">) =>
  crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, usages);

export class JwtError extends Error {
  constructor(public readonly reason: string) {
    super(reason);
  }
}

export async function signJwt(claims: JwtClaims, secret: string): Promise<string> {
  const header = b64url(enc.encode(JSON.stringify({ alg: "HS256", typ: "JWT" })));
  const payload = b64url(enc.encode(JSON.stringify(claims)));
  const key = await hmacKey(secret, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(`${header}.${payload}`));
  return `${header}.${payload}.${b64url(new Uint8Array(sig))}`;
}

export async function verifyJwt(token: string, secret: string, now: number = Math.floor(Date.now() / 1000)): Promise<JwtClaims> {
  const parts = token.split(".");
  if (parts.length !== 3) throw new JwtError("malformed");
  const [h, p, s] = parts as [string, string, string];
  let header: { alg?: string };
  try {
    header = JSON.parse(dec.decode(b64urlDecode(h))) as { alg?: string };
  } catch {
    throw new JwtError("malformed");
  }
  if (header.alg !== "HS256") throw new JwtError("bad_alg");
  const key = await hmacKey(secret, ["verify"]);
  let ok = false;
  try {
    ok = await crypto.subtle.verify("HMAC", key, b64urlDecode(s), enc.encode(`${h}.${p}`));
  } catch {
    ok = false;
  }
  if (!ok) throw new JwtError("bad_signature");
  let claims: Partial<JwtClaims>;
  try {
    claims = JSON.parse(dec.decode(b64urlDecode(p))) as Partial<JwtClaims>;
  } catch {
    throw new JwtError("malformed");
  }
  if (typeof claims.exp !== "number" || claims.exp <= now) throw new JwtError("expired");
  if (typeof claims.sub !== "string" || !claims.sub.includes("@")) throw new JwtError("bad_sub");
  if (typeof claims.iat !== "number") throw new JwtError("malformed");
  return { sub: claims.sub, iat: claims.iat, exp: claims.exp };
}

// 定数時間の文字列比較（招待コード用）
export const timingSafeEqual = (a: string, b: string): boolean => {
  const x = enc.encode(a);
  const y = enc.encode(b);
  let diff = x.length ^ y.length;
  const n = Math.max(x.length, y.length);
  for (let i = 0; i < n; i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
};
