import { describe, expect, it } from "vitest";
import { createApp } from "../src/index";
import { ACCESS_JWT_HEADER, DEV_USER_HEADER, resolveUserId } from "../src/auth";
import type { Env } from "../src/env";
import { AUD, TEAM, fakeDb, makeTestKey, signJwt, validClaims } from "./helpers";

const NOW = 1_800_000_000;

const baseEnv = (over: Partial<Env> = {}): Env =>
  ({
    DB: fakeDb(),
    PHOTOS: {} as R2Bucket,
    ASSETS: {} as Fetcher,
    ENVIRONMENT: "production",
    ANTHROPIC_MODEL: "claude-sonnet-5-5",
    ACCESS_TEAM_DOMAIN: TEAM,
    ACCESS_AUD: AUD,
    APP_VERSION: "test",
    ...over,
  }) as Env;

describe("GET /api/health", () => {
  it("認証なしで ok を返し、秘密を含まない", async () => {
    const app = createApp();
    const res = await app.request("/api/health", {}, baseEnv({ ANTHROPIC_API_KEY: "sk-secret" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ ok: true, service: "souieba", version: "test", environment: "production" });
    expect(JSON.stringify(body)).not.toContain("sk-secret");
  });
});

describe("GET /api/me", () => {
  it("認証なしは 401 と { error: { code } } を返す", async () => {
    const app = createApp();
    const res = await app.request("/api/me", {}, baseEnv());
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ error: { code: "unauthorized" } });
  });

  it("本番では X-Dev-User を無視する", async () => {
    const app = createApp();
    const res = await app.request(
      "/api/me",
      { headers: { [DEV_USER_HEADER]: "someone@example.com" } },
      baseEnv({ ENVIRONMENT: "production" }),
    );
    expect(res.status).toBe(401);
  });

  it("development では X-Dev-User でログイン相当になり、users に作られる", async () => {
    const app = createApp();
    const env = baseEnv({ ENVIRONMENT: "development" });
    const res = await app.request("/api/me", { headers: { [DEV_USER_HEADER]: "Dev@Example.com" } }, env);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ user_id: "dev@example.com" });
    expect((env.DB as unknown as { users: Map<string, unknown> }).users.has("dev@example.com")).toBe(true);
  });

  it("development でも X-Dev-User がメール形式でなければ 401", async () => {
    const app = createApp();
    const res = await app.request(
      "/api/me",
      { headers: { [DEV_USER_HEADER]: "not-an-email" } },
      baseEnv({ ENVIRONMENT: "development" }),
    );
    expect(res.status).toBe(401);
  });

  it("壊れた Access JWT は development でも X-Dev-User にフォールバックしない", async () => {
    const r = await resolveUserId(
      new Request("http://x/api/me", {
        headers: { [ACCESS_JWT_HEADER]: "a.b.c", [DEV_USER_HEADER]: "dev@example.com" },
      }),
      { ENVIRONMENT: "development", ACCESS_TEAM_DOMAIN: TEAM, ACCESS_AUD: AUD },
      { fetchJwks: async () => ({ keys: [] }), now: () => NOW },
    );
    expect(r.userId).toBeNull();
  });

  it("正しい Access JWT でメールが user_id になる", async () => {
    const key = await makeTestKey();
    const token = await signJwt(key, validClaims(NOW));
    const r = await resolveUserId(
      new Request("http://x/api/me", { headers: { [ACCESS_JWT_HEADER]: token } }),
      { ENVIRONMENT: "production", ACCESS_TEAM_DOMAIN: TEAM, ACCESS_AUD: AUD },
      { fetchJwks: async () => key.jwks, now: () => NOW },
    );
    expect(r).toEqual({ userId: "hana@example.com", via: "access" });
  });
});

describe("未知の /api パス", () => {
  it("認証なしなら 401（経路の有無を明かさない）", async () => {
    const app = createApp();
    const res = await app.request("/api/nope", {}, baseEnv());
    expect(res.status).toBe(401);
  });

  it("認証ありなら 404 を JSON で返す", async () => {
    const app = createApp();
    const res = await app.request(
      "/api/nope",
      { headers: { [DEV_USER_HEADER]: "dev@example.com" } },
      baseEnv({ ENVIRONMENT: "development" }),
    );
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ error: { code: "not_found" } });
  });
});
