<script setup lang="ts">
// S2 これまで。時系列の静かなリスト。
// App.vue の KeepAlive で残すので、記憶を開いて戻っても「もっと前を見る」で足した分と位置はそのまま。
// 「よみこみ中」は初回だけ（wireframes 0 節、3.1）。戻ってきたときは裏で取り直して入れ替える。
// 動き（ブラッシュアップ 11/7）: 読み込めて一覧を初めて出すときだけ、行が上から少しずつずれて現れる（.rise-in。5 行目まで 50ms ずつ、
// 6 行目からは 5 行目と一緒）。戻ってきたときの取り直しや「もっと前を見る」で足した行は動かさない。写真は PhotoImg が読めたらふわっと出す
import { onActivated, onMounted, onUnmounted, ref } from "vue";
import { api } from "../api";
import type { Memory } from "../api/types";
import MemoryCard from "../components/MemoryCard.vue";
import Leaf from "../components/motifs/Leaf.vue";
import { useMemoryDeleted } from "../composables/useMemoryDeleted";
import { useMemoryPhoto } from "../composables/useMemoryPhoto";
import { DURATION, prefersMotion } from "../motion";

defineOptions({ name: "TimelineScreen" }); // KeepAlive の include で使う

const items = ref<Memory[]>([]);
const nextCursor = ref<string | null>(null);
const state = ref<"loading" | "ready" | "error">("loading");
const moreError = ref(false);
const loadingMore = ref(false);
// 一覧を書き換える処理（続き・取り直し）のたびに進める。あとから始めた方の結果だけを使う
let version = 0;

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
onUnmounted(() => {
  if (enterTimer) clearTimeout(enterTimer);
});

const load = async () => {
  version += 1;
  state.value = "loading";
  try {
    const page = await api.listMemories();
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

// 今見えている件数に届くまでページをたどって取り直し、そろったら一度に入れ替える。
// S1 で書いた記憶、S3 で消した記憶や添え直した写真を映すため。失敗したら今の一覧のまま（何も出さない）
const refresh = async () => {
  const v = ++version;
  const want = items.value.length;
  try {
    let page = await api.listMemories();
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
</script>

<template>
  <main class="flex flex-1 flex-col gap-6 py-6">
    <!-- 便箋の天（ADR-0010）: 見出しの下に朱の二重罫、右端に押し葉（綴じた帳面） -->
    <header class="rule-double flex items-end gap-3 pb-3">
      <h1 class="text-[24px] tracking-[.04em] [font-feature-settings:'palt'] focus:outline-none">これまで</h1>
      <!-- S6 ことばの地図への入口（ADR-0014）。見出しの行の右、押し葉の手前 -->
      <a href="#words" class="press -mb-2 ml-auto inline-flex min-h-11 shrink-0 items-center px-1 text-sm tracking-[.06em] whitespace-nowrap text-ink-soft">ことばの地図 ›</a>
      <Leaf class="mb-0.5 shrink-0" />
    </header>

    <p v-if="state === 'loading'" class="py-16 text-center text-sm text-ink-soft" role="status">よみこみ中</p>

    <section v-else-if="state === 'error'" class="flex flex-col items-center gap-3 py-16 text-center">
      <p class="text-ink-soft">読み込めませんでした</p>
      <button type="button" class="btn btn-quiet press" @click="load">もう一度</button>
    </section>

    <section v-else-if="items.length === 0" class="flex flex-1 flex-col items-center justify-center gap-1 py-16 text-center text-ink-soft">
      <p>まだ何もありません。</p>
      <a href="#today" class="inline-flex min-h-11 items-center tracking-[.04em] text-ink"><span class="ember-underline">きょうのひとことから</span></a>
    </section>

    <template v-else>
      <ul class="-mt-[18px]">
        <li
          v-for="(m, i) in items"
          :key="m.id"
          :class="entering.has(m.id) ? 'rise-in' : ''"
          :style="entering.has(m.id) ? { '--i': Math.min(i, STAGGER_ROWS - 1) } : undefined"
        >
          <MemoryCard :memory="m" />
        </li>
      </ul>
      <div v-if="nextCursor" class="flex flex-col items-center gap-3">
        <p v-if="moreError" class="text-ink-soft">読み込めませんでした</p>
        <button type="button" class="btn btn-quiet press" :disabled="loadingMore" @click="more">もっと前を見る</button>
      </div>
    </template>
  </main>
</template>
