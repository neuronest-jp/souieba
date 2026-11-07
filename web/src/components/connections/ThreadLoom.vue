<script setup lang="ts">
// 糸の帯（S5 つながりの上端。wireframes 9 節）。年の縁に、登録したひとことの粒と、結ばれたふたつを渡す弧を置き、
// いつといつが結ばれたかを一目で見せる。並べ方は layoutLoom（web/src/connections/loom.ts）の出力をそのまま描く。
// 同じことはすべて下の一覧に文字で書いてあるので、図ごと読み上げから外す（figure aria-hidden）。
// 押すと、押した位置にいちばん近い弧の組を pick で知らせる（pickArc。弧が密なときも指に近い方。届かなければ何もしない）。
// 押せるのは指だけ（読み上げとキーボードは一覧から同じ組へ行ける）。押した弧は glow の間ほのかに光る。
// weave の組の弧は、古い端の順に少しずつずれて縁から立ち上がる（connections.css の .arc-weave。transform と opacity だけ）。
// 幅は実際の幅を測って viewBox に渡す（縮めて描くと 375pt の端末で年の文字が 14px を割るため）。測れないときは 362
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { layoutLoom, pickArc, type LoomBead, type LoomItem } from "../../connections/loom";
import { stitchOf } from "../../connections/pair";

const props = withDefaults(
  defineProps<{ beads: readonly LoomBead[]; items: readonly LoomItem[]; weave?: ReadonlySet<string>; glow?: string | null }>(),
  { weave: () => new Set<string>(), glow: null },
);
const emit = defineEmits<{ pick: [id: string] }>();

const root = ref<HTMLElement | null>(null);
const svg = ref<SVGSVGElement | null>(null);
const width = ref(362);
const layout = computed(() => layoutLoom({ beads: props.beads, items: props.items, width: width.value }));
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

const onPick = (e: MouseEvent) => {
  const el = svg.value;
  if (!el || typeof el.getBoundingClientRect !== "function") return;
  const r = el.getBoundingClientRect();
  if (!r.width || !r.height) return;
  const x = ((e.clientX - r.left) / r.width) * layout.value.width;
  const y = ((e.clientY - r.top) / r.height) * layout.value.height;
  const id = pickArc(layout.value, x, y);
  if (id) emit("pick", id);
};

let observer: ResizeObserver | null = null;
const measure = () => {
  const w = root.value?.clientWidth;
  // KeepAlive で外れている間は 0 になる。そのときは前の幅のまま
  if (typeof w === "number" && w > 0) width.value = Math.round(w);
};
onMounted(() => {
  measure();
  if (typeof ResizeObserver !== "undefined" && root.value) {
    observer = new ResizeObserver(measure);
    observer.observe(root.value);
  }
});
onBeforeUnmount(() => observer?.disconnect());
</script>

<template>
  <figure ref="root" class="loom" aria-hidden="true">
    <svg
      ref="svg"
      class="block h-auto w-full overflow-visible"
      :class="layout.arcs.length > 0 ? 'loom-pickable' : ''"
      :viewBox="`0 0 ${layout.width} ${layout.height}`"
      focusable="false"
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
</template>
