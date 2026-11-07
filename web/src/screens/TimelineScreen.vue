<script setup lang="ts">
// S2 これまで。時系列の静かなリスト。
// App.vue の KeepAlive で残すので、記憶を開いて戻っても「もっと前を見る」で足した分と位置はそのまま。
// 「よみこみ中」は初回だけ（wireframes 0 節、3.1）。戻ってきたときは裏で取り直して入れ替える。
// 動き（ブラッシュアップ 11/7）: 読み込めて一覧を初めて出すときだけ、行が上から少しずつずれて現れる（.rise-in。5 行目まで 50ms ずつ、
// 6 行目からは 5 行目と一緒）。戻ってきたときの取り直しや「もっと前を見る」で足した行は動かさない。写真は PhotoImg が読めたらふわっと出す
// 年月で探す（11/7、ADR-0015、wireframes の「S2 を年月で探す」）: 一覧を起きた日の年月ごとに区切り（past/sections.ts）、区切りの札を左上に浮かべる
// （position: sticky。次の区切りが来たら押し出されて替わる）。札を押すと「年月で探す」のシート（MonthSheet）。月を選ぶと、その月の
// いちばん新しい記憶から一覧を読み直して（GET /api/memories?month=）先頭へ移り、先頭に「いちばん新しいひとことへ」を出す。
// 読み直した一覧も、戻ってきたときの取り直しと「もっと前を見る」は同じ始まりのまま（start）。読み直したときは新しい一覧の最初の表示として .rise-in で出す
import { computed, nextTick, onActivated, onDeactivated, onMounted, onUnmounted, ref } from "vue";
import { api } from "../api";
import type { ListStart, Memory, MemoryMonths } from "../api/types";
import MemoryCard from "../components/MemoryCard.vue";
import Leaf from "../components/motifs/Leaf.vue";
import MonthSheet from "../components/past/MonthSheet.vue";
import { useMemoryDeleted } from "../composables/useMemoryDeleted";
import { useMemoryPhoto } from "../composables/useMemoryPhoto";
import { select } from "../haptics";
import { DURATION, prefersMotion } from "../motion";
import { startOf, toSections } from "../past/sections";

defineOptions({ name: "TimelineScreen" }); // KeepAlive の include で使う

const items = ref<Memory[]>([]);
const nextCursor = ref<string | null>(null);
const state = ref<"loading" | "ready" | "error">("loading");
const moreError = ref(false);
const loadingMore = ref(false);
// 一覧の始まり。null はいちばん新しい記憶から。年月で探したらその区切り（month / year / undated）
const start = ref<ListStart | null>(null);
// 一覧を書き換える処理（続き・取り直し・読み直し）のたびに進める。あとから始めた方の結果だけを使う
let version = 0;

// 起きた日の年月ごとの区切り。行の並び（--i）は区切りをまたいで数える
const sections = computed(() => toSections(items.value));
const order = computed(() => new Map(sections.value.flatMap((s) => s.items).map((m, i) => [m.id, i])));

// 最初に出した行の ID（この行だけ .rise-in で現れる）。動き終わったら空にする
const STAGGER_ROWS = 5;
const entering = ref(new Set<string>());
let enterTimer: ReturnType<typeof setTimeout> | null = null;
const stagger = (rows: Memory[]) => {
  if (!prefersMotion() || rows.length === 0) return;
  entering.value = new Set(rows.map((m) => m.id));
  if (enterTimer) clearTimeout(enterTimer);
  enterTimer = setTimeout(() => {
    enterTimer = null;
    entering.value = new Set();
  }, STAGGER_ROWS * 50 + DURATION.slow + 100);
};
const riseOf = (id: string) => (entering.value.has(id) ? { "--i": Math.min(order.value.get(id) ?? 0, STAGGER_ROWS - 1) } : undefined);
onUnmounted(() => {
  if (enterTimer) clearTimeout(enterTimer);
});

const load = async () => {
  version += 1;
  state.value = "loading";
  try {
    const page = await api.listMemories(null, start.value);
    items.value = page.items;
    nextCursor.value = page.next_cursor;
    state.value = "ready";
    stagger(page.items);
  } catch {
    state.value = "error";
  }
};

const more = async () => {
  if (!nextCursor.value || loadingMore.value) return;
  const v = ++version;
  loadingMore.value = true;
  moreError.value = false;
  try {
    const page = await api.listMemories(nextCursor.value);
    if (v !== version) return;
    items.value = [...items.value, ...page.items];
    nextCursor.value = page.next_cursor;
  } catch {
    if (v === version) moreError.value = true;
  } finally {
    loadingMore.value = false;
  }
};

// 今見えている件数に届くまでページをたどって取り直し、そろったら一度に入れ替える（始まりは今のまま）。
// S1 で書いた記憶、S3 で消した記憶や添え直した写真を映すため。失敗したら今の一覧のまま（何も出さない）
const refresh = async () => {
  const v = ++version;
  const want = items.value.length;
  try {
    let page = await api.listMemories(null, start.value);
    let all = page.items;
    while (page.next_cursor && all.length < want) {
      page = await api.listMemories(page.next_cursor);
      all = [...all, ...page.items];
    }
    if (v !== version) return;
    items.value = all;
    nextCursor.value = page.next_cursor;
    moreError.value = false;
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

// S3 で消した記憶の行は、取り直しを待たずに外す（非アクティブの間に届く）
useMemoryDeleted((id) => {
  items.value = items.value.filter((m) => m.id !== id);
});

// S3 で添え直した写真は、その行に映す（非アクティブの間に届く。添えている途中に戻ると取り直しが PUT より先に終わるため）
useMemoryPhoto((id, photo_key, photo_content_type) => {
  items.value = items.value.map((m) => (m.id === id ? { ...m, photo_key, photo_content_type } : m));
});

// ---- 年月で探す ----
const list = ref<HTMLElement | null>(null);
const sectionEl = (key: string): HTMLElement | null =>
  (list.value ? Array.from(list.value.querySelectorAll<HTMLElement>("section[data-section]")) : []).find((el) => el.dataset.section === key) ?? null;
const tagOf = (key: string): HTMLElement | null => sectionEl(key)?.querySelector<HTMLElement>("button") ?? null;

// シート（MonthSheet）。開いている間は後ろの画面（この画面と下部ナビ）を inert にする（シートは body の直下にあるので外れる）
const sheetFor = ref<string | null>(null); // 押した札の区切り（シートの中で、いま見ている区切りとして示す）
const months = ref<MemoryMonths | null>(null); // 前に開いたときの件数（開き直したらすぐ出し、裏で取り直す）
const monthsState = ref<"loading" | "ready" | "error">("loading");
let monthsVersion = 0;
let inertHost: Element | null = null;
const setInert = (on: boolean) => {
  if (on) {
    // この画面の main の親（App.vue の safe-area。下部ナビも入る）
    let n = list.value as Element | null;
    while (n && n.tagName !== "MAIN") n = n.parentNode as Element | null;
    inertHost = (n?.parentNode as Element | null) ?? null;
    inertHost?.setAttribute("inert", "");
  } else {
    inertHost?.removeAttribute("inert");
    inertHost = null;
  }
};
const loadMonths = async () => {
  const v = ++monthsVersion;
  if (!months.value) monthsState.value = "loading";
  try {
    const got = await api.memoryMonths();
    if (v !== monthsVersion) return;
    months.value = got;
    monthsState.value = "ready";
  } catch {
    if (v === monthsVersion && !months.value) monthsState.value = "error";
  }
};
// 札を押した（触覚は鳴らさない。シートを開くだけでは何も変わらないので。ADR-0011 の 3 節）
const openSheet = (key: string) => {
  if (sheetFor.value) return;
  sheetFor.value = key;
  landing = null;
  setInert(true);
  void loadMonths();
};

// 読み直したあとフォーカスを置く区切り（シートが閉じきるまで待つ。inert の中には置けない）
let landing: string | null = null;
const jumping = ref(false); // 読み直している間（一覧は前のまま出し、aria-busy を付ける）
let jumpToken = 0;
const land = (key: string) => {
  const el = tagOf(key) ?? (sections.value[0] ? tagOf(sections.value[0].key) : null);
  el?.focus({ preventScroll: true });
};

// その区切り（null ならいちばん新しい記憶）から一覧を読み直し、先頭へ移る。年だけの区切りは同じ日の 1 月の区切りの後ろに来るので、
// 先頭の区切りでなければその区切りの頭へ送る。失敗したら「読み込めませんでした」と「もう一度」（同じ始まりで読み直す）
const jump = async (key: string | null) => {
  const v = ++version;
  const t = ++jumpToken;
  const next = key ? startOf(key) : null;
  jumping.value = true;
  try {
    const page = await api.listMemories(null, next);
    if (v !== version) return;
    start.value = next;
    items.value = page.items;
    nextCursor.value = page.next_cursor;
    moreError.value = false;
    state.value = "ready";
    stagger(page.items);
    await nextTick();
    const first = sections.value[0]?.key ?? null;
    const target = key && first !== key ? sectionEl(key) : null;
    if (target) target.scrollIntoView?.({ block: "start" });
    else window.scrollTo?.({ top: 0 });
    const to = key && target ? key : first;
    if (to) {
      if (sheetFor.value) landing = to;
      else land(to);
    }
  } catch {
    if (v !== version) return;
    start.value = next;
    state.value = "error";
  } finally {
    if (t === jumpToken) jumping.value = false;
  }
};

const onPick = (key: string) => {
  select();
  void jump(key);
};
const toNewest = () => {
  select();
  void jump(null);
};

// シートが閉じたとき（下がる動きはシートの useSheetDrag が済ませてから呼ぶ）。immediate: 画面を離れたとき（フォーカスを動かさない）
const closeSheet = ({ immediate = false } = {}) => {
  const from = sheetFor.value;
  if (!from) return;
  sheetFor.value = null;
  setInert(false);
  if (immediate) return;
  if (landing) {
    const to = landing;
    landing = null;
    void nextTick(() => land(to));
  } else if (!jumping.value) {
    // 選ばずに閉じたら、押した札へ返す（読み込めなかったときも一覧は残っている）
    void nextTick(() => tagOf(from)?.focus({ preventScroll: true }));
  }
};
onDeactivated(() => closeSheet({ immediate: true }));
onUnmounted(() => setInert(false));
</script>

<template>
  <main class="flex flex-1 flex-col gap-6 py-6">
    <!-- 便箋の天（ADR-0010）: 見出しの下に朱の二重罫、右端に押し葉（綴じた帳面） -->
    <header class="rule-double flex items-end gap-3 pb-3">
      <h1 class="text-[24px] tracking-[.04em] [font-feature-settings:'palt'] focus:outline-none">これまで</h1>
      <Leaf class="mb-0.5 ml-auto shrink-0" />
    </header>

    <p v-if="state === 'loading'" class="py-16 text-center text-sm text-ink-soft" role="status">よみこみ中</p>

    <section v-else-if="state === 'error'" class="flex flex-col items-center gap-3 py-16 text-center">
      <p class="text-ink-soft">読み込めませんでした</p>
      <button type="button" class="btn btn-quiet press" @click="load">もう一度</button>
      <button v-if="start" type="button" class="press inline-flex min-h-11 items-center text-sm tracking-[.04em] text-ink-soft" @click="toNewest">いちばん新しいひとことへ</button>
    </section>

    <section v-else-if="items.length === 0 && !start" class="flex flex-1 flex-col items-center justify-center gap-1 py-16 text-center text-ink-soft">
      <p>まだ何もありません。</p>
      <a href="#today" class="inline-flex min-h-11 items-center tracking-[.04em] text-ink"><span class="ember-underline">きょうのひとことから</span></a>
    </section>

    <template v-else>
      <!-- 年月で探したあとだけ。押すといちばん新しい記憶から読み直す -->
      <div v-if="start" class="-mt-3 flex">
        <button type="button" class="press -ml-1 inline-flex min-h-11 items-center gap-1.5 px-1 text-sm tracking-[.04em] text-ink" @click="toNewest">
          <svg viewBox="0 0 12 12" class="size-3 text-ink-soft" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 10.5V2M2.5 5.5 6 2l3.5 3.5" /></svg>
          <span class="ember-underline">いちばん新しいひとことへ</span>
        </button>
      </div>
      <p v-if="items.length === 0" class="py-16 text-center text-ink-soft">ここから前には、何もありません。</p>
      <!-- 区切りごとの紙の札（h2）。札は position: sticky で上に貼り付き、区切りの終わりで次の札に押し出される。
           札（高さ 24px）は前の区切りの最後の行の罫にまたがって置く（罫の 9px 上から 15px 下まで。前の行の下の余白の中）。
           区切りの最初の行は上に 12px 足し（li の pt-3）、行の文字（写真の行は焼き付け）が札の下 9px から始まるようにする（文字は隠さない）。
           区切りの箱は札の上端から最後の行の罫の 9px 上までにし（ul の -mt-[15px] / -mb-[9px]）、次の区切りの札がちょうど前の札を押し出す。
           section は flow-root にする。普通のブロックだと ul の -mb-[9px] が section の外へ相殺されて箱が罫まで伸び、
           受け渡しのたびに前の札と次の札が 9px 重なる（11/7 の見直し。headless Chrome の 402×874 で測った）。
           札の行（h2）は横いっぱいで指を通し（pointer-events-none）、札だけ押せる。押せる所は ::after で上下に 44px まで広げる -->
      <div v-else ref="list" class="-mt-5 pb-[9px]" :aria-busy="jumping ? 'true' : undefined">
        <section
          v-for="s in sections"
          :key="s.key"
          :data-section="s.key"
          class="flow-root scroll-mt-[calc(env(safe-area-inset-top,0px)+8px)]"
        >
          <h2 class="pointer-events-none sticky top-[calc(env(safe-area-inset-top,0px)+8px)] z-[4] flex h-6 items-center">
            <button
              type="button"
              class="press pointer-events-auto relative inline-flex h-6 items-center gap-1 rounded-pill border border-line bg-card pr-2 pl-2.5 text-sm leading-none tracking-[.04em] text-ink shadow-card [font-feature-settings:'palt'] after:absolute after:-inset-x-1.5 after:-inset-y-2.5"
              :class="s.items[0] && entering.has(s.items[0].id) ? 'rise-in' : ''"
              :style="s.items[0] ? riseOf(s.items[0].id) : undefined"
              :aria-label="`${s.label}。年月で探す`"
              aria-haspopup="dialog"
              @click="openSheet(s.key)"
            >
              {{ s.label }}
              <svg viewBox="0 0 10 10" class="size-2.5 text-ink-soft" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 3.75 5 6.75 8 3.75" /></svg>
            </button>
          </h2>
          <ul class="-mt-[15px] -mb-[9px]">
            <li v-for="(m, i) in s.items" :key="m.id" :class="[i === 0 ? 'pt-3' : '', entering.has(m.id) ? 'rise-in' : '']" :style="riseOf(m.id)">
              <MemoryCard :memory="m" />
            </li>
          </ul>
        </section>
      </div>
      <div v-if="nextCursor" class="flex flex-col items-center gap-3">
        <p v-if="moreError" class="text-ink-soft">読み込めませんでした</p>
        <button type="button" class="btn btn-quiet press" :disabled="loadingMore" @click="more">もっと前を見る</button>
      </div>
    </template>

    <MonthSheet
      v-if="sheetFor"
      :months="months"
      :state="monthsState"
      :current="sheetFor"
      @pick="onPick"
      @retry="loadMonths"
      @close="closeSheet()"
    />
  </main>
</template>
