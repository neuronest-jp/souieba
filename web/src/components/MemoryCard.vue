<script setup lang="ts">
// S2 の行。最初の一行 + 起きた日（写真があれば左に）。行全体がタップ領域。写真の無い行に空の枠は置かない
import type { Memory } from "../api/types";
import PhotoImg from "./PhotoImg.vue";
import { firstLine, formatHappenedOn } from "../date";
import { hrefFor } from "../composables/useScreen";

defineProps<{ memory: Memory }>();
</script>

<template>
  <a :href="hrefFor({ name: 'memory', id: memory.id, from: 'past' })" class="flex min-h-[72px] items-center gap-3 border-b border-line py-3">
    <div v-if="memory.photo_key" class="h-14 w-14 shrink-0 overflow-hidden rounded-xl bg-line/40">
      <PhotoImg :photo-key="memory.photo_key" class="h-full w-full object-cover" />
    </div>
    <div class="min-w-0 flex-1">
      <p class="truncate text-ink">{{ firstLine(memory.body) }}</p>
      <p class="text-sm text-ink-soft">{{ formatHappenedOn(memory.happened_on, memory.happened_on_precision) }}</p>
    </div>
  </a>
</template>
