<script setup lang="ts">
// ことばの地図で言葉を押したときのシート（S6、wireframes 第10節）。DateSheet・PairSheet と同じ下からのシート（useSheetDrag。div の role="dialog"、aria-modal）。
// 上から 言葉（見出し）/ どの年にいくつ出てくるか / その言葉が出てくるひとことを新しい順に（起きた日と、その言葉を含む本文の一文。言葉の所に印）/「とじる」。
// 一文は Worker が本文から切り出した原文のまま（原則 3）。長い文は言葉の前後だけにして「…」を付ける（markEvidence。一覧の切り方と同じ）。
// ひとことを押すと S3 へ（#memory/<id>?from=words。戻ると「‹ ことばの地図」）。シートは動かさずに閉じる（親が画面を離れたときに閉じる）。
// 後ろの画面を inert にするのと、閉じたあとのフォーカスは親（WordsScreen）が持つ
import { computed, nextTick, onMounted, onUnmounted, ref } from "vue";
import type { KeywordMention, MapKeyword } from "../../api/types";
import { hrefFor } from "../../composables/useScreen";
import { useSheetDrag } from "../../composables/useSheetDrag";
import { markEvidence } from "../../connections/excerpt";
import { formatHappenedOn } from "../../date";

const props = defineProps<{ keyword: MapKeyword; sheetId: string }>();
const emit = defineEmits<{ close: [] }>();

const titleId = computed(() => `${props.sheetId}-title`);
const subId = computed(() => `${props.sheetId}-sub`);

// 「2024年に 3 こ」/「2020年・2026年に、あわせて 5 こ」。bridge の年は多い年 3 つまでなので、ほかの年にも出ていれば「など」
const summary = computed(() => {
  const k = props.keyword;
  const years = k.years.map((y) => `${y.year}年`).join("・");
  if (k.role === "leaf") return `${years}に ${k.total} こ`;
  const listed = k.years.reduce((n, y) => n + y.count, 0);
  return `${years}${listed < k.total ? "など" : ""}に、あわせて ${k.total} こ`;
});

// 長い一文は言葉の前後だけ（一筆箋の幅で 4 行ほど）
const EXCERPT_LIMIT = 72;
const partsOf = (m: KeywordMention) => markEvidence(m.sentence, m.surface, { limit: EXCERPT_LIMIT, context: 22 });
const dateOf = (m: KeywordMention) => formatHappenedOn(m.happened_on, m.happened_on_precision);
const hrefOf = (m: KeywordMention) => hrefFor({ name: "memory", id: m.memory_id, from: "words" });

// 後ろの画面は WordsScreen が inert にする。シートは body の直下に出す（inert の外）。
// 文字列の "body" ではなく要素を渡す（テストの最小の DOM は querySelector を持たない）
const target = document.body;

const { panel, backdrop, close } = useSheetDrag({ onClose: () => emit("close") });

const heading = ref<HTMLElement | null>(null);
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
        :id="sheetId"
        ref="panel"
        class="sheet-paper tex-desk relative max-h-[calc(100dvh-env(safe-area-inset-top)-24px)] w-full max-w-[560px] overflow-y-auto overscroll-contain rounded-t-[20px] bg-paper px-5 pt-5 pb-[max(20px,env(safe-area-inset-bottom))]"
        role="dialog"
        aria-modal="true"
        :aria-labelledby="`${titleId} ${subId}`"
        data-sheet-scroll
      >
        <div class="sheet-grip" aria-hidden="true"></div>
        <h2
          :id="titleId"
          ref="heading"
          tabindex="-1"
          class="font-letter text-[24px] leading-[1.5] font-medium tracking-[.04em] text-ink focus:outline-none"
        >{{ keyword.label }}</h2>
        <p :id="subId" class="mt-0.5 text-sm leading-[1.7] tracking-[.02em] text-ink-soft">{{ summary }}</p>

        <!-- その言葉が出てくるひとこと（新しい順）。どれも本文の一文で、言葉の所に蛍光ペンの印（読み上げは「」で） -->
        <ol role="list" class="mt-4 flex flex-col gap-2.5" :aria-label="`「${keyword.label}」が出てくるひとこと`">
          <li v-for="m in keyword.mentions" :key="m.memory_id">
            <a :href="hrefOf(m)" class="word-mention press block rounded-card border border-line bg-card px-4 pt-2.5 pb-3 shadow-card">
              <span class="flex items-center justify-between gap-3">
                <span class="text-sm leading-[1.6] tracking-[.02em] text-ink-soft">{{ dateOf(m) }}</span>
                <span class="shrink-0 text-sm text-ink-soft" aria-hidden="true">›</span>
              </span>
              <span class="mt-1 block font-letter text-[17px] leading-[1.75] font-medium tracking-[.02em] text-ink">
                <template v-for="(part, i) in partsOf(m)" :key="i">
                  <template v-if="part.hit"><span class="sr-only">「</span><mark class="quote-mark">{{ part.text }}</mark><span class="sr-only">」</span></template>
                  <template v-else>{{ part.text }}</template>
                </template>
              </span>
            </a>
          </li>
        </ol>
        <p v-if="keyword.total > keyword.mentions.length" class="mt-3 text-sm text-ink-soft">新しい {{ keyword.mentions.length }} こを並べています</p>

        <div class="mt-3 flex justify-center">
          <button type="button" class="press min-h-11 px-6 text-ink-soft" @click="close">とじる</button>
        </div>
      </div>
    </div>
  </Teleport>
</template>
