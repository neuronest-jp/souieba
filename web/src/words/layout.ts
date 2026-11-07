// ことばの地図の並べ方（S6、wireframes 第10節、ADR-0014）。純粋関数。402pt の縦長の画面で読めることを第一にする。
//   - 年の背骨: 画面の真ん中に縦の線を引き、年の札（年の数字）を古い年から上に並べる
//   - leaf（1 つの年だけに出る言葉）: その年の札の左右に振り分ける（回数の多い順に 右・左・右・左）。各側は上下に積む
//   - bridge（2 つ以上の年に出る言葉）: 年と年のあいだの行の左右に置き、つなぐ年の札へ糸を引く。置く行は、つなぐ年の真ん中に近い行のうち
//     空いている所。左右は地図全体で少ない側へ（同じなら、その行で少ない側。それも同じなら右）。
//     糸の描き方は 4 通り（LineStyle。開発の間だけ比べる。選んだ 1 つを残す）。どれも線は背骨と言葉のあいだ（年の札の縁から言葉の内側の縁まで）
//     だけを通るので、言葉の文字には重ならない（細い線どうしは交わることがある）:
//       lane: 言葉から横に出て、背骨の脇の自分の通り道（言葉ごとに 6px ずつ外へ）を縦に通り、年の高さで直角に曲がる（角は丸める）。11/7 の形
//       a「糸」: 言葉の内側の縁から、つなぐ年の札それぞれへ、なめらかな曲線を 1 本ずつ。ふくらみ（制御点の x）は言葉ごとに変え、
//                長い糸ほど背骨の近くを通す
//       b「弧」: いちばん古い年と新しい年の札を、背骨の片側の弧（楕円の半分）で結ぶ。弧の頂点は言葉の高さにあり、年をまたぐほど外へふくらむ
//                （同じ側の弧を長さの順に 8〜25px へ振る。あいだのほかの言葉には 10px より近づけない）。言葉は頂点の結び目から短い糸で吊るす。あいだの年は弧から札へ短い糸を渡す
//       c「控えめ」: a と同じ曲線を、言葉と年の真ん中でふくらませる（leaf の線と同じ形）。色は画面が決める（墨の点線と、言葉の側の朱の印）
//   - 言葉の大きさは回数で少しだけ変える（13〜17px）。幅は字数から見積もり、収まらなければ字を小さくし、それでも収まらなければ 2 行にする
// 位置は箱の左上（x, y）と幅・高さ。測らずに決める（線の端を描くのに getBoundingClientRect を使わない）
// 線の端の結び目・印（knots）も位置をここで決める（SVG の path の端は画面から読めないので）
import type { KeywordMap, MapKeyword, YearCount } from "../api/types";

export const WORDS = {
  pillW: 58, // 年の札の幅
  pillH: 30,
  laneStart: 8, // 年の札の縁から最初の通り道まで
  laneStep: 6,
  lanes: 4,
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
/** bridge の糸の描き方（開発の間だけ比べる。layout.ts の冒頭） */
export type LineStyle = "lane" | "a" | "b" | "c";
export const LINE_STYLES: readonly LineStyle[] = ["a", "b", "c", "lane"];
export const isLineStyle = (v: unknown): v is LineStyle => typeof v === "string" && (LINE_STYLES as readonly string[]).includes(v);
/** 糸の端の印。year は年の札の縁（a・b の結び目）、word は言葉の内側の縁の脇（c の朱の印） */
export type MapKnot = { id: string; x: number; y: number; at: "year" | "word"; word: string };
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
  lines: LineStyle;
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

/** 言葉の内側の縁 (x0, y0) から横に通り道 lane まで、縦に y1 まで、横に年の札の縁 x1 まで。角は半径 6 まで丸める */
export const lanePath = (x0: number, y0: number, lane: number, y1: number, x1: number): string => {
  const dy = y1 - y0;
  if (Math.abs(dy) < 0.5) return `M${r(x0)} ${r(y0)}H${r(x1)}`;
  const s = Math.sign(dy);
  const inward = Math.sign(x1 - x0); // 背骨へ向かう向き
  const rad = Math.min(6, Math.abs(dy) / 2, Math.abs(lane - x0), Math.abs(lane - x1));
  return (
    `M${r(x0)} ${r(y0)}H${r(lane - inward * rad)}Q${r(lane)} ${r(y0)} ${r(lane)} ${r(y0 + s * rad)}` +
    `V${r(y1 - s * rad)}Q${r(lane)} ${r(y1)} ${r(lane + inward * rad)} ${r(y1)}H${r(x1)}`
  );
};

/** a・c: 言葉の内側の縁 (x0, y0) から年の札の縁 (x1, y1) へのなめらかな曲線。両端は横向きに出入りし、ふくらみは bx。
 *  制御点の x はどれも x0 と x1 のあいだ（bx もそこに取る）なので、曲線は背骨と言葉のあいだから出ない */
export const threadPath = (x0: number, y0: number, bx: number, x1: number, y1: number): string =>
  `M${r(x0)} ${r(y0)}C${r(bx)} ${r(y0)} ${r(bx)} ${r(y1)} ${r(x1)} ${r(y1)}`;

/** b: 年の札の縁 (edge, y0) から頂点 (edge ± rx, cy) までの楕円の 4 分の 1。中心は (edge, cy)。札の縁では縦の線に直角に出て、頂点で縦に向く */
export const bowQuarter = (edge: number, y0: number, rx: number, cy: number, dir: 1 | -1): string => {
  const ry = Math.abs(cy - y0);
  if (ry < 0.5 || rx < 0.5) return `M${r(edge)} ${r(y0)}L${r(edge + dir * rx)} ${r(cy)}`;
  // 時計回り（sweep 1）になるのは、右側で上から頂点へ・頂点から下へ行くとき。左側はその逆
  const sweep = (dir === 1) === (y0 < cy) ? 1 : 0;
  return `M${r(edge)} ${r(y0)}A${r(rx)} ${r(ry)} 0 0 ${sweep} ${r(edge + dir * rx)} ${r(cy)}`;
};

/** b: 弧の上の、高さ y の点の x（中心 (edge, cy)、横の半径 rx、縦の半径 ry の楕円） */
export const bowX = (edge: number, rx: number, cy: number, ry: number, y: number, dir: 1 | -1): number => {
  const k = ry > 0 ? Math.min(1, Math.abs(y - cy) / ry) : 1;
  return edge + dir * rx * Math.sqrt(1 - k * k);
};

export function layoutWords(map: Pick<KeywordMap, "years" | "keywords">, width: number, lines: LineStyle = "lane"): WordsLayout {
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
  const laneOf = new Map<MapKeyword, number>();
  const laneCount = { left: 0, right: 0 };
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
    // 左右は地図全体で少ない側（通り道を 1 つの言葉に 1 本ずつ。8 つなら 4 つずつ）。同じなら、その行で少ない側。それも同じなら右
    const side: Side =
      laneCount.right !== laneCount.left
        ? laneCount.right < laneCount.left
          ? "right"
          : "left"
        : slot.right.length <= slot.left.length
          ? "right"
          : "left";
    slot[side].push(box(k, side));
    laneOf.set(k, laneCount[side] % WORDS.lanes);
    laneCount[side] += 1;
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

  // 線: leaf は年の札の縁から言葉の内側の縁へ。bridge は lines の描き方で（冒頭）
  const links: MapLink[] = [];
  const knots: MapKnot[] = [];
  const yearKnots = new Set<string>(); // 年の札の縁の結び目は、年と側ごとに 1 つ
  const knotAtYear = (yr: PlacedYear, side: Side, word: string, x: number) => {
    const key = `${yr.year}:${side}`;
    if (yearKnots.has(key)) return;
    yearKnots.add(key);
    knots.push({ id: `knot:${key}`, x: r(x), y: r(yr.y), at: "year", word });
  };
  // 側ごとに、bridge をつなぐ年の端から端までの長さの順（短い順）に並べた順位（0〜1）。a のふくらみと b の弧の大きさに使う
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
    if (lines === "lane") {
      const lx = spineX + dir * (half + WORDS.laneStart + WORDS.laneStep * (laneOf.get(p.keyword) ?? 0));
      for (const yr of linked) links.push({ id: `${p.id}>${yr.year}`, role: "bridge", word: p.id, d: lanePath(inner, cy, lx, yr.y, edge) });
    } else if (lines === "a" || lines === "c") {
      // a: ふくらみは年の札の縁から 6〜21px。長い糸ほど背骨の近くを通す（あいだの年の言葉から離す。言葉の縁には 14px より近づけない）。
      // c: 札の縁と言葉の縁の真ん中（leaf の線と同じ形）
      const bx = lines === "a" ? spineX + dir * (gutterIn + 6 + (gutterOut - gutterIn - 20) * (1 - (spanRank.get(p) ?? 0.5))) : (edge + inner) / 2;
      for (const yr of linked) {
        links.push({ id: `${p.id}>${yr.year}`, role: "bridge", word: p.id, d: threadPath(inner, cy, bx, edge, yr.y) });
        if (lines === "a") knotAtYear(yr, p.side, p.id, edge + dir * 2);
      }
      if (lines === "c") knots.push({ id: `mark:${p.id}`, x: r(inner - dir * 5), y: r(cy), at: "word", word: p.id });
    } else {
      // b: いちばん古い年と新しい年を、言葉の高さに頂点がある弧で結ぶ。弧は、あいだにあるほかの言葉（同じ側）の内側の縁より
      // 10px 手前までしかふくらませない（ほかの言葉に触れて見えないように）。頂点が言葉に届かなければ、頂点の結び目から言葉へ短い糸を渡す
      const ys = linked.map((yr) => yr.y);
      const lo = Math.min(...ys);
      const hi = Math.max(...ys);
      // ふくらみは、同じ側の弧のうち年をまたぐ長さの順に 8〜25px へ等しく振る（長い弧ほど外へ。重なって太い束に見えないように）
      let rx = Math.min(Math.abs(inner - edge) - 2, 8 + 17 * (spanRank.get(p) ?? 0.5));
      for (const q of placed.values()) {
        if (q === p || q.side !== p.side || q.y + q.h <= lo || q.y >= hi) continue;
        const qRoom = Math.abs((q.side === "right" ? q.x : q.x + q.w) - edge) - 10;
        const yq = Math.min(Math.max(cy, q.y), q.y + q.h); // q の箱の中で、頂点の高さにいちばん近い所
        const ry = yq < cy ? cy - lo : hi - cy;
        const k = ry > 0 ? Math.min(1, Math.abs(yq - cy) / ry) : 1;
        const s = Math.sqrt(1 - k * k);
        if (s * rx > qRoom) rx = qRoom / s;
      }
      const apex = edge + dir * rx;
      for (const yr of linked) {
        let d: string;
        if (yr.y === lo) d = bowQuarter(edge, lo, rx, cy, dir);
        else if (yr.y === hi) d = bowQuarter(edge, hi, rx, cy, dir);
        else d = `M${r(bowX(edge, rx, cy, yr.y < cy ? cy - lo : hi - cy, yr.y, dir))} ${r(yr.y)}H${r(edge)}`;
        // 言葉へ渡す短い糸は、いちばん古い年の線に付ける
        if (yr.y === lo && Math.abs(inner - apex) > 4) d += `M${r(apex)} ${r(cy)}H${r(inner)}`;
        links.push({ id: `${p.id}>${yr.year}`, role: "bridge", word: p.id, d });
        knotAtYear(yr, p.side, p.id, edge + dir * 3);
      }
      if (Math.abs(inner - apex) > 4) knots.push({ id: `apex:${p.id}`, x: r(apex), y: r(cy), at: "word", word: p.id });
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
    lines,
    rows,
  };
}
