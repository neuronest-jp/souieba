// 糸の帯（ThreadLoom）の並べ方。画面の部品から切り離した純粋関数（同じ入力なら同じ出力）。
// 年ごとの縁の線、登録したひとことの粒、結ばれた二つを渡す弧の位置を決める。描くのは部品の仕事。
// 規則は「ふたつの日」の見本を作った gen.py の strip_svg と同じ:
//   x = left + (t − t0) / (t1 − t0) × (right − left)。viewBox 0 0 362 90 なら left 10、right 352（幅 342）
//   t0 は一番古い年の 1 月 1 日、t1 は今年の翌年の 1 月 1 日。t は day ならその日、month は 15 日、year は 7 月 1 日。unknown は置かない
//   弧の高さ（0.75k）= 8 + 30√(span / 342)。短い糸から順に決め、端を 6px 以内で分け合う糸は先に置いた糸より 6px 高くして入れ子にする（最大 54）
// 横に送る年表（scroll。11/8、ADR-0009 の末尾の追記）: 見える幅に詰めると 1 年が 150px を割るときだけ、1 年 180px で全体の幅を延ばす
//   （帯の幅は 3600px まで。それより長い年月は 1 年を縮める）。x の式は同じで、right − left が全体の幅になる。
//   実際に送る帯（全体の幅 > 見える幅）では、弧の形と高さを変える（11/8 夜。見える幅の上の式のままだと、何年もまたぐ弧が両端で真上に立ち、
//   上で平らになって、入れ子の +6 で 54 に積み重なり、見える 362px の中では上の端の横線の束にしか見えなかった）:
//     - 帯の高さは 120（縁 90、年の文字 114）。弧の高さはまたぐ長さで決める 10 + 16·log2(1 + len / 60)（1 か月 ≒ 15、半年 ≒ 31、1 年 ≒ 42、
//       2 年 ≒ 55、4 年 ≒ 69、6 年 ≒ 80）。上限は 縁 − 6（84）
//     - 形はなだらかな放物線（制御点を両端から長さの 1/3 内側に置く。頂点の高さは同じ式で h）。端を分け合う糸も傾きで分かれるので、
//       入れ子で高くするのは両端とも 6px 以内で重なる糸だけ
import type { Precision } from "../api/types";
import { todayInTokyo } from "../date";

type Dated = { happened_on: string | null; happened_on_precision: Precision };

export type LoomBead = Dated;

export type LoomItem = {
  id: string;
  feedback: "none" | "helpful" | "not_related";
  memory: Dated; // 書いたひとこと（新しい側）
  related_memory: Dated; // 思い出した昔のひとこと
};

export type LoomRule = { year: number; x1: number; x2: number };
export type LoomLabel = { text: string; x: number };
export type LoomArc = {
  id: string;
  x1: number; // 昔のひとこと（related_memory）の位置
  x2: number; // 書いたひとこと（memory）の位置
  height: number; // 弧の頂点の高さ（縁からの px）= 0.75k
  c1: number; // 制御点の x（見える幅の帯は x1、送る帯は x1 から長さの 1/3 内側）
  c2: number; // 制御点の x（見える幅の帯は x2、送る帯は x2 から長さの 1/3 内側）
  d: string; // M x1,base C c1,base−k c2,base−k x2,base
  helpful: boolean; // 確かめた（そうだった）糸か。実線と塗った結び目で描く
  feedback: LoomItem["feedback"];
};

export type LoomLayout = {
  width: number; // 全体の幅（横に送らないときは見える幅と同じ）
  view: number; // 見える幅（入力の width）
  height: number;
  baseline: number; // 縁の線の y（60）
  labelY: number; // 年や月の文字の y（84）
  rules: LoomRule[]; // 年ごとの縁の線（年の境目は 6px あける）
  labels: LoomLabel[]; // 年の文字。今年しか無いときは 1月・4月・7月・10月
  beads: number[]; // 粒の x（同じ日は同じ x に重なる）
  arcs: LoomArc[]; // items と同じ順。日付が「いつだったか」の組は入らない
};

export type LoomInput = {
  beads: readonly LoomBead[];
  items: readonly LoomItem[];
  today?: string; // Asia/Tokyo の今日 'YYYY-MM-DD'。省略すると todayInTokyo()
  width?: number; // 見える幅（362）
  height?: number; // 90（送る帯は 120）
  // 横に送る年表にする（ThreadLoom）。省略すると、11/7 までの帯と同じく見える幅に詰める（見本の数値と突き合わせるテストのため）
  scroll?: boolean;
};

const PAD = 10; // 左右の余白（粒と結び目がはみ出さない）
const YEAR_GAP = 6; // 年の境目のすきま
const NEAR = 6; // 端を分け合うとみなす距離
const NEST_STEP = 6; // 入れ子にするとき、先の糸より高くする量
const MAX_ARC = 54;
const SCROLL_HEIGHT = 120; // 送る帯の高さ（長さで弧の高さを散らす余地）
const LABEL_SPACING = 44; // 年の文字（14px の「2024」）が重ならない間隔。狭ければ間引く
const LABEL_HALF = 16; // 文字の半分の幅。viewBox からはみ出さないよう中心をこの内側に収める
const QUARTER_MONTHS = [1, 4, 7, 10] as const;
// 横に送る年表（scroll）の 1 年の幅。詰めても 1 年が MIN_YEAR 以上あるなら詰めて横に送らない（少しだけ送れる帯にしない）
export const LOOM_YEAR = 180;
export const LOOM_MIN_YEAR = 150;
export const LOOM_MAX_WIDTH = 3600; // 1 年 180px で 20 年ぶん。ずっと昔の記憶があっても帯が延びすぎない
const DAY_MS = 86_400_000;

const round1 = (v: number): number => Math.round(v * 10) / 10;
const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

// 'YYYY-MM-DD' を精度に合わせた日（UTC の通日）にする。置けないもの（unknown・日付なし・形が違う）は null
const dayOf = (d: Dated): { year: number; day: number } | null => {
  if (d.happened_on_precision === "unknown" || !d.happened_on) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(d.happened_on);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const da = Number(m[3]);
  if (!(mo >= 1 && mo <= 12 && da >= 1 && da <= 31)) return null;
  const t =
    d.happened_on_precision === "year"
      ? Date.UTC(y, 6, 1)
      : d.happened_on_precision === "month"
        ? Date.UTC(y, mo - 1, 15)
        : Date.UTC(y, mo - 1, da);
  return { year: y, day: t / DAY_MS };
};

const jan1 = (y: number): number => Date.UTC(y, 0, 1) / DAY_MS;

export const layoutLoom = (input: LoomInput): LoomLayout => {
  const view = input.width ?? 362;
  const thisYear = Number((input.today ?? todayInTokyo()).slice(0, 4));

  const beadDays = input.beads.map(dayOf).filter((b): b is NonNullable<typeof b> => b !== null);
  const pairs = input.items.map((it) => ({ it, old: dayOf(it.related_memory), now: dayOf(it.memory) }));

  // 年の幅: 粒と組の両端のうち一番古い年から、今年まで。粒は新しい 500 件で切れるので、組の端も含める。
  // 先の日付（validate は 2100 年まで受け付ける）があれば、端に積まないようその年まで伸ばす
  const years = [thisYear, ...beadDays.map((b) => b.year)];
  for (const p of pairs) if (p.old && p.now) years.push(p.old.year, p.now.year);
  const y0 = Math.min(...years);
  const yLast = Math.max(...years);

  // 全体の幅: 見える幅に詰めて 1 年が LOOM_MIN_YEAR を割るときだけ、1 年 LOOM_YEAR（帯は LOOM_MAX_WIDTH まで）で延ばす
  const yearCount = yLast - y0 + 1;
  const fitYear = (view - 2 * PAD) / yearCount;
  const width =
    input.scroll && fitYear < LOOM_MIN_YEAR
      ? Math.max(view, Math.round(2 * PAD + yearCount * Math.min(LOOM_YEAR, (LOOM_MAX_WIDTH - 2 * PAD) / yearCount)))
      : view;
  const scrolls = width > view;
  const height = input.height ?? (scrolls ? SCROLL_HEIGHT : 90);
  const baseline = height - 30;
  const labelY = height - 6;
  const left = PAD;
  const right = width - PAD;
  const span = right - left;
  const t0 = jan1(y0);
  const t1 = jan1(yLast + 1);
  const xOf = (day: number): number => clamp(left + ((day - t0) / (t1 - t0)) * span, left, right);

  // 年ごとの縁。古い年がずっと昔だと 1 年が 6px より狭くなるので、すきまは年の幅の 1/3 までにする
  const rules: LoomRule[] = [];
  for (let y = y0; y <= yLast; y++) {
    const xa = xOf(jan1(y));
    const xb = xOf(jan1(y + 1));
    const gap = Math.min(YEAR_GAP, (xb - xa) / 3);
    rules.push({ year: y, x1: round1(xa + gap / 2), x2: round1(xb - gap / 2) });
  }

  // 文字: 今年しか無いときは 1月・4月・7月・10月（その月の真ん中）。そうでなければ年（区間の真ん中）。
  // 年が多くて文字が重なるときは、一番新しい年から数えて間引く
  const labels: LoomLabel[] = [];
  if (y0 === yLast) {
    for (const m of QUARTER_MONTHS) {
      const mid = (xOf(Date.UTC(y0, m - 1, 1) / DAY_MS) + xOf(Date.UTC(y0, m, 1) / DAY_MS)) / 2;
      labels.push({ text: `${m}月`, x: round1(clamp(mid, LABEL_HALF, width - LABEL_HALF)) });
    }
  } else {
    const step = Math.max(1, Math.ceil(LABEL_SPACING / (span / (yLast - y0 + 1))));
    for (let y = y0; y <= yLast; y++) {
      if ((yLast - y) % step !== 0) continue;
      const mid = (xOf(jan1(y)) + xOf(jan1(y + 1))) / 2;
      labels.push({ text: String(y), x: round1(clamp(mid, LABEL_HALF, width - LABEL_HALF)) });
    }
  }

  const beads = beadDays.map((b) => round1(xOf(b.day)));

  // 弧: 短い糸から順に高さを決める（同じ長さなら items の順）。端の近さは丸める前の位置で見る
  const placedIn = pairs
    .map((p, i) => (p.old && p.now ? { i, x1: xOf(p.old.day), x2: xOf(p.now.day) } : null))
    .filter((a): a is NonNullable<typeof a> => a !== null)
    .map((a) => ({ ...a, len: Math.abs(a.x2 - a.x1) }));
  const order = [...placedIn].sort((a, b) => a.len - b.len || a.i - b.i);
  const heightOf = new Map<number, number>();
  const placed: Array<{ x1: number; x2: number; h: number }> = [];
  const maxArc = scrolls ? baseline - 6 : Math.min(MAX_ARC, baseline - 6);
  for (const a of order) {
    let h = scrolls ? 10 + 16 * Math.log2(1 + a.len / 60) : 8 + 30 * Math.sqrt(a.len / span);
    for (const p of placed) {
      const near = scrolls
        ? Math.abs(p.x1 - a.x1) < NEAR && Math.abs(p.x2 - a.x2) < NEAR
        : Math.abs(p.x1 - a.x1) < NEAR || Math.abs(p.x2 - a.x2) < NEAR || Math.abs(p.x1 - a.x2) < NEAR || Math.abs(p.x2 - a.x1) < NEAR;
      if (near) h = Math.max(h, p.h + NEST_STEP);
    }
    h = Math.min(h, maxArc);
    heightOf.set(a.i, h);
    placed.push({ x1: a.x1, x2: a.x2, h });
  }

  const arcs: LoomArc[] = placedIn.map((a) => {
    const it = pairs[a.i]!.it;
    const h = heightOf.get(a.i)!;
    const x1 = round1(a.x1);
    const x2 = round1(a.x2);
    const top = round1(baseline - h / 0.75);
    const c1 = scrolls ? round1(a.x1 + (a.x2 - a.x1) / 3) : x1;
    const c2 = scrolls ? round1(a.x2 - (a.x2 - a.x1) / 3) : x2;
    return {
      id: it.id,
      x1,
      x2,
      height: round1(h),
      c1,
      c2,
      d: `M${x1} ${baseline}C${c1} ${top} ${c2} ${top} ${x2} ${baseline}`,
      helpful: it.feedback === "helpful",
      feedback: it.feedback,
    };
  });

  return { width, view, height, baseline, labelY, rules, labels, beads, arcs };
};

// 帯を押したとき（余裕があれば、の仕様。wireframes 9.2）に、押した位置からいちばん近い弧の組を選ぶ。
// x, y は帯の全体の中の座標（viewBox。帯は実際の幅で描くので 1 単位 = 1pt。横に送った帯では、押した位置に送った量を足してから渡す）。
// reach（22 = 指の大きさ 44pt の的の半分）より遠ければ null。
// 弧が密なときは、指にいちばん近い弧を選ぶ（入れ子の内と外は押した高さで分かれる）。同じ近さ（両端の結び目を分け合う弧など）なら、
// 短い弧（小さくて押しにくい方）を、それも同じなら一覧で先の組を選ぶ
const ARC_SAMPLES = 32;
const TIE = 0.5;

export const pickArc = (layout: LoomLayout, x: number, y: number, reach = 22): string | null => {
  let best: { id: string; dist: number; len: number } | null = null;
  for (const a of layout.arcs) {
    const top = layout.baseline - a.height / 0.75;
    let dist = Infinity;
    for (let i = 0; i <= ARC_SAMPLES; i++) {
      const t = i / ARC_SAMPLES;
      const u = 1 - t;
      // M x1,base C c1,top c2,top x2,base
      const px = u * u * u * a.x1 + 3 * u * u * t * a.c1 + 3 * u * t * t * a.c2 + t * t * t * a.x2;
      const py = u * u * u * layout.baseline + 3 * u * u * t * top + 3 * u * t * t * top + t * t * t * layout.baseline;
      dist = Math.min(dist, Math.hypot(px - x, py - y));
    }
    if (dist > reach) continue;
    const len = Math.abs(a.x2 - a.x1);
    if (!best || dist < best.dist - TIE || (Math.abs(dist - best.dist) <= TIE && len < best.len)) best = { id: a.id, dist, len };
  }
  return best?.id ?? null;
};
