// ことばの地図の並べ方（web/src/words/layout.ts、wireframes 第10節）。402pt（中身 362px）と 375pt（335px）で、
// 言葉が画面の内に収まり、重ならず、leaf はその年の行に、bridge はつなぐ年のあいだに置かれること
import { describe, expect, it } from "vitest";
import type { KeywordMap, MapKeyword } from "../src/api/types";
import { bowQuarter, bowX, estimateWidth, lanePath, layoutWords, LINE_STYLES, sizeFor, threadPath, WORDS, type PlacedWord } from "../src/words/layout";

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

// 線の上の点を拾う（layout.ts が出す形だけ: M / C / H / L と、中心が (始点の x, 終点の y) の楕円の 4 分の 1 の A）
const samplePath = (d: string): Array<[number, number]> => {
  const pts: Array<[number, number]> = [];
  const tokens = d.match(/[MCHLVAQ]|-?\d+(?:\.\d+)?/g) ?? [];
  let i = 0;
  let x = 0;
  let y = 0;
  const num = () => Number(tokens[i++]);
  while (i < tokens.length) {
    const c = tokens[i++];
    if (c === "M") {
      x = num();
      y = num();
    } else if (c === "H") {
      const x1 = num();
      for (let t = 0; t <= 1; t += 0.02) pts.push([x + (x1 - x) * t, y]);
      x = x1;
    } else if (c === "V") {
      const y1 = num();
      for (let t = 0; t <= 1; t += 0.02) pts.push([x, y + (y1 - y) * t]);
      y = y1;
    } else if (c === "L") {
      const x1 = num();
      const y1 = num();
      for (let t = 0; t <= 1; t += 0.02) pts.push([x + (x1 - x) * t, y + (y1 - y) * t]);
      x = x1;
      y = y1;
    } else if (c === "C") {
      const [ax, ay, bx, by, x1, y1] = [num(), num(), num(), num(), num(), num()];
      for (let t = 0; t <= 1; t += 0.01) {
        const u = 1 - t;
        pts.push([u * u * u * x + 3 * u * u * t * ax + 3 * u * t * t * bx + t * t * t * x1, u * u * u * y + 3 * u * u * t * ay + 3 * u * t * t * by + t * t * t * y1]);
      }
      x = x1;
      y = y1;
    } else if (c === "Q") {
      const [ax, ay, x1, y1] = [num(), num(), num(), num()];
      for (let t = 0; t <= 1; t += 0.05) {
        const u = 1 - t;
        pts.push([u * u * x + 2 * u * t * ax + t * t * x1, u * u * y + 2 * u * t * ay + t * t * y1]);
      }
      x = x1;
      y = y1;
    } else if (c === "A") {
      i += 5; // rx ry 回転 大きい弧 向き
      const x1 = num();
      const y1 = num();
      for (let t = 0; t <= 1; t += 0.01) {
        const a = (t * Math.PI) / 2;
        pts.push([x + (x1 - x) * Math.sin(a), y1 + (y - y1) * Math.cos(a)]);
      }
      x = x1;
      y = y1;
    }
  }
  return pts;
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
        // 背骨のまわり（年の札と糸の通り道）には置かない
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

  // bridge の糸の描き方（a 糸 / b 弧 / c 控えめ / lane 11/7 の形）は開発の間だけ比べる。どれを選んでも、言葉の置き場と線の数は同じ
  for (const lines of LINE_STYLES) {
    it(`描き方 ${lines}: 言葉の置き場は描き方で変わらず、bridge の線はつなぐ年の数だけ。線は言葉の箱に入らず、線の端の印は背骨と言葉のあいだにある`, () => {
      for (const width of [362, 335]) {
        const base = layoutWords(MAP, width);
        const l = layoutWords(MAP, width, lines);
        expect(l.lines).toBe(lines);
        expect(l.words.map((w) => [w.id, w.x, w.y])).toEqual(base.words.map((w) => [w.id, w.x, w.y]));
        const threads = MAP.keywords.filter((k) => k.role === "bridge").reduce((n, k) => n + k.years.length, 0);
        expect(l.links.filter((x) => x.role === "bridge")).toHaveLength(threads);
        // 線は言葉の箱（縁から 1px 内側）に入らない
        for (const link of l.links)
          for (const [px, py] of samplePath(link.d))
            for (const w of l.words) expect(px > w.x + 1 && px < w.x + w.w - 1 && py > w.y + 1 && py < w.y + w.h - 1, `${link.id} が ${w.id} に入る`).toBe(false);
        for (const k of l.knots) {
          const off = Math.abs(k.x - l.spineX);
          expect(off).toBeGreaterThanOrEqual(WORDS.pillW / 2);
          expect(off).toBeLessThanOrEqual(WORDS.inset + WORDS.stagger);
        }
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

  it("糸は言葉の縁から出て、通り道を縦に通り、年の札の縁に届く", () => {
    const d = lanePath(250, 100, 222, 40, 214);
    expect(d.startsWith("M250 100H228")).toBe(true);
    expect(d).toContain("V46");
    expect(d.endsWith("H214")).toBe(true);
    expect(lanePath(250, 40, 222, 40, 214)).toBe("M250 40H214");
  });

  it("a・c の糸は言葉の縁から年の札の縁へのなめらかな曲線。制御点の x は背骨と言葉のあいだ", () => {
    expect(threadPath(250, 100, 230, 214, 40)).toBe("M250 100C230 100 230 40 214 40");
  });

  it("b の弧は年の札の縁から頂点までの楕円の 4 分の 1。弧の上の点は頂点の高さでいちばん外", () => {
    expect(bowQuarter(214, 40, 20, 100, 1)).toBe("M214 40A20 60 0 0 1 234 100");
    expect(bowQuarter(214, 160, 20, 100, 1)).toBe("M214 160A20 60 0 0 0 234 100");
    expect(bowQuarter(148, 40, 20, 100, -1)).toBe("M148 40A20 60 0 0 0 128 100");
    expect(bowX(214, 20, 100, 60, 100, 1)).toBe(234);
    expect(bowX(214, 20, 100, 60, 40, 1)).toBe(214);
    expect(bowX(148, 20, 100, 60, 100, -1)).toBe(128);
  });
});
