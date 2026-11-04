import { beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/index";
import { DEV_USER_HEADER, resolveUserId } from "../src/auth";
import type { Env } from "../src/env";
import { signJwt } from "../src/jwt";
import { ALLOWED_ORIGINS } from "../src/cors";
import { createTestD1, fakeR2, type TestD1 } from "./sqlite-d1";

const NOW = 1_800_000_000;
const SECRET = "test-secret-0123456789abcdef0123456789";
let db: TestD1;
const baseEnv = (over: Partial<Env> = {}): Env =>
  ({
    DB: db,
    PHOTOS: fakeR2(),
    ASSETS: {} as Fetcher,
    ENVIRONMENT: "production",
    ANTHROPIC_MODEL: "claude-opus-5-5",
    INVITE_CODE: "secret-code",
    JWT_SECRET: SECRET,
    APP_VERSION: "test",
    ...over,
  }) as Env;

beforeEach(() => {
  db = createTestD1();
});

describe("GET /api/health", () => {
  it("認証なしで ok を返し、秘密を含まない", async () => {
    const res = await createApp().request("/api/health", {}, baseEnv({ ANTHROPIC_API_KEY: "sk-secret" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Object.keys(body as object).sort()).toEqual(["ok", "service", "time", "version"]);
    expect(JSON.stringify(body)).not.toContain("sk-secret");
    expect(JSON.stringify(body)).not.toContain("secret-code");
  });
});

describe("POST /api/auth/login", () => {
  const login = (body: unknown, env = baseEnv(), headers: Record<string, string> = {}) =>
    createApp({ auth: { now: () => NOW } }).request(
      "/api/auth/login",
      { method: "POST", headers: { "content-type": "application/json", "cf-connecting-ip": "203.0.113.1", ...headers }, body: JSON.stringify(body) },
      env,
    );

  it("招待コードとメールが合えば 90 日の JWT を返し、メールは小文字にする", async () => {
    const res = await login({ invite_code: "secret-code", email: " Hana@Example.com " });
    expect(res.status).toBe(200);
    const j = (await res.json()) as { token: string; expires_at: string; user_id: string };
    expect(j.user_id).toBe("hana@example.com");
    expect(j.expires_at).toBe(new Date((NOW + 90 * 86400) * 1000).toISOString());
    // 返った JWT で /api/me が通る
    const me = await createApp({ now: () => NOW }).request("/api/me", { headers: { authorization: `Bearer ${j.token}` } }, baseEnv());
    expect(me.status).toBe(200);
    expect(await me.json()).toMatchObject({ user_id: "hana@example.com" });
  });

  it("招待コードが違えば 401。どちらが違うかは言わない", async () => {
    const res = await login({ invite_code: "wrong", email: "a@example.com" });
    expect(res.status).toBe(401);
    const j = (await res.json()) as { error: { message: string } };
    expect(j.error.message).toBe("招待コードかメールアドレスが違います");
  });

  it("入力不足やメール形式違いは 400", async () => {
    expect((await login({ invite_code: "secret-code" })).status).toBe(400);
    expect((await login({ invite_code: "secret-code", email: "nope" })).status).toBe(400);
    expect((await login({})).status).toBe(400);
  });

  it("secret が未設定なら 503", async () => {
    const res = await login({ invite_code: "x", email: "a@example.com" }, baseEnv({ INVITE_CODE: undefined }));
    expect(res.status).toBe(503);
  });

  it("同一 IP から 1 分に 10 回を超えると 429（Retry-After 付き）、別 IP は影響しない。成功も数える", async () => {
    for (let i = 0; i < 9; i++) expect((await login({ invite_code: "wrong", email: "a@example.com" })).status).toBe(401);
    expect((await login({ invite_code: "secret-code", email: "a@example.com" })).status).toBe(200); // 10 回目（成功も数える）
    const blocked = await login({ invite_code: "secret-code", email: "a@example.com" });
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get("retry-after")).toBe("60");
    expect((await login({ invite_code: "secret-code", email: "a@example.com" }, baseEnv(), { "cf-connecting-ip": "203.0.113.2" })).status).toBe(200);
  });

  it("時間窓: 59 秒後はまだ 429、60 秒後に解除される", async () => {
    let now = NOW;
    const at = (body: unknown) =>
      createApp({ auth: { now: () => now } }).request(
        "/api/auth/login",
        { method: "POST", headers: { "content-type": "application/json", "cf-connecting-ip": "203.0.113.9" }, body: JSON.stringify(body) },
        baseEnv(),
      );
    for (let i = 0; i < 10; i++) await at({ invite_code: "wrong", email: "a@example.com" });
    expect((await at({ invite_code: "secret-code", email: "a@example.com" })).status).toBe(429);
    now = NOW + 59;
    expect((await at({ invite_code: "secret-code", email: "a@example.com" })).status).toBe(429);
    now = NOW + 60;
    expect((await at({ invite_code: "secret-code", email: "a@example.com" })).status).toBe(200);
  });

  it("並行に 30 回送っても 10 回を超えて判定されない（記録してから数える）", async () => {
    const results = await Promise.all(Array.from({ length: 30 }, () => login({ invite_code: "wrong", email: "a@example.com" })));
    const codes = results.map((r) => r.status);
    expect(codes.filter((c) => c === 401).length).toBeLessThanOrEqual(10);
    expect(codes.filter((c) => c === 429).length).toBeGreaterThanOrEqual(20);
  });

  it("JWT_SECRET が短ければ本番は 503、development は通す", async () => {
    expect((await login({ invite_code: "secret-code", email: "a@example.com" }, baseEnv({ JWT_SECRET: "short" }))).status).toBe(503);
    expect((await login({ invite_code: "secret-code", email: "a@example.com" }, baseEnv({ JWT_SECRET: "short", ENVIRONMENT: "development" }))).status).toBe(200);
  });

  it("login_attempts は 1 時間より古い行が消える", async () => {
    db.raw.prepare("INSERT INTO login_attempts (id, ip, ok, created_at) VALUES ('old', 'x', 0, ?)").run(new Date((NOW - 3601) * 1000).toISOString());
    await login({ invite_code: "wrong", email: "a@example.com" });
    expect(db.raw.prepare("SELECT count(*) AS n FROM login_attempts WHERE id = 'old'").get()).toEqual({ n: 0 });
  });

  it("CORS: 許可オリジンには Allow-Origin を返し、他には返さない", async () => {
    for (const origin of ALLOWED_ORIGINS) {
      const res = await createApp().request("/api/auth/login", { method: "OPTIONS", headers: { origin, "access-control-request-method": "POST", "access-control-request-headers": "authorization,content-type" } }, baseEnv());
      expect(res.headers.get("access-control-allow-origin"), origin).toBe(origin);
      expect(res.headers.get("access-control-allow-headers")?.toLowerCase()).toContain("authorization");
    }
    const bad = await createApp().request("/api/health", { headers: { origin: "https://evil.example" } }, baseEnv());
    expect(bad.headers.get("access-control-allow-origin")).toBeNull();
    const pre = await createApp().request("/api/me", { method: "OPTIONS", headers: { origin: "https://evil.example", "access-control-request-method": "GET" } }, baseEnv());
    expect(pre.headers.get("access-control-allow-origin")).toBeNull();
    const noOrigin = await createApp().request("/api/me", { method: "OPTIONS", headers: { "access-control-request-method": "GET" } }, baseEnv());
    expect(noOrigin.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("CORS: X-Dev-User は development のときだけ許可ヘッダに出る", async () => {
    const req = (env: Env) =>
      createApp().request("/api/me", { method: "OPTIONS", headers: { origin: "capacitor://localhost", "access-control-request-method": "GET", "access-control-request-headers": "authorization" } }, env);
    expect((await req(baseEnv())).headers.get("access-control-allow-headers")?.toLowerCase()).not.toContain("x-dev-user");
    expect((await req(baseEnv({ ENVIRONMENT: "development" }))).headers.get("access-control-allow-headers")?.toLowerCase()).toContain("x-dev-user");
  });
});

describe("認証ミドルウェア", () => {
  it("認証なしは 401 と { error: { code } }、内部理由は含めない", async () => {
    const res = await createApp().request("/api/me", { headers: { authorization: "Bearer a.b.c" } }, baseEnv());
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe("unauthorized");
    expect(body.error.message).not.toMatch(/malformed|bad_|expired|not_configured/);
  });

  it("期限切れの JWT は 401", async () => {
    const t = await signJwt({ sub: "a@example.com", iat: NOW - 200, exp: NOW - 1 }, SECRET);
    const res = await createApp({ now: () => NOW }).request("/api/me", { headers: { authorization: `Bearer ${t}` } }, baseEnv());
    expect(res.status).toBe(401);
  });

  it("本番では X-Dev-User を無視する", async () => {
    const res = await createApp().request("/api/me", { headers: { [DEV_USER_HEADER]: "someone@example.com" } }, baseEnv());
    expect(res.status).toBe(401);
  });

  it("development では X-Dev-User でログイン相当になり、users に作られる", async () => {
    const env = baseEnv({ ENVIRONMENT: "development" });
    const res = await createApp().request("/api/me", { headers: { [DEV_USER_HEADER]: "Dev@Example.com" } }, env);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ user_id: "dev@example.com" });
    expect(db.raw.prepare("SELECT count(*) AS n FROM users WHERE id = 'dev@example.com'").get()).toEqual({ n: 1 });
  });

  it("development でも X-Dev-User がメール形式でなければ 401", async () => {
    for (const v of ["not-an-email", "dev @example.com", ""]) {
      const res = await createApp().request("/api/me", { headers: { [DEV_USER_HEADER]: v } }, baseEnv({ ENVIRONMENT: "development" }));
      expect(res.status, JSON.stringify(v)).toBe(401);
    }
  });

  it("Authorization があれば development でも X-Dev-User にフォールバックしない", async () => {
    const r = await resolveUserId(
      new Request("http://x/api/me", { headers: { authorization: "Bearer a.b.c", [DEV_USER_HEADER]: "dev@example.com" } }),
      { ENVIRONMENT: "development", JWT_SECRET: SECRET },
    );
    expect(r.userId).toBeNull();
  });

  it("JWT_SECRET が未設定なら Bearer は通らない", async () => {
    const t = await signJwt({ sub: "a@example.com", iat: NOW, exp: NOW + 100 }, SECRET);
    const r = await resolveUserId(new Request("http://x/api/me", { headers: { authorization: `Bearer ${t}` } }), { ENVIRONMENT: "production", JWT_SECRET: undefined }, { now: () => NOW });
    expect(r).toMatchObject({ userId: null, reason: "not_configured" });
  });

  it("同じ人が2回来ても users は1件で since は変わらない", async () => {
    const env = baseEnv({ ENVIRONMENT: "development" });
    const a = (await (await createApp().request("/api/me", { headers: { [DEV_USER_HEADER]: "a@example.com" } }, env)).json()) as { since: string };
    const b = (await (await createApp().request("/api/me", { headers: { [DEV_USER_HEADER]: "a@example.com" } }, env)).json()) as { since: string };
    expect(a.since).toBe(b.since);
    expect(db.raw.prepare("SELECT count(*) AS n FROM users").get()).toEqual({ n: 1 });
  });
});

describe("未知の /api パス", () => {
  it("認証なしなら 401、認証ありなら 404 を JSON で返す", async () => {
    expect((await createApp().request("/api/nope", {}, baseEnv())).status).toBe(401);
    const res = await createApp().request("/api/nope", { headers: { [DEV_USER_HEADER]: "dev@example.com" } }, baseEnv({ ENVIRONMENT: "development" }));
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ error: { code: "not_found" } });
  });
});
