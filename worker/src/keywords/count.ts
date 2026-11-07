// ことばの地図の数え方（ADR-0014）。純粋関数。Claude が選んだ言葉の一覧（R2 に置いたもの）を、いまの D1 の本文で数え直す。
// 見るたびに数え直すので、消した記憶・直した本文の引用は出ない（原則 5）。数と引用は Worker の決め打ちで、Claude には言わせない。
//   - 記憶に出てくる: その言葉の surfaces のどれかが本文の部分文字列（正規化しない。X-7）。1 つの記憶は何度出てきても 1 回
//   - 年: happened_on の年。起きた日が「いつだったか」（unknown）の記憶は背骨に置けないので、数にも引用にも入れない
//   - 1 つの年だけに出る言葉は leaf（その年の周り。1 回でも出す。Claude が暮らしを形づくる言葉として選んだものなので、短い日記では 1 回でもその年の特徴になる）、
//     2 つ以上の年に出る言葉は bridge（回数の多い年 3 つまでをつなぐ）
//   - leaf は年ごとに回数の多い順に 4 つまで（同じなら Claude が先に挙げた言葉）。bridge は 8 つまでで、まず合計の多い 2 つ（よく出てくる人など）、
//     残りはつなぐ年の幅（最初の年から最後の年まで）の大きい順、同じなら合計の多い順、それも同じなら Claude が先に挙げた順。
//     何年も離れた日をつなぐ言葉を先にする（「そういえば」の形。11/7 夜に回数の順だけで選ぶと、物語のデータで「展望台」（2020 と 2023）が
//     日々の言葉に押し出され、幅の順だけで選ぶと、隣り合う年に 17 回出る「そら」が落ちた）
//   - mentions: その言葉が出てくる記憶を新しい順（起きた日の降順、同じ日は書いた順の降順。一覧の並びと同じ）に 10 件まで。
//     各件はその surface を含む一文（本文を 。！？ と改行で区切った一文。本文から切り出した原文のまま）
import type { MemoryRow } from "../db/memories";
import type { KeywordKind } from "../ai/schemas";

export const KEYWORD_MIN_TOTAL = 1;
export const LEAF_PER_YEAR = 4;
export const BRIDGE_MAX = 8;
/** bridge のうち、合計の多い順に先に入れる数（よく出てくる人など、暮らしの真ん中の言葉を幅の順で落とさない） */
export const BRIDGE_BY_TOTAL = 2;
export const BRIDGE_YEARS = 3;
export const MENTIONS_MAX = 10;

export type StoredKeyword = { label: string; kind: KeywordKind; surfaces: string[] };
export type CountMemory = Pick<MemoryRow, "id" | "body" | "happened_on" | "happened_on_precision" | "created_at">;

export type YearCount = { year: number; count: number };
export type KeywordMention = {
  memory_id: string;
  happened_on: string;
  happened_on_precision: "day" | "month" | "year";
  sentence: string;
  surface: string;
};
export type MapKeyword = {
  label: string;
  kind: KeywordKind;
  role: "leaf" | "bridge";
  years: YearCount[];
  total: number;
  mentions: KeywordMention[];
};
export type KeywordMap = { generated_at: string; years: YearCount[]; keywords: MapKeyword[] };

export const yearOf = (m: Pick<MemoryRow, "happened_on" | "happened_on_precision">): number | null => {
  if (!m.happened_on || m.happened_on_precision === "unknown") return null;
  const y = Number(m.happened_on.slice(0, 4));
  return Number.isInteger(y) ? y : null;
};

const TERMINATORS = new Set(["。", "！", "？", "!", "?"]);
// 括弧の中の 。！？ では区切らない（みさきと二人で「立った！」と大声を出した。→ 1 文）。閉じ忘れても改行で区切る
const OPENERS = new Set(["「", "『", "（", "(", "【", "〈", "《", "“"]);
// 終わりの記号のすぐ後ろの閉じ括弧は、その文に付ける
const CLOSERS = new Set(["」", "』", "）", ")", "】", "〉", "》", "”", "’"]);

/** 本文を 。！？ と改行で区切る（括弧の中では区切らない）。各文は本文から切り出したまま（前後の空白だけ除く。本文の部分文字列のまま） */
export const splitSentences = (body: string): string[] => {
  const out: string[] = [];
  let cur = "";
  let ended = false;
  let depth = 0;
  const push = () => {
    const t = cur.trim();
    if (t) out.push(t);
    cur = "";
    ended = false;
    depth = 0;
  };
  for (const ch of body) {
    if (ch === "\n" || ch === "\r") {
      push();
      continue;
    }
    if (ended && !CLOSERS.has(ch) && !TERMINATORS.has(ch)) push();
    cur += ch;
    if (OPENERS.has(ch)) depth += 1;
    else if (CLOSERS.has(ch)) depth = Math.max(0, depth - 1);
    else if (TERMINATORS.has(ch) && depth === 0) ended = true;
  }
  push();
  return out;
};

/** 本文の中で、surfaces のどれかを含む最初の一文と、その文の中で先に出てくる surface。無ければ null */
export const sentenceWith = (body: string, surfaces: readonly string[]): { sentence: string; surface: string } | null => {
  for (const sentence of splitSentences(body)) {
    let best: { surface: string; at: number } | null = null;
    for (const s of surfaces) {
      const at = sentence.indexOf(s);
      if (at >= 0 && (best === null || at < best.at || (at === best.at && s.length > best.surface.length))) best = { surface: s, at };
    }
    if (best) return { sentence, surface: best.surface };
  }
  // 区切りをまたいで出てくる形（改行を含む surface など）。本文をそのまま一文として扱う
  const surface = surfaces.find((s) => body.includes(s));
  return surface ? { sentence: body.trim(), surface } : null;
};

// 一覧（GET /api/memories）と同じ並び: 起きた日の降順、同じ日は作成の降順、id の降順
const newestFirst = (a: CountMemory, b: CountMemory): number => {
  const h = (b.happened_on ?? "").localeCompare(a.happened_on ?? "");
  if (h !== 0) return h;
  const c = b.created_at.localeCompare(a.created_at);
  if (c !== 0) return c;
  return b.id.localeCompare(a.id);
};

type Counted = { index: number; keyword: StoredKeyword; label: string; years: YearCount[]; total: number; mentions: KeywordMention[] };

export function buildKeywordMap(stored: { generated_at: string; keywords: readonly StoredKeyword[] }, memories: readonly CountMemory[]): KeywordMap {
  const dated = memories.filter((m) => yearOf(m) !== null).slice().sort(newestFirst);

  const perYear = new Map<number, number>();
  for (const m of dated) perYear.set(yearOf(m)!, (perYear.get(yearOf(m)!) ?? 0) + 1);
  const years = [...perYear.entries()].map(([year, count]) => ({ year, count })).sort((a, b) => a.year - b.year);

  const counted: Counted[] = [];
  const labels = new Set<string>();
  stored.keywords.forEach((keyword, index) => {
    const surfaces = keyword.surfaces.filter((s) => s.length > 0);
    if (surfaces.length === 0) return;
    const hits = dated.filter((m) => surfaces.some((s) => m.body.includes(s)));
    if (hits.length < KEYWORD_MIN_TOTAL) return;
    // 地図に出す言葉は、いまの本文に出てくる形に含まれるものにする（label が消した記憶にしか無かったら、または当たった形と結び付かない
    // 語なら、いちばん多く出てくる形に替える。見出しの言葉と、数えた形・印を付ける一文を食い違わせない）
    const live = surfaces.filter((s) => hits.some((m) => m.body.includes(s)));
    let label = keyword.label;
    if (!live.some((s) => s.includes(label))) {
      const byCount = live.map((s) => ({ s, n: hits.filter((m) => m.body.includes(s)).length }));
      label = byCount.reduce((a, b) => (b.n > a.n ? b : a)).s;
    }
    if (labels.has(label)) return;
    labels.add(label);
    const byYear = new Map<number, number>();
    for (const m of hits) byYear.set(yearOf(m)!, (byYear.get(yearOf(m)!) ?? 0) + 1);
    const mentions: KeywordMention[] = [];
    for (const m of hits) {
      if (mentions.length >= MENTIONS_MAX) break;
      const found = sentenceWith(m.body, surfaces);
      if (!found) continue;
      mentions.push({
        memory_id: m.id,
        happened_on: m.happened_on!,
        happened_on_precision: m.happened_on_precision as KeywordMention["happened_on_precision"],
        sentence: found.sentence,
        surface: found.surface,
      });
    }
    counted.push({
      index,
      keyword,
      label,
      years: [...byYear.entries()].map(([year, count]) => ({ year, count })),
      total: hits.length,
      mentions,
    });
  });

  const toMap = (c: Counted, role: MapKeyword["role"], yrs: YearCount[]): MapKeyword => ({
    label: c.label,
    kind: c.keyword.kind,
    role,
    years: yrs,
    total: c.total,
    mentions: c.mentions,
  });

  // bridge: 2 つ以上の年に出る言葉。つなぐ年は回数の多い年 3 つまで（同じ回数なら新しい年）を、古い順に並べる。
  // 選ぶのは 8 つまでで、まず合計の多い 2 つ、残りはつなぐ年の幅（最初から最後まで）の大きい順、同じなら合計の多い順、それも同じなら Claude が先に挙げた順
  const candidates = counted
    .filter((c) => c.years.length >= 2)
    .map((c) => {
      const top = c.years
        .slice()
        .sort((a, b) => b.count - a.count || b.year - a.year)
        .slice(0, BRIDGE_YEARS)
        .sort((a, b) => a.year - b.year);
      return { c, top, span: top[top.length - 1]!.year - top[0]!.year };
    });
  const byTotal = candidates
    .slice()
    .sort((a, b) => b.c.total - a.c.total || a.c.index - b.c.index)
    .slice(0, BRIDGE_BY_TOTAL);
  const bySpan = candidates
    .filter((x) => !byTotal.includes(x))
    .sort((a, b) => b.span - a.span || b.c.total - a.c.total || a.c.index - b.c.index)
    .slice(0, BRIDGE_MAX - byTotal.length);
  const bridges = [...byTotal, ...bySpan].map(({ c, top }) => toMap(c, "bridge", top));

  // leaf: 1 つの年だけに出る言葉。年ごとに回数の多い順（同じなら Claude が先に挙げた順）に 4 つまで。年の古い順に並べる
  const leavesByYear = new Map<number, Counted[]>();
  for (const c of counted) {
    if (c.years.length !== 1) continue;
    const y = c.years[0]!.year;
    leavesByYear.set(y, [...(leavesByYear.get(y) ?? []), c]);
  }
  const leaves = [...leavesByYear.entries()]
    .sort((a, b) => a[0] - b[0])
    .flatMap(([, list]) =>
      list
        .sort((a, b) => b.total - a.total || a.index - b.index)
        .slice(0, LEAF_PER_YEAR)
        .map((c) => toMap(c, "leaf", c.years)),
    );

  return { generated_at: stored.generated_at, years, keywords: [...bridges, ...leaves] };
}
