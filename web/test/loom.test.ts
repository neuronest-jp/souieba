// 糸の帯（ThreadLoom）の並べ方。数値の期待値は「ふたつの日」の見本を作った gen.py の strip_svg と突き合わせたもの。
import { describe, expect, it } from "vitest";
import type { Precision } from "../src/api/types";
import { layoutLoom, pickArc, type LoomBead, type LoomItem, type LoomLayout } from "../src/connections/loom";

const TODAY = "2026-11-07";
const at = (happened_on: string | null, happened_on_precision: Precision) => ({ happened_on, happened_on_precision });

// seed.sql の demo@example.com の記憶（起きた日がわかっている 15 件）と、11/7 に書いたひとこと 1 件 = 16 件
const SEED_BEADS: LoomBead[] = [
  at("2024-02-20", "day"),
  at("2024-03-09", "day"),
  at("2024-04-14", "day"),
  at("2024-06-01", "month"),
  at("2024-08-02", "day"),
  at("2024-11-18", "day"),
  at("2025-01-12", "day"),
  at("2025-02-22", "day"),
  at("2025-05-11", "day"),
  at("2025-10-03", "day"),
  at("2026-01-04", "day"),
  at("2026-04-06", "day"),
  at("2026-07-19", "day"),
  at("2026-09-28", "day"),
  at("2026-10-01", "month"),
  at("2026-11-07", "day"),
];

const item = (id: string, newer: [string | null, Precision], older: [string | null, Precision], feedback: LoomItem["feedback"] = "none"): LoomItem => ({
  id,
  feedback,
  memory: at(...newer),
  related_memory: at(...older),
});

// 見本の ?n=10 と同じ 10 本（created_at の新しい順）
const TEN: LoomItem[] = [
  item("x-baaba", ["2026-11-07", "day"], ["2024-02-20", "day"]),
  item("p-haruto", ["2026-11-07", "day"], ["2024-04-14", "day"], "helpful"),
  item("p-ume", ["2026-11-07", "day"], ["2024-06-01", "month"]),
  item("x-rain", ["2026-09-28", "day"], ["2024-11-18", "day"]),
  item("x-park", ["2026-04-06", "day"], ["2024-04-14", "day"]),
  item("p-yuki", ["2026-04-06", "day"], ["2025-05-11", "day"], "helpful"),
  item("x-amazake", ["2026-01-04", "day"], ["2025-01-12", "day"], "helpful"),
  item("x-kenshin", ["2025-10-03", "day"], ["2024-11-18", "day"]),
  item("x-kotatsu", ["2025-01-12", "day"], ["2024-06-01", "month"], "helpful"),
  item("x-kotatsu2", ["2025-01-12", "day"], ["2024-02-20", "day"]),
];

const numbers = (l: LoomLayout): number[] => [
  l.width,
  l.height,
  l.baseline,
  l.labelY,
  ...l.rules.flatMap((r) => [r.x1, r.x2]),
  ...l.labels.map((t) => t.x),
  ...l.beads,
  ...l.arcs.flatMap((a) => [a.x1, a.x2, a.height]),
];

const expectSane = (l: LoomLayout) => {
  for (const n of numbers(l)) expect(Number.isFinite(n)).toBe(true);
  for (const x of [...l.beads, ...l.arcs.flatMap((a) => [a.x1, a.x2]), ...l.rules.flatMap((r) => [r.x1, r.x2])]) {
    expect(x).toBeGreaterThanOrEqual(10);
    expect(x).toBeLessThanOrEqual(352);
  }
  for (const r of l.rules) expect(r.x1).toBeLessThanOrEqual(r.x2);
  for (const a of l.arcs) {
    expect(a.height).toBeGreaterThan(0);
    expect(a.height).toBeLessThanOrEqual(54);
    expect(a.d).not.toContain("NaN");
  }
};

describe("layoutLoom（糸の帯）", () => {
  it("0 本: 弧は無く、粒と年の縁だけ。年の境目は 6px あけ、年の文字は区間の真ん中", () => {
    const l = layoutLoom({ beads: SEED_BEADS, items: [], today: TODAY });
    expectSane(l);
    expect(l.arcs).toEqual([]);
    expect(l).toMatchObject({ width: 362, height: 90, baseline: 60, labelY: 84 });
    expect(l.rules).toEqual([
      { year: 2024, x1: 13, x2: 121.2 },
      { year: 2025, x1: 127.2, x2: 235.1 },
      { year: 2026, x1: 241.1, x2: 349 },
    ]);
    expect(l.labels).toEqual([
      { text: "2024", x: 67.1 },
      { text: "2025", x: 181.2 },
      { text: "2026", x: 295.1 },
    ]);
  });

  it("16 件の記憶なら粒は 16 個。unknown は置かず、同じ日は同じ x に重なる（16 件に unknown と 11/7 をもう 1 件足すと 17 個）", () => {
    const l = layoutLoom({ beads: [...SEED_BEADS, at(null, "unknown"), at("2026-11-07", "day")], items: [], today: TODAY });
    expectSane(l);
    expect(l.beads).toHaveLength(17);
    expect(l.beads.filter((x) => x === l.beads[15])).toHaveLength(2); // 11/7 が 2 件
    // day はその日、month は 15 日（2024-06-01 month は 2024-06-15 の位置）
    const t0 = Date.UTC(2024, 0, 1);
    const xOf = (y: number, m: number, d: number) => Math.round((10 + ((Date.UTC(y, m - 1, d) - t0) / (Date.UTC(2027, 0, 1) - t0)) * 342) * 10) / 10;
    expect(l.beads[0]).toBe(xOf(2024, 2, 20));
    expect(l.beads[3]).toBe(xOf(2024, 6, 15));
    expect(l.beads[14]).toBe(xOf(2026, 10, 15));
    expect(layoutLoom({ beads: SEED_BEADS, items: [], today: TODAY }).beads).toHaveLength(16);
  });

  it("year 精度の粒は 7 月 1 日に置く", () => {
    const l = layoutLoom({ beads: [at("2024-01-01", "year"), at("2024-07-01", "day")], items: [], today: TODAY });
    expect(l.beads[0]).toBe(l.beads[1]);
  });

  it("1 本: 弧の両端は昔の側（x1）と書いた側（x2）、高さは 8 + 30√(span/342)", () => {
    const l = layoutLoom({ beads: SEED_BEADS, items: [item("recall_seed_01", ["2026-04-06", "day"], ["2025-05-11", "day"], "helpful")], today: TODAY });
    expectSane(l);
    expect(l.arcs).toHaveLength(1);
    const a = l.arcs[0]!;
    expect(a).toMatchObject({ id: "recall_seed_01", x1: 164.8, x2: 267.7, helpful: true, feedback: "helpful" });
    expect(a.height).toBeCloseTo(8 + 30 * Math.sqrt((267.7 - 164.8) / 342), 1);
    // M x1,60 C x1,60−k x2,60−k x2,60（0.75k = 高さ）。k は丸める前の高さから出すので、丸めた高さとは 0.1 ほどずれうる
    const m = /^M164\.8 60C164\.8 (-?[\d.]+) 267\.7 (-?[\d.]+) 267\.7 60$/.exec(a.d);
    expect(m).not.toBeNull();
    expect(m![1]).toBe(m![2]);
    expect(Math.abs(Number(m![1]) - (60 - a.height / 0.75))).toBeLessThanOrEqual(0.15);
  });

  it("10 本: items と同じ順に 10 本。端を分け合う糸は入れ子になり、高さは 54 以下", () => {
    const l = layoutLoom({ beads: SEED_BEADS, items: TEN, today: TODAY });
    expectSane(l);
    expect(l.arcs.map((a) => a.id)).toEqual(TEN.map((t) => t.id));
    // gen.py の strip_svg と同じ高さ
    expect(l.arcs.map((a) => [a.id, a.x1, a.x2, a.height])).toEqual([
      ["x-baaba", 25.6, 334.8, 46.8],
      ["p-haruto", 42.5, 334.8, 40.8],
      ["p-ume", 61.8, 334.8, 34.8],
      ["x-rain", 110.5, 322.4, 31.6],
      ["x-park", 42.5, 267.7, 32.3],
      ["p-yuki", 164.8, 267.7, 24.5],
      ["x-amazake", 127.6, 239, 33.2],
      ["x-kenshin", 110.5, 210, 24.2],
      ["x-kotatsu", 61.8, 127.6, 21.2],
      ["x-kotatsu2", 25.6, 127.6, 27.2],
    ]);
    // 11/7 を分け合う 3 本は、短い順に 6px ずつ高くなる
    const h = Object.fromEntries(l.arcs.map((a) => [a.id, a.height]));
    expect(h["p-haruto"]! - h["p-ume"]!).toBeCloseTo(6, 1);
    expect(h["x-baaba"]! - h["p-haruto"]!).toBeCloseTo(6, 1);
    expect(l.arcs.filter((a) => a.helpful).map((a) => a.id)).toEqual(["p-haruto", "p-yuki", "x-amazake", "x-kotatsu"]);
  });

  it("入れ子: 端を分け合う糸は、長さだけで決まる高さより高くなる。離れた糸は長さだけで決まる", () => {
    const short = item("s", ["2026-03-01", "day"], ["2026-02-01", "day"]);
    const shared = item("t", ["2026-03-05", "day"], ["2026-02-01", "day"]); // 昔の端を分け合う、少しだけ長い糸
    const apart = item("u", ["2026-09-05", "day"], ["2026-08-01", "day"]); // 端が離れている
    const l = layoutLoom({ beads: [], items: [short, shared, apart], today: TODAY });
    expectSane(l);
    const [s, t, u] = l.arcs;
    const natural = (a: { x1: number; x2: number }) => 8 + 30 * Math.sqrt(Math.abs(a.x2 - a.x1) / 342);
    expect(t!.height).toBeGreaterThan(natural(t!) + 1);
    expect(t!.height).toBeCloseTo(s!.height + 6, 0);
    expect(u!.height).toBeCloseTo(natural(u!), 0);
  });

  it("入れ子がいくら重なっても 54 で止まる", () => {
    const many = Array.from({ length: 15 }, (_, i) => item(`n${i}`, ["2026-11-07", "day"], [`2026-${String(10 - (i % 9)).padStart(2, "0")}-0${1 + Math.floor(i / 9)}`, "day"]));
    const l = layoutLoom({ beads: [], items: many, today: TODAY });
    expectSane(l);
    expect(Math.max(...l.arcs.map((a) => a.height))).toBe(54);
  });

  it("「いつだったか」を含む組は帯に置かない（一覧には出る）", () => {
    const l = layoutLoom({
      beads: SEED_BEADS,
      items: [item("a", ["2026-11-07", "day"], [null, "unknown"]), item("b", [null, "unknown"], ["2024-06-01", "month"]), TEN[2]!],
      today: TODAY,
    });
    expectSane(l);
    expect(l.arcs.map((a) => a.id)).toEqual(["p-ume"]);
  });

  it("今年しか無いときは、年の代わりに 1月・4月・7月・10月（その月の真ん中）を出す", () => {
    const l = layoutLoom({ beads: [at("2026-04-06", "day"), at("2026-11-07", "day")], items: [], today: TODAY });
    expectSane(l);
    expect(l.rules).toEqual([{ year: 2026, x1: 13, x2: 349 }]);
    expect(l.labels.map((t) => t.text)).toEqual(["1月", "4月", "7月", "10月"]);
    const mid = (m: number) => Math.round((10 + ((Date.UTC(2026, m - 1, 1) + Date.UTC(2026, m, 1)) / 2 - Date.UTC(2026, 0, 1)) / (365 * 86_400_000) * 342) * 10) / 10;
    expect(l.labels.map((t) => t.x)).toEqual([mid(1), mid(4), mid(7), mid(10)]);
  });

  it("記憶が 1 件も無くても、今年の縁と月の文字を返す（NaN にならない）", () => {
    const l = layoutLoom({ beads: [], items: [], today: TODAY });
    expectSane(l);
    expect(l.beads).toEqual([]);
    expect(l.labels.map((t) => t.text)).toEqual(["1月", "4月", "7月", "10月"]);
  });

  it("「今年」は渡した today（Asia/Tokyo）の年で決まる。年が明ければ去年の粒も年の縁になる", () => {
    const l = layoutLoom({ beads: [at("2026-12-31", "day")], items: [], today: "2027-01-01" });
    expect(l.labels.map((t) => t.text)).toEqual(["2026", "2027"]);
  });

  it("組の端が粒より古くても（粒は新しい 500 件で切れる）、端を帯の内側に置く", () => {
    const l = layoutLoom({ beads: SEED_BEADS, items: [item("old", ["2026-11-07", "day"], ["2019-05-01", "month"])], today: TODAY });
    expectSane(l);
    expect(l.rules[0]!.year).toBe(2019);
    expect(l.arcs[0]!.x1).toBeGreaterThan(10);
  });

  it("先の日付（validate は 2100 年まで受け付ける）は、その年まで帯を伸ばして置く", () => {
    const l = layoutLoom({ beads: [...SEED_BEADS, at("2028-03-01", "day")], items: [], today: TODAY });
    expectSane(l);
    expect(l.rules.map((r) => r.year)).toEqual([2024, 2025, 2026, 2027, 2028]);
    expect(l.beads[16]).toBeLessThan(352);
  });

  it("ずっと昔の記憶があっても縁は潰れず、年の文字は重ならないよう新しい年から間引く", () => {
    const l = layoutLoom({ beads: [at("1950-01-01", "year"), ...SEED_BEADS], items: [], today: TODAY });
    expectSane(l);
    expect(l.rules).toHaveLength(77);
    expect(l.labels[l.labels.length - 1]!.text).toBe("2026");
    for (let i = 1; i < l.labels.length; i++) expect(l.labels[i]!.x - l.labels[i - 1]!.x).toBeGreaterThanOrEqual(40);
  });

  it("同じ入力なら同じ出力。入力は書き換えない", () => {
    const beads = structuredClone(SEED_BEADS);
    const items = structuredClone(TEN);
    const a = layoutLoom({ beads, items, today: TODAY });
    const b = layoutLoom({ beads, items, today: TODAY });
    expect(a).toEqual(b);
    expect(beads).toEqual(SEED_BEADS);
    expect(items).toEqual(TEN);
  });
});

describe("pickArc（帯を押したときの組の選び方）", () => {
  // 帯の弧の上の点（3 次ベジェの t の位置）
  const pointOn = (l: LoomLayout, id: string, t: number) => {
    const a = l.arcs.find((x) => x.id === id)!;
    const top = l.baseline - a.height / 0.75;
    const u = 1 - t;
    const x = u * u * u * a.x1 + 3 * u * u * t * a.x1 + 3 * u * t * t * a.x2 + t * t * t * a.x2;
    const y = u * u * u * l.baseline + 3 * u * u * t * top + 3 * u * t * t * top + t * t * t * l.baseline;
    return { x, y };
  };

  it("弧の上か近く（22px 以内）を押すと、その組を選ぶ。遠ければ選ばない", () => {
    const l = layoutLoom({ beads: SEED_BEADS, items: TEN, today: TODAY });
    for (const a of l.arcs) {
      const p = pointOn(l, a.id, 0.5);
      expect(pickArc(l, p.x, p.y)).toBe(a.id); // 弧の頂きを押せば、その弧
    }
    // 1 本だけの帯: 弧から 20px 外れても選び、24px 外れたら選ばない
    const one = layoutLoom({ beads: SEED_BEADS, items: [TEN[7]!], today: TODAY });
    const apex = pointOn(one, "x-kenshin", 0.5);
    expect(pickArc(one, apex.x, apex.y - 20)).toBe("x-kenshin");
    expect(pickArc(one, apex.x, apex.y - 24)).toBeNull();
    expect(pickArc(one, 5, 2)).toBeNull(); // 帯の左上の何も無い所
  });

  it("弧が密なときは、指に一番近い弧を選ぶ（入れ子の内と外を、押した高さで分ける）", () => {
    const l = layoutLoom({ beads: SEED_BEADS, items: TEN, today: TODAY });
    // 2026-11-07 に結び目を分け合う 3 本（x-baaba が外、p-ume が内）
    const outer = pointOn(l, "x-baaba", 0.5);
    const inner = pointOn(l, "p-ume", 0.5);
    expect(outer.y).toBeLessThan(inner.y);
    expect(pickArc(l, outer.x, outer.y)).toBe("x-baaba");
    expect(pickArc(l, inner.x, inner.y)).toBe("p-ume");
  });

  it("両端の結び目を分け合う弧のどれも同じ近さなら、短い弧（小さくて押しにくい方）を選ぶ", () => {
    const l = layoutLoom({ beads: SEED_BEADS, items: TEN, today: TODAY });
    const shared = l.arcs.filter((a) => a.x2 === l.arcs.find((x) => x.id === "x-baaba")!.x2);
    expect(shared.length).toBeGreaterThan(1);
    const shortest = [...shared].sort((a, b) => Math.abs(a.x2 - a.x1) - Math.abs(b.x2 - b.x1))[0]!;
    expect(pickArc(l, shared[0]!.x2, l.baseline)).toBe(shortest.id);
  });

  it("弧が 1 本も無ければ何も選ばない", () => {
    const l = layoutLoom({ beads: SEED_BEADS, items: [], today: TODAY });
    expect(pickArc(l, 100, 40)).toBeNull();
  });
});

describe("横に送る年表（scroll。11/8）", () => {
  const STORY: LoomItem[] = [
    item("long", ["2026-11-07", "day"], ["2020-01-05", "day"]),
    item("short", ["2026-10-01", "day"], ["2026-09-20", "day"]),
    ...TEN,
  ];
  const storyBeads = [at("2020-01-05", "day"), ...SEED_BEADS];

  it("詰めると 1 年が 150px を割るときだけ、1 年 180px で全体の幅を延ばす。粒の x は同じ式で全体の幅に置く", () => {
    const l = layoutLoom({ beads: storyBeads, items: STORY, today: TODAY, width: 402, scroll: true });
    expect(l.view).toBe(402);
    expect(l.width).toBe(20 + 7 * 180); // 2020〜2026 の 7 年
    const r2020 = l.rules.find((r) => r.year === 2020)!;
    expect(r2020.x2 - r2020.x1).toBeCloseTo(180 - 6, 0);
    // 2026-11-07 は右の端の近く
    expect(l.beads.at(-1)!).toBeGreaterThan(l.width - 40);
    expect(l.beads[0]!).toBeLessThan(15);
    // 粒の間: 2024-02-20 と 2024-03-09 は 18 日 ≒ 9px 離れる（詰めると 3px 足らず）
    const fit = layoutLoom({ beads: storyBeads, items: STORY, today: TODAY, width: 402 });
    expect(l.beads[2]! - l.beads[1]!).toBeGreaterThan(8);
    expect(fit.beads[2]! - fit.beads[1]!).toBeLessThan(3);
  });

  it("年が少なく、詰めても 1 年 150px 以上あるときは見える幅のまま（送らない）", () => {
    const l = layoutLoom({ beads: [at("2026-01-04", "day")], items: [], today: TODAY, width: 402, scroll: true });
    expect(l.width).toBe(402);
    const two = layoutLoom({ beads: [at("2025-01-04", "day")], items: [], today: TODAY, width: 402, scroll: true });
    expect(two.width).toBe(402); // 2 年なら 1 年 191px
  });

  it("ずっと昔の記憶があっても帯は 3600px まで", () => {
    const l = layoutLoom({ beads: [at("1960-01-01", "day")], items: [], today: TODAY, width: 402, scroll: true });
    expect(l.width).toBeLessThanOrEqual(3600);
  });

  it("送る帯は高さ 120（縁 90）。弧の高さはまたぐ長さで決まり、頂点は上の端から 6px の内に収まる（長い弧が上の端に積み重ならない）", () => {
    const l = layoutLoom({ beads: storyBeads, items: STORY, today: TODAY, width: 402, scroll: true });
    expect(l).toMatchObject({ height: 120, baseline: 90, labelY: 114 });
    for (const a of l.arcs) {
      expect(a.height).toBeLessThanOrEqual(l.baseline - 6);
      expect(l.baseline - a.height).toBeGreaterThanOrEqual(6); // 曲線の頂点（光の太い線 9px の半分より内）
    }
    const long = l.arcs.find((a) => a.id === "long")!;
    const short = l.arcs.find((a) => a.id === "short")!;
    // 長さで決まる: 10 + 16·log2(1 + len / 60)
    expect(short.height).toBeCloseTo(10 + 16 * Math.log2(1 + (short.x2 - short.x1) / 60), 0);
    expect(long.height).toBeGreaterThan(short.height + 40);
    // 高さが散らばる（11/8 夜まで: 長い弧が入れ子の +6 でみな 54 に揃い、上の端の横線の束になった）
    const atTop = l.arcs.filter((a) => a.height >= l.baseline - 6).length;
    expect(atTop).toBeLessThanOrEqual(1);
    expect(new Set(l.arcs.map((a) => Math.round(a.height))).size).toBeGreaterThan(l.arcs.length / 2);
  });

  it("送る帯の弧はなだらかな放物線（制御点は両端から長さの 1/3 内側）。見える幅の帯は今までどおり両端の真上", () => {
    const l = layoutLoom({ beads: storyBeads, items: STORY, today: TODAY, width: 402, scroll: true });
    const a = l.arcs.find((x) => x.id === "long")!;
    expect(a.c1).toBeCloseTo(a.x1 + (a.x2 - a.x1) / 3, 0);
    expect(a.c2).toBeCloseTo(a.x2 - (a.x2 - a.x1) / 3, 0);
    const m = /^M([\d.]+) 90C([\d.]+) (-?[\d.]+) ([\d.]+) (-?[\d.]+) ([\d.]+) 90$/.exec(a.d)!.slice(1).map(Number);
    expect([m[0], m[1], m[3], m[5]]).toEqual([a.x1, a.c1, a.c2, a.x2]);
    expect(m[2]).toBeCloseTo(l.baseline - a.height / 0.75, 0); // 頂点の高さが h になる制御点の y
    expect(m[4]).toBe(m[2]);
    const fit = layoutLoom({ beads: storyBeads, items: STORY, today: TODAY, width: 402 });
    for (const f of fit.arcs) {
      expect(f.c1).toBe(f.x1);
      expect(f.c2).toBe(f.x2);
    }
  });

  it("送る帯では、端を分け合うだけの糸は高くしない（傾きで分かれる）。両端とも重なる糸だけ 6 高くする", () => {
    const beads = [at("2020-01-05", "day")];
    const items = [
      item("a", ["2026-11-07", "day"], ["2023-03-01", "day"]),
      item("b", ["2026-11-07", "day"], ["2021-06-01", "day"]),
      item("c", ["2026-11-07", "day"], ["2023-03-01", "day"]),
    ];
    const l = layoutLoom({ beads, items, today: TODAY, width: 402, scroll: true });
    const h = Object.fromEntries(l.arcs.map((x) => [x.id, x]));
    const natural = (x: { x1: number; x2: number }) => 10 + 16 * Math.log2(1 + Math.abs(x.x2 - x.x1) / 60);
    expect(h.b!.height).toBeCloseTo(natural(h.b!), 0); // 新しい端を a と分け合うが、高くならない
    expect(h.a!.height).toBeCloseTo(natural(h.a!), 0);
    expect(h.c!.height).toBeCloseTo(h.a!.height + 6, 0); // a と両端とも同じ
  });

  it("pickArc は放物線の弧の上で当たる（両端の真上を通る形で当てない）", () => {
    const l = layoutLoom({ beads: storyBeads, items: [STORY.find((x) => x.id === "long")!], today: TODAY, width: 402, scroll: true });
    const a = l.arcs[0]!;
    // t = 0.25 の点（放物線では x = x1 + len/4 で、高さは 0.75h）
    const x = a.x1 + (a.x2 - a.x1) / 4;
    const y = l.baseline - 0.75 * a.height;
    expect(pickArc(l, x, y)).toBe("long");
    // 弧から 22 より遠ければ当たらない
    expect(pickArc(l, x, y - 23)).toBeNull();
  });

  it("pickArc は帯の全体の座標で当たる（見える位置に送った量を足す）。指の大きさ（半径 22）の内なら当たる", () => {
    const l = layoutLoom({ beads: storyBeads, items: STORY, today: TODAY, width: 402, scroll: true });
    const s = l.arcs.find((a) => a.id === "short")!;
    const scrollLeft = l.width - l.view;
    const apexX = (s.x1 + s.x2) / 2;
    const apexY = l.baseline - s.height;
    // 見えている位置（入れ物の左端から）+ scrollLeft
    expect(pickArc(l, apexX - scrollLeft + scrollLeft, apexY)).toBe("short");
    // 足し忘れると、左の方の何も無い所になる
    expect(pickArc(l, apexX - scrollLeft, apexY)).not.toBe("short");
    expect(pickArc(l, apexX, apexY - 20)).not.toBeNull();
  });
});
