<script setup lang="ts">
// 「いつ？」のシート。精度（日 / 月 / 年 / いつだったか）と日付を選ぶ（wireframes 2.1）。
// 内部では常に完全な日付（YYYY-MM-DD）を持ち、精度に応じた表示用の値を派生させる。
// 精度を 日 → 年 → 日 と戻しても、選んだ月日は失われない。
import { computed, nextTick, onMounted, onUnmounted, ref } from "vue";
import type { Precision } from "../api/types";
import { toIsoDate } from "../date";

const precision = defineModel<Precision>("precision", { required: true });
const date = defineModel<string>("date", { required: true }); // 常に YYYY-MM-DD
const emit = defineEmits<{ close: [] }>();

const options: { id: Precision; label: string }[] = [
  { id: "day", label: "日" },
  { id: "month", label: "月" },
  { id: "year", label: "年" },
  { id: "unknown", label: "いつだったか" },
];

const thisYear = new Date().getFullYear();
const years = Array.from({ length: 101 }, (_, i) => thisYear - i);
const firstButton = ref<HTMLButtonElement | null>(null);

const isFullDate = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v);

// 入力が空（クリア）になったら直前の値を保つ。有効な値だけ内部の日付に書き戻す。
const dayModel = computed({
  get: () => date.value,
  set: (v: string) => {
    if (isFullDate(v)) date.value = v;
  },
});
const monthModel = computed({
  get: () => date.value.slice(0, 7),
  set: (v: string) => {
    if (/^\d{4}-\d{2}$/.test(v)) date.value = `${v}-${date.value.slice(8, 10) || "01"}`;
  },
});
const yearModel = computed({
  get: () => Number(date.value.slice(0, 4)) || thisYear,
  set: (y: number) => {
    date.value = `${String(y).padStart(4, "0")}${date.value.slice(4)}`;
  },
});

const onKey = (e: KeyboardEvent) => {
  if (e.key === "Escape") emit("close");
};
onMounted(() => {
  if (!isFullDate(date.value)) date.value = toIsoDate(new Date());
  window.addEventListener("keydown", onKey);
  void nextTick(() => firstButton.value?.focus());
});
onUnmounted(() => window.removeEventListener("keydown", onKey));
</script>

<template>
  <div class="fixed inset-0 z-20 flex items-end justify-center bg-ink/30" @click.self="emit('close')">
    <div class="w-full max-w-[560px] rounded-t-[20px] bg-card p-5 shadow-card" role="dialog" aria-modal="true" aria-labelledby="date-sheet-title">
      <h2 id="date-sheet-title" class="text-xl">いつのこと</h2>
      <div class="mt-4 flex flex-wrap gap-2">
        <button
          v-for="(o, i) in options"
          :key="o.id"
          :ref="(el) => { if (i === 0) firstButton = el as HTMLButtonElement; }"
          type="button"
          class="min-h-11 rounded-full border px-3.5 text-base transition-colors"
          :class="precision === o.id ? 'border-ember bg-ember-soft text-ink' : 'border-line bg-card text-ink-soft'"
          :aria-pressed="precision === o.id"
          @click="precision = o.id"
        >
          {{ o.label }}
        </button>
      </div>
      <div class="mt-4 min-h-11">
        <input v-if="precision === 'day'" v-model="dayModel" type="date" class="h-11 w-full rounded-xl border border-line bg-card px-3" aria-label="日付" />
        <input v-else-if="precision === 'month'" v-model="monthModel" type="month" class="h-11 w-full rounded-xl border border-line bg-card px-3" aria-label="年月" />
        <select v-else-if="precision === 'year'" v-model="yearModel" class="h-11 w-full rounded-xl border border-line bg-card px-3" aria-label="年">
          <option v-for="y in years" :key="y" :value="y">{{ y }}年</option>
        </select>
        <p v-else class="text-sm text-ink-soft">日付は入れずに残します。</p>
      </div>
      <div class="mt-4 flex justify-center">
        <button type="button" class="min-h-11 px-6 text-ink-soft" @click="emit('close')">とじる</button>
      </div>
    </div>
  </div>
</template>
