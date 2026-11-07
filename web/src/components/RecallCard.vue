<script setup lang="ts">
// 「そういえば。」の札（wireframes 2.4）。見出し、昔の記憶の日付、逐語引用、なぜ関係があるか、開く の 5 つだけ。
// 昔の記憶の 1 行目は出さない（本文が 1 行だと引用と同じ文が二度並ぶ。全文は開いて読む）。
// 「ひらく ›」の ::after を札いっぱいに広げ、札のどこを押しても開く（タップ領域は札全体）。
// 見た目は封蝋の付いた一筆箋（ADR-0010）: 左に朱の二重罫、右上に封蝋、引用は罫の上の明朝。
// S1 の札（見出しあり）にだけ、左下に押し葉を置く（昔の記憶から届いたもの）
import type { Recall } from "../api/types";
import { hrefFor, type From } from "../composables/useScreen";
import { formatHappenedOn } from "../date";
import Leaf from "./motifs/Leaf.vue";
import Seal from "./motifs/Seal.vue";

// animate: 現れる動き（.appear と封蝋の押される動き）を付けるか。S1 に戻ってきたとき、もう見せた札は動かさない
withDefaults(defineProps<{ recall: Recall; from: From; heading?: boolean; animate?: boolean }>(), {
  heading: true,
  animate: true,
});
</script>

<template>
  <article class="note" :class="animate ? 'appear' : ''">
    <Seal class="absolute -top-[9px] right-4 drop-shadow-wax" />
    <h2 v-if="heading" class="font-display text-[22px] font-bold tracking-[.06em] text-ember-ink [font-feature-settings:'palt']">そういえば。</h2>
    <p class="text-sm leading-[1.6] text-ink-soft" :class="heading ? 'mt-1' : ''">
      {{ formatHappenedOn(recall.related_memory.happened_on, recall.related_memory.happened_on_precision) }}のひとこと
    </p>
    <!-- 引用は始めのかぎ括弧をぶら下げ、2 行目以降の頭をそろえる。長いときは 3 行で切る -->
    <p class="letter-text mt-2.5 line-clamp-3 -indent-[1em] pl-[1em] text-ink">「{{ recall.evidence }}」</p>
    <p class="mt-2.5 text-sm leading-[1.7] text-ink-soft">{{ recall.reason }}</p>
    <div class="mt-0.5 flex items-center" :class="heading ? 'justify-between' : 'justify-end'">
      <Leaf v-if="heading" class="-ml-1 mb-0.5 shrink-0" />
      <a
        :href="hrefFor({ name: 'memory', id: recall.related_memory.id, from, recall: recall.id })"
        class="flex min-h-11 items-center text-sm tracking-[.06em] text-ink-soft after:absolute after:inset-0 after:rounded-note"
      >ひらく ›</a>
    </div>
  </article>
</template>
