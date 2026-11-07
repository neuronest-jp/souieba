<script setup lang="ts">
// 栞（14×30）。下を V 字に切った朱の絹。S3 で、思い出されたことのある記憶（recalled_by がある）の便箋の天にだけ垂らす
// （本文の蛍光ペンの印と対になる）。横方向のグラデーションで絹のつやを出す。時間が無ければ最初に外す飾り（ADR-0010）
import { useId } from "vue";

const gradient = `ribbon-silk-${useId()}`;
</script>

<template>
  <svg data-motif="ribbon" width="14" height="30" viewBox="0 0 14 30" aria-hidden="true" focusable="false">
    <defs>
      <linearGradient :id="gradient" x1="0" x2="1" y1="0" y2="0">
        <stop offset="0" class="[stop-color:var(--color-seal-deep)]" />
        <stop offset=".35" class="[stop-color:var(--color-ember)]" />
        <stop offset=".6" class="[stop-color:var(--color-seal-light)]" />
        <stop offset="1" class="[stop-color:var(--color-ember)]" />
      </linearGradient>
    </defs>
    <path d="M0 0h14v30l-7-5.5L0 30Z" :fill="`url(#${gradient})`" />
    <path d="M0 3.5h14" class="stroke-seal-deep" stroke-width=".6" opacity=".45" />
  </svg>
</template>
