// ことばの地図の並べ方（web/src/words/layout.ts、wireframes 第10節）。402pt（中身 362px）と 375pt（335px）で、
// 言葉が画面の内に収まり、重ならず、leaf はその年の行に、bridge はつなぐ年のあいだに置かれること
import { describe, expect, it } from "vitest";
import type { KeywordMap, MapKeyword } from "../src/api/types";
import { estimateWidth, layoutWords, sizeFor, threadPath, WORDS, type PlacedWord } from "../src/words/layout";

const kw = (label: string, role: MapKeyword["role"], years: Array<[number, number]>, kind: MapKeyword["kind"] = "thing"): MapKeyword => ({
  label,
  kind,
  role,
  years: years.map(([year, count]) => ({ year, count })),
  total: years.reduce((n, [, c]) => n + c, 0),
  mentions: [],
});

const MAP: KeywordMap = {
  generated_at: "2026-11-07T00:00:00.000Z",
  years: [2020, 2021, 2022, 2023, 2024, 2025, 2026].map((year) => ({ year, count: 10 })),
  keywords: [
    kw("みさき", "bridge", [[2022, 10], [2023, 6], [2026, 5]], "person"),
    kw("そら", "bridge", [[2025, 9], [2026, 5]], "person"),
    kw("展望台", "bridge", [[2020, 1], [2023, 1]], "place"),
    kw("仕事", "bridge", [[2020, 5], [2025, 1], [2026, 1]]),
    kw("ドラマ", "bridge", [[2020, 5], [2022, 1]]),
    kw("休み", "bridge", [[2020, 3], [2021, 1], [2023, 1]]),
    kw("部屋", "bridge", [[2020, 2], [2023, 3]]),
    kw("クリスマス", "bridge", [[2023, 1], [2024, 1], [2025, 1]], "event"),
    kw("離婚届", "leaf", [[2020, 2]], "event"),
    kw("眠れない", "leaf", [[2020, 2]], "feeling"),
    kw("コンビニの弁当", "leaf", [[2020, 2]], "place"),
    kw("先輩", "leaf", [[2020, 4]], "person"),
    kw("婚姻届", "leaf", [[2024, 2]], "event"),
    kw("ハッカソン", "leaf", [[2026, 4]], "event"),
    kw("Claude Code", "leaf", [[2026, 2]]),
    kw("いちばん長いことばのなまえ", "leaf", [[2021, 2]]),
  ],
};

const overlaps = (a: PlacedWord, b: PlacedWord) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

// 線の上の点を拾う（layout.ts が出す形だけ: M と C）
const samplePath = (d: string): Array<[number, number]> => {
  const pts: Array<[number, number]> = [];
  const tokens = d.match(/[MC]|-?\d+(?:\.\d+)?/g) ?? [];
  let i = 0;
  let x = 0;
  let y = 0;
  const num = () => Number(tokens[i++]);
  while (i < tokens.length) {
    const c = tokens[i++];
    if (c === "M") {
      x = num();
      y = num();
    } else if (c === "C") {
      const [ax, ay, bx, by, x1, y1] = [num(), num(), num(), num(), num(), num()];
      for (let t = 0; t <= 1; t += 0.01) {
        const u = 1 - t;
        pts.push([u * u * u * x + 3 * u * u * t * ax + 3 * u * t * t * bx + t * t * t * x1, u * u * u * y + 3 * u * u * t * ay + 3 * u * t * t * by + t * t * t * y1]);
      }
      x = x1;
      y = y1;
    } else {
      throw new Error(`知らない形 ${c}`);
    }
  }
  return pts;
};

// 糸の d（M x0 y0 C bx y0 bx y1 x1 y1）を読む
const threadOf = (d: string) => {
  const m = /^M(-?[\d.]+) (-?[\d.]+)C(-?[\d.]+) (-?[\d.]+) (-?[\d.]+) (-?[\d.]+) (-?[\d.]+) (-?[\d.]+)$/.exec(d);
  if (!m) throw new Error(`糸の形ではない: ${d}`);
  const [x0, y0, c1x, c1y, c2x, c2y, x1, y1] = m.slice(1).map(Number) as [number, number, number, number, number, number, number, number];
  return { x0, y0, c1x, c1y, c2x, c2y, x1, y1 };
};

describe("layoutWords", () => {
  for (const width of [362, 335]) {
    it(`幅 ${width}px: どの言葉も 1 回だけ置かれ、画面の内に収まり、ほかの言葉にも年の札にも重ならない`, () => {
      const l = layoutWords(MAP, width);
      expect(l.words.map((w) => w.keyword.label).sort()).toEqual(MAP.keywords.map((k) => k.label).sort());
      for (const w of l.words) {
        expect(w.x).toBeGreaterThanOrEqual(0);
        expect(w.x + w.w).toBeLessThanOrEqual(width);
        expect(w.y).toBeGreaterThanOrEqual(0);
        expect(w.y + w.h).toBeLessThanOrEqual(l.height);
        expect(w.h).toBeGreaterThanOrEqual(44); // 押せる所は 44pt 以上
        // 背骨のまわり（年の札と糸が通る所）には置かない
        if (w.side === "right") expect(w.x).toBeGreaterThanOrEqual(l.spineX + WORDS.inset);
        else expect(w.x + w.w).toBeLessThanOrEqual(l.spineX - WORDS.inset);
        expect(w.size).toBeGreaterThanOrEqual(13);
        expect(w.size).toBeLessThanOrEqual(17);
      }
      for (let i = 0; i < l.words.length; i += 1) for (let j = i + 1; j < l.words.length; j += 1) expect(overlaps(l.words[i]!, l.words[j]!)).toBe(false);
    });
  }

  it("年は古い順に上から。leaf はその年の行に、bridge はつなぐ年のうち最も古い年と最も新しい年のあいだに置く", () => {
    const l = layoutWords(MAP, 362);
    expect(l.years.map((y) => y.year)).toEqual([2020, 2021, 2022, 2023, 2024, 2025, 2026]);
    for (let i = 1; i < l.years.length; i += 1) expect(l.years[i]!.y).toBeGreaterThan(l.years[i - 1]!.y);
    const yOf = (year: number) => l.years.find((y) => y.year === year)!.y;
    for (const w of l.words) {
      const mid = w.y + w.h / 2;
      if (w.keyword.role === "leaf") {
        expect(Math.abs(mid - yOf(w.keyword.years[0]!.year))).toBeLessThan(60);
      } else {
        const ys = w.keyword.years.map((y) => yOf(y.year));
        expect(mid).toBeGreaterThan(Math.min(...ys));
        expect(mid).toBeLessThan(Math.max(...ys));
      }
    }
    // 2020 の leaf は回数の多い順に 右・左・右・左
    const leaves2020 = l.rows[0]!.leaves;
    expect(leaves2020.find((w) => w.keyword.label === "先輩")!.side).toBe("right");
    expect(leaves2020.filter((w) => w.side === "right")).toHaveLength(2);
    expect(leaves2020.filter((w) => w.side === "left")).toHaveLength(2);
  });

  it("線は leaf に 1 本、bridge にはつなぐ年の数だけ。読み上げの順は 年 → その年の言葉 → 次の年とのあいだの言葉", () => {
    const l = layoutWords(MAP, 362);
    const leaves = MAP.keywords.filter((k) => k.role === "leaf").length;
    const threads = MAP.keywords.filter((k) => k.role === "bridge").reduce((n, k) => n + k.years.length, 0);
    expect(l.links.filter((x) => x.role === "leaf")).toHaveLength(leaves);
    expect(l.links.filter((x) => x.role === "bridge")).toHaveLength(threads);
    expect(l.rows.map((r) => r.year.year)).toEqual([2020, 2021, 2022, 2023, 2024, 2025, 2026]);
    expect(l.rows.flatMap((r) => [...r.leaves, ...r.bridges]).map((w) => w.id)).toEqual(l.words.map((w) => w.id));
    // bridge は左右に分ける（8 つなら 4 つずつ）
    const bridges = l.words.filter((w) => w.keyword.role === "bridge");
    expect(bridges.filter((w) => w.side === "left")).toHaveLength(4);
    expect(bridges.filter((w) => w.side === "right")).toHaveLength(4);
  });

  it("長い言葉は字を小さくし、それでも収まらなければ 2 行にする", () => {
    const l = layoutWords(MAP, 335);
    const long = l.words.find((w) => w.keyword.label === "いちばん長いことばのなまえ")!;
    expect(long.lines).toBe(2);
    expect(long.h).toBe(WORDS.wordH2);
    expect(long.size).toBe(13);
    const short = l.words.find((w) => w.keyword.label === "先輩")!;
    expect(short.lines).toBe(1);
  });

  for (const width of [362, 335]) {
    it(`幅 ${width}px: 糸は bridge につなぐ年の数だけ。線は言葉の箱に入らず、結び目は年の札の縁に年と側ごとに 1 つ`, () => {
      const l = layoutWords(MAP, width);
      const threads = MAP.keywords.filter((k) => k.role === "bridge").reduce((n, k) => n + k.years.length, 0);
      expect(l.links.filter((x) => x.role === "bridge")).toHaveLength(threads);
      // 線は言葉の箱（縁から 1px 内側）に入らない
      for (const link of l.links)
        for (const [px, py] of samplePath(link.d))
          for (const w of l.words) expect(px > w.x + 1 && px < w.x + w.w - 1 && py > w.y + 1 && py < w.y + w.h - 1, `${link.id} が ${w.id} に入る`).toBe(false);
      // 結び目: 年の札の縁（2px 外）に、糸が届く年と側ごとに 1 つ
      const sideOf = new Map(l.words.map((w) => [w.id, w.side]));
      const pairs = new Set(l.links.filter((x) => x.role === "bridge").map((x) => `${x.id.split(">")[1]}:${sideOf.get(x.word)}`));
      expect(l.knots.map((k) => k.id.replace("knot:", "")).sort()).toEqual([...pairs].sort());
      for (const k of l.knots) {
        expect(Math.abs(k.x - l.spineX)).toBeCloseTo(WORDS.pillW / 2 + 2, 5);
        expect(l.years.some((y) => y.y === k.y)).toBe(true);
      }
    });

    it(`幅 ${width}px: 糸は言葉の内側の縁から年の札の縁へ。ふくらみは札の縁から 6px 以上、言葉の縁から 14px 以上離れ、長い糸ほど背骨の近くを通る`, () => {
      const l = layoutWords(MAP, width);
      const byId = new Map(l.words.map((w) => [w.id, w]));
      const yOf = new Map(l.years.map((y) => [y.year, y.y]));
      const bxOf = new Map<string, number>();
      for (const link of l.links.filter((x) => x.role === "bridge")) {
        const w = byId.get(link.word)!;
        const t = threadOf(link.d);
        const inner = w.side === "right" ? w.x : w.x + w.w;
        const edge = l.spineX + (w.side === "right" ? 1 : -1) * (WORDS.pillW / 2);
        // 両端: 言葉の内側の縁の真ん中から、つなぐ年の札の縁へ。両端は横向きに出入りする（制御点が端と同じ高さ）
        expect(t.x0).toBeCloseTo(inner, 5);
        expect(t.y0).toBeCloseTo(w.y + w.h / 2, 0);
        expect(t.x1).toBeCloseTo(edge, 5);
        expect(t.y1).toBe(yOf.get(Number(link.id.split(">")[1])));
        expect(t.c1y).toBe(t.y0);
        expect(t.c2y).toBe(t.y1);
        expect(t.c1x).toBe(t.c2x);
        // ふくらみは札の縁と言葉の縁のあいだ
        expect(Math.abs(t.c1x - edge)).toBeGreaterThanOrEqual(6 - 0.05);
        expect(Math.abs(t.c1x - edge)).toBeLessThanOrEqual(21 + 0.05);
        expect(Math.abs(inner - t.c1x)).toBeGreaterThanOrEqual(14 - 0.05);
        expect(Math.sign(t.c1x - edge)).toBe(Math.sign(inner - t.c1x));
        bxOf.set(link.word, Math.abs(t.c1x - l.spineX));
      }
      // 側ごとに、つなぐ年の端から端までが長い糸ほど、ふくらみは背骨に近い
      for (const side of ["left", "right"] as const) {
        const list = l.words
          .filter((w) => w.keyword.role === "bridge" && w.side === side)
          .map((w) => {
            const ys = w.keyword.years.map((y) => yOf.get(y.year)!);
            return { span: Math.max(...ys) - Math.min(...ys), bx: bxOf.get(w.id)! };
          })
          .sort((a, b) => a.span - b.span);
        expect(list.length).toBeGreaterThan(1);
        for (let i = 1; i < list.length; i += 1) expect(list[i]!.bx).toBeLessThanOrEqual(list[i - 1]!.bx);
        expect(list[0]!.bx).toBeGreaterThan(list[list.length - 1]!.bx);
      }
    });
  }

  it("年が 1 つだけでも描ける（bridge は無い）", () => {
    const l = layoutWords({ years: [{ year: 2026, count: 3 }], keywords: [kw("ハッカソン", "leaf", [[2026, 3]])] }, 362);
    expect(l.words).toHaveLength(1);
    expect(l.spineTop).toBe(l.spineBottom);
  });
});

describe("部品", () => {
  it("字の大きさは回数で 13〜17px。どれも同じなら 15px", () => {
    expect(sizeFor(2, 2, 30)).toBe(13);
    expect(sizeFor(30, 2, 30)).toBe(17);
    expect(sizeFor(16, 2, 30)).toBe(15);
    expect(sizeFor(4, 4, 4)).toBe(15);
  });

  it("幅の見積もりは半角を細く数える", () => {
    expect(estimateWidth("そら", 17)).toBeGreaterThan(estimateWidth("ab", 17));
    expect(estimateWidth("みさき", 17)).toBe(Math.ceil(3 * 17 * 1.02 + WORDS.padX));
  });

  it("糸は言葉の縁から年の札の縁へのなめらかな曲線。両端は横向きに出入りし、制御点の x はふくらみ", () => {
    expect(threadPath(250, 100, 230, 214, 40)).toBe("M250 100C230 100 230 40 214 40");
    expect(threadPath(112.25, 100.04, 131.5, 152.5, 40)).toBe("M112.3 100C131.5 100 131.5 40 152.5 40");
  });
});
