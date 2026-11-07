<script setup lang="ts">
// 押し葉（58×34）。細い茎に互い違いの葉 5 枚。面は leaf、縁と葉脈は moss を薄く。
// 置くのは S1 の札の左下（昔の記憶から届いたもの）と、S2 の見出しの右（綴じた帳面）だけ。
// 葉と葉脈の形はデータに置いて v-for で描く（静的な要素が 5 つ以上並ぶと、Vue が HTML の文字列にまとめて挿す。
// テストの最小の DOM はそれを持たない）
const LEAVES = [
  "M14 26.4c-1.6-4.6.4-8.3 5.6-9.6 1.2 4.7-1.3 8.2-5.6 9.6Z",
  "M18.3 24.7c3.6 3.2 7.8 3.3 11-.3-3.7-3.4-8-3-11 .3Z",
  "M27.6 19.4c-.9-4.8 1.7-8 6.9-8.6.4 4.8-2.5 7.8-6.9 8.6Z",
  "M33 16.6c3.8 2.8 8 2.6 10.9-1.1-3.9-3-8.1-2.4-10.9 1.1Z",
  "M42.8 10.6c-.3-4.4 2.4-7.1 7-7.2 0 4.4-2.8 7-7 7.2Z",
];
const VEINS = ["M14 26.4 18.6 18.4", "M18.3 24.7 28.4 24.4", "M27.6 19.4 33.6 11.8", "M33 16.6 42.9 15.6", "M42.8 10.6 48.8 4.4"];
</script>

<template>
  <svg data-motif="leaf" width="58" height="34" viewBox="0 0 58 34" aria-hidden="true" focusable="false">
    <g stroke-linecap="round" stroke-linejoin="round">
      <path d="M3 31C15 27 30 19 55 4" class="fill-none stroke-moss" stroke-width=".9" opacity=".7" />
      <g class="fill-leaf stroke-moss" stroke-width=".6" stroke-opacity=".55">
        <path v-for="d in LEAVES" :key="d" :d="d" />
      </g>
      <g class="fill-none stroke-moss" stroke-width=".5" opacity=".55">
        <path v-for="d in VEINS" :key="d" :d="d" />
      </g>
    </g>
  </svg>
</template>
