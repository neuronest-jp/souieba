<script setup lang="ts">
// 「そういえば。」の札（wireframes 2.4）。見出し、昔の記憶の日付、逐語引用、なぜ関係があるか、開く の 5 つだけ。
// 昔の記憶の 1 行目は出さない（本文が 1 行だと引用と同じ文が二度並ぶ。全文は開いて読む）。
// 「ひらく ›」の ::after を札いっぱいに広げ、札のどこを押しても開く（タップ領域は札全体。押すと札ごと沈む .press）。
// 見た目は封蝋の付いた一筆箋（ADR-0010）: 左に朱の二重罫、右上に封蝋、引用は罫の上の明朝。
// S1 の札（見出しあり）にだけ、左下に押し葉を置く（昔の記憶から届いたもの）。
// 「関係ないかも」と返した札は、RecalledByCard と同じく地の色の紙（.note-quiet）に退き、封蝋と押し葉を外す（見直し n=6）。
// 見出しと「ひらく ›」は残す（札は薄くなるが残る。F6-2）
// 届いたとき（animate）は一筆箋がすべり込み、少し遅れて封蝋が押される（style.css の .note.appear）。押される瞬間に arrive の触覚
import { computed, onMounted, onUnmounted } from "vue";
import type { Recall } from "../api/types";
import { hrefFor, type From } from "../composables/useScreen";
import { formatHappenedOn } from "../date";
import { arriveSoon, cancelArrive } from "../motion";
import Leaf from "./motifs/Leaf.vue";
import Seal from "./motifs/Seal.vue";

// animate: 現れる動き（.appear と封蝋の押される動き）と届いたときの触覚を付けるか。S1 に戻ってきたとき、もう見せた札は動かさない
const props = withDefaults(defineProps<{ recall: Recall; from: From; heading?: boolean; animate?: boolean }>(), {
  heading: true,
  animate: true,
});
const quiet = computed(() => props.recall.feedback === "not_related");

const owner = Symbol("recall");
onMounted(() => {
  if (props.animate && !quiet.value) arriveSoon(owner);
});
onUnmounted(() => cancelArrive(owner));
</script>

<template>
  <article class="note press" :class="[animate ? 'appear' : '', quiet ? 'note-quiet' : '']">
    <Seal v-if="!quiet" class="absolute -top-[9px] right-4 drop-shadow-wax" />
    <h2 v-if="heading" class="font-display text-[22px] font-bold tracking-[.06em] text-ember-ink [font-feature-settings:'palt']">そういえば。</h2>
    <p class="text-sm leading-[1.6] text-ink-soft" :class="heading ? 'mt-1' : ''">
      {{ formatHappenedOn(recall.related_memory.happened_on, recall.related_memory.happened_on_precision) }}のひとこと
    </p>
    <!-- 引用は始めのかぎ括弧をぶら下げ、2 行目以降の頭をそろえる。長いときは 3 行で切る -->
    <p class="letter-text mt-2.5 line-clamp-3 -indent-[1em] pl-[1em] text-ink">「{{ recall.evidence }}」</p>
    <p class="mt-2.5 text-sm leading-[1.7] text-ink-soft">{{ recall.reason }}</p>
    <!-- 退いた札でも「ひらく ›」の位置は動かさない（justify-between のまま押し葉だけ外す） -->
    <div class="mt-0.5 flex items-center" :class="heading ? 'justify-between' : 'justify-end'">
      <Leaf v-if="heading && !quiet" class="-ml-1 mb-0.5 shrink-0" />
      <span v-else-if="heading" aria-hidden="true"></span>
      <a
        :href="hrefFor({ name: 'memory', id: recall.related_memory.id, from, recall: recall.id })"
        class="flex min-h-11 items-center text-sm tracking-[.06em] text-ink-soft after:absolute after:inset-0 after:rounded-note"
      >ひらく ›</a>
    </div>
  </article>
</template>
