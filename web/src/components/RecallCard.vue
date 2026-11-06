<script setup lang="ts">
// 「そういえば。」の札（wireframes 2.4）。昔の記憶の日付、逐語引用、なぜ関係があるか、開く。
import type { Recall } from "../api/types";
import { hrefFor } from "../composables/useScreen";
import { firstLine, formatHappenedOn } from "../date";

withDefaults(defineProps<{ recall: Recall; from: "today" | "past"; heading?: boolean }>(), { heading: true });
</script>

<template>
  <article class="card appear border-l-[3px] border-l-ember p-4">
    <h2 v-if="heading" class="font-display text-[22px] font-bold text-ember">そういえば。</h2>
    <p class="mt-1 text-sm text-ink-soft">
      {{ formatHappenedOn(recall.related_memory.happened_on, recall.related_memory.happened_on_precision) }}のひとこと
    </p>
    <p class="mt-2 line-clamp-3 leading-relaxed text-ink">「{{ recall.evidence }}」</p>
    <p class="mt-1 text-sm text-ink-soft">{{ recall.reason }}</p>
    <p v-if="firstLine(recall.related_memory.body) !== recall.evidence" class="mt-2 truncate text-sm text-ink-soft">
      {{ firstLine(recall.related_memory.body) }}
    </p>
    <a :href="hrefFor({ name: 'memory', id: recall.related_memory.id, from, recall: recall.id })" class="mt-3 inline-flex min-h-11 items-center text-ink-soft">ひらく ›</a>
  </article>
</template>
