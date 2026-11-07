<script setup lang="ts">
// 候補の行（wireframes 2.3）。種別 + 値 + 根拠、「そう」「ちがう」。確定は moss の判と「✓ そう」、却下は値に打ち消し線を引き、
// 読み上げ用の「ちがう」を添えて残す。
// 見た目は「便箋と押し葉」（ADR-0010）: 候補は鉛筆書き（値に点線の下線、行の区切りも点線）、根拠は罫の上の言葉と同じ明朝、
// 確かめたものは二重の輪の判と実線の区切りにする（色だけでなく形で分ける）。
// variant: slip は S1 の記憶カードのミシン目から下の控え（見出しの前に鉛筆）、page は S3 の地の上（見出しの下に天の二重罫）
import { nextTick, ref } from "vue";
import { api } from "../api";
import { useNotice } from "../composables/useNotice";
import type { Fact } from "../api/types";
import { formatFactDate } from "../date";

// fallback: 行も見出しも無くなったときのフォーカスの置き先（S3 で最後の候補を却下したときの、起きた日の h1）
const props = withDefaults(defineProps<{ facts: Fact[]; title?: string; fallback?: HTMLElement | null; variant?: "slip" | "page" }>(), {
  title: undefined,
  fallback: null,
  variant: "slip",
});
const emit = defineEmits<{ decided: [fact: Fact] }>();

const KIND_LABEL = { person: "人", place: "場所", date: "日", thing: "もの" } as const;
const busy = ref<Set<string>>(new Set());
const notice = useNotice();

const display = (f: Fact) => (f.kind === "date" ? formatFactDate(f.value) : f.value);
const showEvidence = (f: Fact) => f.evidence && f.evidence !== f.value && !f.evidence.startsWith("photo:");

const root = ref<HTMLElement | null>(null);
const heading = ref<HTMLElement | null>(null);
// 選んだ結果の読み上げ（記録できたとき）。行ではなく section に常に置く（S3 の却下では行ごと消え、
// 最後の候補なら見出しも消えるため。section は facts が 0 件になっても外さない）
const announce = ref("");

// 行と見出しは、ここでフォーカスを置くあいだだけ tabindex="-1" にする。最初から付けておくと、
// 指やマウスで行の文字に触れただけで行にフォーカスが入り、S1 では記憶カードの :focus-within の縁が光る
const placeFocus = (el: HTMLElement) => {
  el.setAttribute("tabindex", "-1");
  el.addEventListener("blur", () => el.removeAttribute("tabindex"), { once: true });
  el.focus({ preventScroll: true });
};

// 押した「そう」「ちがう」は消えるので、フォーカスを行に置き直す（wireframes 6 節）。S3 で却下した行は消えるので、
// 同じ位置の行 → ひとつ前の行 → 見出し → （見出しごと消えたら）fallback の順に探す。フォーカスが落ちたか、
// 前にここで置いたままのときだけ動かし、利用者がほかへ移したフォーカスは奪わない。置いた先を返す
const refocus = async (id: string, index: number, placed: Element | null = null) => {
  await nextTick();
  const active = document.activeElement;
  if (active && active !== document.body && active !== placed) return null;
  const rows = Array.from(root.value?.querySelectorAll<HTMLElement>("li[data-fact-id]") ?? []);
  const target =
    rows.find((el) => el.dataset.factId === id) ?? rows[index] ?? rows[index - 1] ?? heading.value ?? props.fallback ?? null;
  if (target) placeFocus(target);
  return target ?? null;
};

const decide = async (f: Fact, status: "confirmed" | "rejected", e: MouseEvent) => {
  if (busy.value.has(f.id)) return;
  busy.value.add(f.id);
  // フォーカスを動かすのは、キーボード（Enter / Space）や読み上げソフトで押したとき（click の detail が 0）だけ。
  // 指やマウスで押したときまで行にフォーカスを置くと、S1 では記憶カードの :focus-within の縁が光ったまま残る
  const byKeys = e.detail === 0;
  const index = props.facts.findIndex((x) => x.id === f.id); // S3 の却下では、次の描画でこの行が消える
  const prev = f.status;
  f.status = status; // 楽観更新
  const placing = byKeys ? refocus(f.id, index) : Promise.resolve(null);
  try {
    await api.decideFact(f.id, status);
    emit("decided", f);
    announce.value = `${display(f)}、${status === "confirmed" ? "そう" : "ちがう"}`;
  } catch {
    f.status = prev; // 表示を戻し、その行の下にそっと知らせる（F4 エラー時）
    notice.show("記録できませんでした", f.id);
    // 戻した行にボタンが作り直されるので、置いたフォーカスをその行へ戻す（S3 の却下で消えた行もここで戻る）
    const placed = await placing;
    if (placed) void refocus(f.id, index, placed);
  } finally {
    busy.value.delete(f.id);
  }
};
</script>

<template>
  <!-- 0 件になっても section は外さない（S3 で最後の候補を却下したとき、読み上げと、記録に失敗して戻した行の知らせを
       同じ部品に残すため）。見出しと一覧は 0 件なら出さず（wireframes 4.1）、section は sr-only にして余白も残さない -->
  <section ref="root" :class="{ 'sr-only': facts.length === 0 }">
    <template v-if="facts.length > 0">
      <h2
        ref="heading"
        class="flex items-center gap-1.5 font-body text-sm leading-[1.6] font-medium tracking-[.06em] text-ink-soft [font-feature-settings:'palt']"
        :class="variant === 'page' ? 'rule-double pb-2' : ''"
      >
        <!-- 鉛筆の線画: ここに並ぶのは鉛筆書き（まだ候補）だという印。S1 の控えにだけ置く -->
        <svg
          v-if="variant === 'slip'"
          class="shrink-0"
          width="15"
          height="15"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="1.75"
          stroke-linecap="round"
          stroke-linejoin="round"
          aria-hidden="true"
          focusable="false"
        >
          <path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16v4Z" />
          <path d="M13.5 6.5l4 4" />
        </svg>
        <!-- 見出しの文字は span に入れ、前後に空白を混ぜない（見出しの文字をそのまま比べるテストがある） -->
        <span>{{ title ?? "ひとことに出てきたもの" }}</span>
      </h2>
      <ul class="flex flex-col" :class="variant === 'page' ? '' : 'mt-1'">
        <!-- 行の区切り: 候補は点線（鉛筆書き）、確かめた行と却下した行は実線 -->
        <li
          v-for="f in facts"
          :key="f.id"
          :data-fact-id="f.id"
          class="flex min-h-11 flex-wrap items-center gap-x-3 gap-y-0.5 border-b border-line last:border-b-0"
          :class="[f.status === 'candidate' ? 'border-dashed' : 'border-solid', variant === 'page' ? 'py-2' : 'py-2.5']"
        >
          <!-- 種別と値はひとまとまりで行を折り返す単位にする。値と根拠が入りきらない幅（375px の S1 など）では、
               値の列を狭めて単語の途中で割らず、ボタンを次の段の右端に回す（wireframes 2.3）。
               値だけを折り返しの単位にすると、長い根拠のとき種別だけが 1 段目に取り残される。
               まとまりと値の列の両方に min-w-0 を付ける。flex の子は既定の min-width: auto のままだと、html の
               overflow-wrap: break-word の折り返し位置が min-content に数えられず、URL のような空白の無い長い英数字の幅より
               細くならない（375px で横にはみ出す）。日本語や短い語の行は、付ける前と同じ位置で折り返す -->
          <span class="flex min-w-0 flex-auto items-baseline gap-x-3">
            <span class="w-8 shrink-0 text-sm tracking-[.04em] text-ink-soft [font-feature-settings:'palt']">{{ KIND_LABEL[f.kind] }}</span>
            <span class="min-w-0 flex-1 leading-[1.6] text-ink">
              <!-- 候補の値は鉛筆でなぞったような点線の下線（色だけでなく線の形で「決まっていない」を示す） -->
              <span
                v-if="f.status === 'candidate' && !showEvidence(f) && f.kind !== 'date'"
                class="underline decoration-ink-faint decoration-dotted decoration-[1.5px] underline-offset-[5px]"
              >「{{ display(f) }}」</span>
              <!-- 却下した値は打ち消し線と ink-soft で示す。opacity で薄くすると文字が 4.5:1 を割る。根拠の引用には線を引かない。
                   打ち消し線は読み上げでは伝わらないので、確定の「✓ そう」と同じく行を読めば分かるよう、見えない「、ちがう」を添える -->
              <span v-else-if="f.status === 'rejected'"><span class="text-ink-soft line-through">{{ display(f) }}</span><span class="sr-only">、ちがう</span></span>
              <span
                v-else-if="f.status === 'candidate'"
                class="underline decoration-ink-faint decoration-dotted decoration-[1.5px] underline-offset-[5px]"
              >{{ display(f) }}</span>
              <template v-else>{{ display(f) }}</template>
              <!-- 根拠は原文なので、罫の上の言葉と同じ明朝で。始めのかぎ括弧をぶら下げ、2 行目以降の頭をそろえる -->
              <span
                v-if="showEvidence(f)"
                class="mt-0.5 block -indent-[1em] pl-[1em] font-letter text-[15px] leading-[1.6] font-semibold text-ink-soft"
              >「{{ f.evidence }}」</span>
            </span>
          </span>
          <!-- 確定の印もボタンと同じ右端に置く（押した瞬間に左へ跳ねない） -->
          <span v-if="f.status === 'candidate'" class="ml-auto flex gap-2">
            <button type="button" class="choice" :disabled="busy.has(f.id)" @click="decide(f, 'confirmed', $event)">そう</button>
            <button type="button" class="choice text-ink-soft" :disabled="busy.has(f.id)" @click="decide(f, 'rejected', $event)">ちがう</button>
          </span>
          <!-- 確かめたものには判: moss-deep の縁の内側に二重の輪（shadow-stamp）と ✓ の線画。読み上げは「✓ そう」のまま -->
          <span
            v-else-if="f.status === 'confirmed'"
            class="ml-auto inline-flex h-8 items-center gap-[3px] rounded-pill border border-moss-deep bg-moss-soft pr-[13px] pl-[11px] text-sm leading-none tracking-[.06em] text-ink shadow-stamp [font-feature-settings:'palt']"
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
            <span class="sr-only">✓ </span><span>そう</span>
          </span>
          <p v-if="notice.key.value === f.id" class="w-full text-sm text-ink-soft" role="status" aria-live="polite">{{ notice.message.value }}</p>
        </li>
      </ul>
    </template>
    <p class="sr-only" role="status" aria-live="polite">{{ announce }}</p>
  </section>
</template>
