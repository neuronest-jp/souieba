// 保存 → ai_runs(running) → waitUntil で Claude（偽物）→ 検証 → 保存 → ai_runs の更新、までの流れ。
import { beforeEach, describe, expect, it } from "vitest";
import { aiAfterSave } from "../src/ai/after-save";
import type { AiCaller, AiRequest } from "../src/ai/client";
import { DEV_USER_HEADER } from "../src/auth";
import type { Env } from "../src/env";
import { createApp } from "../src/index";
import { createTestD1, fakeExecutionCtx, fakeR2, type TestD1 } from "./sqlite-d1";

const ME = "hana@example.com";
let db: TestD1;
let env: Env;
const H = { [DEV_USER_HEADER]: ME, "content-type": "application/json" };

// gate を渡すと、その Promise が解決するまで Claude の応答を待たせる（201 時点の running を確かめるため）
const fakeCall = (impl: (req: AiRequest) => unknown | Promise<unknown>, gate?: Promise<void>): AiCaller & { requests: AiRequest[] } => {
  const requests: AiRequest[] = [];
  const fn = (async (_env: unknown, req: AiRequest) => {
    requests.push(req);
    if (gate) await gate;
    const r = await impl(req);
    if (r instanceof Error) return { ok: false as const, error: r.message, model: "fake" };
    return { ok: true as const, json: r, model: "fake", input_tokens: 10, output_tokens: 5 };
  }) as AiCaller & { requests: AiRequest[] };
  fn.requests = requests;
  return fn;
};

const appWith = (call: AiCaller) => createApp({ memories: { afterSave: aiAfterSave({ facts: { call }, recall: { call } }) } });

const post = async (app: ReturnType<typeof createApp>, body: string, ctx = fakeExecutionCtx()) => {
  const res = await app.request("/api/memories", { method: "POST", headers: H, body: JSON.stringify({ body }) }, env, ctx);
  expect(res.status).toBe(201);
  return { memory: (await res.json()) as { id: string }, ctx };
};
const runs = (memoryId: string) => db.raw.prepare("SELECT kind, status, error, input_tokens FROM ai_runs WHERE memory_id = ? ORDER BY kind").all(memoryId) as Array<{ kind: string; status: string; error: string | null; input_tokens: number | null }>;

beforeEach(() => {
  db = createTestD1();
  env = { DB: db, PHOTOS: fakeR2(), ASSETS: {} as Fetcher, ENVIRONMENT: "development", ANTHROPIC_MODEL: "m", ANTHROPIC_API_KEY: "k", INVITE_CODE: "x", JWT_SECRET: "s", APP_VERSION: "t" } as Env;
});

describe("最初の記憶（過去 0 件）", () => {
  it("facts は running で作られ、recall は作られない（F5-4、N-5）。201 時点で running、waitUntil 後に succeeded", async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => (release = r));
    const call = fakeCall(() => ({ items: [{ kind: "thing", value: "青梅", evidence: "青梅", date_precision: "unknown" }] }), gate);
    const app = appWith(call);
    const { memory, ctx } = await post(app, "スーパーで青梅を見かけた");
    expect(runs(memory.id)).toEqual([{ kind: "facts", status: "running", error: null, input_tokens: null }]);
    // 201 直後の GET は pending=true
    const before = (await (await app.request(`/api/memories/${memory.id}/facts`, { headers: H }, env)).json()) as { pending: boolean; items: unknown[] };
    expect(before).toEqual({ pending: true, items: [] });
    release();
    await ctx.settle();
    expect(runs(memory.id)).toEqual([{ kind: "facts", status: "succeeded", error: null, input_tokens: 10 }]);
    const after = (await (await app.request(`/api/memories/${memory.id}/facts`, { headers: H }, env)).json()) as { pending: boolean; items: Array<Record<string, unknown>> };
    expect(after.pending).toBe(false);
    expect(after.items).toHaveLength(1);
    expect(after.items[0]).toMatchObject({ kind: "thing", value: "青梅", status: "candidate", source: "ai", evidence: "青梅" });
    expect(call.requests).toHaveLength(1);
    expect(call.requests[0]!.user).toContain("スーパーで青梅を見かけた");
    expect(call.requests[0]!.effort).toBe("low");
  });
});

describe("D1 祖母の梅干し", () => {
  it("過去記憶があると recall も走り、引用付きの札が保存される。feedback は入力に含めない", async () => {
    const OLD = "おばあちゃんは毎年6月になると、縁側で梅干しを漬けていた";
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => (release = r));
    const call = fakeCall((req) => {
      if (req.system.includes("過去の記憶")) {
        const m = /<memory id="([^"]+)"[^>]*>おばあちゃん/.exec(req.user);
        return { items: [{ related_memory_id: m![1], reason: "青梅と梅干し", evidence: "梅干しを漬けていた" }] };
      }
      return { items: [] };
    }, gate);
    const app = appWith(call);
    const firstApp = appWith(fakeCall(() => ({ items: [] })));
    const first = await post(firstApp, OLD);
    await first.ctx.settle();
    // 確定済み事実を 1 つ付けておく（プロンプトの facts 属性に乗る）
    db.raw.prepare("INSERT INTO memory_facts (id, memory_id, kind, value, status, source, created_at) VALUES ('f1', ?, 'person', 'おばあちゃん', 'confirmed', 'user', 'now')").run(first.memory.id);
    // 札への反応が入力に混ざらないことを確かめるため、過去側に feedback 付きの札を置く
    const { memory, ctx } = await post(app, "スーパーで青梅を見かけた");
    expect(runs(memory.id).map((r) => `${r.kind}:${r.status}`)).toEqual(["facts:running", "recall:running"]);
    release();
    await ctx.settle();
    expect(runs(memory.id).map((r) => `${r.kind}:${r.status}`)).toEqual(["facts:empty", "recall:succeeded"]);
    const rc = (await (await app.request(`/api/memories/${memory.id}/recalls`, { headers: H }, env)).json()) as { pending: boolean; items: Array<Record<string, unknown>> };
    expect(rc.pending).toBe(false);
    expect(rc.items).toHaveLength(1);
    expect(rc.items[0]).toMatchObject({ reason: "青梅と梅干し", evidence: "梅干しを漬けていた", feedback: "none", related_memory: { id: first.memory.id, body: OLD } });
    const recallReq = call.requests.find((r) => r.system.includes("過去の記憶"))!;
    expect(recallReq.user).toContain('facts="人物: おばあちゃん"');
    expect(recallReq.user).not.toContain("feedback");
    expect(recallReq.effort).toBe("medium");
    // 思い出された側から見ると recalled_by
    const old = (await (await app.request(`/api/memories/${first.memory.id}`, { headers: H }, env)).json()) as { recalled_by: { items: Array<{ memory: { id: string } }> } };
    expect(old.recalled_by.items[0]!.memory.id).toBe(memory.id);
  });

  it("引用が原文に無ければ札は保存されず empty（原則 3）", async () => {
    const call = fakeCall((req) => {
      if (!req.system.includes("過去の記憶")) return { items: [] };
      const m = /<memory id="([^"]+)"/.exec(req.user); // 本物の id を使い、引用だけ本文に無いものにする
      return { items: [{ related_memory_id: m![1], reason: "r", evidence: "梅干しを作っていた" }] };
    });
    const app = appWith(call);
    const first = await post(app, "おばあちゃんは毎年6月になると、縁側で梅干しを漬けていた");
    await first.ctx.settle();
    const { memory, ctx } = await post(app, "青梅");
    await ctx.settle();
    expect(runs(memory.id).find((r) => r.kind === "recall")!.status).toBe("empty");
    expect(db.raw.prepare("SELECT count(*) AS n FROM recalls").get()).toEqual({ n: 0 });
  });
});

describe("相手の記憶が途中で消えたとき", () => {
  it("消えた相手の札だけ落とし、残りの札は保存される", async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => (release = r));
    const call = fakeCall((req) => {
      if (!req.system.includes("過去の記憶")) return { items: [] };
      const ids = [...req.user.matchAll(/<memory id="([^"]+)"/g)].map((m) => m[1]);
      return { items: ids.map((id) => ({ related_memory_id: id, reason: "r", evidence: "梅" })) };
    }, gate);
    const app = appWith(call);
    const quiet = appWith(fakeCall(() => ({ items: [] })));
    const a = await post(quiet, "梅 その一");
    const b = await post(quiet, "梅 その二");
    await a.ctx.settle();
    await b.ctx.settle();
    const { memory, ctx } = await post(app, "青梅");
    expect((await app.request(`/api/memories/${a.memory.id}`, { method: "DELETE", headers: H }, env)).status).toBe(204);
    release();
    await ctx.settle();
    expect(runs(memory.id).find((r) => r.kind === "recall")!.status).toBe("succeeded");
    const rows = db.raw.prepare("SELECT related_memory_id FROM recalls WHERE memory_id = ?").all(memory.id) as Array<{ related_memory_id: string }>;
    expect(rows.map((r) => r.related_memory_id)).toEqual([b.memory.id]);
  });
});

describe("失敗の静かな扱い", () => {
  it("Claude が失敗（refusal / API エラー）なら failed、何も保存しない", async () => {
    const call = fakeCall(() => new Error("refusal:cyber"));
    const app = appWith(call);
    const { memory, ctx } = await post(app, "x");
    await ctx.settle();
    expect(runs(memory.id)).toEqual([{ kind: "facts", status: "failed", error: "refusal:cyber", input_tokens: null }]);
    expect(db.raw.prepare("SELECT count(*) AS n FROM memory_facts").get()).toEqual({ n: 0 });
  });

  it("API キーが無いローカルでも登録は 201 で、ai_runs は failed（not_configured）", async () => {
    env = { ...env, ANTHROPIC_API_KEY: undefined } as Env;
    const app = createApp(); // 本物の callClaude（キー無しで即 failed）
    const { memory, ctx } = await post(app, "x");
    await ctx.settle();
    expect(runs(memory.id)[0]!.status).toBe("failed");
    expect(runs(memory.id)[0]!.error).toContain("not_configured");
  });

  it("結果が届く前に記憶が消されていたら failed（外部キー）", async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => (release = r));
    const call = fakeCall(async () => {
      await gate;
      return { items: [{ kind: "thing", value: "x", evidence: "x", date_precision: "unknown" }] };
    });
    const app = appWith(call);
    const { memory, ctx } = await post(app, "x");
    expect((await app.request(`/api/memories/${memory.id}`, { method: "DELETE", headers: H }, env)).status).toBe(204);
    release();
    await ctx.settle();
    expect(db.raw.prepare("SELECT count(*) AS n FROM memory_facts").get()).toEqual({ n: 0 });
    const run = db.raw.prepare("SELECT status FROM ai_runs WHERE memory_id = ?").get(memory.id) as { status: string };
    expect(run.status).toBe("failed");
  });

  it("古い running（61 秒前）は pending=false として扱う", async () => {
    const app = createApp({ memories: { afterSave: async () => {} } });
    const { memory } = await post(app, "x");
    db.raw.prepare("INSERT INTO ai_runs (id, user_id, memory_id, kind, model, status, created_at) VALUES ('a', ?, ?, 'facts', 'm', 'running', ?)").run(ME, memory.id, new Date(Date.now() - 61_000).toISOString());
    const j = (await (await app.request(`/api/memories/${memory.id}/facts`, { headers: H }, env)).json()) as { pending: boolean };
    expect(j.pending).toBe(false);
  });
});

describe("PATCH /api/facts/:id と /api/recalls/:id", () => {
  it("候補を confirmed / rejected にでき、他人は 404、不正な値は 400", async () => {
    const app = createApp({ memories: { afterSave: async () => {} } });
    const { memory } = await post(app, "x");
    db.raw.prepare("INSERT INTO memory_facts (id, memory_id, kind, value, status, source, evidence, created_at) VALUES ('f1', ?, 'thing', 'x', 'candidate', 'ai', 'x', 'now')").run(memory.id);
    const ok = await app.request("/api/facts/f1", { method: "PATCH", headers: H, body: JSON.stringify({ status: "confirmed" }) }, env);
    expect(ok.status).toBe(200);
    expect(await ok.json()).toMatchObject({ id: "f1", status: "confirmed" });
    expect(db.raw.prepare("SELECT status, decided_at FROM memory_facts WHERE id = 'f1'").get()).toMatchObject({ status: "confirmed" });
    expect((await app.request("/api/facts/f1", { method: "PATCH", headers: H, body: JSON.stringify({ status: "rejected" }) }, env)).status).toBe(200);
    expect((await app.request("/api/facts/f1", { method: "PATCH", headers: H, body: JSON.stringify({ status: "candidate" }) }, env)).status).toBe(400);
    expect((await app.request("/api/facts/f1", { method: "PATCH", headers: { ...H, [DEV_USER_HEADER]: "other@example.com" }, body: JSON.stringify({ status: "confirmed" }) }, env)).status).toBe(404);
    expect((await app.request("/api/facts/nope", { method: "PATCH", headers: H, body: JSON.stringify({ status: "confirmed" }) }, env)).status).toBe(404);
  });

  it("札への反応を記録でき、何度でも変えられる", async () => {
    const app = createApp({ memories: { afterSave: async () => {} } });
    const a = await post(app, "old");
    const b = await post(app, "new");
    db.raw.prepare("INSERT INTO recalls (id, memory_id, related_memory_id, reason, evidence, created_at) VALUES ('r1', ?, ?, 'r', 'old', 'now')").run(b.memory.id, a.memory.id);
    for (const feedback of ["helpful", "not_related", "none"]) {
      const res = await app.request("/api/recalls/r1", { method: "PATCH", headers: H, body: JSON.stringify({ feedback }) }, env);
      expect(res.status).toBe(200);
      expect(db.raw.prepare("SELECT feedback FROM recalls WHERE id = 'r1'").get()).toEqual({ feedback });
    }
    expect((await app.request("/api/recalls/r1", { method: "PATCH", headers: H, body: JSON.stringify({ feedback: "love" }) }, env)).status).toBe(400);
    expect((await app.request("/api/recalls/r1", { method: "PATCH", headers: { ...H, [DEV_USER_HEADER]: "other@example.com" }, body: JSON.stringify({ feedback: "helpful" }) }, env)).status).toBe(404);
  });
});
