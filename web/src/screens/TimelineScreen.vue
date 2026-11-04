<script setup lang="ts">
// S2 これまで。時系列の静かなリスト。
import { onMounted, ref } from "vue";
import { api } from "../api";
import type { Memory } from "../api/types";
import MemoryCard from "../components/MemoryCard.vue";

const items = ref<Memory[]>([]);
const nextCursor = ref<string | null>(null);
const state = ref<"loading" | "ready" | "error">("loading");
const moreError = ref(false);
const loadingMore = ref(false);

const load = async () => {
  state.value = "loading";
  try {
    const page = await api.listMemories();
    items.value = page.items;
    nextCursor.value = page.next_cursor;
    state.value = "ready";
  } catch {
    state.value = "error";
  }
};

const more = async () => {
  if (!nextCursor.value || loadingMore.value) return;
  loadingMore.value = true;
  moreError.value = false;
  try {
    const page = await api.listMemories(nextCursor.value);
    items.value = [...items.value, ...page.items];
    nextCursor.value = page.next_cursor;
  } catch {
    moreError.value = true;
  } finally {
    loadingMore.value = false;
  }
};

onMounted(load);
</script>

<template>
  <main class="flex flex-1 flex-col gap-6 py-6">
    <header>
      <h1 class="text-[22px]">これまで</h1>
    </header>

    <p v-if="state === 'loading'" class="py-16 text-center text-sm text-ink-faint" role="status">よみこみ中</p>

    <section v-else-if="state === 'error'" class="flex flex-col items-center gap-3 py-16 text-center">
      <p class="text-ink-soft">読み込めませんでした</p>
      <button type="button" class="btn btn-quiet" @click="load">もう一度</button>
    </section>

    <section v-else-if="items.length === 0" class="flex flex-1 flex-col items-center justify-center gap-1 py-16 text-center text-ink-soft">
      <p>まだ何もありません。</p>
      <a href="#today" class="min-h-11 border-b border-ember text-ink">きょうのひとことから</a>
    </section>

    <template v-else>
      <ul class="-mt-3">
        <li v-for="m in items" :key="m.id">
          <MemoryCard :memory="m" />
        </li>
      </ul>
      <div v-if="nextCursor" class="flex flex-col items-center gap-3">
        <p v-if="moreError" class="text-ink-soft">読み込めませんでした</p>
        <button type="button" class="btn btn-quiet" :disabled="loadingMore" @click="more">もっと前を見る</button>
      </div>
    </template>
  </main>
</template>
