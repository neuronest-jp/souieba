// ことばの地図の並べ方（S6、wireframes 第10節、ADR-0014）。純粋関数。402pt の縦長の画面で読めることを第一にする。
//   - 年の背骨: 画面の真ん中に縦の線を引き、年の札（年の数字）を古い年から上に並べる
//   - leaf（1 つの年だけに出る言葉）: その年の札の左右に振り分ける（回数の多い順に 右・左・右・左）。各側は上下に積む
//   - bridge（2 つ以上の年に出る言葉）: 年と年のあいだの行の左右に置き、つなぐ年の札へ糸を引く。置く行は、つなぐ年の真ん中に近い行のうち
//     空いている所。左右は地図全体で少ない側へ（同じなら、その行で少ない側。それも同じなら右）。
//   - 糸（bridge の線）: 言葉の内側の縁から、つなぐ年の札それぞれへ、なめらかな曲線（3 次ベジェ。両端は横向きに出入りする）を 1 本ずつ。
//     ふくらみ（制御点の x）は年の札の縁から 6〜21px で、側ごとに、つなぐ年の端から端までが長い糸ほど背骨の近くを通す（あいだの年の言葉から離す）。
//     言葉の縁には 14px より近づけない。線は背骨と言葉のあいだ（年の札の縁から言葉の内側の縁まで）だけを通るので、言葉の文字には重ならない
//     （細い線どうしは交わることがある）。札の縁には小さな結び目（年と側ごとに 1 つ）。色・太さ・不透明度は画面が決める（WordsScreen.vue）
//   - 言葉の大きさは回数で少しだけ変える（13〜17px）。幅は字数から見積もり、収まらなければ字を小さくし、それでも収まらなければ 2 行にする
// 位置は箱の左上（x, y）と幅・高さ。測らずに決める（線の端を描くのに getBoundingClientRect を使わない）
// 糸の端の結び目（knots）も位置をここで決める（SVG の path の端は画面から読めないので）
import type { KeywordMap, MapKeyword, YearCount } from "../api/types";

export const WORDS = {
  pillW: 58, // 年の札の幅
  pillH: 30,
  inset: 64, // 背骨から言葉の箱の内側の縁まで
  stagger: 12, // 同じ側の 2 つめの言葉を外へずらす
  wordH: 44, // 押せる所の高さ（44pt）
  wordH2: 62, // 2 行のとき
  stackGap: 4,
  rowPad: 10,
  gapEmpty: 22, // 言葉の無い、年と年のあいだ
  padX: 22, // 言葉の箱の内側の左右の余白（縁 1px を含む）
  minSize: 13,
  maxSize: 17,
} as const;

export type Side = "left" | "right";
export type PlacedWord = {
  id: string;
  keyword: MapKeyword;
  side: Side;
  x: number;
  y: number;
  w: number;
  h: number;
  size: number;
  lines: 1 | 2;
};
export type PlacedYear = YearCount & { y: number };
export type MapLink = { id: string; d: string; role: "leaf" | "bridge"; word: string };
/** 糸の結び目（年の札の縁。年と側ごとに 1 つ） */
export type MapKnot = { id: string; x: number; y: number; word: string };
export type MapRow = { year: PlacedYear; leaves: PlacedWord[]; bridges: PlacedWord[] };
export type WordsLayout = {
  width: number;
  height: number;
  spineX: number;
  spineTop: number;
  spineBottom: number;
  years: PlacedYear[];
  words: PlacedWord[];
  links: MapLink[];
  knots: MapKnot[];
  /** 読み上げの順: 年 → その年の言葉 → その年と次の年のあいだの言葉 */
  rows: MapRow[];
};

export const wordId = (k: Pick<MapKeyword, "role" | "label">) => `${k.role}:${k.label}`;

/** 字数からの幅の見積もり（半角は 0.58 字、ほかは 1 字。字間 .02em と内側の余白を足す） */
export const estimateWidth = (label: string, size: number): number => {
  let em = 0;
  for (const ch of label) em += /[ -~｡-ﾟ]/.test(ch) ? 0.58 : 1;
  return Math.ceil(em * size * 1.02 + WORDS.padX);
};

/** 回数から字の大きさ（13〜17px）。どれも同じ回数なら 15px */
export const sizeFor = (total: number, min: number, max: number): number => {
  if (max <= min) return 15;
  return Math.round(WORDS.minSize + ((WORDS.maxSize - WORDS.minSize) * (total - min)) / (max - min));
};

const fit = (label: string, size: number, room: number): { size: number; w: number; lines: 1 | 2 } => {
  for (let s = size; s >= WORDS.minSize; s -= 1) {
    const w = estimateWidth(label, s);
    if (w <= room) return { size: s, w, lines: 1 };
  }
  return { size: WORDS.minSize, w: room, lines: 2 };
};

type Box = { keyword: MapKeyword; side: Side; size: number; w: number; h: number; lines: 1 | 2 };
const stackHeight = (boxes: Box[]) => boxes.reduce((n, b) => n + b.h, 0) + Math.max(0, boxes.length - 1) * WORDS.stackGap;

const r = (n: number) => Math.round(n * 10) / 10;

/** 糸: 言葉の内側の縁 (x0, y0) から年の札の縁 (x1, y1) へのなめらかな曲線。両端は横向きに出入りし、ふくらみは bx。
 *  制御点の x はどれも x0 と x1 のあいだ（bx もそこに取る）なので、曲線は背骨と言葉のあいだから出ない */
export const threadPath = (x0: number, y0: number, bx: number, x1: number, y1: number): string =>
  `M${r(x0)} ${r(y0)}C${r(bx)} ${r(y0)} ${r(bx)} ${r(y1)} ${r(x1)} ${r(y1)}`;

export function layoutWords(map: Pick<KeywordMap, "years" | "keywords">, width: number): WordsLayout {
  const spineX = width / 2;
  const half = WORDS.pillW / 2;
  const room = Math.max(40, Math.floor(spineX - WORDS.inset));
  const totals = map.keywords.map((k) => k.total);
  const min = Math.min(...totals);
  const max = Math.max(...totals);
  const box = (keyword: MapKeyword, side: Side): Box => {
    const f = fit(keyword.label, sizeFor(keyword.total, min, max), room);
    return { keyword, side, size: f.size, w: f.w, lines: f.lines, h: f.lines === 2 ? WORDS.wordH2 : WORDS.wordH };
  };
  const yearIndex = new Map(map.years.map((y, i) => [y.year, i]));

  // leaf: 年ごとに、回数の多い順に 右・左・右・左
  const leafBoxes = map.years.map(() => ({ left: [] as Box[], right: [] as Box[] }));
  for (const y of map.years) {
    const list = map.keywords
      .filter((k) => k.role === "leaf" && k.years[0]?.year === y.year)
      .sort((a, b) => b.total - a.total);
    const slot = leafBoxes[yearIndex.get(y.year)!]!;
    list.forEach((k, i) => (i % 2 === 0 ? slot.right : slot.left).push(box(k, i % 2 === 0 ? "right" : "left")));
  }

  // bridge: つなぐ年の真ん中に近い、年と年のあいだの行へ。行の中では少ない側へ（同じなら右）
  const gapBoxes = map.years.slice(0, -1).map(() => ({ left: [] as Box[], right: [] as Box[] }));
  const sideCount = { left: 0, right: 0 };
  const bridges = map.keywords.filter((k) => k.role === "bridge").slice().sort((a, b) => b.total - a.total);
  for (const k of bridges) {
    const idx = k.years.map((y) => yearIndex.get(y.year)).filter((i): i is number => i !== undefined);
    if (idx.length < 2 || gapBoxes.length === 0) continue;
    const lo = Math.min(...idx);
    const hi = Math.max(...idx);
    if (lo === hi) continue;
    const mid = (lo + hi - 1) / 2;
    let best = lo;
    for (let g = lo; g < hi; g += 1) {
      const load = (n: number) => gapBoxes[n]!.left.length + gapBoxes[n]!.right.length;
      if (load(g) < load(best) || (load(g) === load(best) && Math.abs(g - mid) < Math.abs(best - mid))) best = g;
    }
    const slot = gapBoxes[best]!;
    // 左右は地図全体で少ない側（8 つなら 4 つずつ）。同じなら、その行で少ない側。それも同じなら右
    const side: Side =
      sideCount.right !== sideCount.left
        ? sideCount.right < sideCount.left
          ? "right"
          : "left"
        : slot.right.length <= slot.left.length
          ? "right"
          : "left";
    slot[side].push(box(k, side));
    sideCount[side] += 1;
  }

  // 上から積む
  const placed = new Map<MapKeyword, PlacedWord>();
  const years: PlacedYear[] = [];
  const rows: MapRow[] = [];
  const place = (b: Box, top: number, index: number): PlacedWord => {
    const stagger = index % 2 === 1 && b.w + WORDS.stagger <= room ? WORDS.stagger : 0;
    const x = b.side === "right" ? spineX + WORDS.inset + stagger : spineX - WORDS.inset - stagger - b.w;
    const p: PlacedWord = { id: wordId(b.keyword), keyword: b.keyword, side: b.side, x, y: top, w: b.w, h: b.h, size: b.size, lines: b.lines };
    placed.set(b.keyword, p);
    return p;
  };
  const placeStack = (boxes: Box[], centerY: number): PlacedWord[] => {
    let top = centerY - stackHeight(boxes) / 2;
    return boxes.map((b, i) => {
      const p = place(b, top, i);
      top += b.h + WORDS.stackGap;
      return p;
    });
  };
  const sortByTop = (a: PlacedWord, b: PlacedWord) => a.y - b.y || (a.side === "right" ? -1 : 1);

  let y = WORDS.rowPad;
  map.years.forEach((yc, i) => {
    const slot = leafBoxes[i]!;
    const rowH = Math.max(WORDS.pillH + 14, stackHeight(slot.left), stackHeight(slot.right)) + WORDS.rowPad * 2;
    const yearY = y + rowH / 2;
    const placedYear: PlacedYear = { ...yc, y: yearY };
    years.push(placedYear);
    const leaves = [...placeStack(slot.right, yearY), ...placeStack(slot.left, yearY)].sort(sortByTop);
    y += rowH;
    let gapWords: PlacedWord[] = [];
    const gap = gapBoxes[i];
    if (gap) {
      const stack = Math.max(stackHeight(gap.left), stackHeight(gap.right));
      const gapH = stack > 0 ? stack + WORDS.rowPad * 2 : WORDS.gapEmpty;
      const centerY = y + gapH / 2;
      gapWords = [...placeStack(gap.right, centerY), ...placeStack(gap.left, centerY)].sort(sortByTop);
      y += gapH;
    }
    rows.push({ year: placedYear, leaves, bridges: gapWords });
  });
  const height = Math.ceil(y + WORDS.rowPad);

  // 線: leaf は年の札の縁から言葉の内側の縁へ。bridge は言葉の内側の縁から、つなぐ年の札それぞれへ糸を 1 本ずつ（冒頭）
  const links: MapLink[] = [];
  const knots: MapKnot[] = [];
  const yearKnots = new Set<string>(); // 年の札の縁の結び目は、年と側ごとに 1 つ
  const knotAtYear = (yr: PlacedYear, side: Side, word: string, x: number) => {
    const key = `${yr.year}:${side}`;
    if (yearKnots.has(key)) return;
    yearKnots.add(key);
    knots.push({ id: `knot:${key}`, x: r(x), y: r(yr.y), word });
  };
  // 側ごとに、bridge をつなぐ年の端から端までの長さの順（短い順）に並べた順位（0〜1）。糸のふくらみに使う
  const spanRank = new Map<PlacedWord, number>();
  for (const side of ["left", "right"] as const) {
    const list = [...placed.values()]
      .filter((q) => q.keyword.role === "bridge" && q.side === side)
      .map((q) => {
        const ys = q.keyword.years.map((yc) => years[yearIndex.get(yc.year) ?? -1]?.y).filter((v): v is number => v !== undefined);
        return { q, span: ys.length ? Math.max(...ys) - Math.min(...ys) : 0 };
      })
      .sort((a, b) => a.span - b.span);
    list.forEach(({ q }, i) => spanRank.set(q, list.length === 1 ? 0.5 : i / (list.length - 1)));
  }
  // 背骨と言葉のあいだ（年の札の縁から、言葉の内側の縁のいちばん近い所まで）
  const gutterIn = half;
  const gutterOut = WORDS.inset;
  for (const p of placed.values()) {
    const inner = p.side === "right" ? p.x : p.x + p.w;
    const cy = p.y + p.h / 2;
    const dir = p.side === "right" ? 1 : -1;
    const edge = spineX + dir * half;
    if (p.keyword.role === "leaf") {
      const yr = years[yearIndex.get(p.keyword.years[0]!.year)!]!;
      const mx = (edge + inner) / 2;
      links.push({ id: `${p.id}>${yr.year}`, role: "leaf", word: p.id, d: `M${r(edge)} ${r(yr.y)}C${r(mx)} ${r(yr.y)} ${r(mx)} ${r(cy)} ${r(inner)} ${r(cy)}` });
      continue;
    }
    const linked = p.keyword.years
      .map((yc) => years[yearIndex.get(yc.year) ?? -1])
      .filter((yr): yr is PlacedYear => yr !== undefined);
    // ふくらみは年の札の縁から 6〜21px。長い糸ほど背骨の近くを通す（あいだの年の言葉から離す。言葉の縁には 14px より近づけない）
    const bx = spineX + dir * (gutterIn + 6 + (gutterOut - gutterIn - 20) * (1 - (spanRank.get(p) ?? 0.5)));
    for (const yr of linked) {
      links.push({ id: `${p.id}>${yr.year}`, role: "bridge", word: p.id, d: threadPath(inner, cy, bx, edge, yr.y) });
      knotAtYear(yr, p.side, p.id, edge + dir * 2);
    }
  }

  const first = years[0];
  const last = years[years.length - 1];
  return {
    width,
    height,
    spineX,
    spineTop: first ? first.y : 0,
    spineBottom: last ? last.y : 0,
    years,
    words: rows.flatMap((row) => [...row.leaves, ...row.bridges]),
    links,
    knots,
    rows,
  };
}
