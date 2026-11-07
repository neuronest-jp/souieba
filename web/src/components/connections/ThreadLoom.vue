<script setup lang="ts">
// 糸の帯（S5 つながりの上端。wireframes 9 節）。年の縁に、登録したひとことの粒と、結ばれたふたつを渡す弧を置き、
// いつといつが結ばれたかを一目で見せる。並べ方は layoutLoom（web/src/connections/loom.ts）の出力をそのまま描く。
// 同じことはすべて下の一覧に文字で書いてあるので、図ごと読み上げから外す（figure aria-hidden）。P0 では押せない。
// 幅は実際の幅を測って viewBox に渡す（縮めて描くと 375pt の端末で年の文字が 14px を割るため）。測れないときは 362
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { layoutLoom, type LoomBead, type LoomItem } from "../../connections/loom";
import { stitchOf } from "../../connections/pair";

const props = withDefaults(defineProps<{ beads: readonly LoomBead[]; items: readonly LoomItem[]; entering?: boolean }>(), {
  entering: false,
});

const root = ref<HTMLElement | null>(null);
const width = ref(362);
const layout = computed(() => layoutLoom({ beads: props.beads, items: props.items, width: width.value }));
// 弧の両端の結び目。確かめた糸の結び目を上に重ねる（後に描く）
const ends = computed(() =>
  layout.value.arcs
    .flatMap((a) => {
      const stitch = stitchOf(a.feedback);
      return [
        { key: `${a.id}:old`, x: a.x1, stitch },
        { key: `${a.id}:new`, x: a.x2, stitch },
      ];
    })
    .sort((p, q) => Number(p.stitch === "sewn") - Number(q.stitch === "sewn")),
);

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
  <figure ref="root" class="loom" :class="entering ? 'loom-entering' : ''" aria-hidden="true">
    <svg class="block h-auto w-full overflow-visible" :viewBox="`0 0 ${layout.width} ${layout.height}`" focusable="false">
      <line v-for="r in layout.rules" :key="r.year" class="loom-rule" :x1="r.x1" :y1="layout.baseline" :x2="r.x2" :y2="layout.baseline" />
      <text v-for="l in layout.labels" :key="l.text" class="loom-label" :x="l.x" :y="layout.labelY">{{ l.text }}</text>
      <circle v-for="(x, i) in layout.beads" :key="i" class="loom-bead" :cx="x" :cy="layout.baseline" r="2.25" />
      <g v-for="a in layout.arcs" :key="a.id" class="loom-arc" :data-stitch="stitchOf(a.feedback)" :data-pair="a.id">
        <path class="stitch-basting" :d="a.d" />
        <path class="stitch-sewn" pathLength="1" :d="a.d" />
      </g>
      <circle v-for="e in ends" :key="e.key" class="loom-end" :data-stitch="e.stitch" :cx="e.x" :cy="layout.baseline" r="3.75" />
    </svg>
  </figure>
</template>
