// 画面側 api.ts の 401 の扱い（ADR-0007: 401 でトークンを消して S0 へ）。DOM は使わず、fetch / window / Preferences を差し替える。
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const store = new Map<string, string>();
vi.mock("@capacitor/preferences", () => ({
  Preferences: {
    get: vi.fn(async ({ key }: { key: string }) => ({ value: store.get(key) ?? null })),
    set: vi.fn(async ({ key, value }: { key: string; value: string }) => void store.set(key, value)),
    remove: vi.fn(async ({ key }: { key: string }) => void store.delete(key)),
  },
}));

const { api, ApiError } = await import("../src/api");
const { getTokenSync, saveToken } = await import("../src/auth");

const dispatchEvent = vi.fn((_e: Event) => true);
const jsonRes = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

beforeEach(async () => {
  store.clear();
  dispatchEvent.mockClear();
  vi.stubGlobal("window", { dispatchEvent });
  await saveToken("tok-1", "a@example.com");
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("api.ts の 401", () => {
  it("認証付きの呼び出しが 401 なら、トークンを消して souieba:unauthorized を発火し、ApiError(401) を投げる", async () => {
    const fetchMock = vi.fn(async () => jsonRes(401, { error: { code: "unauthorized", message: "ログインが必要です" } }));
    vi.stubGlobal("fetch", fetchMock);

    const err = await api.me().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as InstanceType<typeof ApiError>).status).toBe(401);
    expect((err as InstanceType<typeof ApiError>).code).toBe("unauthorized");

    // Bearer を付けて送っていた
    const init = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(new Headers(init[1].headers).get("authorization")).toBe("Bearer tok-1");
    // トークンが消え、イベントが 1 回出た
    expect(getTokenSync()).toBeNull();
    expect(store.has("souieba.token")).toBe(false);
    expect(store.has("souieba.user")).toBe(false);
    expect(dispatchEvent).toHaveBeenCalledTimes(1);
    expect(dispatchEvent.mock.calls[0]![0].type).toBe("souieba:unauthorized");
  });

  it("ログイン API（auth: false）の 401 では発火せず、トークンも消さない。Authorization も付けない", async () => {
    const fetchMock = vi.fn(async () => jsonRes(401, { error: { code: "unauthorized", message: "招待コードかメールアドレスが違います" } }));
    vi.stubGlobal("fetch", fetchMock);

    const err = await api.login("wrong", "a@example.com").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as InstanceType<typeof ApiError>).status).toBe(401);
    expect((err as InstanceType<typeof ApiError>).message).toBe("招待コードかメールアドレスが違います");
    expect(dispatchEvent).not.toHaveBeenCalled();
    expect(getTokenSync()).toBe("tok-1");
    const init = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(new Headers(init[1].headers).get("authorization")).toBeNull();
  });

  it("401 以外の失敗（500、404）では発火しない", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonRes(500, { error: { code: "internal", message: "x" } })));
    await expect(api.listMemories()).rejects.toMatchObject({ status: 500, code: "internal" });
    vi.stubGlobal("fetch", vi.fn(async () => jsonRes(404, { error: { code: "not_found", message: "x" } })));
    await expect(api.getMemory("m1")).rejects.toMatchObject({ status: 404, code: "not_found" });
    expect(dispatchEvent).not.toHaveBeenCalled();
    expect(getTokenSync()).toBe("tok-1");
  });

  it("ネットワークの失敗は status 0 の ApiError（network）になり、発火しない", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new TypeError("Failed to fetch"))));
    const err = await api.me().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ status: 0, code: "network", message: "いま、うまくつながりません" });
    expect(dispatchEvent).not.toHaveBeenCalled();
    expect(getTokenSync()).toBe("tok-1");
  });

  it("api.connections は GET /api/connections に Bearer を付けて送り、応答をそのまま返す。401 なら他と同じくトークンを消して発火する", async () => {
    const body = {
      items: [
        {
          id: "recall_seed_01",
          reason: "ゆきと一緒にごはんを食べた記憶",
          evidence: "ゆきと駅前の喫茶店でパンケーキを食べた",
          feedback: "helpful",
          created_at: "2026-04-06T04:00:40.000Z",
          memory: { id: "mem_daily_08", body: "近所の公園でゆきと弁当を食べた。", happened_on: "2026-04-06", happened_on_precision: "day", photo_key: null },
          related_memory: { id: "mem_daily_05", body: "ゆきと駅前の喫茶店でパンケーキを食べた。", happened_on: "2025-05-11", happened_on_precision: "day", photo_key: null },
        },
      ],
      beads: [{ happened_on: "2024-06-01", happened_on_precision: "month" }],
    };
    const ok = vi.fn(async () => jsonRes(200, body));
    vi.stubGlobal("fetch", ok);
    await expect(api.connections()).resolves.toEqual(body);
    const [url, init] = ok.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/connections");
    expect(init.method ?? "GET").toBe("GET");
    expect(new Headers(init.headers).get("authorization")).toBe("Bearer tok-1");
    expect(dispatchEvent).not.toHaveBeenCalled();

    vi.stubGlobal("fetch", vi.fn(async () => jsonRes(401, { error: { code: "unauthorized", message: "ログインが必要です" } })));
    await expect(api.connections()).rejects.toMatchObject({ status: 401, code: "unauthorized" });
    expect(getTokenSync()).toBeNull();
    expect(dispatchEvent).toHaveBeenCalledTimes(1);
  });

  it("本文の無い 401 でも発火し、code は http_error", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 401, statusText: "Unauthorized" })));
    await expect(api.getFacts("m1")).rejects.toMatchObject({ status: 401, code: "http_error" });
    expect(dispatchEvent).toHaveBeenCalledTimes(1);
  });
});
