// GET /api/connections（つながり）。seed.sql をテスト用 D1 に流して確かめる。
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/index";
import { DEV_USER_HEADER } from "../src/auth";
import type { Env } from "../src/env";
import { createTestD1, fakeR2, type TestD1 } from "./sqlite-d1";

const SEED = join(__dirname, "..", "..", "demo", "fixtures", "seed.sql");
const DEMO = "demo@example.com";
const OTHER = "other@example.com";

type Summary = { id: string; body: string; happened_on: string | null; happened_on_precision: string; photo_key: string | null };
type Item = { id: string; reason: string; evidence: string; feedback: string; created_at: string; memory: Summary; related_memory: Summary };
type Body = { items: Item[]; beads: Array<{ happened_on: string; happened_on_precision: string }> };

let db: TestD1;
let env: Env;

beforeEach(() => {
  db = createTestD1();
  db.raw.exec(readFileSync(SEED, "utf8"));
  env = {
    DB: db,
    PHOTOS: fakeR2(),
    ASSETS: {} as Fetcher,
    ENVIRONMENT: "development",
    ANTHROPIC_MODEL: "claude-opus-5-5",
    APP_VERSION: "test",
  } as Env;
});

const get = async (user: string): Promise<Body> => {
  const res = await createApp().request("/api/connections", { headers: { [DEV_USER_HEADER]: user } }, env);
  expect(res.status).toBe(200);
  return (await res.json()) as Body;
};

const patch = (id: string, feedback: string, user = DEMO) =>
  createApp().request(
    `/api/recalls/${id}`,
    { method: "PATCH", headers: { [DEV_USER_HEADER]: user, "content-type": "application/json" }, body: JSON.stringify({ feedback }) },
    env,
  );

const addMemory = (id: string, user: string, happenedOn: string | null, precision: string, createdAt: string) =>
  db.raw
    .prepare(
      "INSERT INTO memories (id, user_id, body, happened_on, happened_on_precision, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
    )
    .run(id, user, `本文 ${id}`, happenedOn, precision, createdAt, createdAt);

const addRecall = (id: string, memoryId: string, relatedId: string, createdAt: string, feedback = "none") =>
  db.raw
    .prepare("INSERT INTO recalls (id, memory_id, related_memory_id, reason, evidence, feedback, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .run(id, memoryId, relatedId, "理由", "本文", feedback, createdAt);

describe("GET /api/connections", () => {
  it("認証なしは 401（X-Dev-User も Authorization も無い）", async () => {
    const res = await createApp().request("/api/connections", {}, env);
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ error: { code: "unauthorized" } });
  });

  it("本番では X-Dev-User を付けても 401", async () => {
    const res = await createApp().request("/api/connections", { headers: { [DEV_USER_HEADER]: DEMO } }, { ...env, ENVIRONMENT: "production" } as Env);
    expect(res.status).toBe(401);
  });

  it("demo@example.com で recall_seed_01 が memory（新しい側）/ related_memory（昔の側）の形で返る", async () => {
    const body = await get(DEMO);
    expect(body.items).toEqual([
      {
        id: "recall_seed_01",
        reason: "ゆきと一緒にごはんを食べた記憶",
        evidence: "ゆきと駅前の喫茶店でパンケーキを食べた",
        feedback: "helpful",
        created_at: "2026-04-06T04:00:40.000Z",
        memory: {
          id: "mem_daily_08",
          body: "近所の公園でゆきと弁当を食べた。風が強くて、レジャーシートが飛びそうになった。",
          happened_on: "2026-04-06",
          happened_on_precision: "day",
          photo_key: null,
        },
        related_memory: {
          id: "mem_daily_05",
          body: "ゆきと駅前の喫茶店でパンケーキを食べた。ゆきは相変わらずよく笑う。",
          happened_on: "2025-05-11",
          happened_on_precision: "day",
          photo_key: null,
        },
      },
    ]);
    expect(Object.keys(body).sort()).toEqual(["beads", "items"]);
  });

  it("other@example.com の記憶にかかる札は出ない（両端とも他人の札も、片側だけ他人の札も）", async () => {
    addMemory("mem_other_02", OTHER, "2026-06-01", "day", "2026-06-01T00:00:00.000Z");
    addRecall("r_other_both", "mem_other_02", "mem_other_01", "2026-06-01T00:00:10.000Z"); // 両端とも other
    addRecall("r_half_new_mine", "mem_daily_09", "mem_other_01", "2026-07-19T11:00:10.000Z"); // 新しい側だけ demo
    addRecall("r_half_old_mine", "mem_other_02", "mem_daily_05", "2026-06-01T00:00:20.000Z"); // 昔の側だけ demo

    const mine = await get(DEMO);
    expect(mine.items.map((i) => i.id)).toEqual(["recall_seed_01"]);
    expect(JSON.stringify(mine)).not.toContain("mem_other_");

    const theirs = await get(OTHER);
    expect(theirs.items.map((i) => i.id)).toEqual(["r_other_both"]);
    expect(JSON.stringify(theirs)).not.toContain("mem_daily_");
  });

  it("feedback を not_related にすると消え、none に戻すとまた出る", async () => {
    expect((await patch("recall_seed_01", "not_related")).status).toBe(200);
    expect((await get(DEMO)).items).toEqual([]);
    expect((await patch("recall_seed_01", "none")).status).toBe(200);
    const back = await get(DEMO);
    expect(back.items.map((i) => [i.id, i.feedback])).toEqual([["recall_seed_01", "none"]]);
  });

  it("created_at DESC、同じ時刻なら id DESC の順", async () => {
    addRecall("r_b", "mem_daily_10", "mem_daily_03", "2026-09-28T10:30:20.000Z");
    addRecall("r_a", "mem_daily_10", "mem_daily_06", "2026-09-28T10:30:20.000Z");
    addRecall("r_old", "mem_d1_02", "mem_d1_01", "2025-01-12T08:30:40.000Z", "helpful");
    const body = await get(DEMO);
    expect(body.items.map((i) => i.id)).toEqual(["r_b", "r_a", "recall_seed_01", "r_old"]);
  });

  it("55 本あれば新しい 50 本で切れる", async () => {
    // UNIQUE (memory_id, related_memory_id) に当たらないよう、新しい記憶を 55 件足して、それぞれ mem_d1_01 に結ぶ
    db.raw.exec("DELETE FROM recalls");
    for (let i = 0; i < 55; i++) {
      const n = String(i).padStart(2, "0");
      const at = `2026-11-01T00:00:${n}.000Z`;
      addMemory(`mem_n_${n}`, DEMO, "2026-11-01", "day", at);
      addRecall(`r_${n}`, `mem_n_${n}`, "mem_d1_01", at);
    }
    const body = await get(DEMO);
    expect(body.items).toHaveLength(50);
    const expected = Array.from({ length: 50 }, (_, k) => `r_${String(54 - k).padStart(2, "0")}`);
    expect(body.items.map((i) => i.id)).toEqual(expected);
  });

  it("beads は起きた日がわかっている自分の記憶だけ（unknown と他人の記憶は入らない）", async () => {
    const body = await get(DEMO);
    // demo の記憶 16 件のうち、unknown（mem_daily_12）の 1 件を除いた 15 件
    expect(body.beads).toHaveLength(15);
    expect(body.beads.every((b) => typeof b.happened_on === "string" && b.happened_on_precision !== "unknown")).toBe(true);
    // 他人の記憶（mem_other_01、2025-06-08）の日付は入らない
    expect(body.beads.map((b) => b.happened_on)).not.toContain("2025-06-08");
    // 日付と精度だけを返す（本文や id は出さない）
    for (const b of body.beads) expect(Object.keys(b).sort()).toEqual(["happened_on", "happened_on_precision"]);
    // 新しい順。month 精度はそのまま
    expect(body.beads[0]).toEqual({ happened_on: "2026-10-01", happened_on_precision: "month" });
    expect(body.beads).toContainEqual({ happened_on: "2024-06-01", happened_on_precision: "month" });

    const theirs = await get(OTHER);
    expect(theirs.beads).toEqual([{ happened_on: "2025-06-08", happened_on_precision: "day" }]);
  });

  it("記憶も札も無い利用者は items も beads も空", async () => {
    expect(await get("fresh@example.com")).toEqual({ items: [], beads: [] });
  });

  it("記憶はあっても札が無ければ items は空で、beads だけ返る", async () => {
    db.raw.exec("DELETE FROM recalls");
    const body = await get(DEMO);
    expect(body.items).toEqual([]);
    expect(body.beads).toHaveLength(15);
  });
});
