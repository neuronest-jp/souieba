<script setup lang="ts">
// S5 つながり（「ふたつの日」。ADR-0009、wireframes 9 節）。書いたひとことと、そのとき浮かんだ昔のひとことを一組にして、新しい順に並べる。
// 上端の糸の帯（ThreadLoom）で、いつといつが結ばれたかを一目で見せる（読み上げは下の一覧が受け持つ）。
// 一組を押すとシート（PairSheet）が開き、そこで「そうだった」「関係ないかも」を返せる（S3 の札と同じ PATCH /api/recalls/:id）。
// App.vue の KeepAlive で残すので、S3 を開いて戻っても位置はそのまま。戻ったときは裏で取り直して入れ替えるだけで動かさない。
// 組が順に現れて糸が描かれるのは、最初に読み込んだときだけ（prefers-reduced-motion ではすべて止める）
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

defineOptions({ name: "ConnectionsScreen" }); // KeepAlive の include で使う

const SHEET_ID = "connection-sheet";
const ENTER_MS = 2400; // 入ってくる動きがすべて終わるまで（5 組目の遅れ 450ms + 糸 900ms + 遅れ 260ms、帯 1100ms + 200ms に余裕）
const CLOSE_MS = 200; // シートが下がる動き
const LEAVE_MS = 300; // 「関係ないかも」の組が薄れて抜ける動き（280ms）

const items = ref<Pair[]>([]);
const beads = ref<Bead[]>([]);
const state = ref<"loading" | "ready" | "error">("loading");
// 「関係ないかも」にしてシートを閉じ、一覧と帯から外した組。記録に失敗したら戻す
const gone = ref(new Set<string>());
const leavingId = ref<string | null>(null);
const entering = ref(false);
const openId = ref<string | null>(null);
const opening = ref(false);
const closing = ref(false);
const main = ref<HTMLElement | null>(null);
const heading = ref<HTMLElement | null>(null);
const list = ref<HTMLElement | null>(null);

const visible = computed(() => items.value.filter((p) => !gone.value.has(p.id)));
const openPair = computed(() => (openId.value ? (items.value.find((p) => p.id === openId.value) ?? null) : null));
// 糸の揺れの向きは組ごとに左右を入れ替える（読み込んだ順で決め、外しても隣の組の向きは変えない）
const swingOf = (p: Pair): 0 | 1 => (items.value.indexOf(p) % 2 === 0 ? 0 : 1);

// 動きを減らす設定（とテストの環境）では待たずに切り替える
const motion = () =>
  typeof window.matchMedia === "function" && !window.matchMedia("(prefers-reduced-motion: reduce)").matches;

const timers = new Set<ReturnType<typeof setTimeout>>();
const later = (fn: () => void, ms: number) => {
  const t = setTimeout(() => {
    timers.delete(t);
    fn();
  }, ms);
  timers.add(t);
};

// 一覧を書き換える処理（読み込み・取り直し）のたびに進める。あとから始めた方の結果だけを使う
let version = 0;
// 記録中の組（取り直しで反応の印を古い値に戻さない）
const busy = new Set<string>();

const apply = (r: ConnectionsResponse) => {
  const local = new Map(items.value.filter((p) => busy.has(p.id)).map((p) => [p.id, p.feedback] as const));
  items.value = r.items.map((c) => ({ ...c, feedback: local.get(c.id) ?? c.feedback }));
  beads.value = r.beads;
  gone.value = new Set();
};

const load = async () => {
  const v = ++version;
  state.value = "loading";
  try {
    const r = await api.connections();
    if (v !== version) return;
    apply(r);
    state.value = "ready";
    if (motion() && r.items.length > 0) {
      entering.value = true;
      later(() => (entering.value = false), ENTER_MS);
    }
  } catch {
    if (v === version) state.value = "error";
  }
};

// S3 で返した反応、消した記憶、新しく浮かんだ札を映す。失敗したら今の一覧のまま（何も出さない）
const refresh = async () => {
  const v = ++version;
  try {
    const r = await api.connections();
    if (v !== version || openId.value) return;
    apply(r);
  } catch {
    /* 静かに今の一覧のまま */
  }
};

onMounted(load);
// 初回（onMounted の load が動いている間）は何もしない。読めていれば裏で取り直し、読めていなければ読み直す
onActivated(() => {
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

const openButton = (id: string): HTMLElement | null => {
  const rows = list.value ? Array.from(list.value.querySelectorAll<HTMLElement>("li[data-pair]")) : [];
  return rows.find((el) => el.dataset.pair === id)?.querySelector<HTMLElement>("button") ?? null;
};

const open = (id: string) => {
  if (openId.value) return;
  openId.value = id;
  closing.value = false;
  setInert(true);
  if (motion()) {
    opening.value = true;
    later(() => (opening.value = false), 1100);
  }
};

// 「関係ないかも」のままシートを閉じた組を、一覧と帯から外す。フォーカスは次の組へ、無ければ h1 へ
const unravel = (id: string, { quiet = false } = {}) => {
  const order = visible.value.map((p) => p.id);
  const next = order[order.indexOf(id) + 1] ?? null;
  const remove = () => {
    if (leavingId.value === id) leavingId.value = null;
    // 抜けている間に記録が失敗して戻っていたら外さない
    if (items.value.find((p) => p.id === id)?.feedback !== "not_related") return;
    gone.value.add(id);
    if (quiet) return;
    void nextTick(() => {
      const to = next ? openButton(next) : null;
      if (to) to.focus({ preventScroll: true });
      else focusHeading(heading.value, { force: true });
    });
  };
  if (!quiet && motion()) {
    leavingId.value = id;
    later(remove, LEAVE_MS);
  } else remove();
};

// immediate: 動かさずにすぐ閉じ、フォーカスも動かさない（画面を離れたとき）
const close = ({ immediate = false } = {}) => {
  const id = openId.value;
  if (!id) return;
  const finish = () => {
    if (openId.value !== id) return;
    openId.value = null;
    opening.value = false;
    closing.value = false;
    setInert(false);
    if (items.value.find((p) => p.id === id)?.feedback === "not_related") unravel(id, { quiet: immediate });
    else if (!immediate) void nextTick(() => openButton(id)?.focus({ preventScroll: true }));
  };
  if (!immediate && motion()) {
    if (closing.value) return;
    closing.value = true;
    later(finish, CLOSE_MS);
  } else finish();
};

// 反応の記録（S3 の札と同じ）。同じボタンをもう一度押すと none に戻す。失敗したら印を戻して「記録できませんでした」
const notice = useNotice();
const react = async (feedback: "helpful" | "not_related") => {
  const p = openPair.value;
  if (!p || busy.has(p.id)) return;
  busy.add(p.id);
  const prev = p.feedback;
  p.feedback = p.feedback === feedback ? "none" : feedback;
  try {
    await api.recallFeedback(p.id, p.feedback);
  } catch {
    p.feedback = prev;
    gone.value.delete(p.id); // シートを閉じて外した後に失敗していたら、組を戻す
    notice.show("記録できませんでした", p.id);
  } finally {
    busy.delete(p.id);
  }
};

// 画面を離れるとき（シートの「ひらく ›」で S3 へ、戻るボタン、下部ナビ）は、シートと入ってくる動きを止める
onDeactivated(() => {
  entering.value = false;
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
        書いたひとことと、そのとき浮かんだ昔のひとこと
      </p>
    </header>

    <p v-if="state === 'loading'" class="py-16 text-center text-sm text-ink-soft" role="status">よみこみ中</p>

    <section v-else-if="state === 'error'" class="flex flex-col items-center gap-3 py-16 text-center">
      <p class="text-ink-soft">読み込めませんでした</p>
      <button type="button" class="btn btn-quiet" @click="load">もう一度</button>
    </section>

    <!-- 糸が 0 本: 記憶が何件あっても、添え書き・帯・一覧を出さない（S2 の空と同じ形。絵は置かない） -->
    <section v-else-if="visible.length === 0" class="flex flex-1 flex-col items-center justify-center gap-1 py-16 text-center text-ink-soft">
      <p>まだ、つながっていません。</p>
      <a href="#today" class="inline-flex min-h-11 items-center tracking-[.04em] text-ink"><span class="ember-underline">きょうのひとことから</span></a>
    </section>

    <template v-else>
      <ThreadLoom class="-mt-1" :beads="beads" :items="visible" :entering="entering" />
      <ol ref="list" role="list" aria-label="つながりの一覧" class="flex flex-col gap-7" :class="entering ? 'pairs-entering' : ''">
        <li
          v-for="(p, i) in visible"
          :key="p.id"
          :data-pair="p.id"
          :class="leavingId === p.id ? 'pair-leaving' : ''"
          :style="{ '--i': Math.min(i, 5) }"
        >
          <PairCard :pair="p" :swing="swingOf(p)" :sheet-id="SHEET_ID" @open="open" />
        </li>
      </ol>
    </template>

    <PairSheet
      v-if="openPair"
      :pair="openPair"
      :swing="swingOf(openPair)"
      :sheet-id="SHEET_ID"
      :notice="notice.key.value === openPair.id ? notice.message.value : ''"
      :opening="opening"
      :closing="closing"
      @react="react"
      @close="close()"
    />
  </main>
</template>
