import { beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/index";
import { DEV_USER_HEADER } from "../src/auth";
import type { Env } from "../src/env";
import { buildListSql } from "../src/db/memories";
import { createTestD1, fakeR2, type TestD1 } from "./sqlite-d1";

const ME = "hana@example.com";
const OTHER = "other@example.com";

let db: TestD1;
let env: Env;
const app = () => createApp();
const H = { [DEV_USER_HEADER]: ME, "content-type": "application/json" };
const H_OTHER = { [DEV_USER_HEADER]: OTHER, "content-type": "application/json" };

const post = (body: unknown, headers = H) =>
  app().request("/api/memories", { method: "POST", headers, body: JSON.stringify(body) }, env);

beforeEach(async () => {
  db = createTestD1();
  env = {
    DB: db,
    PHOTOS: fakeR2(),
    ASSETS: {} as Fetcher,
    ENVIRONMENT: "development",
    ANTHROPIC_MODEL: "claude-opus-5-5",
    ACCESS_TEAM_DOMAIN: "",
    ACCESS_AUD: "",
    APP_VERSION: "test",
  } as Env;
  // /api/me で users を作っておく（FK）
  await app().request("/api/me", { headers: { [DEV_USER_HEADER]: ME } }, env);
  await app().request("/api/me", { headers: { [DEV_USER_HEADER]: OTHER } }, env);
});

describe("POST /api/memories", () => {
  it("F2-1: 本文だけで 201、JST の今日・day・写真なし", async () => {
    const res = await post({ body: "スーパーで青梅を見かけた" });
    expect(res.status).toBe(201);
    const m = (await res.json()) as Record<string, unknown>;
    expect(m).toMatchObject({ body: "スーパーで青梅を見かけた", happened_on_precision: "day", photo_key: null });
    expect(m.happened_on).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    const row = db.raw.prepare("SELECT user_id, body FROM memories WHERE id = ?").get(m.id as string) as Record<string, unknown>;
    expect(row).toEqual({ user_id: ME, body: "スーパーで青梅を見かけた" });
  });
  it("F2-2: 空白のみは 400 validation、行は作られない", async () => {
    const res = await post({ body: "  " });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: { code: "validation" } });
    expect((db.raw.prepare("SELECT count(*) AS n FROM memories").get() as { n: number }).n).toBe(0);
  });
  it("JSON でない本文は 400", async () => {
    const res = await app().request("/api/memories", { method: "POST", headers: H, body: "not json" }, env);
    expect(res.status).toBe(400);
  });
  it("F2-4: unknown は happened_on NULL", async () => {
    const res = await post({ body: "いつだったか", happened_on_precision: "unknown" });
    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({ happened_on: null, happened_on_precision: "unknown" });
  });
  it("month / year は丸める", async () => {
    const a = (await (await post({ body: "a", happened_on: "2025-06", happened_on_precision: "month" })).json()) as { happened_on: string };
    const b = (await (await post({ body: "b", happened_on: "2024", happened_on_precision: "year" })).json()) as { happened_on: string };
    expect(a.happened_on).toBe("2025-06-01");
    expect(b.happened_on).toBe("2024-01-01");
  });
  it("afterSave が 201 の前に呼ばれ、memory と waitUntil を受け取る", async () => {
    const calls: string[] = [];
    const a = createApp({ memories: { afterSave: async ({ memory, userId }) => void calls.push(`${userId}:${memory.body}`) } });
    const res = await a.request("/api/memories", { method: "POST", headers: H, body: JSON.stringify({ body: "x" }) }, env);
    expect(res.status).toBe(201);
    expect(calls).toEqual([`${ME}:x`]);
  });
});

describe("GET /api/memories", () => {
  const seed = async (rows: Array<[string, string | null, string]>) => {
    // [body, happened_on, created_at]
    for (const [body, h, c] of rows) {
      db.raw
        .prepare(
          "INSERT INTO memories (id, user_id, body, happened_on, happened_on_precision, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
        )
        .run(crypto.randomUUID(), ME, body, h, h ? "day" : "unknown", c, c);
    }
  };
  const bodies = async (url: string, headers = { [DEV_USER_HEADER]: ME }) => {
    const res = await app().request(url, { headers }, env);
    expect(res.status).toBe(200);
    const j = (await res.json()) as { items: { body: string }[]; next_cursor: string | null };
    return { bodies: j.items.map((i) => i.body), next: j.next_cursor };
  };

  it("F3-1: 起きた日の降順、不明は最後", async () => {
    await seed([
      ["jun", "2026-06-15", "2026-06-15T00:00:00.000Z"],
      ["nov", "2026-11-03", "2026-11-03T00:00:00.000Z"],
      ["unk", null, "2026-11-04T00:00:00.000Z"],
      ["jan", "2024-01-01", "2024-01-01T00:00:00.000Z"],
    ]);
    expect((await bodies("/api/memories")).bodies).toEqual(["nov", "jun", "jan", "unk"]);
  });
  it("F3-2: 同じ日は作成の降順", async () => {
    await seed([
      ["A", "2026-11-03", "2026-11-03T01:00:00.000Z"],
      ["B", "2026-11-03", "2026-11-03T02:00:00.000Z"],
    ]);
    expect((await bodies("/api/memories")).bodies).toEqual(["B", "A"]);
  });
  it("F3-3: 25 件を 20 + 5 で重複も欠落もなく、2 ページ目の next_cursor は null", async () => {
    const rows: Array<[string, string | null, string]> = [];
    for (let i = 0; i < 25; i++) {
      // 日付を 3 種類に絞って同日の多発（カーソルのタイブレーク）を確かめる
      const day = (["2026-11-01", "2026-11-02", null] as const)[i % 3] ?? null;
      rows.push([`m${i}`, day, `2026-11-0${(i % 3) + 1}T00:00:${String(i).padStart(2, "0")}.000Z`]);
    }
    await seed(rows);
    const p1 = await bodies("/api/memories");
    expect(p1.bodies).toHaveLength(20);
    expect(p1.next).toBeTruthy();
    const p2 = await bodies(`/api/memories?cursor=${p1.next}`);
    expect(p2.bodies).toHaveLength(5);
    expect(p2.next).toBeNull();
    const all = [...p1.bodies, ...p2.bodies];
    expect(new Set(all).size).toBe(25);
  });
  it("limit は 1〜50 に丸める。壊れたカーソルは 400", async () => {
    await seed([["a", "2026-11-01", "2026-11-01T00:00:00.000Z"], ["b", "2026-11-02", "2026-11-02T00:00:00.000Z"]]);
    expect((await bodies("/api/memories?limit=1")).bodies).toHaveLength(1);
    expect((await bodies("/api/memories?limit=999")).bodies).toHaveLength(2);
    const res = await app().request("/api/memories?cursor=!!!", { headers: { [DEV_USER_HEADER]: ME } }, env);
    expect(res.status).toBe(400);
  });
  it("X-11: 他人の記憶は見えない", async () => {
    await seed([["mine", "2026-11-01", "2026-11-01T00:00:00.000Z"]]);
    expect((await bodies("/api/memories", { [DEV_USER_HEADER]: OTHER })).bodies).toEqual([]);
  });
  it("SQL: カーソル無しは 2 バインド、有りは 5 バインドで同じ ORDER BY", () => {
    expect(buildListSql(null).bindCount).toBe(2);
    const withCursor = buildListSql({ h: "", c: "", i: "" });
    expect(withCursor.bindCount).toBe(5);
    expect(withCursor.sql).toContain("ORDER BY COALESCE(happened_on,'') DESC, created_at DESC, id DESC");
    expect(withCursor.sql).toContain("user_id = ?1");
  });
});

type Detail = { facts: { pending: boolean; items: unknown[] }; recalls: { pending: boolean; items: unknown[] }; recalled_by: { items: unknown[] } };

describe("GET / DELETE /api/memories/:id", () => {
  const create = async (body: string, headers = H) => (await (await post({ body }, headers)).json()) as { id: string };

  it("詳細は memory と空の facts / recalls / recalled_by の枠を返す", async () => {
    const { id } = await create("青梅");
    const res = await app().request(`/api/memories/${id}`, { headers: { [DEV_USER_HEADER]: ME } }, env);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      memory: expect.objectContaining({ id, body: "青梅" }),
      facts: { pending: false, items: [] },
      recalls: { pending: false, items: [] },
      recalled_by: { items: [] },
    });
  });

  it("F3-8: facts は全 status を返し、recalls / recalled_by は相手の記憶を含む", async () => {
    const { id: oldId } = await create("おばあちゃんは毎年6月になると梅干しを漬けていた");
    const { id: newId } = await create("スーパーで青梅を見かけた");
    const now = "2026-11-05T00:00:00.000Z";
    for (const [st, v] of [["candidate", "a"], ["confirmed", "b"], ["rejected", "c"]] as const) {
      db.raw
        .prepare("INSERT INTO memory_facts (id, memory_id, kind, value, status, source, evidence, created_at) VALUES (?, ?, 'thing', ?, ?, 'ai', ?, ?)")
        .run(`f-${v}`, newId, v, st, v, now);
    }
    db.raw
      .prepare("INSERT INTO recalls (id, memory_id, related_memory_id, reason, evidence, created_at) VALUES ('r1', ?, ?, '梅', '梅干しを漬けていた', ?)")
      .run(newId, oldId, now);

    const n = (await (await app().request(`/api/memories/${newId}`, { headers: { [DEV_USER_HEADER]: ME } }, env)).json()) as Detail;
    expect(n.facts.items.map((f) => (f as { status: string }).status).sort()).toEqual(["candidate", "confirmed", "rejected"]);
    expect(n.recalls.items).toHaveLength(1);
    expect(n.recalls.items[0]).toMatchObject({ id: "r1", evidence: "梅干しを漬けていた", related_memory: { id: oldId } });
    expect(n.recalled_by.items).toEqual([]);

    const o = (await (await app().request(`/api/memories/${oldId}`, { headers: { [DEV_USER_HEADER]: ME } }, env)).json()) as Detail;
    expect(o.recalled_by.items[0]).toMatchObject({ id: "r1", memory: { id: newId, body: "スーパーで青梅を見かけた" } });
    expect(o.recalls.items).toEqual([]);
  });

  it("pending は 60 秒以内の running 行があるときだけ true", async () => {
    const { id } = await create("x");
    const fresh = new Date().toISOString();
    const stale = new Date(Date.now() - 120_000).toISOString();
    db.raw
      .prepare("INSERT INTO ai_runs (id, user_id, memory_id, kind, model, status, created_at) VALUES ('a1', ?, ?, 'facts', 'm', 'running', ?)")
      .run(ME, id, fresh);
    db.raw
      .prepare("INSERT INTO ai_runs (id, user_id, memory_id, kind, model, status, created_at) VALUES ('a2', ?, ?, 'recall', 'm', 'running', ?)")
      .run(ME, id, stale);
    const j = (await (await app().request(`/api/memories/${id}`, { headers: { [DEV_USER_HEADER]: ME } }, env)).json()) as Detail;
    expect(j.facts.pending).toBe(true);
    expect(j.recalls.pending).toBe(false);
  });

  it("F3-5: 他人の記憶は GET も DELETE も 404 で、消えない", async () => {
    const { id } = await create("mine");
    const g = await app().request(`/api/memories/${id}`, { headers: { [DEV_USER_HEADER]: OTHER } }, env);
    const d = await app().request(`/api/memories/${id}`, { method: "DELETE", headers: { [DEV_USER_HEADER]: OTHER } }, env);
    expect(g.status).toBe(404);
    expect(d.status).toBe(404);
    expect(db.raw.prepare("SELECT count(*) AS n FROM memories").get()).toEqual({ n: 1 });
  });

  it("F3-4: 削除で facts と recalls（両側）と R2 の写真も消え、以後 404", async () => {
    const { id: oldId } = await create("old");
    const { id: newId } = await create("new");
    const now = "2026-11-05T00:00:00.000Z";
    db.raw.prepare("INSERT INTO memory_facts (id, memory_id, kind, value, status, source, created_at) VALUES ('f1', ?, 'thing', 'x', 'confirmed', 'user', ?)").run(newId, now);
    db.raw.prepare("INSERT INTO recalls (id, memory_id, related_memory_id, reason, evidence, created_at) VALUES ('r1', ?, ?, 'r', 'e', ?)").run(newId, oldId, now);
    const key = `photos/${ME}/${newId}/p.jpg`;
    const r2 = env.PHOTOS as unknown as { store: Map<string, unknown> };
    r2.store.set(key, { body: new Uint8Array([1]), contentType: "image/jpeg" });
    db.raw.prepare("UPDATE memories SET photo_key = ?, photo_content_type = 'image/jpeg' WHERE id = ?").run(key, newId);

    const d = await app().request(`/api/memories/${newId}`, { method: "DELETE", headers: { [DEV_USER_HEADER]: ME } }, env);
    expect(d.status).toBe(204);
    expect(r2.store.has(key)).toBe(false);
    expect(db.raw.prepare("SELECT count(*) AS n FROM memory_facts").get()).toEqual({ n: 0 });
    expect(db.raw.prepare("SELECT count(*) AS n FROM recalls").get()).toEqual({ n: 0 });
    expect((await app().request(`/api/memories/${newId}`, { headers: { [DEV_USER_HEADER]: ME } }, env)).status).toBe(404);
    // 相手側（old）は残る
    expect((await app().request(`/api/memories/${oldId}`, { headers: { [DEV_USER_HEADER]: ME } }, env)).status).toBe(200);
  });

  it("削除した記憶を related に持つ札も消える（related 側の CASCADE）", async () => {
    const { id: oldId } = await create("old");
    const { id: newId } = await create("new");
    db.raw.prepare("INSERT INTO recalls (id, memory_id, related_memory_id, reason, evidence, created_at) VALUES ('r1', ?, ?, 'r', 'e', 'now')").run(newId, oldId);
    await app().request(`/api/memories/${oldId}`, { method: "DELETE", headers: { [DEV_USER_HEADER]: ME } }, env);
    expect(db.raw.prepare("SELECT count(*) AS n FROM recalls").get()).toEqual({ n: 0 });
  });
});
