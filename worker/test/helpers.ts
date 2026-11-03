// テスト用: RSA 鍵を作り、Cloudflare Access 風の JWT に署名する。
import type { Jwks } from "../src/access";

const b64url = (bytes: Uint8Array | string): string => {
  const bin = typeof bytes === "string" ? bytes : String.fromCharCode(...bytes);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};

export type TestKey = {
  kid: string;
  privateKey: CryptoKey;
  jwks: Jwks;
};

export async function makeTestKey(kid = "test-kid-1"): Promise<TestKey> {
  const pair = (await crypto.subtle.generateKey(
    { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
    true,
    ["sign", "verify"],
  )) as CryptoKeyPair;
  const pub = (await crypto.subtle.exportKey("jwk", pair.publicKey)) as JsonWebKey;
  return {
    kid,
    privateKey: pair.privateKey,
    jwks: { keys: [{ kty: pub.kty, n: pub.n, e: pub.e, kid, alg: "RS256", use: "sig" }] },
  };
}

export async function signJwt(
  key: TestKey,
  payload: Record<string, unknown>,
  header: Record<string, unknown> = { alg: "RS256", kid: key.kid, typ: "JWT" },
): Promise<string> {
  const h = b64url(new TextEncoder().encode(JSON.stringify(header)));
  const p = b64url(new TextEncoder().encode(JSON.stringify(payload)));
  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key.privateKey, new TextEncoder().encode(`${h}.${p}`));
  return `${h}.${p}.${b64url(new Uint8Array(sig))}`;
}

// alg 混同のテスト用: RSA 公開鍵の JWK をそのまま HMAC の鍵にして HS256 で署名する
export async function signJwtHs256WithPublicKey(key: TestKey, payload: Record<string, unknown>): Promise<string> {
  const pub = key.jwks.keys[0]!;
  const secret = new TextEncoder().encode(JSON.stringify({ kty: pub.kty, n: pub.n, e: pub.e }));
  const hmac = await crypto.subtle.importKey("raw", secret, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const h = b64url(new TextEncoder().encode(JSON.stringify({ alg: "HS256", kid: key.kid, typ: "JWT" })));
  const p = b64url(new TextEncoder().encode(JSON.stringify(payload)));
  const sig = await crypto.subtle.sign("HMAC", hmac, new TextEncoder().encode(`${h}.${p}`));
  return `${h}.${p}.${b64url(new Uint8Array(sig))}`;
}

export const TEAM = "example";
export const AUD = "aud-tag-0123456789abcdef";
export const ISS = `https://${TEAM}.cloudflareaccess.com`;

export const validClaims = (now: number, extra: Record<string, unknown> = {}) => ({
  email: "Hana@example.com",
  sub: "sub-1",
  iss: ISS,
  aud: [AUD],
  iat: now - 10,
  nbf: now - 10,
  exp: now + 600,
  ...extra,
});

// D1 の最小スタブ。/api/me の upsert と select に応えられるだけ。
export const fakeDb = () => {
  const users = new Map<string, { id: string; display_name: string | null; created_at: string; last_seen_at: string }>();
  const prepare = (sql: string) => {
    let args: unknown[] = [];
    const stmt = {
      bind: (...a: unknown[]) => {
        args = a;
        return stmt;
      },
      run: async () => {
        if (sql.startsWith("INSERT INTO users")) {
          if (args.length !== 2 || typeof args[0] !== "string" || !args[0].includes("@")) {
            throw new Error(`users の upsert の bind が想定外: ${JSON.stringify(args)}`);
          }
          const [id, now] = args as [string, string];
          const cur = users.get(id);
          if (cur) cur.last_seen_at = now;
          else users.set(id, { id, display_name: null, created_at: now, last_seen_at: now });
        }
        return { success: true, meta: {} };
      },
      first: async () => {
        if (sql.startsWith("SELECT id, display_name, created_at FROM users")) {
          const u = users.get(args[0] as string);
          return u ? { id: u.id, display_name: u.display_name, created_at: u.created_at } : null;
        }
        return null;
      },
      all: async () => ({ results: [], success: true, meta: {} }),
    };
    return stmt;
  };
  return { prepare, users } as unknown as D1Database & { users: typeof users };
};
