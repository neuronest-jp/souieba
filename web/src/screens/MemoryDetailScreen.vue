<script setup lang="ts">
// S3 記憶の詳細。本文、起きた日、確定済みの事実、「そういえば。」の枠、削除。
import { computed, onMounted, ref, watch } from "vue";
import { api, ApiError } from "../api";
import type { MemoryDetail } from "../api/types";
import { formatHappenedOn } from "../date";
import { go } from "../composables/useScreen";

const props = defineProps<{ id: string; from: "today" | "past" }>();

const detail = ref<MemoryDetail | null>(null);
const state = ref<"loading" | "ready" | "missing" | "error">("loading");
const confirming = ref(false);
const deleting = ref(false);
const deleteError = ref("");

const load = async () => {
  state.value = "loading";
  try {
    detail.value = await api.getMemory(props.id);
    state.value = "ready";
  } catch (e) {
    state.value = e instanceof ApiError && e.status === 404 ? "missing" : "error";
  }
};

const confirmedFacts = computed(() => detail.value?.facts.items.filter((f) => f.status === "confirmed") ?? []);
const KIND_LABEL = { person: "人", place: "場所", date: "日", thing: "もの" } as const;

const remove = async () => {
  deleting.value = true;
  deleteError.value = "";
  try {
    await api.deleteMemory(props.id);
    go({ name: "past" });
  } catch {
    confirming.value = false;
    deleteError.value = "消せませんでした";
  } finally {
    deleting.value = false;
  }
};

const back = () => {
  if (window.history.length > 1) window.history.back();
  else go({ name: props.from });
};

onMounted(load);
watch(() => props.id, load);
</script>

<template>
  <main class="flex flex-1 flex-col gap-4 py-4">
    <button type="button" class="self-start min-h-11 text-ink-soft" @click="back">‹ {{ from === "today" ? "きょう" : "これまで" }}</button>

    <p v-if="state === 'loading'" class="py-16 text-center text-sm text-ink-faint" role="status">よみこみ中</p>
    <p v-else-if="state === 'missing'" class="py-16 text-center text-ink-soft">この記憶は、もうありません。</p>
    <section v-else-if="state === 'error'" class="flex flex-col items-center gap-3 py-16">
      <p class="text-ink-soft">読み込めませんでした</p>
      <button type="button" class="btn btn-quiet" @click="load">もう一度</button>
    </section>

    <template v-else-if="detail">
      <h1 class="text-[22px]">{{ formatHappenedOn(detail.memory.happened_on, detail.memory.happened_on_precision) }}</h1>
      <img
        v-if="detail.memory.photo_key"
        :src="`/api/photos/${detail.memory.photo_key}`"
        alt=""
        class="max-h-[360px] w-full rounded-card object-cover"
      />
      <p class="whitespace-pre-wrap leading-relaxed">{{ detail.memory.body }}</p>

      <section v-if="confirmedFacts.length > 0" class="mt-4">
        <h2 class="text-sm text-ink-soft">おぼえていること</h2>
        <ul class="mt-2 flex flex-wrap gap-2">
          <li v-for="f in confirmedFacts" :key="f.id" class="rounded-full border border-moss bg-moss-soft px-3.5 py-1.5">
            <span class="mr-1 text-sm text-ink-faint">{{ KIND_LABEL[f.kind] }}</span>{{ f.value }}
          </li>
        </ul>
      </section>

      <div class="mt-auto flex flex-col items-end gap-3 pt-6">
        <p v-if="deleteError" class="text-sm text-ink-soft" role="alert">{{ deleteError }}</p>
        <button type="button" class="min-h-11 px-2 text-sm text-ink-soft" @click="confirming = true">消す</button>
      </div>

      <div v-if="confirming" class="fixed inset-0 z-20 flex items-end justify-center bg-ink/30" @click.self="confirming = false">
        <div class="w-full max-w-md rounded-t-[20px] bg-card p-5 shadow-card" role="dialog" aria-modal="true" aria-labelledby="delete-title">
          <h2 id="delete-title" class="text-[22px]">この記憶を消しますか</h2>
          <p class="mt-2 text-sm text-ink-soft">写真も、この記憶から浮かんだ「そういえば。」も一緒に消えます。</p>
          <div class="mt-5 flex items-center justify-end gap-4">
            <button type="button" class="min-h-11 px-4 text-ink-soft" @click="confirming = false">やめる</button>
            <button type="button" class="btn btn-primary px-8" :disabled="deleting" @click="remove">消す</button>
          </div>
        </div>
      </div>
    </template>
  </main>
</template>
