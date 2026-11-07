<script setup lang="ts">
// S2 の行。最初の一行 + 起きた日（写真があれば左に）。行全体がタップ領域。写真の無い行に空の枠は置かない。
// 見た目は「便箋と押し葉」（ADR-0010）: 1 行目は自分の言葉なので明朝（罫は引かない）、行の区切りは朱罫の色、
// 写真は白いふちの焼き付け（紙に置いたプリント）。読めなかったときも 56px の枠に文言は出さない（quiet。見直し n=12）。
// 押すと行ごと沈む（.press）
import type { Memory } from "../api/types";
import PhotoImg from "./PhotoImg.vue";
import { firstLine, formatHappenedOn } from "../date";
import { hrefFor } from "../composables/useScreen";

defineProps<{ memory: Memory }>();
</script>

<template>
  <a :href="hrefFor({ name: 'memory', id: memory.id, from: 'past' })" class="press flex min-h-[74px] items-center gap-3.5 border-b border-rule py-3">
    <div v-if="memory.photo_key" class="size-14 shrink-0 rounded-[4px] bg-card p-[3px] shadow-print">
      <PhotoImg :photo-key="memory.photo_key" quiet class="size-full rounded-[2px] object-cover" />
    </div>
    <div class="min-w-0 flex-1">
      <p class="truncate font-letter text-base leading-[1.6] font-medium tracking-[.02em] text-ink">{{ firstLine(memory.body) }}</p>
      <p class="mt-0.5 text-sm leading-[1.5] tracking-[.03em] text-ink-soft">{{ formatHappenedOn(memory.happened_on, memory.happened_on_precision) }}</p>
    </div>
  </a>
</template>
