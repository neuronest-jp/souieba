<script setup lang="ts">
// あの日のひとこと（ブラッシュアップ 11/7）。去年以前の同じ日付のあたりの記憶を、書く画面の下に折りたたんだ便箋で 1 つだけ出す。
// 上は便箋（見出しと起きた日、ひとことの 1 行目を明朝で 1 行）、折り目から下は折り返した裏に「ひらく ›」。全体が S3（from=today）へのリンク。
// 無い日は呼ぶ側が出さない（何も言わない。原則 2）。どれを出すかは Worker が決め、その日のうちは変わらない（routes/today.ts）
import type { ThatDay } from "../../api/types";
import { hrefFor } from "../../composables/useScreen";
import { firstLine, formatHappenedOn } from "../../date";
import { thatDayLabel } from "./prompts";

// animate: 現れる動き（.appear）。S1 に戻ってきたとき、もう見せた便箋は動かさない
defineProps<{ thatDay: ThatDay; animate?: boolean }>();
</script>

<template>
  <a :href="hrefFor({ name: 'memory', id: thatDay.memory.id, from: 'today' })" class="that-day press" :class="animate ? 'appear' : ''">
    <span class="block px-5 pt-4 pb-3">
      <span class="flex flex-wrap items-baseline justify-between gap-x-3">
        <span class="font-display text-[15px] font-bold tracking-[.06em] text-ink [font-feature-settings:'palt']">{{ thatDayLabel(thatDay) }}</span>
        <span class="text-sm leading-[1.6] tracking-[.04em] text-ink-soft">{{ formatHappenedOn(thatDay.memory.happened_on, thatDay.memory.happened_on_precision) }}</span>
      </span>
      <span class="letter-text mt-2 line-clamp-1 text-ink">{{ firstLine(thatDay.memory.body) }}</span>
    </span>
    <span class="that-day-fold flex min-h-11 items-center justify-end px-5 text-sm tracking-[.06em] text-ink-soft">ひらく ›</span>
  </a>
</template>
