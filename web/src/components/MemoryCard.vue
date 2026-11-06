<script setup lang="ts">
// S2 の行。最初の一行 + 起きた日（写真があれば左に小さく）。行全体がタップ領域。
import type { Memory } from "../api/types";
import PhotoImg from "./PhotoImg.vue";
import { firstLine, formatHappenedOn } from "../date";
import { hrefFor } from "../composables/useScreen";

defineProps<{ memory: Memory }>();
</script>

<template>
  <!-- iOS の一覧の行（インセットグループの 1 行）。写真があるときだけ左に小さく出し、右に › を置く。区切り線は文字の始まりから -->
  <a :href="hrefFor({ name: 'memory', id: memory.id, from: 'past' })" class="flex min-h-[64px] items-center gap-3 pl-4 active:bg-fill">
    <div v-if="memory.photo_key" class="h-11 w-11 shrink-0 overflow-hidden rounded-[10px] bg-fill">
      <PhotoImg :photo-key="memory.photo_key" class="h-full w-full object-cover" />
    </div>
    <div class="flex min-w-0 flex-1 items-center gap-2 self-stretch border-b-[0.5px] border-line py-2.5 pr-4 group-last:border-b-0">
      <div class="min-w-0 flex-1">
        <p class="truncate text-ink">{{ firstLine(memory.body) }}</p>
        <p class="text-sm text-ink-soft">{{ formatHappenedOn(memory.happened_on, memory.happened_on_precision) }}</p>
      </div>
      <svg width="8" height="14" viewBox="0 0 8 14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="shrink-0 text-ink-faint" aria-hidden="true"><path d="M1.5 1.5 6.5 7l-5 5.5" /></svg>
    </div>
  </a>
</template>
