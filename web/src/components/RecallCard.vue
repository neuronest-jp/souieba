<script setup lang="ts">
// 「そういえば。」の札（wireframes 2.4）。見出し、昔の記憶の日付、逐語引用、なぜ関係があるか、開く の 5 つだけ。
// 昔の記憶の 1 行目は出さない（本文が 1 行だと引用と同じ文が二度並ぶ。全文は開いて読む）。
// 「ひらく ›」の ::after を札いっぱいに広げ、札のどこを押しても開く（タップ領域は札全体）
import type { Recall } from "../api/types";
import { hrefFor } from "../composables/useScreen";
import { formatHappenedOn } from "../date";

// animate: 現れる動き（.appear）を付けるか。S1 に戻ってきたとき、もう見せた札は動かさない
withDefaults(defineProps<{ recall: Recall; from: "today" | "past"; heading?: boolean; animate?: boolean }>(), {
  heading: true,
  animate: true,
});
</script>

<template>
  <article class="card relative p-4" :class="animate ? 'appear' : ''">
    <h2 v-if="heading" class="text-xl text-ember">そういえば。</h2>
    <p class="mt-1 text-sm text-ink-soft">
      {{ formatHappenedOn(recall.related_memory.happened_on, recall.related_memory.happened_on_precision) }}のひとこと
    </p>
    <p class="mt-2 line-clamp-3 leading-relaxed text-ink">「{{ recall.evidence }}」</p>
    <p class="mt-1 text-sm text-ink-soft">{{ recall.reason }}</p>
    <a :href="hrefFor({ name: 'memory', id: recall.related_memory.id, from, recall: recall.id })" class="mt-2 flex min-h-11 items-center justify-end text-ember after:absolute after:inset-0 after:rounded-card active:after:bg-ink/[0.04]">ひらく ›</a>
  </article>
</template>
