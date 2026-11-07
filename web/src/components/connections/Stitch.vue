<script setup lang="ts">
// ふたつの紙片のあいだの一本の糸と、上下の縁の結び目（S5 つながり。wireframes 9 節）。結び（.tie）の左の 56px の欄いっぱいに置く。
// 糸は viewBox 0 0 40 100 に preserveAspectRatio="none" で描くので、結びの高さを測らなくても上下の縁から縁まで届く。
// 揺れの向きは組ごとに左右を入れ替える（swing）。見た目の状態は data-stitch（style.css）:
//   basting = しつけ糸（確かめる前。破線と中空の結び目）/ sewn = 本縫い（そうだった。実線と塗った結び目）/ loose = ほどけた糸（関係ないかも）
// 読み上げには出さない（同じことを「✓ そうだった」の文字と aria-pressed が受け持つ）
import { computed } from "vue";
import type { StitchState } from "../../connections/pair";

const props = defineProps<{ stitch: StitchState; swing: 0 | 1 }>();
const d = computed(() => (props.swing === 0 ? "M20 0C34 32 6 68 20 100" : "M20 0C6 32 34 68 20 100"));
</script>

<template>
  <span class="thread absolute inset-y-0 left-0 w-14" :data-stitch="stitch" aria-hidden="true">
    <svg class="absolute top-0 left-2 h-full w-10 overflow-visible" viewBox="0 0 40 100" preserveAspectRatio="none" focusable="false">
      <path class="stitch-basting" :d="d" />
      <path class="stitch-sewn" pathLength="1" :d="d" />
    </svg>
    <span class="knot knot-top"></span>
    <span class="knot knot-bottom"></span>
  </span>
</template>
