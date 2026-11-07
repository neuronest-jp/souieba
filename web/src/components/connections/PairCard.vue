<script setup lang="ts">
// つながりの一組（S5。wireframes 9 節）。上に後の日の紙片、下に前の日の紙片を置き（起きた日の順。書いた順ではない。pair.ts の sidesOf）、
// あいだを一本の糸と「2年5か月まえの、あのとき」、つながった理由で結ぶ。読む順は見た目と同じ（上の日付 → 本文 → 隔たり → 理由 → 下の日付 → 本文 → そうだった → ひらく）。
// 紙は「便箋と押し葉」（ADR-0010）の言葉: 上は便箋（.card）、下は一筆箋（.note の朱の二重罫。封蝋は一覧では付けない）。
// どちらも本文は罫の上の明朝。思い出された側（上下どちらでも）は、思い出した一文（evidence）に蛍光ペンの印（mark）を引く。
// 「ひらく ›」の ::after を組いっぱいに広げ、組のどこを押してもシート（PairSheet）が開く（RecallCard と同じ作り）
import { computed } from "vue";
import { markEvidence, type ExcerptPart } from "../../connections/excerpt";
import { dateOf, gapOf, sidesOf, stitchOf, type Pair, type Side } from "../../connections/pair";
import Stitch from "./Stitch.vue";

const props = defineProps<{ pair: Pair; swing: 0 | 1; sheetId: string }>();
const emit = defineEmits<{ open: [id: string] }>();

const sides = computed(() => sidesOf(props.pair));
const upperDate = computed(() => dateOf(sides.value.upper));
const lowerDate = computed(() => dateOf(sides.value.lower));
const gap = computed(() => gapOf(props.pair));
// 一覧では、80 字を超える思い出された側の本文は引用の前後 24 字だけにする（行で切る前に、印が見える所まで寄せる）。
// 書いた側は本文のまま（印は無い）
const partsOf = (side: Side): ExcerptPart[] =>
  side.recalled ? markEvidence(side.memory.body, props.pair.evidence, { limit: 80, context: 24 }) : [{ text: side.memory.body, hit: false }];
const upperParts = computed(() => partsOf(sides.value.upper));
const lowerParts = computed(() => partsOf(sides.value.lower));
// 思い出された側は印が見えるよう 4 行まで、書いた側は 2 行まで
const clampOf = (side: Side) => (side.recalled ? "line-clamp-4" : "line-clamp-2");
const labelId = computed(() => `pair-${props.pair.id}-upper`);
</script>

<template>
  <article
    class="relative rounded-card has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-[6px] has-[:focus-visible]:outline-ember"
    :aria-labelledby="labelId"
  >
    <!-- 後の日（便箋） -->
    <div class="card relative z-[1] px-5 pt-3 pb-3.5">
      <p :id="labelId" class="text-sm leading-[1.6] tracking-[.02em] text-ink-soft">{{ upperDate }}のひとこと</p>
      <p class="letter-text mt-1 text-ink" :class="clampOf(sides.upper)">
        <template v-for="(part, i) in upperParts" :key="i">
          <mark v-if="part.hit">{{ part.text }}</mark>
          <template v-else>{{ part.text }}</template>
        </template>
      </p>
    </div>
    <!-- 結び: 左に糸（読み上げない）、右に隔たりと理由（本物の文字） -->
    <div class="relative grid min-h-[88px] grid-cols-[56px_1fr] pt-[13px] pr-0.5 pb-[15px]">
      <Stitch :stitch="stitchOf(pair.feedback)" :swing="swing" />
      <div class="col-start-2 min-w-0 self-center">
        <p v-if="gap" class="font-display text-[17px] leading-[1.5] font-bold tracking-[.02em] text-ink [font-feature-settings:'palt']">{{ gap }}</p>
        <p class="mt-[3px] line-clamp-3 text-sm leading-[1.7] text-ink-soft">{{ pair.reason }}</p>
      </div>
    </div>
    <!-- 前の日（一筆箋） -->
    <div class="note z-[1] pt-3 pr-5 pb-3.5">
      <p class="text-sm leading-[1.6] tracking-[.02em] text-ink-soft">{{ lowerDate }}のひとこと</p>
      <p class="letter-text mt-1 text-ink" :class="clampOf(sides.lower)">
        <template v-for="(part, i) in lowerParts" :key="i">
          <mark v-if="part.hit">{{ part.text }}</mark>
          <template v-else>{{ part.text }}</template>
        </template>
      </p>
    </div>
    <!-- 足: 確かめた糸だけ左に判（二重の輪と ✓。S3 の「✓ そう」と同じ形）、右に「ひらく ›」 -->
    <div class="mt-1 flex min-h-11 items-center pl-1">
      <span
        v-if="pair.feedback === 'helpful'"
        class="inline-flex h-8 items-center gap-[3px] rounded-pill border border-moss-deep bg-moss-soft pr-[13px] pl-[11px] text-sm leading-none tracking-[.06em] text-ink shadow-stamp [font-feature-settings:'palt']"
        data-stamp="helpful"
      >
        <svg
          class="shrink-0"
          width="13"
          height="13"
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          stroke-width="1.9"
          stroke-linecap="round"
          stroke-linejoin="round"
          aria-hidden="true"
          focusable="false"
        >
          <path d="M3.2 8.6 6.4 11.6 12.8 4.6" />
        </svg>
        <span class="sr-only">✓ </span><span>そうだった</span>
      </span>
      <button
        type="button"
        class="ml-auto flex min-h-11 items-center pr-0.5 pl-3 text-sm tracking-[.06em] text-ink-soft after:absolute after:inset-0 after:z-[3] after:rounded-card focus-visible:outline-none"
        aria-haspopup="dialog"
        :aria-controls="sheetId"
        :aria-label="`ひらく、${upperDate}と${lowerDate}のつながり`"
        @click="emit('open', pair.id)"
      >ひらく ›</button>
    </div>
  </article>
</template>
