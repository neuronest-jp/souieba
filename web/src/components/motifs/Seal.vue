<script setup lang="ts">
// 封蝋（36px）。「そういえば。」の一筆箋の右上にだけ押す。少し歪んだ円（18 点の半径を 15.2±0.8 で固定）を朱の蝋で塗り、
// 内側に浮き出しの輪 2 本と、押した季節の線画を描く（押し葉と同じ季節。春 = 桜の花、夏 = 青もみじ、秋 = 紅葉、冬 = 南天の実と葉）。
// 線画は内側の輪（半径 10.4、線の内縁 9.85）に触れないよう、中心から 9px 以内に収める。season を渡さなければ今日の季節（Asia/Tokyo）。
// 札が現れるときは .appear .seal で押される動きになる（style.css）。
// 色はトークンの class（stroke-seal-deep、[stop-color:var(--color-ember)] など）だけ。グラデーションの id は札ごとに分ける（同じ画面に札が何枚も並ぶ）
import { computed, useId } from "vue";
import { seasonOf, type Season } from "../../season";

const props = defineProps<{ season?: Season }>();
const season = computed<Season>(() => props.season ?? seasonOf());
const gradient = `seal-wax-${useId()}`;
// 浮き出しの輪 2 本（暗い線と明るい線を 0.5px ずらす）。データに置いて v-for で描く（静的な要素が 5 つ以上並ぶと、
// Vue が HTML の文字列にまとめて挿す。テストの最小の DOM はそれを持たない）
const RINGS = [
  { cx: 18, cy: 18, width: 1.1, tone: "stroke-seal-deep" },
  { cx: 18.5, cy: 18.6, width: 0.8, tone: "stroke-seal-light" },
];
// 浮き出しの線画（線だけ。季節ごとの path の d）
const EMBOSS: Record<Season, string[]> = {
  // 桜: 先に切れ込みのある花びら 5 枚と、花の芯
  spring: [
    "M18 17.1C15 16.1 14.4 12.7 16.3 11.4Q17.3 11.2 18 12.4Q18.7 11.2 19.7 11.4C21.6 12.7 21 16.1 18 17.1ZM19 17.9C19 14.7 22.1 13.1 23.9 14.5Q24.5 15.4 23.5 16.4Q24.9 16.7 24.9 17.7C24.4 19.9 20.9 20.4 19 17.9ZM18.6 19.1C21.7 18.1 24.1 20.6 23.3 22.7Q22.7 23.5 21.4 22.9Q21.6 24.3 20.6 24.6C18.3 24.8 16.8 21.7 18.6 19.1ZM17.4 19.1C19.2 21.7 17.7 24.8 15.4 24.6Q14.4 24.3 14.6 22.9Q13.3 23.5 12.7 22.7C11.9 20.6 14.3 18.1 17.4 19.1ZM17 17.9C15.1 20.4 11.6 19.9 11.1 17.7Q11.1 16.7 12.5 16.4Q11.5 15.4 12.1 14.5C13.9 13.1 17 14.7 17 17.9Z",
    "M16.9 18.2a1.1 1.1 0 1 0 2.2 0a1.1 1.1 0 1 0 -2.2 0Z",
  ],
  // 青もみじ: 5 つに裂けた若い葉を立て、葉柄を下へ
  summer: [
    "M16.7 21Q15.2 21.5 13.3 20.1Q15.4 19.2 15.9 19.5Q14.1 18.8 13.3 15.4Q16.6 16.5 16.7 17.3Q16.2 16.3 18 13Q19.8 16.3 19.3 17.3Q19.4 16.5 22.7 15.4Q21.9 18.8 20.1 19.5Q20.6 19.2 22.7 20.1Q20.8 21.5 19.3 21Q18 21.5 16.7 21Z",
    "M18 20.8Q18.5 23.4 17.2 25.6",
  ],
  // 紅葉: 7 つに裂けた葉を少し傾け、葉柄を左下へ
  autumn: [
    "M17.4 20.3Q16.5 20.3 15.1 19.5Q16.7 19.2 17.1 19.3Q15.6 18.4 14.6 16.1Q16.9 17.1 17.4 17.7Q16.8 16.1 17.4 13Q19 15.7 19.1 16.7Q19.4 15.5 21.9 13.2Q21.6 16.6 20.9 17.6Q21.7 17 24.9 16.6Q22.8 19.1 21.2 19.5Q21.9 19.6 24.2 20.8Q21.7 21.3 20.1 20.7Q20.4 21 21.1 22.4Q19.7 21.8 19.1 21.1Q18.3 20.7 17.4 20.3Z",
    "M18.6 20Q16.6 23.2 14 24.8",
  ],
  // 南天: 実 3 つと、その房の軸、細い葉 1 枚
  winter: [
    "M13.2 24.2Q13.8 19.9 9.4 15.8Q9.6 21.8 13.2 24.2Z",
    "M13.4 24.8Q15.6 22.6 17.8 21.2M17.8 21.2 20.2 16.4M17.8 21.2 22.2 19.6M17.8 21.2 16.4 16.6",
    "M18.9 13.6a2.1 2.1 0 1 0 4.2 0a2.1 2.1 0 1 0 -4.2 0ZM22.1 18.6a2.1 2.1 0 1 0 4.2 0a2.1 2.1 0 1 0 -4.2 0ZM14 13.8a2 2 0 1 0 4 0a2 2 0 1 0 -4 0Z",
  ],
};
const emboss = computed(() => EMBOSS[season.value]);
</script>

<template>
  <svg data-motif="seal" :data-season="season" class="seal" width="36" height="36" viewBox="0 0 36 36" aria-hidden="true" focusable="false">
    <defs>
      <radialGradient :id="gradient" cx="38%" cy="32%" r="72%">
        <stop offset="0" class="[stop-color:var(--color-seal-light)]" />
        <stop offset=".55" class="[stop-color:var(--color-ember)]" />
        <stop offset="1" class="[stop-color:var(--color-seal-deep)]" />
      </radialGradient>
    </defs>
    <path
      d="M32.91 20.64Q32.52 23.28 31.25 25.67Q29.98 28.06 27.71 29.47Q25.43 30.88 23.06 32.05Q20.68 33.23 18.00 33.22Q15.32 33.22 12.96 32.01Q10.61 30.80 8.55 29.23Q6.49 27.66 5.18 25.40Q3.87 23.14 3.20 20.57Q2.52 18.00 2.38 15.13Q2.24 12.27 4.24 10.20Q6.24 8.13 8.46 6.72Q10.68 5.31 13.06 4.43Q15.45 3.55 18.01 3.47Q20.57 3.40 23.37 3.62Q26.17 3.85 27.82 6.11Q29.47 8.38 30.53 10.72Q31.59 13.05 32.44 15.53Q33.30 18.00 32.91 20.64Z"
      :fill="`url(#${gradient})`"
    />
    <circle v-for="ring in RINGS" :key="ring.tone" :cx="ring.cx" :cy="ring.cy" r="10.4" class="fill-none" :class="ring.tone" :stroke-width="ring.width" opacity=".55" />
    <g class="fill-none stroke-seal-emboss" stroke-width="1.15" stroke-linecap="round" stroke-linejoin="round">
      <path v-for="(d, i) in emboss" :key="`${season}-${i}`" :d="d" />
    </g>
  </svg>
</template>
