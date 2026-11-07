<script setup lang="ts">
// 「年月で探す」のシート（S2 の区切りの札を押したとき。ADR-0015、wireframes の「S2 を年月で探す」）。DateSheet・PairSheet と同じ、下からのシート。
// 年ごとに 12 か月のマス（新しい年から。記憶のある月だけ押せて、件数を小さく添える。無い月は薄く、押せず、読み上げない）。
// 年だけの記憶はその年のマスの下、日付なしはいちばん下に、それぞれ 1 つのボタンで選べる。いま見ている区切り（current）は朱の淡い地で示す。
// 押すと pick を出してから紙を下げる（読み直しは親が始める。触覚の select も親が鳴らす）。
// 手ざわりは useSheetDrag: 紙はばねで上がり、下へなぞる・地を押す・Esc・「とじる」で下がってから close を出す。
// 見出しの下の中身だけがスクロールする（data-sheet-scroll）。紙（.sheet-paper）そのものはスクロールさせない
// （紙の下に伸ばした ::after がスクロールする中身と一緒に動き、年のマスの上に重なって見えるため）。
// 開いたら見出しにフォーカスを置く。後ろを inert にするのとフォーカスを返すのは親（TimelineScreen）が持つ（PairSheet と同じ）
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from "vue";
import type { MemoryMonths } from "../../api/types";
import { useSheetDrag } from "../../composables/useSheetDrag";
import { UNDATED } from "../../past/sections";

const props = defineProps<{ months: MemoryMonths | null; state: "loading" | "ready" | "error"; current: string | null }>();
const emit = defineEmits<{ pick: [key: string]; retry: []; close: [] }>();

type Cell = { key: string; month: number; count: number };
type Year = { year: string; cells: Cell[]; yearOnly: number };

const years = computed<Year[]>(() => {
  const d = props.months;
  if (!d) return [];
  const byMonth = new Map(d.months.map((m) => [m.month, m.count]));
  const yearOnly = new Map(d.years_only.map((y) => [y.year, y.count]));
  const all = new Set([...d.months.map((m) => m.month.slice(0, 4)), ...d.years_only.map((y) => y.year)]);
  return [...all]
    .sort((a, b) => (a < b ? 1 : a > b ? -1 : 0))
    .map((year) => ({
      year,
      cells: Array.from({ length: 12 }, (_, i) => {
        const key = `${year}-${String(i + 1).padStart(2, "0")}`;
        return { key, month: i + 1, count: byMonth.get(key) ?? 0 };
      }),
      yearOnly: yearOnly.get(year) ?? 0,
    }));
});
const undated = computed(() => props.months?.undated ?? 0);

// シートは body の直下に出す（後ろの画面は親が inert にする）。要素を渡す（テストの最小の DOM は querySelector を持たない）
const target = document.body;
const { panel, backdrop, close } = useSheetDrag({ onClose: () => emit("close") });
const heading = ref<HTMLElement | null>(null);
const scroller = ref<HTMLElement | null>(null);

const pick = (key: string) => {
  emit("pick", key);
  close();
};

// 開いたとき、いま見ている年がシートの外（下）にあれば、その年の頭まで中身を送る（動かさずに置く）
const showCurrent = () => {
  const el = scroller.value;
  const year = props.current === UNDATED ? UNDATED : props.current?.slice(0, 4);
  if (!el || !year || typeof el.clientHeight !== "number") return;
  const block = Array.from(el.querySelectorAll<HTMLElement>("[data-year]")).find((b) => b.dataset.year === year);
  if (!block || block.offsetTop + block.offsetHeight <= el.clientHeight) return;
  el.scrollTop = Math.max(0, block.offsetTop - 20);
};
let shown = false;
watch(
  () => props.state === "ready" && years.value.length > 0,
  (ready) => {
    if (!ready || shown) return;
    shown = true;
    void nextTick(showCurrent);
  },
  { immediate: true },
);

const onKey = (e: KeyboardEvent) => {
  if (e.key === "Escape") close();
};
onMounted(() => {
  window.addEventListener("keydown", onKey);
  void nextTick(() => heading.value?.focus({ preventScroll: true }));
});
onUnmounted(() => window.removeEventListener("keydown", onKey));
</script>

<template>
  <Teleport :to="target">
    <div class="sheet-host fixed inset-0 z-20 flex items-end justify-center">
      <div ref="backdrop" class="sheet-backdrop absolute inset-0 bg-ink/30" aria-hidden="true" @click="close"></div>
      <div
        ref="panel"
        class="sheet-paper tex-sheet relative flex max-h-[calc(100dvh-env(safe-area-inset-top)-24px)] w-full max-w-[560px] flex-col rounded-t-[20px] bg-card pt-5 shadow-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="month-sheet-title"
      >
        <div class="sheet-grip" aria-hidden="true"></div>
        <h2 id="month-sheet-title" ref="heading" tabindex="-1" class="px-5 text-xl focus:outline-none">年月でたどる</h2>
        <div ref="scroller" class="relative min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pb-[max(20px,env(safe-area-inset-bottom))]" data-sheet-scroll>
          <p v-if="state === 'loading'" class="py-10 text-center text-sm text-ink-soft" role="status">よみこみ中</p>

          <div v-else-if="state === 'error'" class="flex flex-col items-center gap-3 py-8 text-center">
            <p class="text-ink-soft">読み込めませんでした</p>
            <button type="button" class="btn btn-quiet press" @click="emit('retry')">もう一度</button>
          </div>

          <template v-else>
            <section v-for="y in years" :key="y.year" class="mt-5" :data-year="y.year" :aria-labelledby="`month-sheet-${y.year}`">
              <h3 :id="`month-sheet-${y.year}`" class="text-base tracking-[.04em] text-ink [font-feature-settings:'palt']">{{ Number(y.year) }}年</h3>
              <!-- 6 列 × 2 段（375pt で 1 マス約 50px、402pt で約 55px。高さ 52px） -->
              <div class="mt-2 grid grid-cols-6 gap-1.5">
                <template v-for="c in y.cells" :key="c.key">
                  <button
                    v-if="c.count > 0"
                    type="button"
                    class="press flex h-[52px] min-w-0 flex-col items-center justify-center gap-1 rounded-[10px] border text-[15px] leading-none tracking-[.02em] text-ink [font-feature-settings:'palt']"
                    :class="current === c.key ? 'border-ember bg-ember-soft shadow-highlight' : 'border-line-strong bg-card shadow-press'"
                    :aria-label="`${Number(y.year)}年 ${c.month}月、${c.count} こ`"
                    :aria-current="current === c.key ? 'true' : undefined"
                    :data-month="c.key"
                    @click="pick(c.key)"
                  >
                    <span>{{ c.month }}月</span>
                    <span class="text-[12px] leading-none text-ink-soft tabular-nums" aria-hidden="true">{{ c.count }}</span>
                  </button>
                  <!-- 記憶の無い月: 薄く置くだけ（押せず、読み上げない） -->
                  <button
                    v-else
                    type="button"
                    disabled
                    aria-hidden="true"
                    tabindex="-1"
                    class="flex h-[52px] min-w-0 items-center justify-center rounded-[10px] text-[15px] leading-none tracking-[.02em] text-ink-faint [font-feature-settings:'palt']"
                    :data-month="c.key"
                  >
                    {{ c.month }}月
                  </button>
                </template>
              </div>
              <button
                v-if="y.yearOnly > 0"
                type="button"
                class="press mt-1.5 flex min-h-11 w-full items-center justify-between rounded-[10px] border px-3.5 text-[15px] tracking-[.02em] text-ink"
                :class="current === y.year ? 'border-ember bg-ember-soft shadow-highlight' : 'border-line-strong bg-card shadow-press'"
                :aria-label="`${Number(y.year)}年、年だけ、${y.yearOnly} こ`"
                :aria-current="current === y.year ? 'true' : undefined"
                :data-month="y.year"
                @click="pick(y.year)"
              >
                <span>年だけ</span>
                <span class="text-[12px] text-ink-soft tabular-nums" aria-hidden="true">{{ y.yearOnly }}</span>
              </button>
            </section>
            <section v-if="undated > 0" class="mt-5" :data-year="UNDATED">
              <button
                type="button"
                class="press flex min-h-11 w-full items-center justify-between rounded-[10px] border px-3.5 text-[15px] tracking-[.02em] text-ink"
                :class="current === UNDATED ? 'border-ember bg-ember-soft shadow-highlight' : 'border-line-strong bg-card shadow-press'"
                :aria-label="`日付なし、${undated} こ`"
                :aria-current="current === UNDATED ? 'true' : undefined"
                :data-month="UNDATED"
                @click="pick(UNDATED)"
              >
                <span>日付なし</span>
                <span class="text-[12px] text-ink-soft tabular-nums" aria-hidden="true">{{ undated }}</span>
              </button>
            </section>
          </template>

          <div class="mt-4 flex justify-center">
            <button type="button" class="press min-h-11 px-6 text-ink-soft" @click="close">とじる</button>
          </div>
        </div>
      </div>
    </div>
  </Teleport>
</template>
