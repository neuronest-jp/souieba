<script setup lang="ts">
// S6 ことばの地図（ADR-0014、wireframes 第10節）。S2 の見出しの行の「ことばの地図 ›」から push で入り、戻るは「‹ これまで」。
// これまでのひとことに、くり返し出てくることばを、年の背骨のまわりに並べる。1 つの年だけに出る言葉はその年の左右に、
// 2 つ以上の年に出る言葉は年と年のあいだに置いてつなぐ年へ糸を渡す（並べ方は web/src/words/layout.ts）。言葉を押すと、その言葉が
// 出てくるひとことを新しい順にシートで並べる（WordSheet）。言葉を選ぶのは Claude、数と引用は Worker がいまの本文から数える。
// 地図がまだ無いときは「ことばを集める」（POST /api/keywords。数十秒かかる）。記憶が 8 件未満なら集めない。
// App.vue の KeepAlive で残すので、S3 を開いて戻っても位置と地図はそのまま。戻ったときは裏で取り直す（消した記憶・書いた記憶を映す）。
// 動き（transform と opacity だけ。動きを減らす設定では止める）: 地図が現れるとき、背骨が上から伸び、年の札が順に、そのあと言葉と線が少しずつ現れる
import { computed, nextTick, onActivated, onDeactivated, onMounted, onUnmounted, ref, watch } from "vue";
import { api, ApiError } from "../api";
import type { KeywordsResponse, MapKeyword } from "../api/types";
import WordSheet from "../components/words/WordSheet.vue";
import { useEdgeSwipe } from "../composables/useEdgeSwipe";
import { useMemoryDeleted } from "../composables/useMemoryDeleted";
import { back as goBack, focusHeading } from "../composables/useScreen";
import { formatHappenedOn, todayInTokyo } from "../date";
import { failed, saved } from "../haptics";
import { prefersMotion } from "../motion";
import { isLineStyle, layoutWords, wordId, type LineStyle, type MapKnot, type MapLink, type PlacedWord } from "../words/layout";

defineOptions({ name: "WordsScreen" }); // KeepAlive の include で使う

const SHEET_ID = "word-sheet";
// 待つ時間は styles/words.css の動きと合わせる（背骨 460ms、言葉は 260ms から 35ms ずつ 30 こまで、各 460ms）
const WEAVE_MS = 1900;
const STITCHES = [0, 1, 2, 3, 4].map((i) => ({ i, x1: 3 + i * 12, x2: 10 + i * 12, y: i % 2 === 0 ? 6.5 : 5.5 }));
// bridge の糸の描き方（開発の間だけ比べる。web/src/words/layout.ts の冒頭）。URL の ?lines=a|b|c|lane（#words の前）で切り替える。
// 選んだら 1 つだけを残し、この切り替えは外す
const LINES: LineStyle = "a";
const lines: LineStyle = (() => {
  const q = typeof location === "undefined" ? null : new URLSearchParams(location.search).get("lines");
  return isLineStyle(q) ? q : LINES;
})();
// 線の見た目（色はトークンの class だけ）
type Stroke = { class: string; width: number; dash?: string; opacity?: number };
const strokeOf = (l: MapLink): Stroke => {
  if (l.role === "leaf") return { class: "words-link stroke-line-strong", width: 1 };
  if (lines === "a") return { class: "words-thread stroke-ember", width: 1, opacity: 0.5 };
  if (lines === "b") return { class: "words-thread stroke-ember", width: 1.25, dash: "2.5 4", opacity: 0.8 };
  if (lines === "c") return { class: "words-thread stroke-ink-faint", width: 1.5, dash: "0 3.5" };
  return { class: "words-thread stroke-ember", width: 1.25, dash: "4 3" };
};
const knotOf = (k: MapKnot): { class: string; r: number } =>
  lines === "b"
    ? { class: "words-knot fill-paper stroke-ember", r: 2.5 }
    : k.at === "word"
      ? { class: "words-knot fill-ember", r: 2.25 }
      : { class: "words-knot fill-ember opacity-60", r: 2 };

const data = ref<KeywordsResponse | null>(null);
const state = ref<"loading" | "ready" | "error">("loading");
// 集めている間（POST の返りを待つ）。地図があればそのまま見せておく
const collecting = ref(false);
// 集められなかった（地図が無いとき）/ 集めなおせなかった（前の地図のまま）
const collectFailed = ref(false);
// 読み上げの知らせ（初めから置いて文字だけ入れ替える）
const live = ref("");
const weaving = ref(false);
const openLabel = ref<string | null>(null);
const root = ref<HTMLElement | null>(null);
const heading = ref<HTMLElement | null>(null);
const mapBox = ref<HTMLElement | null>(null);
const width = ref(362);

const map = computed(() => data.value?.map ?? null);
const few = computed(() => data.value?.reason === "few");
const hasWords = computed(() => (map.value?.keywords.length ?? 0) > 0);
const layout = computed(() => (map.value && hasWords.value ? layoutWords(map.value, width.value, lines) : null));
const openKeyword = computed<MapKeyword | null>(() => map.value?.keywords.find((k) => wordId(k) === openLabel.value) ?? null);
// 集めた日（Asia/Tokyo の日付。起きた日と同じ書き方）
const generatedOn = computed(() => (map.value ? formatHappenedOn(todayInTokyo(new Date(map.value.generated_at)), "day") : ""));
// 地図を作ったあとに書いたひとことがあれば、集めなおしを勧める（集めている間と、記憶が少ないときは出さない）
const staleCount = computed(() => (map.value && !few.value ? (data.value?.stale_count ?? 0) : 0));

// 読み上げの名前: 見えている言葉を先に、どの年にいくつ（bridge は「2020年と2026年」）。
// bridge の年は多い年 3 つまでなので、ほかの年にも出ていれば「など」を付ける（WordSheet の見出しの下と同じ。挙げた年だけで合計を数えたように読まない）
const nameOf = (w: PlacedWord) => {
  const k = w.keyword;
  const years = k.years.map((y) => `${y.year}年`);
  const where = years.length <= 1 ? years.join("") : `${years.slice(0, -1).join("、")}と${years[years.length - 1]}`;
  const listed = k.years.reduce((n, y) => n + y.count, 0);
  return `${k.label}、${where}${listed < k.total ? "など" : ""}に ${k.total} こ`;
};

const timers = new Set<ReturnType<typeof setTimeout>>();
const later = (fn: () => void, ms: number) => {
  const t = setTimeout(() => {
    timers.delete(t);
    fn();
  }, ms);
  timers.add(t);
};
let weaveToken = 0;
const startWeave = () => {
  if (!prefersMotion() || !hasWords.value) return;
  const token = ++weaveToken;
  weaving.value = true;
  later(() => {
    if (token === weaveToken) weaving.value = false;
  }, WEAVE_MS);
};
const stopWeave = () => {
  weaveToken += 1;
  weaving.value = false;
};

// 読み込み・取り直しを始めるたびに進め、あとから始めた方の結果だけを使う（集めた結果は取り直しより後に始まるので、それも進める）
let version = 0;

const load = async () => {
  const v = ++version;
  state.value = "loading";
  try {
    const r = await api.keywords();
    if (v !== version) return;
    data.value = r;
    state.value = "ready";
    void nextTick(() => {
      measure();
      startWeave();
    });
  } catch {
    if (v === version) state.value = "error";
  }
};

// 戻ってきたとき: 裏で取り直して入れ替える（動かさない）。失敗したら今のまま。集めている間は取り直さない
const refresh = async () => {
  if (collecting.value) return;
  const v = ++version;
  try {
    const r = await api.keywords();
    if (v !== version || collecting.value) return;
    data.value = r;
  } catch {
    /* 静かに今のまま */
  }
};

const collect = async () => {
  if (collecting.value) return;
  const v = ++version;
  collecting.value = true;
  collectFailed.value = false;
  live.value = "ことばを集めています";
  try {
    const r = await api.collectKeywords();
    if (v !== version) return;
    data.value = r;
    state.value = "ready";
    if (r.refreshed === false) {
      collectFailed.value = true;
      live.value = "いまは集めなおせませんでした";
      failed();
    } else {
      live.value = r.map && r.map.keywords.length > 0 ? "ことばの地図ができました" : "";
      saved();
      void nextTick(() => {
        measure();
        startWeave();
      });
    }
  } catch (e) {
    if (v !== version) return;
    // 記憶が足りなかった（別の端末で消した、など）: 少ない状態へ
    if (e instanceof ApiError && e.status === 400 && e.code === "few" && data.value) {
      data.value = { ...data.value, reason: "few" };
      live.value = "";
    } else {
      collectFailed.value = true;
      live.value = map.value ? "いまは集めなおせませんでした" : "いまは、うまく集められませんでした";
      failed();
    }
  } finally {
    if (v === version) collecting.value = false;
    // 押したボタンは消えているので、見出しへ置く（body に落ちているときだけ）
    void nextTick(() => focusHeading(heading.value));
  }
};

let observer: ResizeObserver | null = null;
const measure = () => {
  const w = mapBox.value?.clientWidth ?? root.value?.clientWidth;
  // KeepAlive で外れている間は 0 になる。そのときは前の幅のまま
  if (typeof w === "number" && w > 0) width.value = Math.round(w);
};

onMounted(() => {
  void load();
  if (typeof ResizeObserver === "function" && root.value) {
    observer = new ResizeObserver(() => measure());
    observer.observe(root.value as Element);
  }
});
// 初回（onMounted の load が動いている間）は何もしない。読めていれば裏で取り直し、読めていなければ読み直す
onActivated(() => {
  measure();
  if (state.value === "ready") void refresh();
  else if (state.value === "error") void load();
});

// 後ろの画面（この画面と下部ナビ）を inert にする。シートは body の直下にあるので外れる（ConnectionsScreen と同じ）
let inertHost: Element | null = null;
const setInert = (on: boolean) => {
  if (on) {
    inertHost = (root.value?.parentNode as Element | null) ?? null;
    inertHost?.setAttribute("inert", "");
  } else {
    inertHost?.removeAttribute("inert");
    inertHost = null;
  }
};

const buttonOf = (id: string): HTMLElement | null =>
  (mapBox.value ? Array.from(mapBox.value.querySelectorAll<HTMLElement>("button[data-word]")) : []).find((el) => el.dataset.word === id) ?? null;

const open = (w: PlacedWord) => {
  if (openLabel.value) return;
  openLabel.value = w.id;
  setInert(true);
};
// immediate: 画面を離れたとき（シートのひとことから S3 へ、戻るボタン、下部ナビ）。フォーカスは動かさない
const close = ({ immediate = false } = {}) => {
  const id = openLabel.value;
  if (!id) return;
  openLabel.value = null;
  setInert(false);
  if (!immediate) void nextTick(() => buttonOf(id)?.focus({ preventScroll: true }));
};

// 開いている言葉が地図から消えたら（集めなおした地図で 2 回を割った・別の年にも出て役が変わった・別の言葉が選ばれた）、
// シートは外れるので、inert も外してフォーカスを見出しへ置く（残すと、下部ナビも含めて何も押せなくなる）
watch(openKeyword, (k) => {
  if (k || !openLabel.value) return;
  close({ immediate: true });
  void nextTick(() => focusHeading(heading.value));
});

const back = () => goBack({ name: "past" });
// 左端からなぞって戻る（シートが出ている間は拾わない）
useEdgeSwipe(root, { onBack: () => goBack({ name: "past" }, { swipe: true }), enabled: () => !openLabel.value });

onDeactivated(() => {
  stopWeave();
  if (!collecting.value) live.value = "";
  close({ immediate: true });
});
onUnmounted(() => {
  setInert(false);
  observer?.disconnect();
  timers.forEach((t) => clearTimeout(t));
  timers.clear();
});

// S3 で消した記憶は、取り直しを待たずに引用から外す（数は戻ったときの取り直しで直る）
useMemoryDeleted((id) => {
  const m = data.value?.map;
  if (!m) return;
  data.value = { ...data.value!, map: { ...m, keywords: m.keywords.map((k) => ({ ...k, mentions: k.mentions.filter((x) => x.memory_id !== id) })) } };
});

// 年の札・言葉・線の現れる順（--i）
const orderOf = computed(() => {
  const order = new Map<string, number>();
  layout.value?.words.forEach((w, i) => order.set(w.id, Math.min(i, 29)));
  return order;
});
</script>

<template>
  <main ref="root" class="flex flex-1 flex-col gap-5 py-4">
    <button type="button" class="press self-start min-h-11 tracking-[.04em] text-ink-soft" @click="back">‹ これまで</button>

    <!-- 便箋の天（ADR-0010）: 見出しの下に朱の二重罫。添え書きは地図に言葉があるときだけ -->
    <header class="rule-double -mt-3 pb-3">
      <h1 ref="heading" class="text-[24px] tracking-[.04em] [font-feature-settings:'palt'] focus:outline-none">ことばの地図</h1>
      <p v-if="state === 'ready' && hasWords" class="mt-0.5 text-sm leading-[1.7] tracking-[.02em] text-ink-soft">くり返し出てくることばを、年ごとに</p>
    </header>

    <!-- 読み上げの知らせ（集めている・できた・集められなかった）。後から差し込んだ所は読まれないことがあるので、初めから置いて文字だけ入れ替える -->
    <p class="sr-only" role="status" aria-live="polite" data-live>{{ live }}</p>

    <p v-if="state === 'loading'" class="py-16 text-center text-sm text-ink-soft" role="status">よみこみ中</p>

    <section v-else-if="state === 'error'" class="flex flex-col items-center gap-3 py-16 text-center">
      <p class="text-ink-soft">読み込めませんでした</p>
      <button type="button" class="btn btn-quiet press" @click="load">もう一度</button>
    </section>

    <!-- 集めている間（地図がまだ無いとき）。静かに、しつけ糸の目が縫われていく -->
    <section v-else-if="!map && collecting" class="flex flex-1 flex-col items-center justify-center gap-2 py-16 text-center" aria-hidden="true">
      <svg width="64" height="12" viewBox="0 0 64 12" fill="none" focusable="false">
        <line v-for="s in STITCHES" :key="s.i" class="waiting-stitch" :x1="s.x1" :x2="s.x2" :y1="s.y" :y2="s.y" :style="{ '--i': s.i }" />
      </svg>
      <p class="tracking-[.04em] text-ink-soft">ことばを集めています</p>
      <p class="text-sm text-ink-soft">少し時間がかかります</p>
    </section>

    <!-- 記憶がまだ少ない（8 件未満）、または集めた言葉がくり返し出てこなかった -->
    <section v-else-if="(!map && few) || (map && !hasWords && !collecting)" class="flex flex-1 flex-col items-center justify-center gap-1 py-16 text-center text-ink-soft">
      <p>もう少し書きためると、<br />ことばの地図ができます。</p>
      <a href="#today" class="inline-flex min-h-11 items-center tracking-[.04em] text-ink"><span class="ember-underline">きょうのひとことから</span></a>
      <button v-if="map && staleCount > 0" type="button" class="press mt-2 min-h-11 px-2 text-sm tracking-[.06em] text-ink-soft" @click="collect">集めなおす</button>
    </section>

    <!-- 地図がまだ無い -->
    <section v-else-if="!map" class="flex flex-1 flex-col items-center justify-center gap-5 py-12 text-center">
      <p v-if="collectFailed" class="leading-[1.8] text-ink-soft">いまは、うまく集められませんでした。<br />少し時間をおいて、もう一度どうぞ。</p>
      <p v-else class="leading-[1.8] text-ink-soft">これまでのひとことから、<br />くり返し出てくることばを集めて、<br />年ごとの地図にします。</p>
      <button type="button" class="btn btn-primary press px-10" @click="collect">{{ collectFailed ? "もう一度" : "ことばを集める" }}</button>
    </section>

    <template v-else>
      <!-- 地図の上の知らせ: 集めている / 集めなおせなかった / 新しいひとことがある -->
      <div v-if="collecting" class="-mt-1 flex min-h-11 items-center gap-2.5" aria-hidden="true">
        <svg width="64" height="12" viewBox="0 0 64 12" fill="none" focusable="false">
          <line v-for="s in STITCHES" :key="s.i" class="waiting-stitch" :x1="s.x1" :x2="s.x2" :y1="s.y" :y2="s.y" :style="{ '--i': s.i }" />
        </svg>
        <span class="text-sm tracking-[.04em] text-ink-soft">ことばを集めています</span>
      </div>
      <p v-else-if="collectFailed && hasWords" class="-mt-1 flex min-h-11 flex-wrap items-center gap-x-2 text-sm text-ink-soft">
        <span>いまは集めなおせませんでした。</span>
        <button type="button" class="press min-h-11 tracking-[.04em] text-ink" @click="collect"><span class="ember-underline">もう一度</span></button>
      </p>
      <p v-else-if="staleCount > 0 && hasWords" class="-mt-1 flex min-h-11 flex-wrap items-center gap-x-2 text-sm text-ink-soft">
        <span>新しいひとことが {{ staleCount }} こあります。</span>
        <button type="button" class="press min-h-11 tracking-[.04em] text-ink" @click="collect"><span class="ember-underline">集めなおす</span></button>
      </p>

      <!-- 地図。線は SVG（aria-hidden）、年と言葉はふつうの要素。読み上げは年 → その年の言葉 → 次の年とのあいだの言葉の順 -->
      <div
        v-if="layout"
        ref="mapBox"
        class="words-map relative -mx-1"
        :class="{ 'is-weaving': weaving, 'is-collecting': collecting }"
        :style="{ height: `${layout.height}px` }"
      >
        <div
          class="words-spine pointer-events-none absolute w-[1.5px] bg-line-strong"
          :style="{ left: `${layout.spineX - 0.75}px`, top: `${layout.spineTop}px`, height: `${Math.max(0, layout.spineBottom - layout.spineTop)}px` }"
          aria-hidden="true"
        ></div>
        <svg
          class="pointer-events-none absolute inset-0 overflow-visible"
          :width="layout.width"
          :height="layout.height"
          :viewBox="`0 0 ${layout.width} ${layout.height}`"
          fill="none"
          aria-hidden="true"
          focusable="false"
        >
          <path
            v-for="l in layout.links"
            :key="l.id"
            :d="l.d"
            :class="strokeOf(l).class"
            :stroke-width="strokeOf(l).width"
            :stroke-dasharray="strokeOf(l).dash"
            :stroke-opacity="strokeOf(l).opacity"
            stroke-linecap="round"
            :style="{ '--i': orderOf.get(l.word) ?? 0 }"
          />
          <circle
            v-for="k in layout.knots"
            :key="k.id"
            :cx="k.x"
            :cy="k.y"
            :r="knotOf(k).r"
            :class="knotOf(k).class"
            stroke-width="1.25"
            :style="{ '--i': orderOf.get(k.word) ?? 0 }"
          />
        </svg>
        <ol role="list" aria-label="年ごとのことば">
          <li v-for="(row, ri) in layout.rows" :key="row.year.year">
            <p
              class="words-year absolute flex items-center justify-center rounded-pill border border-line-strong bg-card font-display text-[16px] font-bold tracking-[.04em] text-ink shadow-press"
              :style="{ left: `${layout.spineX - 29}px`, top: `${row.year.y - 15}px`, width: '58px', height: '30px', '--i': Math.min(ri, 12) }"
            >{{ row.year.year }}<span class="sr-only">年</span></p>
            <button
              v-for="w in [...row.leaves, ...row.bridges]"
              :key="w.id"
              type="button"
              :data-word="w.id"
              :data-role="w.keyword.role"
              class="words-word press absolute flex items-center"
              :class="w.side === 'right' ? 'justify-start' : 'justify-end'"
              :style="{ left: `${w.x}px`, top: `${w.y}px`, width: `${w.w}px`, height: `${w.h}px`, '--i': orderOf.get(w.id) ?? 0 }"
              :aria-label="nameOf(w)"
              aria-haspopup="dialog"
              :aria-controls="openLabel === w.id ? SHEET_ID : undefined"
              @click="open(w)"
            >
              <span
                class="block max-w-full rounded-pill border px-[10px] py-[3px] font-letter leading-[1.45] font-medium tracking-[.02em] text-ink"
                :class="[
                  w.keyword.role === 'bridge' ? 'border-ember/50 bg-ember-soft' : 'border-line bg-card shadow-press',
                  w.lines === 2 ? 'line-clamp-2 rounded-[14px] text-center' : 'whitespace-nowrap',
                ]"
                :style="{ fontSize: `${w.size}px` }"
              >{{ w.keyword.label }}</span>
            </button>
          </li>
        </ol>
      </div>
      <p v-if="hasWords" class="text-center text-sm text-ink-soft">{{ generatedOn }}に集めました</p>
    </template>

    <WordSheet v-if="openKeyword" :keyword="openKeyword" :sheet-id="SHEET_ID" @close="close()" />
  </main>
</template>
