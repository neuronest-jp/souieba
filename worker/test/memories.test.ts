import { beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/index";
import { DEV_USER_HEADER } from "../src/auth";
import type { Env } from "../src/env";
import { buildListSql } from "../src/db/memories";
import { createTestD1, fakeExecutionCtx, fakeR2, type TestD1 } from "./sqlite-d1";

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
  it("初めてのユーザーが /api/me を経ずに POST しても 201（users は認証時に作られる）", async () => {
    const res = await post({ body: "初回" }, { [DEV_USER_HEADER]: "fresh@example.com", "content-type": "application/json" });
    expect(res.status).toBe(201);
    expect(db.raw.prepare("SELECT count(*) AS n FROM users WHERE id = 'fresh@example.com'").get()).toEqual({ n: 1 });
  });

  it("afterSave は 201 の前に呼ばれ、waitUntil に渡した処理は応答後に続く", async () => {
    const ctx = fakeExecutionCtx();
    let background = "not yet";
    const a = createApp({
      memories: {
        afterSave: async ({ env: e, memory, userId, waitUntil }) => {
          // 201 の前に同期で記録を残す（11/6 の ai_runs と同じ形）
          await e.DB.prepare("INSERT INTO ai_runs (id, user_id, memory_id, kind, model, status, created_at) VALUES ('a1', ?1, ?2, 'facts', 'm', 'running', 'now')")
            .bind(userId, memory.id)
            .run();
          waitUntil(Promise.resolve().then(() => void (background = "done")));
        },
      },
    });
    const res = await a.request("/api/memories", { method: "POST", headers: H, body: JSON.stringify({ body: "x" }) }, env, ctx);
    expect(res.status).toBe(201);
    const { id } = (await res.json()) as { id: string };
    expect(db.raw.prepare("SELECT status FROM ai_runs WHERE memory_id = ?").get(id)).toEqual({ status: "running" });
    expect(ctx.pending).toHaveLength(1);
    await ctx.settle();
    expect(background).toBe("done");
  });

  it("afterSave が例外を投げても記憶は保存され 201（AI は静かな失敗）", async () => {
    const a = createApp({ memories: { afterSave: async () => { throw new Error("D1 down"); } } });
    const res = await a.request("/api/memories", { method: "POST", headers: H, body: JSON.stringify({ body: "x" }) }, env, fakeExecutionCtx());
    expect(res.status).toBe(201);
    expect(db.raw.prepare("SELECT count(*) AS n FROM memories").get()).toEqual({ n: 1 });
  });

  it("happened_on が空文字なら 400（消した状態を今日にしない）", async () => {
    const res = await post({ body: "x", happened_on: "", happened_on_precision: "day" });
    expect(res.status).toBe(400);
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
  // LIST_ORDER と同じ比較で期待順を作る
  const expectedOrder = (rows: Array<{ body: string; h: string | null; c: string; id: string }>) =>
    [...rows]
      .sort((a, b) => {
        const ah = a.h ?? "";
        const bh = b.h ?? "";
        if (ah !== bh) return ah < bh ? 1 : -1;
        if (a.c !== b.c) return a.c < b.c ? 1 : -1;
        return a.id < b.id ? 1 : -1;
      })
      .map((r) => r.body);

  it("F3-3: 25 件を 20 + 5 で、順序どおり重複も欠落もなく、2 ページ目の next_cursor は null", async () => {
    const rows: Array<{ body: string; h: string | null; c: string; id: string }> = [];
    for (let i = 0; i < 25; i++) {
      const h = (["2026-11-01", "2026-11-02", null] as const)[i % 3] ?? null;
      // 同じ (happened_on, created_at) の組を意図的に作る（i を 5 で割った商で created_at を決める）
      const c = `2026-11-0${(i % 3) + 1}T00:00:${String(Math.floor(i / 5)).padStart(2, "0")}.000Z`;
      const id = `id-${String(i).padStart(2, "0")}`;
      rows.push({ body: `m${i}`, h, c, id });
      db.raw
        .prepare("INSERT INTO memories (id, user_id, body, happened_on, happened_on_precision, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
        .run(id, ME, `m${i}`, h, h ? "day" : "unknown", c, c);
    }
    const p1 = await bodies("/api/memories");
    expect(p1.bodies).toHaveLength(20);
    expect(p1.next).toBeTruthy();
    const p2 = await bodies(`/api/memories?cursor=${p1.next}`);
    expect(p2.bodies).toHaveLength(5);
    expect(p2.next).toBeNull();
    expect([...p1.bodies, ...p2.bodies]).toEqual(expectedOrder(rows));
  });

  it("同じ起きた日・同じ created_at の行も、limit=2 で id のタイブレークにより欠落なく返る", async () => {
    const rows = ["id-a", "id-b", "id-c", "id-d", "id-e"].map((id) => ({ body: id, h: "2026-11-01", c: "2026-11-01T00:00:00.000Z", id }));
    for (const r of rows) {
      db.raw
        .prepare("INSERT INTO memories (id, user_id, body, happened_on, happened_on_precision, created_at, updated_at) VALUES (?, ?, ?, ?, 'day', ?, ?)")
        .run(r.id, ME, r.body, r.h, r.c, r.c);
    }
    const got: string[] = [];
    let cursor: string | null = null;
    for (let page = 0; page < 10; page++) {
      const r = await bodies(`/api/memories?limit=2${cursor ? `&cursor=${cursor}` : ""}`);
      got.push(...r.bodies);
      cursor = r.next;
      if (!cursor) break;
    }
    expect(got).toEqual(["id-e", "id-d", "id-c", "id-b", "id-a"]);
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

  // 裏の処理（候補・札の INSERT → ai_runs を succeeded）が、GET の 2 本の読み取りの間に終わる場合を決定的に作る。
  // ai_runs を最初に読む直前に「書き込みが済んだ」ことにする。items を先に（並行に）読むと pending=false・items=[] になり、
  // 画面のポーリングが「終わった」と見て止まる。pending を先に読めば、false のとき items はそろっている。
  it.each([
    ["/facts", (j: Record<string, unknown>) => [j]],
    ["/recalls", (j: Record<string, unknown>) => [j]],
    ["", (j: Record<string, unknown>) => [j.facts, j.recalls]],
  ] as const)("GET /api/memories/:id%s: pending=false なら items はそろっている（書き込みが読み取りの間に終わっても）", async (path, pick) => {
    const now = new Date().toISOString();
    const ins = db.raw.prepare("INSERT INTO memories (id, user_id, body, happened_on, happened_on_precision, created_at, updated_at) VALUES (?, ?, ?, NULL, 'unknown', ?, ?)");
    ins.run("old", ME, "梅干しを漬けていた", now, now);
    ins.run("new", ME, "青梅を見かけた", now, now);
    const run = db.raw.prepare("INSERT INTO ai_runs (id, user_id, memory_id, kind, model, status, created_at) VALUES (?, ?, 'new', ?, 'm', 'running', ?)");
    run.run("run-f", ME, "facts", now);
    run.run("run-r", ME, "recall", now);
    const finishWriters = () => {
      db.raw.prepare("INSERT INTO memory_facts (id, memory_id, kind, value, status, source, evidence, created_at) VALUES ('f1', 'new', 'thing', '青梅', 'candidate', 'ai', '青梅', ?)").run(now);
      db.raw.prepare("UPDATE ai_runs SET status = 'succeeded' WHERE id = 'run-f'").run();
      db.raw.prepare("INSERT INTO recalls (id, memory_id, related_memory_id, reason, evidence, created_at) VALUES ('r1', 'new', 'old', 'r', '梅干し', ?)").run(now);
      db.raw.prepare("UPDATE ai_runs SET status = 'succeeded' WHERE id = 'run-r'").run();
    };
    let fired = false;
    const racing = {
      ...db,
      prepare: (sql: string) => {
        if (!fired && sql.includes("FROM ai_runs")) {
          fired = true;
          finishWriters();
        }
        return db.prepare(sql);
      },
    } as unknown as D1Database;

    const res = await app().request(`/api/memories/new${path}`, { headers: { [DEV_USER_HEADER]: ME } }, { ...env, DB: racing });
    expect(res.status).toBe(200);
    expect(fired).toBe(true);
    for (const part of pick((await res.json()) as Record<string, unknown>)) {
      expect(part).toMatchObject({ pending: false });
      expect((part as { items: unknown[] }).items).toHaveLength(1);
    }
  });

  it("F3-5: 他人の記憶は GET も DELETE も 404 で、消えない", async () => {
    const { id } = await create("mine");
    const g = await app().request(`/api/memories/${id}`, { headers: { [DEV_USER_HEADER]: OTHER } }, env);
    const d = await app().request(`/api/memories/${id}`, { method: "DELETE", headers: { [DEV_USER_HEADER]: OTHER } }, env);
    expect(g.status).toBe(404);
    expect(d.status).toBe(404);
    expect(db.raw.prepare("SELECT count(*) AS n FROM memories").get()).toEqual({ n: 1 });
  });

  it("X-11: 他人の記憶の /facts と /recalls は 404 で、候補の値も札の相手の本文も返さない", async () => {
    // listFacts / listRecalls は memory_id だけで引くので、所有者の確認はルートの getMemory に頼っている
    const { id: oldId } = await create("梅干しを漬けていた");
    const { id: newId } = await create("青梅を見かけた");
    const now = "2026-11-05T00:00:00.000Z";
    db.raw
      .prepare("INSERT INTO memory_facts (id, memory_id, kind, value, status, source, evidence, created_at) VALUES ('f1', ?, 'person', 'おばあちゃん', 'candidate', 'ai', '青梅', ?)")
      .run(newId, now);
    db.raw.prepare("INSERT INTO recalls (id, memory_id, related_memory_id, reason, evidence, created_at) VALUES ('r1', ?, ?, 'r', 'e', ?)").run(newId, oldId, now);

    for (const path of ["facts", "recalls"]) {
      const res = await app().request(`/api/memories/${newId}/${path}`, { headers: { [DEV_USER_HEADER]: OTHER } }, env);
      expect(res.status).toBe(404);
      const text = await res.text();
      expect((JSON.parse(text) as { error: { code: string } }).error.code).toBe("not_found");
      expect(text).not.toContain("おばあちゃん");
      expect(text).not.toContain("梅干しを漬けていた");
    }
    // 持ち主には 1 件ずつ見える（上の 404 が「行が無いから」ではないことの確認）
    for (const path of ["facts", "recalls"]) {
      const res = await app().request(`/api/memories/${newId}/${path}`, { headers: { [DEV_USER_HEADER]: ME } }, env);
      expect(res.status).toBe(200);
      expect(((await res.json()) as { items: unknown[] }).items).toHaveLength(1);
    }
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

  it("原則 5: 削除でその記憶の ai_runs の記録も消える（ほかの記憶・ほかの人・記憶に結びつかない記録は残る）", async () => {
    const { id: keepId } = await create("残す記憶");
    const { id } = await create("消す記憶");
    const { id: otherId } = (await (await post({ body: "ほかの人の記憶" }, H_OTHER)).json()) as { id: string };
    db.raw.exec("DELETE FROM ai_runs"); // 登録のときに走った記録は外して、ここで置いた行だけを見る
    const run = db.raw.prepare("INSERT INTO ai_runs (id, user_id, memory_id, kind, model, status, created_at) VALUES (?, ?, ?, ?, 'm', 'succeeded', 'now')");
    run.run("gone-facts", ME, id, "facts");
    run.run("gone-recall", ME, id, "recall");
    run.run("keep-mine", ME, keepId, "facts");
    run.run("keep-other", OTHER, otherId, "facts");
    run.run("keep-retro", ME, null, "retrospect");

    const d = await app().request(`/api/memories/${id}`, { method: "DELETE", headers: { [DEV_USER_HEADER]: ME } }, env);
    expect(d.status).toBe(204);
    const left = db.raw.prepare("SELECT id FROM ai_runs ORDER BY id").all() as Array<{ id: string }>;
    expect(left.map((r) => r.id)).toEqual(["keep-mine", "keep-other", "keep-retro"]);
  });

  // 写真付きの記憶を 1 件作り、R2 にも置く
  const withPhoto = async () => {
    const { id } = await create("写真のある記憶");
    const key = `photos/${ME}/${id}/p.jpg`;
    const r2 = env.PHOTOS as unknown as { store: Map<string, unknown> };
    r2.store.set(key, { body: new Uint8Array([1]), contentType: "image/jpeg" });
    db.raw.prepare("UPDATE memories SET photo_key = ?, photo_content_type = 'image/jpeg' WHERE id = ?").run(key, id);
    return { id, key, r2 };
  };

  it("F3 エラー時: D1 の削除が失敗したら 500 で、記憶も R2 の写真も ai_runs の記録も残る", async () => {
    const { id, key, r2 } = await withPhoto();
    db.raw.prepare("INSERT INTO ai_runs (id, user_id, memory_id, kind, model, status, created_at) VALUES ('a1', ?, ?, 'facts', 'm', 'succeeded', 'now')").run(ME, id);
    const runsOf = () => db.raw.prepare("SELECT id FROM ai_runs WHERE memory_id = ? ORDER BY id").all(id);
    const runsBefore = runsOf();
    // DELETE FROM memories の実行だけを失敗させる（ほかの SQL はそのまま。batch の中で走る runSync も失敗させる）
    const failing = {
      ...db,
      prepare: (sql: string) => {
        const stmt = db.prepare(sql);
        if (!/^DELETE FROM memories/.test(sql)) return stmt;
        const fail = async () => {
          throw new Error("D1_ERROR: network connection lost");
        };
        const failSync = () => {
          throw new Error("D1_ERROR: network connection lost");
        };
        return { ...stmt, bind: () => ({ first: fail, run: fail, all: fail, runSync: failSync }) };
      },
    } as unknown as D1Database;
    const d = await app().request(`/api/memories/${id}`, { method: "DELETE", headers: { [DEV_USER_HEADER]: ME } }, { ...env, DB: failing });
    expect(d.status).toBe(500);
    expect(r2.store.has(key)).toBe(true);
    // 同じ batch（1 トランザクション）なので、先に流した ai_runs の削除も戻る
    expect(runsOf()).toEqual(runsBefore);
    expect(runsBefore).toContainEqual({ id: "a1" });
    expect((await app().request(`/api/memories/${id}`, { headers: { [DEV_USER_HEADER]: ME } }, env)).status).toBe(200);
    expect((await app().request(`/api/photos/${key}`, { headers: { [DEV_USER_HEADER]: ME } }, env)).status).toBe(200);
  });

  it("R2 の削除が失敗しても、D1 から消えていれば 204（写真は参照されなくなる）", async () => {
    const { id } = await withPhoto();
    (env.PHOTOS as unknown as { delete: () => Promise<void> }).delete = async () => {
      throw new Error("R2 down");
    };
    const d = await app().request(`/api/memories/${id}`, { method: "DELETE", headers: { [DEV_USER_HEADER]: ME } }, env);
    expect(d.status).toBe(204);
    expect((await app().request(`/api/memories/${id}`, { headers: { [DEV_USER_HEADER]: ME } }, env)).status).toBe(404);
  });

  it("削除した記憶を related に持つ札も消える（related 側の CASCADE）", async () => {
    const { id: oldId } = await create("old");
    const { id: newId } = await create("new");
    db.raw.prepare("INSERT INTO recalls (id, memory_id, related_memory_id, reason, evidence, created_at) VALUES ('r1', ?, ?, 'r', 'e', 'now')").run(newId, oldId);
    await app().request(`/api/memories/${oldId}`, { method: "DELETE", headers: { [DEV_USER_HEADER]: ME } }, env);
    expect(db.raw.prepare("SELECT count(*) AS n FROM recalls").get()).toEqual({ n: 0 });
  });
});

// S2 の「年月で探す」（ADR-0015）。GET /api/memories/months と GET /api/memories?month= / year= / undated=
describe("年月で探す", () => {
  const add = (user: string, id: string, h: string | null, p: "day" | "month" | "year" | "unknown", c = "2026-11-01T00:00:00.000Z") =>
    db.raw
      .prepare("INSERT INTO memories (id, user_id, body, happened_on, happened_on_precision, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .run(id, user, id, h, p, c, c);
  const get = async (url: string, headers: Record<string, string> = { [DEV_USER_HEADER]: ME }) => {
    const res = await app().request(url, { headers }, env);
    return { status: res.status, json: (await res.json()) as Record<string, unknown> };
  };
  const ids = async (url: string) => {
    const { status, json } = await get(url);
    expect(status).toBe(200);
    return { ids: (json.items as Array<{ id: string }>).map((m) => m.id), next: json.next_cursor as string | null };
  };
  // 精度ごとに 1 つずつ（2026-11 は day 2 と month 1、2025-12 は月末、2025 年だけ、2024-06 は month、日付なし 2）
  const seedAll = () => {
    add(ME, "nov3", "2026-11-03", "day", "2026-11-03T00:00:00.000Z");
    add(ME, "nov1", "2026-11-01", "day", "2026-11-01T00:00:00.000Z");
    add(ME, "nov-m", "2026-11-01", "month", "2026-11-02T00:00:00.000Z");
    add(ME, "jan26", "2026-01-01", "day", "2026-01-01T00:00:00.000Z");
    add(ME, "dec31", "2025-12-31", "day", "2025-12-31T00:00:00.000Z");
    add(ME, "dec1", "2025-12-01", "day", "2025-12-01T00:00:00.000Z");
    add(ME, "y2025", "2025-01-01", "year", "2025-03-01T00:00:00.000Z");
    add(ME, "jun-m", "2024-06-01", "month", "2024-06-20T00:00:00.000Z");
    add(ME, "unk1", null, "unknown", "2026-10-01T00:00:00.000Z");
    add(ME, "unk2", null, "unknown", "2026-09-01T00:00:00.000Z");
  };

  it("months: 年月ごと（day と month）・年だけ・日付なしの件数を新しい順に。/:id と取り違えない", async () => {
    seedAll();
    const { status, json } = await get("/api/memories/months");
    expect(status).toBe(200);
    expect(json).toEqual({
      months: [
        { month: "2026-11", count: 3 },
        { month: "2026-01", count: 1 },
        { month: "2025-12", count: 2 },
        { month: "2024-06", count: 1 },
      ],
      years_only: [{ year: "2025", count: 1 }],
      undated: 2,
    });
  });

  it("months: ほかの人の記憶は数えない。記憶が無ければ空", async () => {
    seedAll();
    add(OTHER, "o1", "2026-11-05", "day");
    add(OTHER, "o2", "2023-04-01", "month");
    add(OTHER, "o3", "2022-01-01", "year");
    add(OTHER, "o4", null, "unknown");
    const mine = await get("/api/memories/months");
    expect((mine.json.months as Array<{ month: string }>).map((m) => m.month)).toEqual(["2026-11", "2026-01", "2025-12", "2024-06"]);
    expect(mine.json.years_only).toEqual([{ year: "2025", count: 1 }]);
    expect(mine.json.undated).toBe(2);
    const fresh = await get("/api/memories/months", { [DEV_USER_HEADER]: "fresh@example.com" });
    expect(fresh.json).toEqual({ months: [], years_only: [], undated: 0 });
  });

  it("month=: その月のいちばん新しい記憶から始まり、日付なしまで今の並びのまま続く", async () => {
    seedAll();
    expect((await ids("/api/memories?month=2025-12")).ids).toEqual(["dec31", "dec1", "y2025", "jun-m", "unk1", "unk2"]);
    // 精度 month は 1 日に並ぶ（同じ日の day とは作成の降順）
    expect((await ids("/api/memories?month=2026-11")).ids).toEqual(["nov3", "nov-m", "nov1", "jan26", "dec31", "dec1", "y2025", "jun-m", "unk1", "unk2"]);
    // 記憶の無い月なら、それより前のいちばん新しい記憶から
    expect((await ids("/api/memories?month=2025-06")).ids).toEqual(["y2025", "jun-m", "unk1", "unk2"]);
    // 12 月は翌年の 1 月 1 日を含めない
    expect((await ids("/api/memories?month=2025-12")).ids).not.toContain("jan26");
  });

  it("year=: 年だけの区切り（YYYY-01-01 に並ぶ）から。undated=1: 日付なしから", async () => {
    seedAll();
    add(ME, "jan1-25", "2025-01-01", "day", "2025-01-01T00:00:00.000Z");
    // 同じ 1 月 1 日の day の行も前に入る（画面は 1 月の区切りを先に、年だけの区切りをその後に出す）
    expect((await ids("/api/memories?year=2025")).ids).toEqual(["y2025", "jan1-25", "jun-m", "unk1", "unk2"]);
    expect((await ids("/api/memories?undated=1")).ids).toEqual(["unk1", "unk2"]);
  });

  it("month= の続きは next_cursor のまま。cursor と month が両方あれば cursor を優先する", async () => {
    for (let i = 0; i < 5; i += 1) add(ME, `may${i}`, `2025-05-0${i + 1}`, "day", `2025-05-0${i + 1}T00:00:00.000Z`);
    add(ME, "jun", "2025-06-10", "day");
    add(ME, "apr", "2025-04-10", "day");
    const p1 = await ids("/api/memories?month=2025-05&limit=2");
    expect(p1.ids).toEqual(["may4", "may3"]);
    expect(p1.next).toBeTruthy();
    const p2 = await ids(`/api/memories?cursor=${p1.next}&limit=2`);
    expect(p2.ids).toEqual(["may2", "may1"]);
    // 別の月を付けても、続きは cursor の位置から
    const both = await ids(`/api/memories?cursor=${p1.next}&month=2025-06&limit=2`);
    expect(both.ids).toEqual(["may2", "may1"]);
    const p3 = await ids(`/api/memories?cursor=${p2.next}&limit=2`);
    expect(p3.ids).toEqual(["may0", "apr"]);
    expect(p3.next).toBeNull();
  });

  it("month=: ほかの人の記憶は混ぜない", async () => {
    add(ME, "mine", "2025-05-01", "day");
    add(OTHER, "theirs", "2025-05-02", "day");
    add(OTHER, "theirs-old", "2025-04-02", "day");
    expect((await ids("/api/memories?month=2025-05")).ids).toEqual(["mine"]);
  });

  it("形の誤りは 400（月の形・範囲、年の形、undated の値、2 つ以上）。空の値は付けないのと同じ", async () => {
    for (const q of ["month=2025-13", "month=2025-00", "month=2025-5", "month=202505", "month=1899-12", "year=25", "year=2101", "undated=yes", "month=2025-05&year=2025", "year=2025&undated=1"]) {
      const { status, json } = await get(`/api/memories?${q}`);
      expect(status, q).toBe(400);
      expect(json).toMatchObject({ error: { code: "validation" } });
    }
    add(ME, "a", "2025-05-01", "day");
    expect((await ids("/api/memories?month=")).ids).toEqual(["a"]);
  });

  it("SQL: 始まりだけなら 3 バインド、cursor があれば始まりを使わない", () => {
    const start = buildListSql(null, "2025-06-01");
    expect(start.bindCount).toBe(3);
    expect(start.sql).toContain("COALESCE(happened_on,'') < ?2");
    expect(start.sql).toContain("ORDER BY COALESCE(happened_on,'') DESC, created_at DESC, id DESC");
    expect(buildListSql({ h: "", c: "", i: "" }, "2025-06-01").bindCount).toBe(5);
  });
});
