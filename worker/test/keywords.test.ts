// ことばの地図（ADR-0014、requirements F10）。Claude は呼ばない（fakeCall）。
// 検証（verifyKeywords）・数え方（buildKeywordMap）の純粋関数と、POST / GET /api/keywords の流れ（R2 の置き場、ai_runs、
// 8 件未満、消した記憶、ほかの人の記憶、Claude の失敗）
import { beforeEach, describe, expect, it } from "vitest";
import type { AiCaller, AiRequest } from "../src/ai/client";
import { KEYWORDS_TIMEOUT_MS, pickForPrompt } from "../src/ai/keywords";
import { KEYWORDS_SCHEMA } from "../src/ai/schemas";
import { verifyKeywords } from "../src/ai/verify";
import { DEV_USER_HEADER } from "../src/auth";
import type { Env } from "../src/env";
import { createApp } from "../src/index";
import { buildKeywordMap, sentenceWith, splitSentences, type CountMemory, type StoredKeyword } from "../src/keywords/count";
import { mapKey } from "../src/keywords/store";
import type { KeywordsResponse } from "../src/routes/keywords";
import { createTestD1, fakeExecutionCtx, fakeR2, type TestD1 } from "./sqlite-d1";

const ME = "hana@example.com";
const OTHER = "other@example.com";

let db: TestD1;
let env: Env;
let r2: ReturnType<typeof fakeR2>;

beforeEach(() => {
  db = createTestD1();
  r2 = fakeR2();
  env = { DB: db, PHOTOS: r2, ASSETS: {} as Fetcher, ENVIRONMENT: "development", ANTHROPIC_MODEL: "m", ANTHROPIC_API_KEY: "k", INVITE_CODE: "x", JWT_SECRET: "s", APP_VERSION: "t" } as Env;
});

// ---------------------------------------------------------------
// 純粋関数
// ---------------------------------------------------------------

const mem = (id: string, body: string, happened_on: string | null, precision: CountMemory["happened_on_precision"] = "day", created_at = "2026-11-01T00:00:00.000Z"): CountMemory => ({
  id,
  body,
  happened_on,
  happened_on_precision: happened_on ? precision : "unknown",
  created_at,
});
const kw = (label: string, surfaces: string[] = [label], kind: StoredKeyword["kind"] = "thing"): StoredKeyword => ({ label, kind, surfaces });
const STORED_AT = "2026-11-07T00:00:00.000Z";

describe("verifyKeywords", () => {
  const bodies = ["そらくんと展望台へ行った。", "みさきと展望台で夕日を見た", "A&Bの店で「ただいま」と言った"];

  it("本文に無い surface は捨て、残った形が無い言葉は捨てる。label が本文に無ければ残った最初の形に替える", () => {
    const r = verifyKeywords(
      {
        keywords: [
          { label: "そら", kind: "person", surfaces: ["そらくん", "空くん", "そら"] },
          { label: "家族", kind: "person", surfaces: ["家族"] },
          { label: "夕景", kind: "event", surfaces: ["夕日", "夕焼け"] },
        ],
      },
      bodies,
    );
    expect(r.items).toEqual([
      { label: "そら", kind: "person", surfaces: ["そらくん", "そら"] },
      { label: "夕日", kind: "event", surfaces: ["夕日"] },
    ]);
    expect(r.stats.dropped.map((d) => d.reason)).toEqual(["surface_not_in_body"]);
  });

  it("エスケープした記号のまま返した形は、元の記号に戻して照合する。1 字のかなは捨て、漢字 1 字は残す", () => {
    const r = verifyKeywords(
      {
        keywords: [
          { label: "A&amp;B", kind: "place", surfaces: ["A&amp;B"] },
          { label: "と", kind: "thing", surfaces: ["と"] },
          { label: "店", kind: "place", surfaces: ["店"] },
        ],
      },
      bodies,
    );
    expect(r.items).toEqual([
      { label: "A&B", kind: "place", surfaces: ["A&B"] },
      { label: "店", kind: "place", surfaces: ["店"] },
    ]);
  });

  it("kind が enum 以外・形の崩れ・label の重複は捨てる。surfaces は重複を除いて 3 個まで。最大 40 個", () => {
    const r = verifyKeywords(
      {
        keywords: [
          { label: "展望台", kind: "landmark", surfaces: ["展望台"] },
          { label: "展望台", kind: "place", surfaces: ["展望台", "展望台", "展望", "展", "台"] },
          { label: "展望台", kind: "place", surfaces: ["展望台"] },
          { label: 3, kind: "place", surfaces: ["展望台"] },
          "展望台",
        ],
      },
      bodies,
    );
    expect(r.items).toEqual([{ label: "展望台", kind: "place", surfaces: ["展望台", "展望", "展"] }]);
    expect(r.stats.dropped.map((d) => d.reason)).toEqual(["bad_kind", "duplicate", "malformed", "malformed"]);
    const many = { keywords: Array.from({ length: 45 }, (_, i) => ({ label: `語${i}`, kind: "thing", surfaces: [`語${i}`] })) };
    expect(verifyKeywords(many, [many.keywords.map((k) => k.label).join(" ")]).items).toHaveLength(40);
    expect(verifyKeywords({ items: [] }, bodies).stats.dropped[0]!.reason).toBe("malformed");
  });

  it("スキーマは kind の enum を持ち、どのオブジェクトにも additionalProperties: false", () => {
    const item = KEYWORDS_SCHEMA.properties.keywords.items;
    expect(item.properties.kind.enum).toEqual(["person", "place", "thing", "event", "feeling"]);
    expect(item.required).toEqual(["label", "kind", "surfaces"]);
    expect(item.additionalProperties).toBe(false);
    expect(KEYWORDS_SCHEMA.additionalProperties).toBe(false);
  });
});

describe("一文の切り出し", () => {
  it("。！？ と改行で区切る。括弧の中では区切らず、閉じ括弧は前の文に付ける。各文は本文の部分文字列のまま", () => {
    const body = "朝から雨。「行こうか！」と言った\nそらが笑った？ 展望台へ。（よかった。）「立った！」\n「閉じ忘れ。\n次の行";
    expect(splitSentences(body)).toEqual(["朝から雨。", "「行こうか！」と言った", "そらが笑った？", "展望台へ。", "（よかった。）「立った！」", "「閉じ忘れ。", "次の行"]);
    for (const s of splitSentences(body)) expect(body.includes(s)).toBe(true);
  });

  it("surface を含む最初の一文と、その文の中で先に出てくる形を返す", () => {
    expect(sentenceWith("雨だった。そらくんと展望台へ。そらが寝た", ["そら", "そらくん"])).toEqual({ sentence: "そらくんと展望台へ。", surface: "そらくん" });
    expect(sentenceWith("雨だった", ["そら"])).toBeNull();
  });
});

describe("buildKeywordMap", () => {
  it("本文に出てこない言葉・合計 2 回未満の言葉は捨てる。1 つの記憶に何度出てきても 1 回", () => {
    const m = buildKeywordMap({ generated_at: STORED_AT, keywords: [kw("展望台"), kw("海"), kw("指輪")] }, [
      mem("a", "展望台。展望台。展望台", "2024-05-01"),
      mem("b", "指輪を見た", "2024-06-01"),
    ]);
    expect(m.keywords).toEqual([]);
    const two = buildKeywordMap({ generated_at: STORED_AT, keywords: [kw("展望台")] }, [mem("a", "展望台", "2024-05-01"), mem("b", "また展望台", "2024-06-01")]);
    expect(two.keywords.map((k) => [k.label, k.role, k.total])).toEqual([["展望台", "leaf", 2]]);
    expect(two.years).toEqual([{ year: 2024, count: 2 }]);
  });

  it("起きた日が「いつだったか」の記憶は、年にも数にも引用にも入れない", () => {
    const m = buildKeywordMap({ generated_at: STORED_AT, keywords: [kw("展望台")] }, [
      mem("a", "展望台", "2024-05-01"),
      mem("u", "展望台", null),
      mem("b", "展望台", "2024-06", "month"),
    ]);
    expect(m.years).toEqual([{ year: 2024, count: 2 }]);
    expect(m.keywords[0]!.total).toBe(2);
    expect(m.keywords[0]!.mentions.map((x) => x.memory_id)).toEqual(["b", "a"]);
  });

  it("1 つの年だけなら leaf、2 つ以上の年なら bridge。bridge は回数の多い年 3 つまでを古い順に", () => {
    const rows = [
      mem("a1", "展望台へ", "2020-04-01"),
      mem("a2", "展望台へ", "2021-04-01"),
      mem("a3", "展望台へ", "2021-05-01"),
      mem("a4", "展望台へ", "2023-04-01"),
      mem("a5", "展望台へ", "2023-05-01"),
      mem("a6", "展望台へ", "2026-04-01"),
      mem("a7", "展望台へ", "2026-05-01"),
      mem("b1", "離婚の日", "2020-05-01"),
      mem("b2", "離婚の書類", "2020-06-01"),
    ];
    const m = buildKeywordMap({ generated_at: STORED_AT, keywords: [kw("離婚"), kw("展望台", ["展望台"], "place")] }, rows);
    const bridge = m.keywords.find((k) => k.label === "展望台")!;
    expect(bridge.role).toBe("bridge");
    expect(bridge.total).toBe(7);
    // 2020（1）・2021（2）・2023（2）・2026（2）のうち、回数の多い 3 つ（同じ回数なら新しい年）
    expect(bridge.years).toEqual([
      { year: 2021, count: 2 },
      { year: 2023, count: 2 },
      { year: 2026, count: 2 },
    ]);
    expect(m.keywords.find((k) => k.label === "離婚")).toMatchObject({ role: "leaf", years: [{ year: 2020, count: 2 }], total: 2 });
    expect(m.years.map((y) => y.year)).toEqual([2020, 2021, 2023, 2026]);
  });

  it("leaf は年ごとに回数の多い順に 4 つまで（同じなら先に挙げた言葉）、bridge は合計の多い順に 8 つまで", () => {
    const leafWords = ["一", "二", "三", "四", "五"].map((w) => `${w}丁目`);
    const rows: CountMemory[] = [];
    leafWords.forEach((w, i) => {
      for (let k = 0; k < 2 + (i === 4 ? 3 : 0); k += 1) rows.push(mem(`${w}${k}`, `${w}を歩いた`, `2024-0${k + 1}-01`));
    });
    const bridgeWords = Array.from({ length: 10 }, (_, i) => `橋${i}`);
    bridgeWords.forEach((w, i) => {
      for (let k = 0; k < 2 + i; k += 1) rows.push(mem(`${w}-${k}`, `${w}を渡った`, `${2020 + (k % 2)}-03-0${(k % 9) + 1}`));
    });
    const m = buildKeywordMap({ generated_at: STORED_AT, keywords: [...leafWords, ...bridgeWords].map((w) => kw(w)) }, rows);
    // 五丁目（5 回）が先頭、残りは 2 回ずつで挙げた順。5 つめの「四丁目」が落ちる
    expect(m.keywords.filter((k) => k.role === "leaf").map((k) => k.label)).toEqual(["五丁目", "一丁目", "二丁目", "三丁目"]);
    expect(m.keywords.filter((k) => k.role === "bridge").map((k) => k.label)).toEqual(["橋9", "橋8", "橋7", "橋6", "橋5", "橋4", "橋3", "橋2"]);
  });

  it("mentions は新しい順（起きた日、同じ日は書いた順の降順）に 10 件まで。各件は surface を含む本文の一文", () => {
    const rows = Array.from({ length: 12 }, (_, i) =>
      mem(`m${String(i).padStart(2, "0")}`, `雨の日。そらくんが${i}回わらった。おしまい`, `2025-01-${String((i % 6) + 1).padStart(2, "0")}`, "day", `2026-01-01T00:00:${String(i).padStart(2, "0")}.000Z`),
    );
    const m = buildKeywordMap({ generated_at: STORED_AT, keywords: [kw("そら", ["そら", "そらくん"], "person")] }, rows);
    const k = m.keywords[0]!;
    expect(k.total).toBe(12);
    expect(k.mentions).toHaveLength(10);
    // 起きた日 01-06 が新しい。同じ日（i と i+6）は書いたのが後（i+6）を先に
    expect(k.mentions.slice(0, 3).map((x) => x.memory_id)).toEqual(["m11", "m05", "m10"]);
    expect(k.mentions[0]).toEqual({ memory_id: "m11", happened_on: "2025-01-06", happened_on_precision: "day", sentence: "そらくんが11回わらった。", surface: "そらくん" });
  });

  it("label がいまの本文に無ければ（その記憶を消した）、いちばん多く出てくる形を地図に出す", () => {
    const m = buildKeywordMap({ generated_at: STORED_AT, keywords: [kw("そらくん", ["そらくん", "そら"], "person")] }, [mem("a", "そらと公園", "2025-01-01"), mem("b", "そらが寝た", "2025-02-01")]);
    expect(m.keywords[0]!.label).toBe("そら");
  });

  it("pickForPrompt は本文の合計が上限を越える前で止める（1 件目は必ず入れる）", () => {
    const rows = [{ body: "あ".repeat(30) }, { body: "い".repeat(30) }, { body: "う".repeat(30) }];
    expect(pickForPrompt(rows, 70)).toHaveLength(2);
    expect(pickForPrompt([{ body: "あ".repeat(100) }], 70)).toHaveLength(1);
  });
});

// ---------------------------------------------------------------
// POST / GET /api/keywords
// ---------------------------------------------------------------

type Out = unknown | Error;
const fakeCall = (answer: (req: AiRequest) => Out) => {
  const requests: AiRequest[] = [];
  const fn = (async (_env: unknown, req: AiRequest) => {
    requests.push(req);
    const r = answer(req);
    if (r instanceof Error) return { ok: false as const, error: r.message, model: "fake", input_tokens: 3 };
    return { ok: true as const, json: r, model: "fake", input_tokens: 100, output_tokens: 20 };
  }) as AiCaller;
  return Object.assign(fn, { requests });
};

const appWith = (call: AiCaller, now = () => new Date("2026-11-07T12:00:00.000Z")) => createApp({ keywords: { call, now } });

let seq = 0;
const ensureUser = (id: string) => db.raw.prepare("INSERT OR IGNORE INTO users (id, display_name, created_at, last_seen_at) VALUES (?, NULL, 'x', 'x')").run(id);
const insert = (userId: string, body: string, happened_on: string | null, created_at = "2026-11-01T00:00:00.000Z"): string => {
  ensureUser(userId);
  const id = `mem_${String(++seq).padStart(4, "0")}`;
  db.raw
    .prepare("INSERT INTO memories (id, user_id, body, happened_on, happened_on_precision, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .run(id, userId, body, happened_on, happened_on ? "day" : "unknown", created_at, created_at);
  return id;
};
// 8 件（展望台が 2020 と 2026、離婚が 2020 だけ、そらが 2025 だけ）
const seed = () => ({
  a: insert(ME, "離婚の届けを出した。ひとりで展望台へ走った", "2020-04-10"),
  b: insert(ME, "離婚のあと、はじめて料理をした", "2020-05-01"),
  c: insert(ME, "みさきと会った", "2023-03-01"),
  d: insert(ME, "そらが生まれた", "2025-01-15"),
  e: insert(ME, "そらがつかまり立ちをした！", "2025-11-07"),
  f: insert(ME, "同じ展望台で、みさきに指輪を渡した", "2026-04-01"),
  g: insert(ME, "電気代を払った", "2026-10-01"),
  h: insert(ME, "いつだったか、展望台の夢を見た", null),
});
const ANSWER = {
  keywords: [
    { label: "展望台", kind: "place", surfaces: ["展望台"] },
    { label: "離婚", kind: "event", surfaces: ["離婚"] },
    { label: "そら", kind: "person", surfaces: ["そら"] },
    { label: "みさき", kind: "person", surfaces: ["みさき"] },
    { label: "海", kind: "place", surfaces: ["海"] },
  ],
};

const H = (user = ME) => ({ [DEV_USER_HEADER]: user });
const postKeywords = async (app: ReturnType<typeof createApp>, user = ME) => {
  const ctx = fakeExecutionCtx();
  const res = await app.request("/api/keywords", { method: "POST", headers: H(user) }, env, ctx);
  await ctx.settle();
  return res;
};
const getKeywords = async (app: ReturnType<typeof createApp>, user = ME) => {
  const res = await app.request("/api/keywords", { headers: H(user) }, env);
  expect(res.status).toBe(200);
  return (await res.json()) as KeywordsResponse;
};
const runs = () =>
  db.raw.prepare("SELECT user_id, memory_id, kind, status, error, input_tokens FROM ai_runs ORDER BY created_at").all() as Array<{
    user_id: string;
    memory_id: string | null;
    kind: string;
    status: string;
    error: string | null;
    input_tokens: number | null;
  }>;
const stored = () => {
  const v = r2.store.get(mapKey(ME));
  return v ? (JSON.parse(new TextDecoder().decode(v.body)) as Record<string, unknown>) : null;
};

describe("POST /api/keywords", () => {
  it("記憶が 8 件未満なら 400（few）で、Claude を呼ばず ai_runs も R2 も作らない", async () => {
    for (let i = 0; i < 7; i += 1) insert(ME, `展望台 ${i}`, "2025-01-01");
    const call = fakeCall(() => ANSWER);
    const res = await postKeywords(appWith(call));
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("few");
    expect(call.requests).toHaveLength(0);
    expect(runs()).toEqual([]);
    expect(r2.store.size).toBe(0);
    const g = await getKeywords(appWith(call));
    expect(g).toEqual({ map: null, stale_count: 0, memory_count: 7, reason: "few" });
  });

  it("Claude を effort low・60 秒で 1 回呼び、言葉の一覧だけを maps/<user>/keywords.json に置いて、数え直した地図を返す", async () => {
    const ids = seed();
    const call = fakeCall(() => ANSWER);
    const res = await postKeywords(appWith(call));
    expect(res.status).toBe(200);
    expect(call.requests).toHaveLength(1);
    const req = call.requests[0]!;
    expect(req.effort).toBe("low");
    expect(req.timeout_ms).toBe(KEYWORDS_TIMEOUT_MS);
    expect(req.timeout_ms).toBe(60_000);
    // 本文と起きた日を渡す（いつだったかは「不明」）。id は渡さない
    expect(req.user).toContain('<memory happened_on="2020-04-10">離婚の届けを出した。ひとりで展望台へ走った</memory>');
    expect(req.user).toContain('<memory happened_on="不明">いつだったか、展望台の夢を見た</memory>');
    expect(req.user).not.toContain(ids.a);

    // R2 には label・kind・surfaces と作った時刻・件数だけ。本文に無い「海」は捨ててある
    expect([...r2.store.keys()]).toEqual(["maps/hana@example.com/keywords.json"]);
    expect(stored()).toEqual({
      version: 1,
      generated_at: "2026-11-07T12:00:00.000Z",
      memory_count: 8,
      keywords: ANSWER.keywords.slice(0, 4),
    });
    expect(runs()).toEqual([{ user_id: ME, memory_id: null, kind: "retrospect", status: "succeeded", error: null, input_tokens: 100 }]);

    const body = (await res.json()) as KeywordsResponse;
    expect(body.refreshed).toBe(true);
    expect(body.memory_count).toBe(8);
    expect(body.stale_count).toBe(0);
    expect(body.reason).toBeUndefined();
    const map = body.map!;
    expect(map.years).toEqual([
      { year: 2020, count: 2 },
      { year: 2023, count: 1 },
      { year: 2025, count: 2 },
      { year: 2026, count: 2 },
    ]);
    // 展望台は 2020 と 2026 をつなぐ（いつだったかの 1 件は数えない）。みさきも 2023 と 2026。離婚は 2020、そらは 2025 の leaf
    expect(map.keywords.map((k) => [k.label, k.role, k.total, k.years.map((y) => y.year)])).toEqual([
      ["展望台", "bridge", 2, [2020, 2026]],
      ["みさき", "bridge", 2, [2023, 2026]],
      ["離婚", "leaf", 2, [2020]],
      ["そら", "leaf", 2, [2025]],
    ]);
    expect(map.keywords[0]!.mentions).toEqual([
      { memory_id: ids.f, happened_on: "2026-04-01", happened_on_precision: "day", sentence: "同じ展望台で、みさきに指輪を渡した", surface: "展望台" },
      { memory_id: ids.a, happened_on: "2020-04-10", happened_on_precision: "day", sentence: "ひとりで展望台へ走った", surface: "展望台" },
    ]);
    // GET も同じ地図
    expect((await getKeywords(appWith(call))).map).toEqual(map);
  });

  it("Claude が失敗したら R2 に触らず、ai_runs は failed。前の地図があればそれを返し、無ければ 502", async () => {
    seed();
    const fail = fakeCall(() => new Error("api_529: overloaded"));
    const first = await postKeywords(appWith(fail));
    expect(first.status).toBe(502);
    expect(((await first.json()) as { error: { code: string } }).error.code).toBe("unavailable");
    expect(r2.store.size).toBe(0);
    expect(runs().map((r) => [r.kind, r.status, r.error])).toEqual([["retrospect", "failed", "api_529: overloaded"]]);

    await postKeywords(appWith(fakeCall(() => ANSWER)));
    const before = stored();
    const later = () => new Date("2026-11-08T09:00:00.000Z");
    const again = await postKeywords(appWith(fakeCall(() => new Error("timeout")), later));
    expect(again.status).toBe(200);
    const body = (await again.json()) as KeywordsResponse;
    expect(body.refreshed).toBe(false);
    expect(body.map!.generated_at).toBe("2026-11-07T12:00:00.000Z");
    expect(body.map!.keywords.map((k) => k.label)).toEqual(["展望台", "みさき", "離婚", "そら"]);
    expect(stored()).toEqual(before);
    // 言葉が 1 つも残らない答え（本文に無い言葉だけ）でも、前の地図は上書きしない
    const empty = await postKeywords(appWith(fakeCall(() => ({ keywords: [{ label: "海", kind: "place", surfaces: ["海"] }] })), later));
    expect(((await empty.json()) as KeywordsResponse).refreshed).toBe(false);
    expect(stored()).toEqual(before);
    expect(runs().map((r) => r.status)).toEqual(["failed", "succeeded", "failed", "empty"]);
  });

  it("前の地図が無いときに言葉が 1 つも残らなければ、空の地図を置く（画面は「もう少し書きためると」）", async () => {
    seed();
    const res = await postKeywords(appWith(fakeCall(() => ({ keywords: [] }))));
    expect(res.status).toBe(200);
    const body = (await res.json()) as KeywordsResponse;
    expect(body.map!.keywords).toEqual([]);
    expect(runs().map((r) => r.status)).toEqual(["empty"]);
  });

  it("ほかの人の記憶は Claude にも数にも混ぜない。ほかの人の GET は自分の地図だけ（無ければ null）", async () => {
    seed();
    for (let i = 0; i < 3; i += 1) insert(OTHER, `よその展望台 ${i}、そらも`, `202${i}-01-01`);
    const call = fakeCall(() => ANSWER);
    await postKeywords(appWith(call));
    expect(call.requests[0]!.user).not.toContain("よその");
    const mine = (await getKeywords(appWith(call))).map!;
    const view = mine.keywords.find((k) => k.label === "展望台")!;
    expect(view.total).toBe(2);
    expect(view.mentions.every((x) => !x.sentence.includes("よその"))).toBe(true);
    expect(mine.keywords.find((k) => k.label === "そら")!.total).toBe(2);
    const theirs = await getKeywords(appWith(call), OTHER);
    expect(theirs).toEqual({ map: null, stale_count: 0, memory_count: 3, reason: "few" });
  });
});

describe("GET /api/keywords（見るたびに数え直す）", () => {
  it("地図が無ければ map は null（8 件以上なら reason を付けない）", async () => {
    seed();
    expect(await getKeywords(appWith(fakeCall(() => ANSWER)))).toEqual({ map: null, stale_count: 0, memory_count: 8 });
  });

  it("消した記憶は mentions にも数にも出ない。2 回を割った言葉は地図から外れる", async () => {
    const ids = seed();
    const app = appWith(fakeCall(() => ANSWER));
    await postKeywords(app);
    const del = await app.request(`/api/memories/${ids.f}`, { method: "DELETE", headers: H() }, env);
    expect(del.status).toBe(204);
    const map = (await getKeywords(app)).map!;
    const all = map.keywords.flatMap((k) => k.mentions.map((x) => x.memory_id));
    expect(all).not.toContain(ids.f);
    // 展望台（2020 の 1 回だけになった）とみさき（2023 の 1 回）は外れる
    expect(map.keywords.map((k) => k.label)).toEqual(["離婚", "そら"]);
    expect(map.years.find((y) => y.year === 2026)).toEqual({ year: 2026, count: 1 });
  });

  it("直した本文の言葉で数える（本文から消えた言葉の引用は出ない）", async () => {
    const ids = seed();
    const app = appWith(fakeCall(() => ANSWER));
    await postKeywords(app);
    db.raw.prepare("UPDATE memories SET body = ? WHERE id = ?").run("そらが笑った", ids.b);
    const map = (await getKeywords(app)).map!;
    expect(map.keywords.find((k) => k.label === "離婚")).toBeUndefined();
    expect(map.keywords.find((k) => k.label === "そら")!.total).toBe(3);
  });

  it("stale_count は地図を作ったあとに書いた記憶の数", async () => {
    seed();
    const app = appWith(fakeCall(() => ANSWER));
    await postKeywords(app);
    insert(ME, "きょうも展望台", "2026-11-08", "2026-11-08T01:00:00.000Z");
    insert(ME, "そらと散歩", "2026-11-08", "2026-11-08T02:00:00.000Z");
    const g = await getKeywords(app);
    expect(g.stale_count).toBe(2);
    expect(g.memory_count).toBe(10);
    expect(g.map!.keywords.find((k) => k.label === "展望台")!.total).toBe(3);
  });

  it("R2 の中身が壊れていたら地図は無いものとして扱う", async () => {
    seed();
    r2.store.set(mapKey(ME), { body: new TextEncoder().encode("{oops"), contentType: "application/json" });
    expect((await getKeywords(appWith(fakeCall(() => ANSWER)))).map).toBeNull();
  });
});
