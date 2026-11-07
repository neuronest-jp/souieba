<script setup lang="ts">
// ふたつの紙片のあいだの一本の糸と、上下の縁の結び目（S5 つながり。wireframes 9 節）。結び（.tie）の左の 56px の欄いっぱいに置く。
// 糸は viewBox 0 0 40 100 に preserveAspectRatio="none" で描くので、結びの高さを測らなくても上下の縁から縁まで届く。
// 揺れの向きは組ごとに左右を入れ替える（swing）。見た目の状態は data-stitch（style.css）:
//   basting = しつけ糸（確かめる前。破線と中空の結び目）/ sewn = 本縫い（そうだった。実線と塗った結び目）/ loose = ほどけた糸（関係ないかも）
// 本縫いは同じ線を 8 針に分けて描く（各針は pathLength=1 の上で 1/8 ずつの区間。止まっているときは 1 本の実線に見える）。
// 縫い直す動き（connections.css の .is-tying ほか）は、針を上から順に opacity で現すだけ（transform と opacity だけで動かす約束）。
// 8 本の path はデータにして v-for で描く（静的な要素が 5 つ以上並ぶと、テストの最小の DOM が持たない形で挿される）。
// 読み上げには出さない（同じことを「✓ そうだった」の文字と aria-pressed が受け持つ）
import { computed } from "vue";
import type { StitchState } from "../../connections/pair";

const props = defineProps<{ stitch: StitchState; swing: 0 | 1 }>();
const d = computed(() => (props.swing === 0 ? "M20 0C34 32 6 68 20 100" : "M20 0C6 32 34 68 20 100"));

const NEEDLES = 8;
// 区間のつなぎ目に髪の毛ほどのすきまが出ないよう、各針を少しだけ長くする
const STITCHES = Array.from({ length: NEEDLES }, (_, k) => ({ k, dash: `${1 / NEEDLES + 0.006} 2`, offset: String(-k / NEEDLES) }));
</script>

<template>
  <span class="thread absolute inset-y-0 left-0 w-14" :data-stitch="stitch" aria-hidden="true">
    <svg class="absolute top-0 left-2 h-full w-10 overflow-visible" viewBox="0 0 40 100" preserveAspectRatio="none" focusable="false">
      <path class="stitch-basting" :d="d" />
      <g class="stitch-sewn">
        <path
          v-for="s in STITCHES"
          :key="s.k"
          class="stitch-needle"
          pathLength="1"
          :d="d"
          :stroke-dasharray="s.dash"
          :stroke-dashoffset="s.offset"
          :style="{ '--k': s.k }"
        />
      </g>
    </svg>
    <span class="knot knot-top"></span>
    <span class="knot knot-bottom"></span>
  </span>
</template>
