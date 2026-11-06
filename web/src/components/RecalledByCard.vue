<script setup lang="ts">
// S3 の「この記憶が思い出された側」の札（wireframes 4.1 の recalled_by、4.2 の反応用の札）。
// 相手（新しい記憶）の日付と 1 行目、この記憶の本文からの逐語引用、なぜ関係があるか、反応ボタン。
// 反応の記録は親（MemoryDetailScreen）が持つ。札を本文のすぐ下にも一覧にも置けるように、描き方だけをここにまとめる。
import type { RecalledBy } from "../api/types";
import { formatHappenedOn } from "../date";

withDefaults(defineProps<{ item: RecalledBy; heading?: boolean; notice?: string }>(), { heading: false, notice: "" });
const emit = defineEmits<{ react: [feedback: "helpful" | "not_related"] }>();
</script>

<template>
  <article class="card border-l-[3px] border-l-ember p-4">
    <h2 v-if="heading" class="font-display text-[22px] font-bold text-ember">そういえば。</h2>
    <p class="text-sm text-ink-soft" :class="heading ? 'mt-1' : ''">{{ formatHappenedOn(item.memory.happened_on, item.memory.happened_on_precision) }}のひとことから</p>
    <a :href="`#memory/${encodeURIComponent(item.memory.id)}`" class="mt-1 block truncate text-sm text-ink-soft">{{ item.memory.body.split(/\r?\n/)[0] }}</a>
    <p class="mt-2 line-clamp-3 leading-relaxed text-ink">「{{ item.evidence }}」</p>
    <p class="mt-1 text-sm text-ink-soft">{{ item.reason }}</p>
    <div class="mt-3 flex gap-2">
      <button type="button" class="min-h-11 rounded-full border px-3.5 text-base" :class="item.feedback === 'helpful' ? 'border-moss bg-moss-soft text-ink' : 'border-line bg-card text-ink'" :aria-pressed="item.feedback === 'helpful'" @click="emit('react', 'helpful')">そうだった</button>
      <button type="button" class="min-h-11 rounded-full border px-3.5 text-base" :class="item.feedback === 'not_related' ? 'border-line bg-paper text-ink-soft opacity-70' : 'border-line bg-card text-ink-soft'" :aria-pressed="item.feedback === 'not_related'" @click="emit('react', 'not_related')">関係ないかも</button>
    </div>
    <p v-if="notice" class="mt-2 text-sm text-ink-soft" role="status" aria-live="polite">{{ notice }}</p>
  </article>
</template>
