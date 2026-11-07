<script setup lang="ts">
// 「残しました」の横の手書きの ✓（ブラッシュアップ 11/7）。2 画をそれぞれ左端から伸ばして描く（transform だけ。styles/today.css）。
// 画の class 名は Tailwind の utility と重ならない名前にする（「stroke-」に数字を続けた名前は stroke-width の utility になり、線の太さが 1.8 でなくなる）。
// draw: いま残したときだけ描く動きを付ける（戻ってきたときは描いた形のまま）。飾りなので読み上げない（見出しの「残しました」で伝わる）
defineProps<{ draw?: boolean }>();
</script>

<template>
  <svg
    class="saved-check shrink-0"
    :class="draw ? 'is-drawing' : ''"
    width="18"
    height="18"
    viewBox="0 0 18 18"
    fill="none"
    stroke="currentColor"
    stroke-width="1.8"
    stroke-linecap="round"
    aria-hidden="true"
    focusable="false"
  >
    <!-- 1 画目（短い払い）と 2 画目（長いはね）。少しだけ反らせて手書きに寄せる -->
    <g transform="translate(3.6 9.6) rotate(42)"><path class="check-stroke-1" d="M0 0Q2.5 .55 5 0" /></g>
    <g transform="translate(7.3 13) rotate(-50)"><path class="check-stroke-2" d="M0 0Q5.8 -.9 11.5 0" /></g>
  </svg>
</template>
