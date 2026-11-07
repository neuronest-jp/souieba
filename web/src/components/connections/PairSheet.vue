<script setup lang="ts">
// つながりの一組をひらいたとき（S5 のシート。wireframes 9 節）。DateSheet と同じ、下からのシート（div の role="dialog"、aria-modal）。
// 上から 見出し「そういえば。」（と封蝋を 1 つ）/ 後の日の紙片（全文と「ひらく ›」）/ 大きめの結び（隔たりと 17px の理由）/
// 前の日の紙片（全文と「ひらく ›」）/「そうだった」「関係ないかも」/「とじる」。上下は起きた日の順（pair.ts の sidesOf）で、
// 思い出した一文の印と、S3 を札の形（?recall=）で開くリンクは、思い出された側（上下どちらでも）に付ける。
// シートの地は机と同じ紙（bg-paper）にして、便箋と一筆箋が一覧と同じ紙として見えるようにする（便箋の地 card の上に便箋を置かない）。
// 手ざわりは useSheetDrag（motion の受け持ち。DateSheet・S3 の「消しますか」と同じ）: 紙はばねで上がり、下へなぞる・地を押す・Esc・「とじる」で
// 下がり始めに closing、下がってから close を出す。開いている間は後ろの一覧をスクロールさせない（見直し n=11。中身がスクロールするときはパネルだけ動く）。
// 開いたら見出しにフォーカスを置く。フォーカスを返すのと反応の記録は親（ConnectionsScreen）が持つ（RecalledByCard と同じ）。
// 「関係ないかも」にした組は、一筆箋を地の紙に退かせ（.note-quiet）、封蝋を外し、糸をほどく（色だけでなく形で）。
// 「そうだった」にしたら、しつけ糸を上から一針ずつ本縫いに縫い直し、下の結び目が留まる（.is-tying。触覚の stamp は親が押した直後に鳴らす）
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from "vue";
import { useSheetDrag } from "../../composables/useSheetDrag";
import { markEvidence, type ExcerptPart } from "../../connections/excerpt";
import { dateOf, gapOf, sidesOf, stitchOf, type Pair, type Side } from "../../connections/pair";
import { hrefFor } from "../../composables/useScreen";
import { prefersMotion } from "../../motion";
import Seal from "../motifs/Seal.vue";
import Stitch from "./Stitch.vue";

const props = withDefaults(defineProps<{ pair: Pair; swing: 0 | 1; sheetId: string; notice?: string }>(), { notice: "" });
// closing: 紙が下がり始めたとき（下へなぞって離した・地・Esc・「とじる」のどれでも）。close: 下がりきったとき
const emit = defineEmits<{ react: [feedback: "helpful" | "not_related"]; closing: []; close: [] }>();

const OPEN_MS = 1100; // 紙が上がり（460ms）、糸が一針ずつ渡され、結び目が留まるまで
const TIE_MS = 760; // 8 針（55ms ずつ）+ 下の結び目が留まるまで

const titleId = computed(() => `${props.sheetId}-title`);
const gapId = computed(() => `${props.sheetId}-gap`);
const sides = computed(() => sidesOf(props.pair));
const upperDate = computed(() => dateOf(sides.value.upper));
const lowerDate = computed(() => dateOf(sides.value.lower));
const gap = computed(() => gapOf(props.pair));
const partsOf = (side: Side): ExcerptPart[] =>
  side.recalled ? markEvidence(side.memory.body, props.pair.evidence) : [{ text: side.memory.body, hit: false }];
const upperParts = computed(() => partsOf(sides.value.upper));
const lowerParts = computed(() => partsOf(sides.value.lower));
// 思い出された側は札から開いた S3 と同じ形（4.2）。その札が本文のすぐ下に反応ボタン付きで出る
const hrefOf = (side: Side) =>
  hrefFor({ name: "memory", id: side.memory.id, from: "connections", ...(side.recalled ? { recall: props.pair.id } : {}) });

// 後ろの画面は ConnectionsScreen が inert にする。シートは body の直下に出す（inert の外）。
// 文字列の "body" ではなく要素を渡す（テストの最小の DOM は querySelector を持たない）
const target = document.body;

const { panel, backdrop, close, closing } = useSheetDrag({ onClose: () => emit("close") });
// 下がっていく途中のシートは、親が閉じたものとして扱う（その間に返った記録の失敗を組の足に残すため。見直し 4 回目）。
// なぞって離したときは useSheetDrag の中で閉じ始めるので、close を包まずに closing を見る。
// sync: 閉じ始めたその場で知らせる（後回しにすると、動きを減らす設定では close のあとに届き、順が入れ替わる）
watch(
  closing,
  (now) => {
    if (now) emit("closing");
  },
  { flush: "sync" },
);

const heading = ref<HTMLElement | null>(null);
const timers = new Set<ReturnType<typeof setTimeout>>();
const later = (fn: () => void, ms: number) => {
  const t = setTimeout(() => {
    timers.delete(t);
    fn();
  }, ms);
  timers.add(t);
};
// 開いたとき、紙が上がるのに合わせて糸を渡す（動きを減らす設定では付けない）
const opening = ref(false);
// 「そうだった」にしたとき、しつけ糸を本縫いに縫い直す
const tying = ref(false);
watch(
  () => props.pair.feedback,
  (now, before) => {
    if (now !== "helpful" || before === "helpful" || !prefersMotion()) return;
    tying.value = false;
    void nextTick(() => {
      tying.value = true;
      later(() => (tying.value = false), TIE_MS);
    });
  },
);

const onKey = (e: KeyboardEvent) => {
  if (e.key === "Escape") close();
};
onMounted(() => {
  window.addEventListener("keydown", onKey);
  if (prefersMotion()) {
    opening.value = true;
    later(() => (opening.value = false), OPEN_MS);
  }
  void nextTick(() => heading.value?.focus({ preventScroll: true }));
});
onUnmounted(() => {
  window.removeEventListener("keydown", onKey);
  timers.forEach((t) => clearTimeout(t));
  timers.clear();
});
</script>

<template>
  <Teleport :to="target">
    <div class="pair-sheet fixed inset-0 z-20 flex items-end justify-center" :class="{ 'is-opening': opening }">
      <div ref="backdrop" class="sheet-backdrop absolute inset-0 bg-ink/30" aria-hidden="true" @click="close"></div>
      <div
        :id="sheetId"
        ref="panel"
        class="sheet-paper pair-panel tex-desk relative max-h-[calc(100dvh-env(safe-area-inset-top)-24px)] w-full max-w-[560px] overflow-y-auto overscroll-contain rounded-t-[20px] bg-paper px-5 pt-5 pb-[max(20px,env(safe-area-inset-bottom))]"
        role="dialog"
        aria-modal="true"
        :aria-labelledby="gap ? `${titleId} ${gapId}` : titleId"
        data-sheet-scroll
      >
        <div class="sheet-grip" aria-hidden="true"></div>
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
          <!-- 後の日（便箋、全文） -->
          <section class="card relative z-[1] px-5 pt-3.5 pb-0.5" :aria-labelledby="`${sheetId}-upper`">
            <p :id="`${sheetId}-upper`" class="text-sm leading-[1.6] tracking-[.02em] text-ink-soft">{{ upperDate }}のひとこと</p>
            <p class="letter-text mt-1 whitespace-pre-wrap text-ink">
              <template v-for="(part, i) in upperParts" :key="i">
                <template v-if="part.hit"><span class="sr-only">「</span><mark class="quote-mark">{{ part.text }}</mark><span class="sr-only">」</span></template>
                <template v-else>{{ part.text }}</template>
              </template>
            </p>
            <div class="flex justify-end">
              <a :href="hrefOf(sides.upper)" class="-mr-1 flex min-h-11 items-center px-1 text-sm tracking-[.06em] text-ink-soft" :aria-label="`${upperDate}のひとことをひらく`">ひらく ›</a>
            </div>
          </section>
          <!-- 大きめの結び: 理由が主役なので 17px -->
          <div class="relative grid min-h-32 grid-cols-[56px_1fr] pt-[18px] pr-0.5 pb-5" :class="tying ? 'is-tying' : ''">
            <Stitch :stitch="stitchOf(pair.feedback)" :swing="swing" />
            <div class="col-start-2 min-w-0 self-center">
              <p v-if="gap" :id="gapId" class="font-display text-[17px] leading-[1.5] font-bold tracking-[.02em] text-ink [font-feature-settings:'palt']">{{ gap }}</p>
              <p class="mt-1 text-[17px] leading-[1.8] text-ink-soft">{{ pair.reason }}</p>
            </div>
          </div>
          <!-- 前の日（一筆箋、全文） -->
          <section class="note z-[1] pt-3.5 pr-5 pb-0.5" :class="pair.feedback === 'not_related' ? 'note-quiet' : ''" :aria-labelledby="`${sheetId}-lower`">
            <p :id="`${sheetId}-lower`" class="text-sm leading-[1.6] tracking-[.02em] text-ink-soft">{{ lowerDate }}のひとこと</p>
            <p class="letter-text mt-1 whitespace-pre-wrap text-ink">
              <template v-for="(part, i) in lowerParts" :key="i">
                <template v-if="part.hit"><span class="sr-only">「</span><mark class="quote-mark">{{ part.text }}</mark><span class="sr-only">」</span></template>
                <template v-else>{{ part.text }}</template>
              </template>
            </p>
            <div class="flex justify-end">
              <a :href="hrefOf(sides.lower)" class="-mr-1 flex min-h-11 items-center px-1 text-sm tracking-[.06em] text-ink-soft" :aria-label="`${lowerDate}のひとことをひらく`">ひらく ›</a>
            </div>
          </section>
        </div>

        <!-- 反応（S3 の札と同じ。見た目は 40px、押せる所は ::after で 48px）。同じボタンをもう一度押すと取り消し。
             押すと沈み（style.css の .choice:active）、「そうだった」は判を押したように少し弾んで留まる（.is-stamped） -->
        <div class="mt-5 flex flex-wrap gap-2">
          <button
            type="button"
            class="choice h-10 px-4"
            :class="[pair.feedback === 'helpful' ? 'border-moss-deep bg-moss-soft shadow-stamp' : '', tying ? 'is-stamped' : '']"
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
        <!-- 記録に失敗したときの知らせ。読み上げが確実に拾うよう、初めから置いて文字だけ入れ替える -->
        <p class="text-sm text-ink-soft" :class="notice ? 'mt-2' : ''" role="status" aria-live="polite">{{ notice }}</p>
        <div class="mt-2 flex justify-center">
          <button type="button" class="press min-h-11 px-6 text-ink-soft" @click="close">とじる</button>
        </div>
      </div>
    </div>
  </Teleport>
</template>
