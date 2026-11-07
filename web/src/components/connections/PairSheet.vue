<script setup lang="ts">
// つながりの一組をひらいたとき（S5 のシート。wireframes 9 節）。DateSheet と同じ、下からのシート（div の role="dialog"、aria-modal）。
// 上から 見出し「そういえば。」（と封蝋を 1 つ）/ 新しい紙片（全文と「ひらく ›」）/ 大きめの結び（隔たりと 17px の理由）/
// 昔の紙片（全文と印、「ひらく ›」）/「そうだった」「関係ないかも」/「とじる」。
// シートの地は机と同じ紙（bg-paper）にして、便箋と一筆箋が一覧と同じ紙として見えるようにする（便箋の地 card の上に便箋を置かない）。
// 開いたら見出しにフォーカスを置く。閉じ方は「とじる」・地を押す・Esc の 3 つで、どれも close を出すだけ（閉じる動きと
// フォーカスを返すのは ConnectionsScreen）。反応の記録も親が持つ（RecalledByCard と同じ）。
// 「関係ないかも」にした組は、一筆箋を地の紙に退かせ（.note-quiet）、封蝋を外し、糸をほどく（色だけでなく形で）
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from "vue";
import { markEvidence } from "../../connections/excerpt";
import { gapOf, newDateOf, oldDateOf, stitchOf, type Pair } from "../../connections/pair";
import { hrefFor } from "../../composables/useScreen";
import Seal from "../motifs/Seal.vue";
import Stitch from "./Stitch.vue";

const props = withDefaults(
  defineProps<{ pair: Pair; swing: 0 | 1; sheetId: string; notice?: string; opening?: boolean; closing?: boolean }>(),
  { notice: "", opening: false, closing: false },
);
const emit = defineEmits<{ react: [feedback: "helpful" | "not_related"]; close: [] }>();

const titleId = computed(() => `${props.sheetId}-title`);
const gapId = computed(() => `${props.sheetId}-gap`);
const newDate = computed(() => newDateOf(props.pair));
const oldDate = computed(() => oldDateOf(props.pair));
const gap = computed(() => gapOf(props.pair));
const oldParts = computed(() => markEvidence(props.pair.related_memory.body, props.pair.evidence));
const newHref = computed(() => hrefFor({ name: "memory", id: props.pair.memory.id, from: "connections" }));
// 昔の側は札から開いた S3 と同じ形（4.2）。その札が本文のすぐ下に反応ボタン付きで出る
const oldHref = computed(() => hrefFor({ name: "memory", id: props.pair.related_memory.id, from: "connections", recall: props.pair.id }));

// 後ろの画面は ConnectionsScreen が inert にする。シートは body の直下に出す（inert の外）。
// 文字列の "body" ではなく要素を渡す（テストの最小の DOM は querySelector を持たない）
const target = document.body;

const heading = ref<HTMLElement | null>(null);
// 「そうだった」にしたとき、しつけ糸を実線で縫い直す（640ms）。動きを減らす設定では style.css が止める
const tying = ref(false);
let tyingTimer: ReturnType<typeof setTimeout> | null = null;
watch(
  () => props.pair.feedback,
  (now, before) => {
    if (now !== "helpful" || before === "helpful") return;
    tying.value = false;
    void nextTick(() => {
      tying.value = true;
      if (tyingTimer) clearTimeout(tyingTimer);
      tyingTimer = setTimeout(() => (tying.value = false), 700);
    });
  },
);

const onKey = (e: KeyboardEvent) => {
  if (e.key === "Escape") emit("close");
};
onMounted(() => {
  window.addEventListener("keydown", onKey);
  void nextTick(() => heading.value?.focus({ preventScroll: true }));
});
onUnmounted(() => {
  window.removeEventListener("keydown", onKey);
  if (tyingTimer) clearTimeout(tyingTimer);
});
</script>

<template>
  <Teleport :to="target">
    <div
      class="sheet-scrim fixed inset-0 z-20 flex items-end justify-center bg-ink/30"
      :class="{ 'is-opening': opening, 'is-closing': closing }"
      @click.self="emit('close')"
    >
      <div
        :id="sheetId"
        class="sheet-panel tex-desk max-h-[calc(100dvh-env(safe-area-inset-top)-24px)] w-full max-w-[560px] overflow-y-auto overscroll-contain rounded-t-[20px] bg-paper px-5 pt-5 pb-[max(20px,env(safe-area-inset-bottom))] shadow-card"
        role="dialog"
        aria-modal="true"
        :aria-labelledby="gap ? `${titleId} ${gapId}` : titleId"
      >
        <div class="mx-auto -mt-2 mb-3 h-1 w-10 rounded-full bg-line" aria-hidden="true"></div>
        <div class="flex items-start justify-between gap-3">
          <h2
            :id="titleId"
            ref="heading"
            tabindex="-1"
            class="font-display text-[22px] font-bold tracking-[.06em] text-ember-ink [font-feature-settings:'palt'] focus:outline-none"
          >そういえば。</h2>
          <!-- 封蝋はシートの見出しに 1 つだけ（一覧の組には付けない）。「関係ないかも」にしたら外す -->
          <Seal v-if="pair.feedback !== 'not_related'" class="-mt-0.5 mr-1 shrink-0 drop-shadow-wax" />
        </div>

        <div class="mt-3.5">
          <!-- 新しい日: 書いたひとこと（便箋、全文） -->
          <section class="card relative z-[1] px-5 pt-3.5 pb-0.5" :aria-labelledby="`${sheetId}-new`">
            <p :id="`${sheetId}-new`" class="text-sm leading-[1.6] tracking-[.02em] text-ink-soft">{{ newDate }}のひとこと</p>
            <p class="letter-text mt-1 whitespace-pre-wrap text-ink">{{ pair.memory.body }}</p>
            <div class="flex justify-end">
              <a :href="newHref" class="-mr-1 flex min-h-11 items-center px-1 text-sm tracking-[.06em] text-ink-soft" :aria-label="`${newDate}のひとことをひらく`">ひらく ›</a>
            </div>
          </section>
          <!-- 大きめの結び: 理由が主役なので 17px -->
          <div class="relative grid min-h-32 grid-cols-[56px_1fr] pt-[18px] pr-0.5 pb-5" :class="tying ? 'tying' : ''">
            <Stitch :stitch="stitchOf(pair.feedback)" :swing="swing" />
            <div class="col-start-2 min-w-0 self-center">
              <p v-if="gap" :id="gapId" class="font-display text-[17px] leading-[1.5] font-bold tracking-[.02em] text-ink [font-feature-settings:'palt']">{{ gap }}</p>
              <p class="mt-1 text-[17px] leading-[1.8] text-ink-soft">{{ pair.reason }}</p>
            </div>
          </div>
          <!-- 昔の日: 思い出したひとこと（一筆箋、全文と印） -->
          <section class="note z-[1] pt-3.5 pr-5 pb-0.5" :class="pair.feedback === 'not_related' ? 'note-quiet' : ''" :aria-labelledby="`${sheetId}-old`">
            <p :id="`${sheetId}-old`" class="text-sm leading-[1.6] tracking-[.02em] text-ink-soft">{{ oldDate }}のひとこと</p>
            <p class="letter-text mt-1 whitespace-pre-wrap text-ink">
              <template v-for="(part, i) in oldParts" :key="i">
                <mark v-if="part.hit">{{ part.text }}</mark>
                <template v-else>{{ part.text }}</template>
              </template>
            </p>
            <div class="flex justify-end">
              <a :href="oldHref" class="-mr-1 flex min-h-11 items-center px-1 text-sm tracking-[.06em] text-ink-soft" :aria-label="`${oldDate}のひとことをひらく`">ひらく ›</a>
            </div>
          </section>
        </div>

        <!-- 反応（S3 の札と同じ。見た目は 40px、押せる所は ::after で 48px）。同じボタンをもう一度押すと取り消し -->
        <div class="mt-5 flex flex-wrap gap-2">
          <button
            type="button"
            class="choice h-10 px-4"
            :class="pair.feedback === 'helpful' ? 'border-moss-deep bg-moss-soft shadow-stamp' : ''"
            :aria-pressed="pair.feedback === 'helpful'"
            @click="emit('react', 'helpful')"
          >そうだった</button>
          <button
            type="button"
            class="choice h-10 px-4 text-ink-soft"
            :class="pair.feedback === 'not_related' ? 'border-ink-soft bg-paper shadow-none' : ''"
            :aria-pressed="pair.feedback === 'not_related'"
            @click="emit('react', 'not_related')"
          >関係ないかも</button>
        </div>
        <p v-if="notice" class="mt-2 text-sm text-ink-soft" role="status" aria-live="polite">{{ notice }}</p>
        <div class="mt-2 flex justify-center">
          <button type="button" class="min-h-11 px-6 text-ink-soft" @click="emit('close')">とじる</button>
        </div>
      </div>
    </div>
  </Teleport>
</template>
