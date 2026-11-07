// ことばの地図（ADR-0014、requirements F10）。Claude は呼ばない（fakeCall）。
// 検証（verifyKeywords）・数え方（buildKeywordMap）の純粋関数と、POST / GET /api/keywords の流れ（R2 の置き場、ai_runs、
// 8 件未満、消した記憶、ほかの人の記憶、Claude の失敗）
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AiCaller, AiRequest } from "../src/ai/client";
import { KEYWORDS_TIMEOUT_MS, pickForPrompt } from "../src/ai/keywords";
import { KEYWORDS_SCHEMA } from "../src/ai/schemas";
import { KEYWORDS_MAX, verifyKeywords } from "../src/ai/verify";
import { DEV_USER_HEADER } from "../src/auth";
import type { Env } from "../src/env";
import { createApp } from "../src/index";
import { BRIDGE_MAX, buildKeywordMap, LEAF_PER_YEAR, sentenceWith, splitSentences, type CountMemory, type StoredKeyword } from "../src/keywords/count";
import { mapKey, writeStoredMap } from "../src/keywords/store";
import type { KeywordsResponse } from "../src/routes/keywords";
import { createTestD1, fakeExecutionCtx, fakeR2, type TestD1 } from "./sqlite-d1";

const ME = "hana@example.com";
const OTHER = "other@example.com";
// 互いに部分文字列にならない名前（「橋1」が「橋10」の本文にも当たらないように、数字ではなく 1 字ずつ違う漢字にする）
const NAMES = [..."甲乙丙丁戊己庚辛壬癸子丑寅卯辰巳午未申酉戌亥"];

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

  it("label が本文の別の所にあっても、残った形のどれにも含まれなければ形に替える（まとめ言葉を、ほかの形の回数と引用に付けて出さない）", () => {
    const r = verifyKeywords(
      {
        keywords: [
          { label: "家族", kind: "person", surfaces: ["そら"] },
          { label: "誕生日", kind: "event", surfaces: ["誕生日を祝った"] },
        ],
      },
      ["家族でそらの誕生日を祝った", "そらが歩いた"],
    );
    expect(r.items).toEqual([
      { label: "そら", kind: "person", surfaces: ["そら"] },
      { label: "誕生日", kind: "event", surfaces: ["誕生日を祝った"] },
    ]);
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

  it("kind が enum 以外・形の崩れ・label の重複は捨てる。surfaces は重複を除いて 3 個まで。最大 KEYWORDS_MAX（60）個", () => {
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
    const many = { keywords: Array.from({ length: KEYWORDS_MAX + 5 }, (_, i) => ({ label: `語${i}`, kind: "thing", surfaces: [`語${i}`] })) };
    expect(verifyKeywords(many, [many.keywords.map((k) => k.label).join(" ")]).items).toHaveLength(KEYWORDS_MAX);
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
  it("本文に出てこない言葉は捨てる。1 つの年にだけ出る言葉は 1 回でも leaf（11/7 夜に 2 回未満を捨てるのをやめた）。1 つの記憶に何度出てきても 1 回", () => {
    const m = buildKeywordMap({ generated_at: STORED_AT, keywords: [kw("展望台"), kw("海"), kw("指輪")] }, [
      mem("a", "展望台。展望台。展望台", "2024-05-01"),
      mem("b", "指輪を見た", "2024-06-01"),
    ]);
    expect(m.keywords.map((k) => [k.label, k.role, k.total])).toEqual([
      ["展望台", "leaf", 1],
      ["指輪", "leaf", 1],
    ]);
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

  it("leaf は年ごとに回数の多い順に LEAF_PER_YEAR（6）つまで（同じなら先に挙げた言葉）、bridge は合計の多い順に BRIDGE_MAX（20）まで", () => {
    // leaf: 2024 だけに出る言葉を LEAF_PER_YEAR + 1 個。最後の 1 つだけ 5 回、ほかは 2 回
    const leafWords = NAMES.slice(0, LEAF_PER_YEAR + 1).map((w) => `${w}丁目`);
    const last = leafWords.length - 1;
    const rows: CountMemory[] = [];
    leafWords.forEach((w, i) => {
      for (let k = 0; k < 2 + (i === last ? 3 : 0); k += 1) rows.push(mem(`${w}${k}`, `${w}を歩いた`, `2024-0${k + 1}-01`));
    });
    // bridge: 2020 と 2021 に出る言葉を BRIDGE_MAX + 2 個。i 番めは 2 + i 回（幅はどれも 1 なので、合計の多い順になる）
    const bridgeWords = NAMES.slice(0, BRIDGE_MAX + 2).map((w) => `${w}橋`);
    bridgeWords.forEach((w, i) => {
      for (let k = 0; k < 2 + i; k += 1) rows.push(mem(`${w}-${k}`, `${w}を渡った`, `${2020 + (k % 2)}-03-${String((k % 28) + 1).padStart(2, "0")}`));
    });
    const m = buildKeywordMap({ generated_at: STORED_AT, keywords: [...leafWords, ...bridgeWords].map((w) => kw(w)) }, rows);
    // 5 回の言葉が先頭、残りは 2 回ずつで挙げた順。LEAF_PER_YEAR + 1 番めが落ちる
    expect(m.keywords.filter((k) => k.role === "leaf").map((k) => k.label)).toEqual([leafWords[last], ...leafWords.slice(0, LEAF_PER_YEAR - 1)]);
    // 少ない 2 つ（甲橋・乙橋）が落ちる
    expect(m.keywords.filter((k) => k.role === "bridge").map((k) => k.label)).toEqual(bridgeWords.slice(2).reverse());
  });

  it("bridge は合計の多い 2 つを先に入れ、残りはつなぐ年の幅（最初から最後まで）の大きい順に選ぶ。隣り合う年だけの言葉は、離れた年をつなぐ言葉に譲る", () => {
    const rows: CountMemory[] = [];
    // 「人」は 2025・2026 に 10 回ずつ（幅 1）、「展望台」は 2020 と 2023 に 1 回ずつ（幅 3）
    for (let k = 0; k < 10; k += 1) rows.push(mem(`p5-${k}`, "人と歩いた", `2025-0${(k % 9) + 1}-01`), mem(`p6-${k}`, "人と歩いた", `2026-0${(k % 9) + 1}-01`));
    rows.push(mem("t20", "ひとりで展望台へ", "2020-07-12"), mem("t23", "あの展望台で", "2023-11-22"));
    // 合計 3 回・幅 1 の言葉を BRIDGE_MAX 個（「人」「展望台」と合わせて BRIDGE_MAX + 2 個。2 つ落ちる）
    const fillers = NAMES.slice(0, BRIDGE_MAX).map((w) => `言葉${w}`);
    fillers.forEach((w, i) => {
      for (let k = 0; k < 3; k += 1) rows.push(mem(`${w}-${k}`, `${w}を書いた`, `${2025 + (k % 2)}-1${i % 3}-0${k + 1}`));
    });
    const m = buildKeywordMap({ generated_at: STORED_AT, keywords: ["人", ...fillers, "展望台"].map((w) => kw(w)) }, rows);
    const bridges = m.keywords.filter((k) => k.role === "bridge");
    expect(bridges).toHaveLength(BRIDGE_MAX);
    // 合計の多い 2 つ（人 20 回、言葉甲 3 回）が先、その次に幅 3 の展望台。合計 3 回の言葉のうち、残りは挙げた順に BRIDGE_MAX - 3 個だけ
    expect(bridges.slice(0, 3).map((k) => k.label)).toEqual(["人", fillers[0], "展望台"]);
    expect(bridges[2]!.years).toEqual([
      { year: 2020, count: 1 },
      { year: 2023, count: 1 },
    ]);
    expect(bridges.map((k) => k.label)).not.toContain(fillers[BRIDGE_MAX - 1]);
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

  it("label が当たった形のどれにも含まれなければ（本文の別の所にだけある語）、いちばん多く出てくる形を地図に出す", () => {
    const m = buildKeywordMap({ generated_at: STORED_AT, keywords: [kw("家族", ["そら"], "person")] }, [
      mem("a", "家族でそらの誕生日を祝った", "2025-01-01"),
      mem("b", "そらが歩いた", "2025-02-01"),
    ]);
    expect(m.keywords.map((k) => [k.label, k.total, k.mentions.map((x) => x.surface)])).toEqual([["そら", 2, ["そら", "そら"]]]);
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

describe("ログ", () => {
  it("言葉を捨てたとき・失敗したときのログにメールアドレスを出さない。エラーは文言だけ", async () => {
    seed();
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      await postKeywords(appWith(fakeCall(() => ANSWER))); // 本文に無い「海」を捨てる
      (r2 as unknown as { put: () => Promise<never> }).put = async () => {
        throw new Error("r2 down");
      };
      const res = await postKeywords(appWith(fakeCall(() => ANSWER)));
      expect(((await res.json()) as KeywordsResponse).refreshed).toBe(false);
      const dropped = log.mock.calls.find((c) => c[0] === "keywords dropped")!;
      const failedCall = error.mock.calls.find((c) => c[0] === "collectKeywords failed")!;
      expect(dropped).toBeDefined();
      expect(failedCall).toBeDefined();
      expect(failedCall.every((a) => typeof a === "string")).toBe(true);
      expect(failedCall[2]).toBe("r2 down");
      for (const call of [...log.mock.calls, ...error.mock.calls]) for (const a of call) expect(String(a)).not.toContain("@example.com");
    } finally {
      log.mockRestore();
      error.mockRestore();
    }
  });
});

describe("GET /api/keywords（見るたびに数え直す）", () => {
  it("地図が無ければ map は null（8 件以上なら reason を付けない）", async () => {
    seed();
    expect(await getKeywords(appWith(fakeCall(() => ANSWER)))).toEqual({ map: null, stale_count: 0, memory_count: 8 });
  });

  it("消した記憶は mentions にも数にも出ない。1 つの年だけになった言葉は leaf に変わる", async () => {
    const ids = seed();
    const app = appWith(fakeCall(() => ANSWER));
    await postKeywords(app);
    const del = await app.request(`/api/memories/${ids.f}`, { method: "DELETE", headers: H() }, env);
    expect(del.status).toBe(204);
    const map = (await getKeywords(app)).map!;
    const all = map.keywords.flatMap((k) => k.mentions.map((x) => x.memory_id));
    expect(all).not.toContain(ids.f);
    // 展望台（2020 の 1 回だけになった）とみさき（2023 の 1 回）は、年をまたがなくなったので leaf になる
    expect(map.keywords.map((k) => [k.label, k.role, k.total])).toEqual([
      ["離婚", "leaf", 2],
      ["展望台", "leaf", 1],
      ["みさき", "leaf", 1],
      ["そら", "leaf", 2],
    ]);
    expect(map.years.find((y) => y.year === 2026)).toEqual({ year: 2026, count: 1 });
  });

  it("直した本文の言葉で数える（本文から消えた言葉の引用は出ない）", async () => {
    const ids = seed();
    const app = appWith(fakeCall(() => ANSWER));
    await postKeywords(app);
    db.raw.prepare("UPDATE memories SET body = ? WHERE id = ?").run("そらが笑った", ids.b);
    const map = (await getKeywords(app)).map!;
    const rikon = map.keywords.find((k) => k.label === "離婚")!;
    expect(rikon.total).toBe(1);
    expect(rikon.mentions.map((x) => x.memory_id)).not.toContain(ids.b);
    const sora = map.keywords.find((k) => k.label === "そら")!;
    expect([sora.role, sora.total]).toEqual(["bridge", 3]);
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

describe("記憶を消したとき（R2 の言葉の一覧からも外す。原則 5）", () => {
  const del = async (app: ReturnType<typeof createApp>, id: string) => {
    const res = await app.request(`/api/memories/${id}`, { method: "DELETE", headers: H() }, env);
    expect(res.status).toBe(204);
  };
  const storedKeywords = () => (stored()!.keywords as StoredKeyword[]).map((k) => [k.label, k.surfaces]);

  it("消した本文にだけ出てきた言葉は、maps/<user>/keywords.json から外す。ほかの人の本文に同じ言葉があっても残さない", async () => {
    const ids = seed();
    insert(OTHER, "よその離婚の話を聞いた", "2024-01-01");
    const app = appWith(fakeCall(() => ANSWER));
    await postKeywords(app);
    await del(app, ids.a);
    // b にまだ「離婚」がある
    expect(storedKeywords()).toContainEqual(["離婚", ["離婚"]]);
    await del(app, ids.b);
    expect(JSON.stringify(stored())).not.toContain("離婚");
    // 展望台は f と h（いつだったか）にもあるので残す。作った時刻と件数はそのまま（集めなおしは勧めない）
    expect(storedKeywords()).toEqual([
      ["展望台", ["展望台"]],
      ["そら", ["そら"]],
      ["みさき", ["みさき"]],
    ]);
    expect(stored()!.generated_at).toBe("2026-11-07T12:00:00.000Z");
    expect((await getKeywords(app)).stale_count).toBe(0);
  });

  it("起きた日が「いつだったか」の本文にだけ残る言葉は置き場に残す（地図には出ない）", async () => {
    const ids = seed();
    const app = appWith(fakeCall(() => ANSWER));
    await postKeywords(app);
    await del(app, ids.a);
    await del(app, ids.f);
    expect(storedKeywords()).toContainEqual(["展望台", ["展望台"]]);
    expect((await getKeywords(app)).map!.keywords.find((k) => k.label === "展望台")).toBeUndefined();
  });

  it("消した本文にだけあった形を外し、label がその形にだけ含まれていたら残った形に替える", async () => {
    const x = insert(ME, "そらくんが笑った", "2025-01-01");
    insert(ME, "そらが寝た", "2025-02-01");
    await writeStoredMap(r2, ME, { version: 1, generated_at: STORED_AT, memory_count: 2, keywords: [kw("そらくん", ["そらくん", "そら"], "person"), kw("寝た", ["寝た"])] });
    const app = appWith(fakeCall(() => ANSWER));
    await del(app, x);
    expect(storedKeywords()).toEqual([
      ["そら", ["そら"]],
      ["寝た", ["寝た"]],
    ]);
  });

  it("消した本文に地図の言葉が無ければ置き場に書かない。置き場が読めなくても記憶は消える（204）", async () => {
    const ids = seed();
    const app = appWith(fakeCall(() => ANSWER));
    await postKeywords(app);
    const put = vi.spyOn(r2, "put");
    await del(app, ids.g); // 「電気代を払った」
    expect(put).not.toHaveBeenCalled();
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      (r2 as unknown as { get: () => Promise<never> }).get = async () => {
        throw new Error("r2 down");
      };
      await del(app, ids.c);
      expect(db.raw.prepare("SELECT COUNT(*) AS n FROM memories WHERE id = ?").get(ids.c)).toEqual({ n: 0 });
      expect(error.mock.calls.find((c) => c[0] === "keywords forget failed")).toEqual(["keywords forget failed", ids.c, "r2 down"]);
    } finally {
      error.mockRestore();
    }
  });
});
