<script setup lang="ts">
// 「いつ？」のシート。精度（日 / 月 / 年 / いつだったか）と日付を選ぶ（wireframes 2.1）。
import { computed } from "vue";
import type { Precision } from "../api/types";

const precision = defineModel<Precision>("precision", { required: true });
const value = defineModel<string>("value", { required: true }); // day: YYYY-MM-DD, month: YYYY-MM, year: YYYY
const emit = defineEmits<{ close: [] }>();

const options: { id: Precision; label: string }[] = [
  { id: "day", label: "日" },
  { id: "month", label: "月" },
  { id: "year", label: "年" },
  { id: "unknown", label: "いつだったか" },
];

const thisYear = new Date().getFullYear();
const years = Array.from({ length: 101 }, (_, i) => thisYear - i);

// 精度を変えたら値の形を合わせる（日 → 月なら先頭 7 文字、など）
const choose = (p: Precision) => {
  const v = value.value;
  const y = v.slice(0, 4) || String(thisYear);
  const m = v.slice(5, 7) || "01";
  const d = v.slice(8, 10) || "01";
  precision.value = p;
  if (p === "day") value.value = v.length === 10 ? v : `${y}-${m}-${d}`;
  else if (p === "month") value.value = `${y}-${m}`;
  else if (p === "year") value.value = y;
};

const yearModel = computed({
  get: () => Number(value.value.slice(0, 4)) || thisYear,
  set: (y: number) => {
    value.value = String(y);
  },
});
</script>

<template>
  <div class="fixed inset-0 z-20 flex items-end justify-center bg-ink/30" @click.self="emit('close')">
    <div class="w-full max-w-md rounded-t-[20px] bg-card p-5 shadow-card" role="dialog" aria-modal="true" aria-labelledby="date-sheet-title">
      <h2 id="date-sheet-title" class="text-xl">いつのこと</h2>
      <div class="mt-4 flex flex-wrap gap-2">
        <button
          v-for="o in options"
          :key="o.id"
          type="button"
          class="rounded-full border px-3.5 py-1.5 text-base transition-colors"
          :class="precision === o.id ? 'border-ember bg-ember-soft text-ink' : 'border-line bg-card text-ink-soft'"
          :aria-pressed="precision === o.id"
          @click="choose(o.id)"
        >
          {{ o.label }}
        </button>
      </div>
      <div class="mt-4 min-h-11">
        <input v-if="precision === 'day'" v-model="value" type="date" class="h-11 w-full rounded-xl border border-line bg-card px-3" aria-label="日付" />
        <input v-else-if="precision === 'month'" v-model="value" type="month" class="h-11 w-full rounded-xl border border-line bg-card px-3" aria-label="年月" />
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
