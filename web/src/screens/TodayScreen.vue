<script setup lang="ts">
// S1 きょう。入力 → 保存 → 「残しました」。候補と札は 11/6 で足す。
import { computed, nextTick, ref } from "vue";
import { api } from "../api";
import type { Memory, Precision } from "../api/types";
import DateSheet from "../components/DateSheet.vue";
import { formatHappenedOn, toIsoDate } from "../date";
import { hrefFor } from "../composables/useScreen";

const body = ref("");
const precision = ref<Precision>("day");
const date = ref(toIsoDate(new Date())); // 常に YYYY-MM-DD。精度に応じて POST 時に切り詰める
const sheetOpen = ref(false);
const whenButton = ref<HTMLButtonElement | null>(null);
const saving = ref(false);
const error = ref("");
const saved = ref<Memory | null>(null);

const MAX = 2000;
const remaining = computed(() => MAX - Array.from(body.value).length);
const hasDate = computed(() => precision.value === "unknown" || /^\d{4}-\d{2}-\d{2}$/.test(date.value));
const canSave = computed(() => body.value.trim().length > 0 && remaining.value >= 0 && hasDate.value && !saving.value);

// POST に入れる happened_on（day: YYYY-MM-DD / month: YYYY-MM / year: YYYY）
const happenedOnForPost = computed(() => {
  if (precision.value === "month") return date.value.slice(0, 7);
  if (precision.value === "year") return date.value.slice(0, 4);
  return date.value;
});

// 見出しは選んだ精度で丸めた起きた日
const headingDate = computed(() => {
  if (precision.value === "unknown") return formatHappenedOn(null, "unknown");
  if (!hasDate.value) return formatHappenedOn(toIsoDate(new Date()), precision.value);
  return formatHappenedOn(date.value, precision.value);
});

const closeSheet = () => {
  sheetOpen.value = false;
  void nextTick(() => whenButton.value?.focus());
};

const save = async () => {
  if (!canSave.value) return;
  saving.value = true;
  error.value = "";
  try {
    saved.value = await api.createMemory({
      body: body.value.trim(),
      happened_on_precision: precision.value,
      ...(precision.value === "unknown" ? {} : { happened_on: happenedOnForPost.value }),
    });
    body.value = "";
  } catch {
    error.value = "うまく保存できませんでした。もう少ししてから、もう一度";
  } finally {
    saving.value = false;
  }
};

const another = () => {
  saved.value = null;
  precision.value = "day";
  date.value = toIsoDate(new Date());
};
</script>

<template>
  <main class="flex flex-1 flex-col gap-6 py-6">
    <template v-if="!saved">
      <header class="flex items-baseline justify-between">
        <h1 class="text-[22px]">{{ headingDate }}</h1>
        <button ref="whenButton" type="button" class="min-h-11 px-2 text-sm text-ink-soft" @click="sheetOpen = true">いつ？</button>
      </header>

      <section class="card p-4">
        <label class="sr-only" for="body">きょうのひとこと</label>
        <textarea
          id="body"
          v-model="body"
          rows="5"
          class="field-sizing-content w-full resize-none bg-transparent leading-relaxed outline-none"
          placeholder="きょうのひとこと"
        ></textarea>
        <p v-if="remaining < 100" class="text-right text-sm text-ink-soft" aria-live="polite">あと {{ remaining }} 文字</p>
      </section>

      <div>
        <button class="btn btn-quiet min-h-11 px-4 text-sm" type="button" disabled>写真を添える</button>
      </div>

      <div class="flex flex-col items-center gap-3">
        <button class="btn btn-primary px-10" type="button" :disabled="!canSave" @click="save">保存する</button>
        <p v-if="error" class="text-sm text-ink-soft" role="alert">{{ error }}</p>
      </div>

      <DateSheet v-if="sheetOpen" v-model:precision="precision" v-model:date="date" @close="closeSheet" />
    </template>

    <template v-else>
      <p class="text-sm text-ink-soft" role="status">残しました</p>
      <article class="card appear p-4">
        <p class="text-sm text-ink-soft">{{ formatHappenedOn(saved.happened_on, saved.happened_on_precision) }}</p>
        <p class="mt-1 whitespace-pre-wrap leading-relaxed">{{ saved.body }}</p>
      </article>
      <div class="flex items-center gap-6">
        <button type="button" class="min-h-11 border-b border-ember text-ink" @click="another">もうひとつ書く</button>
        <a :href="hrefFor({ name: 'memory', id: saved.id, from: 'today' })" class="min-h-11 text-ink-soft">ひらく ›</a>
      </div>
    </template>
  </main>
</template>
