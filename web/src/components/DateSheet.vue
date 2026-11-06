<script setup lang="ts">
// 「いつ？」のシート。精度（日 / 月 / 年 / いつだったか）と日付を選ぶ（wireframes 2.1）。
// 内部では常に完全な日付（YYYY-MM-DD）を持ち、精度に応じた表示用の値を派生させる。
// 精度を 日 → 年 → 日 と戻しても、選んだ月日は失われない。
import { computed, nextTick, onMounted, onUnmounted, ref } from "vue";
import type { Precision } from "../api/types";
import { clampDay, isRealYmd, todayInTokyo } from "../date";

const precision = defineModel<Precision>("precision", { required: true });
const date = defineModel<string>("date", { required: true }); // 常に YYYY-MM-DD
const emit = defineEmits<{ close: [] }>();

const options: { id: Precision; label: string }[] = [
  { id: "day", label: "日" },
  { id: "month", label: "月" },
  { id: "year", label: "年" },
  { id: "unknown", label: "いつだったか" },
];

// 年の選択肢は Asia/Tokyo の今年から（既定の日付と同じ基準。年明けの数時間に今年が選べなくならない）
const thisYear = Number(todayInTokyo().slice(0, 4));
const years = Array.from({ length: 101 }, (_, i) => thisYear - i);
const firstButton = ref<HTMLButtonElement | null>(null);

// 入力が空（クリア）になったら直前の値を保つ。有効な値だけ内部の日付に書き戻す。
const dayModel = computed({
  get: () => date.value,
  set: (v: string) => {
    if (isRealYmd(v)) date.value = v;
  },
});
// 月や年だけ変えるときは、日をその月の末日に丸める（clampDay）。10/31 のまま 11 月にすると 2026-11-31 になり、
// 「日」に戻すと日付欄は空に見え、保存は Worker の「存在しない日付です」で通らなくなる。
// 丸めた日は月を戻しても元に戻らない（10/31 → 11 月 → 10 月で 10/30）
const monthModel = computed({
  get: () => date.value.slice(0, 7),
  set: (v: string) => {
    const m = /^(\d{4})-(\d{2})$/.exec(v);
    if (m) date.value = clampDay(Number(m[1]), Number(m[2]), Number(date.value.slice(8, 10)));
  },
});
const yearModel = computed({
  get: () => Number(date.value.slice(0, 4)) || thisYear,
  set: (y: number) => {
    date.value = clampDay(y, Number(date.value.slice(5, 7)), Number(date.value.slice(8, 10)));
  },
});

const onKey = (e: KeyboardEvent) => {
  if (e.key === "Escape") emit("close");
};
onMounted(() => {
  if (!isRealYmd(date.value)) date.value = todayInTokyo();
  window.addEventListener("keydown", onKey);
  void nextTick(() => firstButton.value?.focus());
});
onUnmounted(() => window.removeEventListener("keydown", onKey));
</script>

<template>
  <!-- iOS 26 / 27 のシート: 画面の端から少し浮いた大きな角丸、上に掴み手。選択肢は iOS のセグメント -->
  <div class="fixed inset-0 z-20 flex items-end justify-center bg-ink/25" @click.self="emit('close')">
    <div
      class="m-2 w-full max-w-[560px] rounded-[34px] bg-card px-5 pt-2 pb-[max(20px,calc(env(safe-area-inset-bottom)-4px))] shadow-[var(--shadow-float)]"
      role="dialog"
      aria-modal="true"
      aria-labelledby="date-sheet-title"
    >
      <div class="mx-auto mb-3 h-[5px] w-9 rounded-full bg-ink-faint" aria-hidden="true"></div>
      <h2 id="date-sheet-title" class="text-center text-base font-semibold">いつのこと</h2>
      <div class="mt-4 flex gap-0.5 rounded-[10px] bg-fill p-0.5">
        <button
          v-for="(o, i) in options"
          :key="o.id"
          :ref="(el) => { if (i === 0) firstButton = el as HTMLButtonElement; }"
          type="button"
          class="min-h-11 flex-1 rounded-[8px] px-1 text-xs whitespace-nowrap transition-colors"
          :class="precision === o.id ? 'bg-card font-semibold text-ink shadow-[var(--shadow-float)]' : 'font-medium text-ink'"
          :aria-pressed="precision === o.id"
          @click="precision = o.id"
        >
          {{ o.label }}
        </button>
      </div>
      <div class="mt-4 min-h-11">
        <input v-if="precision === 'day'" v-model="dayModel" type="date" class="h-11 w-full rounded-xl bg-fill px-3" aria-label="日付" />
        <input v-else-if="precision === 'month'" v-model="monthModel" type="month" class="h-11 w-full rounded-xl bg-fill px-3" aria-label="年月" />
        <select v-else-if="precision === 'year'" v-model="yearModel" class="h-11 w-full rounded-xl bg-fill px-3" aria-label="年">
          <option v-for="y in years" :key="y" :value="y">{{ y }}年</option>
        </select>
        <p v-else class="text-sm text-ink-soft">日付は入れずに残します。</p>
      </div>
      <div class="mt-4 flex justify-center">
        <button type="button" class="btn btn-quiet w-full" @click="emit('close')">とじる</button>
      </div>
    </div>
  </div>
</template>
