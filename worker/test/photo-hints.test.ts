// F7 写真からの気づき候補（C3）。PUT /photo → ai_runs(kind='photo', running) → waitUntil で Claude（偽物）→ 検証 → 保存、までの流れと、
// 検証の純粋関数。requirements F7-1〜F7-7、N-5、X-1、X-2。Claude は呼ばない（fakeCall）
import { beforeEach, describe, expect, it } from "vitest";
import { aiAfterPhoto, aiAfterSave } from "../src/ai/after-save";
import type { AiCaller, AiRequest } from "../src/ai/client";
import { PHOTO_HINT_MAX_BYTES, toBase64 } from "../src/ai/photo";
import { PHOTO_HINTS_SCHEMA } from "../src/ai/schemas";
import { verifyPhotoHints } from "../src/ai/verify";
import { DEV_USER_HEADER } from "../src/auth";
import type { Env } from "../src/env";
import { createApp } from "../src/index";
import { createTestD1, fakeExecutionCtx, fakeR2, type TestD1 } from "./sqlite-d1";

const ME = "hana@example.com";
const BODY = "公園で花が咲いていた";
const JSON_H = { [DEV_USER_HEADER]: ME, "content-type": "application/json" };
const H = { [DEV_USER_HEADER]: ME };
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00]);

let db: TestD1;
let env: Env;
let r2: ReturnType<typeof fakeR2>;

type Out = unknown | Error;
// 写真の呼び出し（req.image がある）と本文の呼び出しを分けて答える。gate を渡すと、写真の応答だけその Promise まで待たせる
const fakeCall = (photo: (req: AiRequest) => Out, text: (req: AiRequest) => Out = () => ({ items: [] }), gate?: Promise<void>) => {
  const requests: AiRequest[] = [];
  const fn = (async (_env: unknown, req: AiRequest) => {
    requests.push(req);
    if (req.image && gate) await gate;
    const r = req.image ? photo(req) : text(req);
    if (r instanceof Error) return { ok: false as const, error: r.message, model: "fake", input_tokens: 3 };
    return { ok: true as const, json: r, model: "fake", input_tokens: 10, output_tokens: 5 };
  }) as AiCaller & { requests: AiRequest[] };
  fn.requests = requests;
  return Object.assign(fn, { requests, photoRequests: () => requests.filter((r) => r.image) });
};

const appWith = (call: AiCaller) =>
  createApp({ memories: { afterSave: aiAfterSave({ facts: { call }, recall: { call } }) }, photos: { afterPhoto: aiAfterPhoto({ call }) } });

const post = async (app: ReturnType<typeof createApp>, body = BODY) => {
  const ctx = fakeExecutionCtx();
  const res = await app.request("/api/memories", { method: "POST", headers: JSON_H, body: JSON.stringify({ body }) }, env, ctx);
  expect(res.status).toBe(201);
  await ctx.settle();
  return (await res.json()) as { id: string };
};

const put = async (app: ReturnType<typeof createApp>, id: string, bytes: Uint8Array = JPEG, type = "image/jpeg") => {
  const ctx = fakeExecutionCtx();
  const form = new FormData();
  form.set("photo", new File([bytes], "p", { type }));
  const res = await app.request(`/api/memories/${id}/photo`, { method: "PUT", headers: H, body: form }, env, ctx);
  return { res, ctx, json: res.status === 200 ? ((await res.json()) as { photo_key: string }) : null };
};

const getFacts = async (app: ReturnType<typeof createApp>, id: string) =>
  (await (await app.request(`/api/memories/${id}/facts`, { headers: H }, env)).json()) as {
    pending: boolean;
    items: Array<{ id: string; kind: string; value: string; status: string; source: string; evidence: string }>;
  };

const photoRuns = (memoryId: string) =>
  db.raw.prepare("SELECT status, error FROM ai_runs WHERE memory_id = ? AND kind = 'photo'").all(memoryId) as Array<{ status: string; error: string | null }>;

beforeEach(() => {
  db = createTestD1();
  r2 = fakeR2();
  env = { DB: db, PHOTOS: r2, ASSETS: {} as Fetcher, ENVIRONMENT: "development", ANTHROPIC_MODEL: "m", ANTHROPIC_API_KEY: "k", INVITE_CODE: "x", JWT_SECRET: "s", APP_VERSION: "t" } as Env;
});

describe("verifyPhotoHints", () => {
  it("F7-4: kind が thing / place 以外（person・date）は捨てる。年齢や感情の語を含む thing は kind でしか見ないので残る", () => {
    const r = verifyPhotoHints({
      items: [
        { kind: "person", value: "おばあちゃん" },
        { kind: "date", value: "2026-04" },
        { kind: "thing", value: "桜" },
        { kind: "place", value: "公園" },
        { kind: "thing", value: "嬉しそうな子ども" },
      ],
    });
    expect(r.items).toEqual([
      { kind: "thing", value: "桜" },
      { kind: "place", value: "公園" },
      { kind: "thing", value: "嬉しそうな子ども" },
    ]);
    expect(r.stats.dropped.map((d) => d.reason)).toEqual(["bad_kind", "bad_kind"]);
  });

  it("value の前後の空白（全角を含む）を除き、空なら捨てる。(kind, value) の重複は除き、kind が違えば別", () => {
    const r = verifyPhotoHints({
      items: [
        { kind: "thing", value: "　桜 " },
        { kind: "thing", value: "桜" },
        { kind: "thing", value: "  " },
        { kind: "place", value: "" },
        { kind: "place", value: "桜" },
      ],
    });
    expect(r.items).toEqual([
      { kind: "thing", value: "桜" },
      { kind: "place", value: "桜" },
    ]);
    expect(r.stats.dropped.map((d) => d.reason)).toEqual(["duplicate", "empty", "empty"]);
  });

  it("捨てたあとの先頭から最大 5 件。形の崩れたものは捨てる", () => {
    const many = { items: [{ kind: "person", value: "x" }, ...["桜", "紅葉", "雪", "海", "山", "川"].map((value) => ({ kind: "thing", value }))] };
    expect(verifyPhotoHints(many).items.map((h) => h.value)).toEqual(["桜", "紅葉", "雪", "海", "山"]);
    expect(verifyPhotoHints({ items: [{ kind: "thing" }, "桜", { kind: "thing", value: 3 }] }).items).toEqual([]);
    expect(verifyPhotoHints({ hints: [] }).stats.dropped[0]!.reason).toBe("malformed");
    expect(verifyPhotoHints(null).items).toEqual([]);
  });

  it("スキーマは thing / place の enum だけで、どのオブジェクトにも additionalProperties: false", () => {
    const item = PHOTO_HINTS_SCHEMA.properties.items.items;
    expect(item.properties.kind.enum).toEqual(["thing", "place"]);
    expect(item.required).toEqual(["kind", "value"]);
    expect(item.additionalProperties).toBe(false);
    expect(PHOTO_HINTS_SCHEMA.additionalProperties).toBe(false);
  });
});

describe("toBase64", () => {
  it("32KB を超える写真も、まとめて変換したときと同じ文字列になる", () => {
    const bytes = new Uint8Array(100_000).map((_, i) => (i * 37) % 256);
    expect(toBase64(bytes)).toBe(Buffer.from(bytes).toString("base64"));
    expect(toBase64(JPEG)).toBe(Buffer.from(JPEG).toString("base64"));
  });
});

describe("PUT /photo から写真候補まで", () => {
  it("F7-1: 200 の時点で photo が running で GET /facts は pending。届いたら evidence='photo:<photo_key>' の候補（thing / place）が並ぶ", async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => (release = r));
    const call = fakeCall(
      () => ({ items: [{ kind: "thing", value: "桜" }, { kind: "place", value: "公園" }] }),
      () => ({ items: [] }),
      gate,
    );
    const app = appWith(call);
    const { id } = await post(app);
    // 本文の候補は先に終わっている（facts は empty）。写真を添える前は pending ではない
    expect((await getFacts(app, id)).pending).toBe(false);
    const { res, ctx, json } = await put(app, id);
    expect(res.status).toBe(200);
    expect(photoRuns(id)).toEqual([{ status: "running", error: null }]);
    expect(await getFacts(app, id)).toEqual({ pending: true, items: [] });
    const detail = (await (await app.request(`/api/memories/${id}`, { headers: H }, env)).json()) as { facts: { pending: boolean } };
    expect(detail.facts.pending).toBe(true);

    release();
    await ctx.settle();
    expect(photoRuns(id)).toEqual([{ status: "succeeded", error: null }]);
    const after = await getFacts(app, id);
    expect(after.pending).toBe(false);
    // 同じ時刻に入れた行どうしの並びは id 順（listFacts）なので、ここでは中身だけを比べる
    expect(after.items.map((f) => `${f.kind}:${f.value}`).sort()).toEqual(["place:公園", "thing:桜"]);
    for (const f of after.items) expect(f).toMatchObject({ status: "candidate", source: "ai", evidence: `photo:${json!.photo_key}` });

    // Claude へは写真（R2 から読んで base64）と本文を 1 回だけ。effort は低め
    const reqs = call.photoRequests();
    expect(reqs).toHaveLength(1);
    expect(reqs[0]!.image).toEqual({ media_type: "image/jpeg", data: Buffer.from(JPEG).toString("base64") });
    expect(reqs[0]!.user).toContain(BODY);
    expect(reqs[0]!.effort).toBe("low");
    expect(reqs[0]!.schema).toBe(PHOTO_HINTS_SCHEMA);
    // 人物を推しはからない決めが prompt にある
    for (const w of ["年齢", "感情", "人数", "誰なのか"]) expect(reqs[0]!.system).toContain(w);
  });

  it("PNG はそのまま image/png で渡す", async () => {
    const call = fakeCall(() => ({ items: [] }));
    const app = appWith(call);
    const { id } = await post(app);
    const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00]);
    const { ctx } = await put(app, id, PNG, "image/png");
    await ctx.settle();
    expect(call.photoRequests()[0]!.image!.media_type).toBe("image/png");
    expect(photoRuns(id)).toEqual([{ status: "empty", error: null }]);
  });

  it("F7-4: Claude が person と date を返しても保存しない。全部捨てたら empty", async () => {
    const call = fakeCall(() => ({ items: [{ kind: "person", value: "子ども" }, { kind: "date", value: "2026-04" }] }));
    const app = appWith(call);
    const { id } = await post(app);
    const { ctx } = await put(app, id);
    await ctx.settle();
    expect(photoRuns(id)).toEqual([{ status: "empty", error: null }]);
    expect((await getFacts(app, id)).items).toEqual([]);
  });

  it("F7-5: 写真なしの記憶では photo の ai_runs を作らない", async () => {
    const call = fakeCall(() => ({ items: [{ kind: "thing", value: "桜" }] }));
    const app = appWith(call);
    const { id } = await post(app);
    expect(photoRuns(id)).toEqual([]);
    expect(call.photoRequests()).toHaveLength(0);
  });

  it("F7-6: 7 MB の JPEG は 200 で保存されるが、photo の ai_runs は作らず GET /facts の pending にも響かない", async () => {
    const call = fakeCall(() => ({ items: [{ kind: "thing", value: "桜" }] }));
    const app = appWith(call);
    const { id } = await post(app);
    const big = new Uint8Array(7 * 1024 * 1024);
    big.set(JPEG);
    const { res, ctx, json } = await put(app, id, big);
    expect(res.status).toBe(200);
    expect(r2.store.get(json!.photo_key)!.body.byteLength).toBe(big.byteLength);
    await ctx.settle();
    expect(photoRuns(id)).toEqual([]);
    expect(call.photoRequests()).toHaveLength(0);
    expect(await getFacts(app, id)).toEqual({ pending: false, items: [] });
  });

  it("上限ちょうど（6,291,456 バイト）までは送る", async () => {
    const call = fakeCall(() => ({ items: [] }));
    const app = appWith(call);
    const { id } = await post(app);
    const edge = new Uint8Array(PHOTO_HINT_MAX_BYTES);
    edge.set(JPEG);
    const { ctx } = await put(app, id, edge);
    await ctx.settle();
    expect(call.photoRequests()).toHaveLength(1);
  });

  it("F7-7: 写真候補「公園」と本文候補 place: 公園（evidence「公園」）は、別の行として両方 candidate で返る", async () => {
    const call = fakeCall(
      () => ({ items: [{ kind: "place", value: "公園" }] }),
      () => ({ items: [{ kind: "place", value: "公園", evidence: "公園", date_precision: "unknown" }] }),
    );
    const app = appWith(call);
    const { id } = await post(app);
    const { ctx, json } = await put(app, id);
    await ctx.settle();
    const { items } = await getFacts(app, id);
    expect(items).toHaveLength(2);
    expect(items.map((f) => [f.kind, f.value, f.status, f.evidence]).sort((a, b) => a[3]!.length - b[3]!.length)).toEqual([
      ["place", "公園", "candidate", "公園"],
      ["place", "公園", "candidate", `photo:${json!.photo_key}`],
    ]);
  });

  it("N-5: 写真を差し替えても photo の 2 行目は作らず、前の候補が残る", async () => {
    const call = fakeCall(() => ({ items: [{ kind: "thing", value: "桜" }] }));
    const app = appWith(call);
    const { id } = await post(app);
    const first = await put(app, id);
    await first.ctx.settle();
    const second = await put(app, id);
    expect(second.res.status).toBe(200);
    await second.ctx.settle();
    expect(photoRuns(id)).toEqual([{ status: "succeeded", error: null }]);
    expect(call.photoRequests()).toHaveLength(1);
    const { items } = await getFacts(app, id);
    expect(items.map((f) => [f.value, f.evidence])).toEqual([["桜", `photo:${first.json!.photo_key}`]]);
  });

  it("同じ記憶に同じ写真候補が既にあれば足さない（本文の候補とは比べない）", async () => {
    const call = fakeCall(() => ({ items: [{ kind: "thing", value: "桜" }, { kind: "place", value: "公園" }] }));
    const app = appWith(call);
    const { id } = await post(app);
    db.raw
      .prepare("INSERT INTO memory_facts (id, memory_id, kind, value, status, source, evidence, created_at) VALUES ('p0', ?, 'thing', '桜', 'rejected', 'ai', 'photo:photos/old.jpg', '2026-11-07T00:00:00.000Z')")
      .run(id);
    db.raw
      .prepare("INSERT INTO memory_facts (id, memory_id, kind, value, status, source, evidence, created_at) VALUES ('t0', ?, 'place', '公園', 'candidate', 'ai', '公園', '2026-11-07T00:00:00.000Z')")
      .run(id);
    const { ctx } = await put(app, id);
    await ctx.settle();
    const { items } = await getFacts(app, id);
    // 却下済みの「桜」は二重にしない。本文由来の「公園」はあっても、写真の「公園」は足す
    expect(items.filter((f) => f.value === "桜")).toHaveLength(1);
    expect(items.filter((f) => f.value === "公園").map((f) => f.evidence.startsWith("photo:"))).toEqual([false, true]);
  });

  it("F7 エラー時: refusal や API の失敗は failed。候補は増えず、pending は false に戻る", async () => {
    const call = fakeCall(() => new Error("refusal:cyber"));
    const app = appWith(call);
    const { id } = await post(app);
    const { ctx } = await put(app, id);
    await ctx.settle();
    expect(photoRuns(id)).toEqual([{ status: "failed", error: "refusal:cyber" }]);
    expect(await getFacts(app, id)).toEqual({ pending: false, items: [] });
  });

  it("結果が届く前に記憶が消されていたら、写真候補は入らず ai_runs の記録も残らない（外部キーで失敗。記録は削除と一緒に消える、原則 5）。写真の PUT は 200 のまま", async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => (release = r));
    const call = fakeCall(() => ({ items: [{ kind: "thing", value: "桜" }] }), undefined, gate);
    const app = appWith(call);
    const { id } = await post(app);
    const { res, ctx } = await put(app, id);
    expect(res.status).toBe(200);
    expect((await app.request(`/api/memories/${id}`, { method: "DELETE", headers: H }, env)).status).toBe(204);
    release();
    await ctx.settle();
    // 裏の処理は外部キーで失敗して failed を書こうとするが、記録は記憶の削除と一緒にもう消えているので何も戻らない
    expect(photoRuns(id)).toHaveLength(0);
    expect(db.raw.prepare("SELECT count(*) AS n FROM memory_facts").get()).toEqual({ n: 0 });
  });

  it("写真候補の準備で例外が出ても、写真は 200 で保存される", async () => {
    const app = createApp({
      memories: { afterSave: async () => {} },
      photos: {
        afterPhoto: async () => {
          throw new Error("boom");
        },
      },
    });
    const { id } = await post(app);
    const { res, json } = await put(app, id);
    expect(res.status).toBe(200);
    expect(r2.store.has(json!.photo_key)).toBe(true);
  });
});

describe("写真候補を決める（PATCH /api/facts/:id）", () => {
  const setup = async () => {
    const call = fakeCall(
      () => ({ items: [{ kind: "thing", value: "桜" }] }),
      (req) => {
        // 2 つめの記憶の想起: 入力（確定済みの事実）を見るだけで、札は出さない
        if (req.system.includes("過去の記憶")) return { items: [] };
        return { items: [] };
      },
    );
    const app = appWith(call);
    const { id } = await post(app);
    const { ctx, json } = await put(app, id);
    await ctx.settle();
    const fact = (await getFacts(app, id)).items[0]!;
    return { app, call, id, fact, photoKey: json!.photo_key };
  };
  const patch = (app: ReturnType<typeof createApp>, factId: string, status: string) =>
    app.request(`/api/facts/${factId}`, { method: "PATCH", headers: JSON_H, body: JSON.stringify({ status }) }, env);
  const recallInput = (call: ReturnType<typeof fakeCall>) => call.requests.filter((r) => r.system.includes("過去の記憶")).at(-1)!.user;

  it("X-1: 写真候補は挿入直後 candidate", async () => {
    const { fact } = await setup();
    expect(fact).toMatchObject({ kind: "thing", value: "桜", status: "candidate", source: "ai" });
  });

  it("F7-2: 「ちがう」で rejected。本文は変わらず、行は残り、次の記憶の想起の入力に入らない（X-2）", async () => {
    const { app, call, id, fact } = await setup();
    expect((await patch(app, fact.id, "rejected")).status).toBe(200);
    expect(db.raw.prepare("SELECT body FROM memories WHERE id = ?").get(id)).toEqual({ body: BODY });
    expect((await getFacts(app, id)).items).toMatchObject([{ id: fact.id, status: "rejected" }]);
    await post(app, "梅を見に行った");
    expect(recallInput(call)).not.toContain("桜");
  });

  it("F7-3: 「そう」で confirmed。source='ai'・evidence='photo:<photo_key>' のまま、次の想起の入力に確定の事実として入る", async () => {
    const { app, call, id, fact, photoKey } = await setup();
    expect((await patch(app, fact.id, "confirmed")).status).toBe(200);
    expect(db.raw.prepare("SELECT status, source, evidence FROM memory_facts WHERE id = ?").get(fact.id)).toEqual({
      status: "confirmed",
      source: "ai",
      evidence: `photo:${photoKey}`,
    });
    const detail = (await (await app.request(`/api/memories/${id}`, { headers: H }, env)).json()) as { facts: { items: Array<{ value: string; status: string }> } };
    expect(detail.facts.items).toMatchObject([{ value: "桜", status: "confirmed" }]);
    await post(app, "梅を見に行った");
    expect(recallInput(call)).toContain('facts="もの: 桜"');
  });
});
