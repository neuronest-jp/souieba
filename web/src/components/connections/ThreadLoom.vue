<script setup lang="ts">
// 糸の帯（S5 つながりの上端。wireframes 9 節）。年の縁に、登録したひとことの粒と、結ばれたふたつを渡す弧を置き、
// いつといつが結ばれたかを一目で見せる。並べ方は layoutLoom（web/src/connections/loom.ts）の出力をそのまま描く。
// 同じことはすべて下の一覧に文字で書いてあるので、図ごと読み上げから外す（figure aria-hidden）。
// 押すと、押した位置にいちばん近い弧の組を pick で知らせる（pickArc。弧が密なときも指に近い方。届かなければ何もしない）。
// 押せるのは指だけ（読み上げとキーボードは一覧から同じ組へ行ける）。押した弧は glow の間ほのかに光る。
// weave の組の弧は、古い端の順に少しずつずれて縁から立ち上がる（connections.css の .arc-weave。transform と opacity だけ）。
// 幅は実際の幅を測って渡す（縮めて描くと 375pt の端末で年の文字が 14px を割るため）。測れないときは 362
//
// 横に送る年表（11/8、ADR-0009 の末尾の追記）: 見える幅に詰めると 1 年が 150px を割るときは 1 年 180px で並べ、figure を横に送る。
//   - 開いたときは右端（新しい側）。位置は右端からの量で覚え、年が増えても、KeepAlive で外れて戻っても（外れると位置は 0 に戻る）同じ所を見せる
//   - 戻ったときに新しく結ばれた組（weave）があれば、その弧が見える所まで送る。一覧で組をひらいたときも reveal で送る
//   - 押した位置は、figure の左端からの量に送った量（scrollLeft）を足して帯の座標にする
//   - 送っている途中や送った直後（scroll の知らせから 120ms 以内）に指が触れた押し、押している間に送れた押しは、弧を押したことにしない
//   - 左右の端の薄いぼかしは、その向きに続きがあるときだけ（data-more-start / data-more-end。connections.css）
import { computed, nextTick, onActivated, onBeforeUnmount, onDeactivated, onMounted, ref, watch } from "vue";
import { layoutLoom, pickArc, type LoomArc, type LoomBead, type LoomItem } from "../../connections/loom";
import { stitchOf } from "../../connections/pair";
import { prefersMotion } from "../../motion";

const props = withDefaults(
  defineProps<{ beads: readonly LoomBead[]; items: readonly LoomItem[]; weave?: ReadonlySet<string>; glow?: string | null }>(),
  { weave: () => new Set<string>(), glow: null },
);
const emit = defineEmits<{ pick: [id: string] }>();

const SETTLE_MS = 120; // 送るのが止まってから、押しを受け付けるまで
const SLIP = 3; // 押している間にこれより送れたら、押したことにしない（px）
const REVEAL_MARGIN = 28; // 弧を見せるとき、端のぼかしの内側に収める余白

// figure が横に送る入れ物（connections.css の .loom。touch-action: pan-x pan-y）
const root = ref<HTMLElement | null>(null);
const width = ref(362);
const layout = computed(() => layoutLoom({ beads: props.beads, items: props.items, width: width.value, scroll: true }));
const maxScroll = computed(() => Math.max(0, layout.value.width - layout.value.view));
// 立ち上がる順（古い端の左から。ずらすのは 11 本目まで）
const weaveOrder = computed(() => {
  const order = new Map<string, number>();
  const woven = layout.value.arcs.filter((a) => props.weave.has(a.id)).sort((p, q) => p.x1 - q.x1 || p.x2 - q.x2);
  woven.forEach((a, i) => order.set(a.id, Math.min(i, 10)));
  return order;
});
// 弧の両端の結び目。確かめた糸の結び目を上に重ねる（後に描く）
const ends = computed(() =>
  layout.value.arcs
    .flatMap((a) => {
      const stitch = stitchOf(a.feedback);
      const i = weaveOrder.value.get(a.id);
      return [
        { key: `${a.id}:old`, x: a.x1, stitch, i },
        { key: `${a.id}:new`, x: a.x2, stitch, i },
      ];
    })
    .sort((p, q) => Number(p.stitch === "sewn") - Number(q.stitch === "sewn")),
);

// ---- 横に送った位置 ----
// 右端からの量（0 = 右端）。scroll の知らせと、こちらから送ったときに書く
let fromEnd = 0;
let active = true;
let scrolledAt = Number.NEGATIVE_INFINITY;
const more = ref({ start: false, end: false });
const now = () => (typeof performance !== "undefined" ? performance.now() : Date.now());
const currentLeft = (): number => {
  const v = root.value?.scrollLeft;
  return typeof v === "number" && Number.isFinite(v) ? v : maxScroll.value - fromEnd;
};
const markEdges = (left: number) => {
  more.value = { start: left > 1, end: maxScroll.value - left > 1 };
};
const scrollToLeft = (left: number, smooth = false) => {
  const el = root.value;
  if (!el) return;
  const to = Math.round(Math.min(maxScroll.value, Math.max(0, left)));
  if (smooth && typeof el.scrollTo === "function") el.scrollTo({ left: to, behavior: "smooth" });
  else el.scrollLeft = to;
  fromEnd = maxScroll.value - to;
  markEdges(to);
};
// 覚えている位置（右端からの量）へ戻す
const place = () => scrollToLeft(maxScroll.value - fromEnd);
const onScroll = () => {
  // KeepAlive で外れるときに位置が 0 に戻る知らせは覚えない
  if (!active) return;
  scrolledAt = now();
  const left = currentLeft();
  fromEnd = Math.max(0, maxScroll.value - left);
  markEdges(left);
};

// 組の弧が見える所まで送る（入るならその弧を真ん中に、入らなければ新しい端を右のぼかしの内側に）。もう見えていれば動かさない
const showArc = (a: LoomArc, smooth: boolean) => {
  const view = layout.value.view;
  const left = currentLeft();
  const lo = Math.min(a.x1, a.x2) - REVEAL_MARGIN;
  const hi = Math.max(a.x1, a.x2) + REVEAL_MARGIN;
  if (lo >= left && hi <= left + view) return;
  scrollToLeft(hi - lo <= view ? (lo + hi - view) / 2 : hi - view, smooth);
};
const reveal = (id: string) => {
  const a = layout.value.arcs.find((x) => x.id === id);
  if (!a || maxScroll.value <= 0) return;
  showArc(a, prefersMotion());
};
defineExpose({ reveal });

// 戻ったときに新しく結ばれた組があれば、そのうち一番新しい端の弧が見える所まで送る（新しい糸が渡されるのが見えるように）
watch(
  () => props.weave,
  (w) => {
    if (!active || w.size === 0 || maxScroll.value <= 0) return;
    const woven = layout.value.arcs.filter((a) => w.has(a.id));
    if (woven.length === 0) return;
    const newest = woven.reduce((p, q) => (Math.max(q.x1, q.x2) > Math.max(p.x1, p.x2) ? q : p));
    showArc(newest, prefersMotion());
  },
  { flush: "post" },
);
// 幅が変わったら（測り直し、年が増えた・減った）、右端からの量を保って置き直す
watch(
  () => [layout.value.width, layout.value.view],
  () => place(),
  { flush: "post" },
);

// ---- 押す ----
let press: { left: number; at: number } | null = null;
const onPointerDown = () => {
  press = { left: currentLeft(), at: now() };
};
const onPick = (e: MouseEvent) => {
  const el = root.value;
  const p = press;
  press = null;
  if (!el || typeof el.getBoundingClientRect !== "function") return;
  // 送っている途中か送った直後に触れた指、押している間に送れた指は、弧を押したことにしない
  if (scrolledAt > (p?.at ?? now()) - SETTLE_MS) return;
  if (p && Math.abs(currentLeft() - p.left) > SLIP) return;
  const r = el.getBoundingClientRect();
  if (!r.width || !r.height) return;
  const x = e.clientX - r.left + currentLeft();
  const y = e.clientY - r.top;
  const id = pickArc(layout.value, x, y);
  if (id) emit("pick", id);
};

// ---- 幅を測る ----
let observer: ResizeObserver | null = null;
const measure = () => {
  const w = root.value?.clientWidth;
  // KeepAlive で外れている間は 0 になる。そのときは前の幅のまま
  if (typeof w === "number" && w > 0) width.value = Math.round(w);
};
onMounted(() => {
  measure();
  root.value?.addEventListener("scroll", onScroll, { passive: true });
  if (typeof ResizeObserver !== "undefined" && root.value) {
    observer = new ResizeObserver(measure);
    observer.observe(root.value);
  }
  // 開いたときは右端（新しい側）から
  void nextTick(place);
});
onActivated(() => {
  active = true;
  measure();
  place();
});
onDeactivated(() => {
  active = false;
  press = null;
});
onBeforeUnmount(() => {
  observer?.disconnect();
  root.value?.removeEventListener("scroll", onScroll);
});
</script>

<template>
  <div class="loom-frame" :data-more-start="more.start ? '' : null" :data-more-end="more.end ? '' : null">
    <figure ref="root" class="loom" aria-hidden="true">
      <svg
        class="block overflow-visible"
        :class="layout.arcs.length > 0 ? 'loom-pickable' : ''"
        :width="layout.width"
        :height="layout.height"
        :viewBox="`0 0 ${layout.width} ${layout.height}`"
        focusable="false"
        @pointerdown="onPointerDown"
        @click="onPick"
      >
        <line v-for="r in layout.rules" :key="r.year" class="loom-rule" :x1="r.x1" :y1="layout.baseline" :x2="r.x2" :y2="layout.baseline" />
        <text v-for="l in layout.labels" :key="l.text" class="loom-label" :x="l.x" :y="layout.labelY">{{ l.text }}</text>
        <circle v-for="(x, i) in layout.beads" :key="i" class="loom-bead" :cx="x" :cy="layout.baseline" r="2.25" />
        <g
          v-for="a in layout.arcs"
          :key="a.id"
          class="loom-arc"
          :class="{ 'arc-weave': weaveOrder.has(a.id), 'arc-glow': glow === a.id }"
          :data-stitch="stitchOf(a.feedback)"
          :data-pair="a.id"
          :style="{ '--i': weaveOrder.get(a.id) ?? 0 }"
        >
          <path class="arc-halo" :d="a.d" />
          <path class="stitch-basting" :d="a.d" />
          <path class="stitch-sewn" pathLength="1" :d="a.d" />
        </g>
        <circle
          v-for="e in ends"
          :key="e.key"
          class="loom-end"
          :class="e.i !== undefined ? 'end-weave' : ''"
          :data-stitch="e.stitch"
          :cx="e.x"
          :cy="layout.baseline"
          r="3.75"
          :style="{ '--i': e.i ?? 0 }"
        />
      </svg>
    </figure>
  </div>
</template>
