<script setup lang="ts">
// S1 きょう。入力欄と写真ボタン。保存と「そういえば。」の札は 11/5 以降に実装する。
import { computed, ref } from "vue";
import type { Me } from "../api";
import { formatDateJa } from "../date";

defineProps<{ me: Me }>();

const body = ref("");
const today = formatDateJa(new Date());
const remaining = computed(() => 2000 - body.value.length);
const canSave = computed(() => body.value.trim().length > 0 && remaining.value >= 0);
// 保存は 11/5 で API とつなぐ。それまでは押しても静かに状態を伝えるだけ。
const notice = ref("");
const save = () => {
  notice.value = "いまは、まだ残せません。";
};
</script>

<template>
  <main class="flex flex-1 flex-col gap-6 py-8">
    <header class="space-y-1">
      <p class="text-sm text-ink-faint">{{ today }}</p>
      <h1 class="text-2xl">きょうは、どんな日でしたか</h1>
    </header>

    <section class="card p-4">
      <label class="sr-only" for="body">きょうのひとこと</label>
      <textarea
        id="body"
        v-model="body"
        rows="5"
        class="w-full resize-none bg-transparent leading-relaxed outline-none"
        placeholder="ひとことでも、長くても。"
        maxlength="2000"
      ></textarea>
      <div class="mt-3 flex items-center justify-between border-t border-line pt-3">
        <button class="btn btn-quiet min-h-11 px-4 text-sm" type="button" disabled>写真を添える</button>
        <span v-if="body.length > 1800" class="text-sm text-ink-soft" aria-live="polite">あと {{ remaining }} 文字</span>
      </div>
    </section>

    <div class="flex items-center justify-end gap-4">
      <p v-if="notice" class="text-sm text-ink-soft" role="status">{{ notice }}</p>
      <button class="btn btn-primary px-8" type="button" :disabled="!canSave" @click="save">保存する</button>
    </div>

    <p class="text-sm leading-relaxed text-ink-soft">
      保存すると、関係のある昔のひとことがあれば、ここに「そういえば。」と浮かんできます。<br />
      なければ、何も出ません。それでいいのです。
    </p>
  </main>
</template>
