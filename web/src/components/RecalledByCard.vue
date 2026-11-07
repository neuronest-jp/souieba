<script setup lang="ts">
// S3 の「この記憶が思い出された側」の札（wireframes 4.1 の recalled_by、4.2 の反応用の札）。
// 相手（新しい記憶）の日付と 1 行目、この記憶の本文からの逐語引用、なぜ関係があるか、反応ボタン。
// 反応の記録は親（MemoryDetailScreen）が持つ。札を本文のすぐ下にも一覧にも置けるように、描き方だけをここにまとめる。
// 見た目は RecallCard と同じ封蝋の付いた一筆箋（ADR-0010）。「関係ないかも」と返した札は、地の色に戻して
// 二重罫を line にし、封蝋を外す（色だけでなく形で退かせる。文字は薄くしない）。「そうだった」は判の形（二重の輪）
import type { RecalledBy } from "../api/types";
import { firstLine, formatHappenedOn } from "../date";
import Seal from "./motifs/Seal.vue";

withDefaults(defineProps<{ item: RecalledBy; heading?: boolean; notice?: string }>(), { heading: false, notice: "" });
const emit = defineEmits<{ react: [feedback: "helpful" | "not_related"] }>();
</script>

<template>
  <article class="note" :class="item.feedback === 'not_related' ? 'note-quiet' : ''">
    <Seal v-if="item.feedback !== 'not_related'" class="absolute -top-[9px] right-4 drop-shadow-wax" />
    <h2 v-if="heading" class="font-display text-[22px] font-bold tracking-[.06em] text-ember-ink [font-feature-settings:'palt']">そういえば。</h2>
    <p class="text-sm leading-[1.6] text-ink-soft" :class="heading ? 'mt-1' : ''">{{ formatHappenedOn(item.memory.happened_on, item.memory.happened_on_precision) }}のひとことから</p>
    <a :href="`#memory/${encodeURIComponent(item.memory.id)}`" class="-mt-1 flex min-h-11 items-center text-sm text-ink-soft">
      <span class="min-w-0 truncate">{{ firstLine(item.memory.body) }}</span>
    </a>
    <p class="letter-text mt-1 line-clamp-3 -indent-[1em] pl-[1em] text-ink">「{{ item.evidence }}」</p>
    <p class="mt-2.5 text-sm leading-[1.7] text-ink-soft">{{ item.reason }}</p>
    <!-- 見た目は 40px、押せる所は ::after で 48px -->
    <div class="mt-3.5 mb-3.5 flex flex-wrap gap-2">
      <button
        type="button"
        class="choice h-10 px-4"
        :class="item.feedback === 'helpful' ? 'border-moss-deep bg-moss-soft shadow-stamp' : ''"
        :aria-pressed="item.feedback === 'helpful'"
        @click="emit('react', 'helpful')"
      >そうだった</button>
      <button
        type="button"
        class="choice h-10 px-4 text-ink-soft"
        :class="item.feedback === 'not_related' ? 'border-ink-soft bg-paper shadow-none' : ''"
        :aria-pressed="item.feedback === 'not_related'"
        @click="emit('react', 'not_related')"
      >関係ないかも</button>
    </div>
    <p v-if="notice" class="-mt-1.5 mb-3 text-sm text-ink-soft" role="status" aria-live="polite">{{ notice }}</p>
  </article>
</template>
