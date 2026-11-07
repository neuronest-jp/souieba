<script setup lang="ts">
// 封蝋（36px）。「そういえば。」の一筆箋の右上にだけ押す。少し歪んだ円（18 点の半径を 15.2±0.8 で固定）を朱の蝋で塗り、
// 内側に浮き出しの輪 2 本と、押した葉の線画を描く。札が現れるときは .appear .seal で押される動きになる（style.css）。
// 色はトークンの class（stroke-seal-deep、[stop-color:var(--color-ember)] など）だけ。グラデーションの id は札ごとに分ける（同じ画面に札が何枚も並ぶ）
import { useId } from "vue";

const gradient = `seal-wax-${useId()}`;
// 浮き出しの輪 2 本（暗い線と明るい線を 0.5px ずらす）。データに置いて v-for で描く（静的な要素が 5 つ以上並ぶと、
// Vue が HTML の文字列にまとめて挿す。テストの最小の DOM はそれを持たない）
const RINGS = [
  { cx: 18, cy: 18, width: 1.1, tone: "stroke-seal-deep" },
  { cx: 18.5, cy: 18.6, width: 0.8, tone: "stroke-seal-light" },
];
</script>

<template>
  <svg data-motif="seal" class="seal" width="36" height="36" viewBox="0 0 36 36" aria-hidden="true" focusable="false">
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
      <path d="M13.2 22.6c-.3-5.1 3.1-8.6 9.4-9.2.4 5.8-3.6 9.3-9.4 9.2Z" />
      <path d="M13.2 22.6 19.6 16.3" />
    </g>
  </svg>
</template>
