<script setup lang="ts">
// S5 つながり（「ふたつの日」。ADR-0009、wireframes 9 節）。「そういえば。」の札の両端（書いたひとことと、そのとき浮かんだひとこと）を一組にし、
// 札の新しい順に並べる。組の中の上下は起きた日の順（上 = 後の日）。
// 上端の糸の帯（ThreadLoom）で、いつといつが結ばれたかを一目で見せる（読み上げは下の一覧が受け持つ）。帯の弧を押すと、その組へ一覧が動いて組がほのかに光る。
// 一組を押すとシート（PairSheet）が開き、そこで「そうだった」「関係ないかも」を返せる（S3 の札と同じ PATCH /api/recalls/:id）。
// App.vue の KeepAlive で残すので、S3 を開いて戻っても位置はそのまま。戻ったときは裏で取り直して入れ替え、新しく結ばれた組だけを現す。
// 組が順に現れて糸が渡されるのは、最初に読み込んだときと、戻ったときの新しい組だけ（prefers-reduced-motion ではすべて止める）
import { computed, nextTick, onActivated, onDeactivated, onMounted, onUnmounted, ref } from "vue";
import { api } from "../api";
import type { Bead, ConnectionsResponse } from "../api/types";
import PairCard from "../components/connections/PairCard.vue";
import PairSheet from "../components/connections/PairSheet.vue";
import ThreadLoom from "../components/connections/ThreadLoom.vue";
import { useMemoryDeleted } from "../composables/useMemoryDeleted";
import { useNotice } from "../composables/useNotice";
import { focusHeading } from "../composables/useScreen";
import type { Pair } from "../connections/pair";
import { failed, select, stamp, tap } from "../haptics";
import { DURATION, prefersMotion } from "../motion";

defineOptions({ name: "ConnectionsScreen" }); // KeepAlive の include で使う

const SHEET_ID = "connection-sheet";
// 待つ時間は connections.css の動きと合わせる（トークン quick 160 / base 280 / slow 460ms）
const WEAVE_MS = 1900; // 組と帯の弧が入ってくる動きがすべて終わるまで（6 組目の遅れ 350 + 紙 460 + 一針ずつ 200 + 8 × 45 + 160、帯 120 + 10 × 70 + 460 + 結び目 480 に余裕）
const LEAVE_MS = DURATION.base + 20; // 「関係ないかも」の組が薄れて抜ける動き（280ms）
const GLOW_MS = 1400; // 帯から飛んだ組がほのかに光る

const items = ref<Pair[]>([]);
const beads = ref<Bead[]>([]);
const state = ref<"loading" | "ready" | "error">("loading");
// 「関係ないかも」にしてシートを閉じ、一覧と帯から外した組。記録に失敗したら戻す
const gone = ref(new Set<string>());
const leavingId = ref<string | null>(null);
// 入ってくる動きの組（最初の表示ではすべて、戻ったときは新しく結ばれた組だけ）
const weave = ref(new Set<string>());
// 帯から飛んで、ほのかに光っている組
const glowId = ref<string | null>(null);
// シートを閉じたあとに記録が失敗した組。組の足に「記録できませんでした」を出し、その組をひらくまで残す（見直し n=3, n=8）
const failedIds = ref(new Set<string>());
const openId = ref<string | null>(null);
// 紙が下がっていく途中のシートの組（PairSheet の closing から close まで）。閉じたものとして扱い、
// その間に返った記録の失敗も組の足に残す（下がりきる約 280ms の内か外かで扱いを変えない。見直し 4 回目）
let closingId: string | null = null;
const main = ref<HTMLElement | null>(null);
const heading = ref<HTMLElement | null>(null);
const list = ref<HTMLElement | null>(null);

const visible = computed(() => items.value.filter((p) => !gone.value.has(p.id)));
const openPair = computed(() => (openId.value ? (items.value.find((p) => p.id === openId.value) ?? null) : null));
// 糸の揺れの向きは組ごとに左右を入れ替える（読み込んだ順で決め、外しても隣の組の向きは変えない）
const swingOf = (p: Pair): 0 | 1 => (items.value.indexOf(p) % 2 === 0 ? 0 : 1);
// 入ってくる組のずらし（入ってくる組の中での順。ずらすのは 6 組目まで）
const weaveOrder = computed(() => {
  const order = new Map<string, number>();
  for (const p of visible.value) if (weave.value.has(p.id)) order.set(p.id, Math.min(order.size, 5));
  return order;
});

const timers = new Set<ReturnType<typeof setTimeout>>();
const later = (fn: () => void, ms: number) => {
  const t = setTimeout(() => {
    timers.delete(t);
    fn();
  }, ms);
  timers.add(t);
};

let weaveToken = 0;
const startWeave = (ids: string[]) => {
  if (!prefersMotion() || ids.length === 0) return;
  const token = ++weaveToken;
  weave.value = new Set(ids);
  later(() => {
    if (token === weaveToken) weave.value = new Set();
  }, WEAVE_MS);
};
const stopWeave = () => {
  weaveToken += 1;
  weave.value = new Set();
};

// 一覧を読む（GET）ことと反応を記録する（PATCH）ことが重なったときの約束（見直し n=1, n=2, n=4）:
//   - 読み込み・取り直しを始めるたびに version を進め、あとから始めた方の結果だけを使う
//   - 反応の記録を始めたときと終えたときにも version を進める。記録と重なって読んだ結果は記録の前の値かもしれないので使わない
//   - シートが開いている間に返った結果も使わない（開いている組を足元で入れ替えない）
//   使わなかったら owed を立て、シートが閉じて記録中のものも抜ける動きも無くなってから取り直す（catchUp）
let version = 0;
let reads = 0;
let owed = false;
let active = true;
// 記録中の組
const busy = new Set<string>();

// 一覧を入れ替える。新しく現れた組の id を返す
const apply = (r: ConnectionsResponse): string[] => {
  const known = new Set(items.value.map((p) => p.id));
  items.value = r.items.map((c) => ({ ...c }));
  beads.value = r.beads;
  gone.value = new Set();
  return r.items.filter((c) => !known.has(c.id)).map((c) => c.id);
};

const load = async () => {
  const v = ++version;
  state.value = "loading";
  reads += 1;
  try {
    const r = await api.connections();
    if (v !== version) return;
    apply(r);
    state.value = "ready";
    startWeave(r.items.map((c) => c.id));
  } catch {
    if (v === version) state.value = "error";
  } finally {
    reads -= 1;
  }
};

// S3 で返した反応、消した記憶、新しく浮かんだ札を映す。失敗したら今の一覧のまま（何も出さない）
const refresh = async () => {
  const v = ++version;
  owed = false;
  reads += 1;
  try {
    const r = await api.connections();
    if (v !== version) return;
    if (openId.value || busy.size > 0) {
      owed = true;
      return;
    }
    startWeave(apply(r));
  } catch {
    /* 静かに今の一覧のまま */
  } finally {
    reads -= 1;
  }
};

// 記録の始めと終わりに呼ぶ。読んでいる最中の結果は使わず、あとで取り直す
const invalidateReads = () => {
  version += 1;
  if (reads > 0) owed = true;
};
const catchUp = () => {
  if (owed && active && state.value === "ready" && !openId.value && busy.size === 0 && !leavingId.value) void refresh();
};

onMounted(load);
// 初回（onMounted の load が動いている間）は何もしない。読めていれば裏で取り直し、読めていなければ読み直す
onActivated(() => {
  active = true;
  if (state.value === "ready") void refresh();
  else if (state.value === "error") void load();
});

// 後ろの画面（この画面と下部ナビ）を inert にする。シートは body の直下にあるので外れる。
// 外すときは付けた要素から外す（KeepAlive で離れると main はもう別の所にある）
let inertHost: Element | null = null;
const setInert = (on: boolean) => {
  if (on) {
    inertHost = (main.value?.parentNode as Element | null) ?? null;
    inertHost?.setAttribute("inert", "");
  } else {
    inertHost?.removeAttribute("inert");
    inertHost = null;
  }
};

const rowOf = (id: string): HTMLElement | null =>
  (list.value ? Array.from(list.value.querySelectorAll<HTMLElement>("li[data-pair]")) : []).find((el) => el.dataset.pair === id) ?? null;
const openButton = (id: string): HTMLElement | null => rowOf(id)?.querySelector<HTMLElement>("button") ?? null;

const open = (id: string) => {
  if (openId.value) return;
  openId.value = id;
  closingId = null;
  failedIds.value.delete(id); // シートの中で同じ知らせを出す
  // 抜けている途中の組をひらき直したら、抜ける動きを取り消して元の見た目に戻す（外すかどうかは、また閉じたときに決め直す。見直し 4 回目）
  if (leavingId.value === id) leavingId.value = null;
  setInert(true);
};

// 組が抜けたあと、下の組を元の位置から詰める（FLIP: 抜ける前の位置を測り、抜けた後の位置との差を transform で戻してから 0 へ）。
// 画面の外の組は動かさない。動きを減らす設定と、測れない環境（テスト）では何もしない
const slideUpAfter = (id: string): (() => void) => {
  if (!prefersMotion() || !list.value) return () => {};
  const rows = Array.from(list.value.querySelectorAll<HTMLElement>("li[data-pair]"));
  const below = rows.slice(rows.findIndex((el) => el.dataset.pair === id) + 1).filter((el) => typeof el.getBoundingClientRect === "function");
  const limit = window.innerHeight * 1.5;
  const before = below.map((el) => ({ el, top: el.getBoundingClientRect().top })).filter((r) => r.top < limit);
  return () => {
    for (const { el, top } of before) {
      const dy = top - el.getBoundingClientRect().top;
      if (Math.abs(dy) < 1) continue;
      el.style.transition = "none";
      el.style.transform = `translate3d(0, ${dy}px, 0)`;
      void el.offsetHeight; // 戻した位置を一度描かせてから動かす
      el.style.transition = "transform var(--duration-slow) var(--ease-out-soft)";
      el.style.transform = "";
      el.addEventListener("transitionend", () => (el.style.transition = ""), { once: true });
    }
  };
};

// 「関係ないかも」のままシートを閉じた組を、一覧と帯から外す。フォーカスは次の組へ、無ければ h1 へ
const unravel = (id: string, { quiet = false } = {}) => {
  const order = visible.value.map((p) => p.id);
  const next = order[order.indexOf(id) + 1] ?? null;
  const remove = () => {
    if (leavingId.value === id) leavingId.value = null;
    // 抜けている間にその組がひらき直されていたら外さない（シートで取り消すかもしれない。
    // 「関係ないかも」のまま閉じたら、close がもう一度 unravel を呼んで外す。見直し 4 回目）
    if (openId.value === id) return;
    const now = items.value.find((p) => p.id === id);
    // 抜けている間に記録が失敗して戻っていたら外さず、フォーカスをその組へ返す（見直し n=3）
    if (now && now.feedback !== "not_related") {
      if (!quiet) void nextTick(() => openButton(id)?.focus({ preventScroll: true }));
      catchUp();
      return;
    }
    const slide = quiet ? () => {} : slideUpAfter(id);
    if (now) gone.value.add(id);
    if (!quiet) {
      void nextTick(() => {
        slide();
        const to = next ? openButton(next) : null;
        if (to) to.focus({ preventScroll: true });
        else focusHeading(heading.value, { force: true });
      });
    }
    catchUp();
  };
  if (!quiet && prefersMotion()) {
    leavingId.value = id;
    later(remove, LEAVE_MS);
  } else remove();
};

// シートの紙が下がり始めたとき（閉じる動きの最初。動きを減らす設定では close の直前）
const onClosing = () => {
  closingId = openId.value;
};

// シートが閉じたとき（下がる動きはシート側の useSheetDrag が済ませてから呼ぶ）。
// immediate: 画面を離れたとき。フォーカスを動かさず、取り直しは戻ったときに任せる
const close = ({ immediate = false } = {}) => {
  const id = openId.value;
  closingId = null;
  if (!id) return;
  openId.value = null;
  setInert(false);
  if (items.value.find((p) => p.id === id)?.feedback === "not_related") unravel(id, { quiet: immediate });
  else if (!immediate) void nextTick(() => openButton(id)?.focus({ preventScroll: true }));
  if (!immediate) catchUp();
};

// 反応の記録（S3 の札と同じ）。同じボタンをもう一度押すと none に戻す。
// 失敗したら印を戻して「記録できませんでした」（シートが開いていればシートの中、閉じていれば組の足と読み上げの知らせ。
// 下がっていく途中のシートは閉じたものとして扱い、組の足にも出す）
const notice = useNotice();
const liveNotice = computed(() => (notice.key.value && notice.key.value !== openId.value ? notice.message.value : ""));
const react = async (feedback: "helpful" | "not_related") => {
  const p = openPair.value;
  if (!p || busy.has(p.id)) return;
  const id = p.id;
  const prev = p.feedback;
  const next = prev === feedback ? "none" : feedback;
  // 触覚は押した直後に 1 回: 判を押す（そうだった）か、ふつうのボタン（関係ないかも・取り消し）
  if (next === "helpful") stamp();
  else tap();
  busy.add(id);
  invalidateReads();
  p.feedback = next;
  try {
    await api.recallFeedback(id, next);
  } catch {
    // 取り直しで一覧が入れ替わっていても、いま画面にある組を戻す（見直し n=1）
    const now = items.value.find((x) => x.id === id) ?? p;
    now.feedback = prev;
    gone.value.delete(id); // シートを閉じて外した後に失敗していたら、組を戻す
    if (leavingId.value === id) leavingId.value = null; // 抜けている途中なら、すぐ戻す
    if (openId.value !== id || closingId === id) failedIds.value.add(id);
    notice.show("記録できませんでした", id);
    failed();
  } finally {
    busy.delete(id);
    invalidateReads();
    catchUp();
  }
};

// 帯の弧を押したら、その組へ一覧を動かし、組をほのかに光らせる（帯は読み上げない。同じ組は一覧にある）
let glowToken = 0;
const jump = (id: string) => {
  const row = rowOf(id);
  if (!row) return;
  select();
  row.scrollIntoView?.({ behavior: prefersMotion() ? "smooth" : "auto", block: "start" });
  const token = ++glowToken;
  glowId.value = null;
  void nextTick(() => {
    if (token !== glowToken) return;
    glowId.value = id;
    later(() => {
      if (token === glowToken) glowId.value = null;
    }, GLOW_MS);
  });
};

// 画面を離れるとき（シートの「ひらく ›」で S3 へ、戻るボタン、下部ナビ）は、シートと入ってくる動きを止める
onDeactivated(() => {
  active = false;
  stopWeave();
  glowToken += 1;
  glowId.value = null;
  close({ immediate: true });
  if (leavingId.value) unravel(leavingId.value, { quiet: true });
});
onUnmounted(() => {
  setInert(false);
  timers.forEach((t) => clearTimeout(t));
  timers.clear();
});

// S3 で消した記憶の組は、取り直しを待たずに外す（非アクティブの間に届く。帯の粒は取り直しで直る）
useMemoryDeleted((id) => {
  items.value = items.value.filter((p) => p.memory.id !== id && p.related_memory.id !== id);
});
</script>

<template>
  <main ref="main" class="flex flex-1 flex-col gap-6 py-6">
    <!-- 便箋の天（ADR-0010）: 見出しの下に朱の二重罫。添え書きは組があるときだけ -->
    <header class="rule-double pb-3">
      <h1 ref="heading" class="text-[24px] tracking-[.04em] [font-feature-settings:'palt'] focus:outline-none">つながり</h1>
      <p v-if="state === 'ready' && visible.length > 0" class="mt-0.5 text-sm leading-[1.7] tracking-[.02em] text-ink-soft">
        そういえば、で結ばれたふたつの日
      </p>
    </header>

    <p v-if="state === 'loading'" class="py-16 text-center text-sm text-ink-soft" role="status">よみこみ中</p>

    <section v-else-if="state === 'error'" class="flex flex-col items-center gap-3 py-16 text-center">
      <p class="text-ink-soft">読み込めませんでした</p>
      <button type="button" class="btn btn-quiet press" @click="load">もう一度</button>
    </section>

    <!-- 糸が 0 本: 記憶が何件あっても、添え書き・帯・一覧を出さない（S2 の空と同じ形。絵は置かない） -->
    <section v-else-if="visible.length === 0" class="flex flex-1 flex-col items-center justify-center gap-1 py-16 text-center text-ink-soft">
      <p>まだ、つながっていません。</p>
      <a href="#today" class="inline-flex min-h-11 items-center tracking-[.04em] text-ink"><span class="ember-underline">きょうのひとことから</span></a>
    </section>

    <template v-else>
      <ThreadLoom class="-mt-1" :beads="beads" :items="visible" :weave="weave" :glow="glowId" @pick="jump" />
      <ol ref="list" role="list" aria-label="つながりの一覧" class="flex flex-col gap-7">
        <li
          v-for="p in visible"
          :key="p.id"
          :data-pair="p.id"
          class="pair-row"
          :class="{ 'pair-weave': weave.has(p.id), 'pair-unravel': leavingId === p.id, 'pair-glow': glowId === p.id }"
          :style="{ '--i': weaveOrder.get(p.id) ?? 0 }"
        >
          <PairCard
            :pair="p"
            :swing="swingOf(p)"
            :sheet-id="SHEET_ID"
            :notice="failedIds.has(p.id) && openId !== p.id ? '記録できませんでした' : ''"
            @open="open"
          />
        </li>
      </ol>
    </template>

    <!-- 記録の失敗の読み上げ（シートを閉じたあとの分）。後から差し込んだ所は読まれないことがあるので、初めから置いて文字だけ入れ替える。
         シートが開いている間は後ろが inert なので、その組の知らせはシートの中で読む -->
    <p class="sr-only" role="status" aria-live="polite" data-live>{{ liveNotice }}</p>

    <PairSheet
      v-if="openPair"
      :pair="openPair"
      :swing="swingOf(openPair)"
      :sheet-id="SHEET_ID"
      :notice="notice.key.value === openPair.id ? notice.message.value : ''"
      @react="react"
      @closing="onClosing"
      @close="close()"
    />
  </main>
</template>
