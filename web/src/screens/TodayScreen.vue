<script setup lang="ts">
// S1 きょう。入力 → 保存 → 「残しました」。候補と札は 11/6 で足す。
// App.vue の KeepAlive で残すので、ほかの画面へ移っても書きかけ・残しました・候補・札はそのまま（wireframes 0 節）。
import { computed, nextTick, onActivated, onDeactivated, onUnmounted, ref, watch } from "vue";
import { api, ApiError } from "../api";
import PhotoImg from "../components/PhotoImg.vue";
import type { Fact, Memory, Precision, Recall } from "../api/types";
import FactChips from "../components/FactChips.vue";
import RecallCard from "../components/RecallCard.vue";
import { usePolling } from "../composables/usePolling";
import DateSheet from "../components/DateSheet.vue";
import PhotoPicker from "../components/PhotoPicker.vue";
import { PHOTO_MAX_BYTES, shrinkPhoto } from "../photo";
import { formatHappenedOn, toIsoDate } from "../date";
import { hrefFor } from "../composables/useScreen";
import { useMemoryDeleted } from "../composables/useMemoryDeleted";
import { keepDecided } from "../facts";

defineOptions({ name: "TodayScreen" }); // KeepAlive の include で使う

const body = ref("");
const precision = ref<Precision>("day");
const date = ref(toIsoDate(new Date())); // 常に YYYY-MM-DD。精度に応じて POST 時に切り詰める
// 「いつ？」で日付か精度を変えたら立てる。立っていなければ、戻ってきたときに既定の日付（今日）を取り直す
const dateTouched = ref(false);
const sheetOpen = ref(false);
const whenButton = ref<HTMLButtonElement | null>(null);
const saving = ref(false);
const error = ref("");
const saved = ref<Memory | null>(null);
// KeepAlive で DOM が戻ると .appear の動きがやり直されるので、離れる前に見せたカードと札は戻ってきたとき動かさない。
// 離れている間や戻ったあとに届いた札は、これまでどおり現れる動きで出す
const shownIds = ref(new Set<string>());
// 401 で S0 に戻ると画面ごと捨てる。保存の途中だった場合に、捨てた画面のためのポーリングを始めない
let alive = true;
onUnmounted(() => {
  alive = false;
});
const photo = ref<File | null>(null);
const photoNote = ref("");

// 保存直後: 候補と札が届くまで静かに待つ（両方の pending が false で止まる）
const facts = ref<Fact[]>([]);
const recalls = ref<Recall[]>([]);
const polling = usePolling(
  async () => {
    const id = saved.value!.id;
    const [f, r] = await Promise.all([api.getFacts(id), api.getRecalls(id)]);
    return { f, r };
  },
  (v) => !v.f.pending && !v.r.pending,
);
const applyPolled = (v: { f: { items: Fact[] }; r: { items: Recall[] } } | null) => {
  if (!v) return;
  // 画面で確定・却下した状態を上書きしないよう、既存の status を優先する
  const prev = new Map(facts.value.map((x) => [x.id, x.status]));
  facts.value = v.f.items.map((x) => ({ ...x, status: prev.get(x.id) ?? x.status }));
  recalls.value = v.r.items;
};
watch(() => polling.value.value, (v) => applyPolled(v));

const MAX = 2000;
const remaining = computed(() => MAX - Array.from(body.value).length);
const hasDate = computed(() => precision.value === "unknown" || /^\d{4}-\d{2}-\d{2}$/.test(date.value));
const canSave = computed(() => body.value.trim().length > 0 && remaining.value >= 0 && hasDate.value && !saving.value);

// POST に入れる happened_on（day: YYYY-MM-DD / month: YYYY-MM / year: YYYY）
const happenedOnForPost = computed(() => {
  if (precision.value === "month") return date.value.slice(0, 7);
  if (precision.value === "year") return date.value.slice(0, 4);
  return date.value;
});

// 見出しは選んだ精度で丸めた起きた日
const headingDate = computed(() => {
  if (precision.value === "unknown") return formatHappenedOn(null, "unknown");
  if (!hasDate.value) return formatHappenedOn(toIsoDate(new Date()), precision.value);
  return formatHappenedOn(date.value, precision.value);
});

const closeSheet = () => {
  sheetOpen.value = false;
  void nextTick(() => whenButton.value?.focus());
};

const save = async () => {
  if (!canSave.value) return;
  saving.value = true;
  error.value = "";
  photoNote.value = "";
  let memory: Memory;
  try {
    memory = await api.createMemory({
      body: body.value.trim(),
      happened_on_precision: precision.value,
      ...(precision.value === "unknown" ? {} : { happened_on: happenedOnForPost.value }),
    });
  } catch {
    error.value = "うまく保存できませんでした。もう少ししてから、もう一度";
    saving.value = false;
    return;
  }
  // 記憶は残った。写真だけ失敗しても記憶は消さない（requirements F2 エラー時）
  if (photo.value) {
    try {
      const blob = await shrinkPhoto(photo.value);
      if (blob.size > PHOTO_MAX_BYTES) throw new Error("too large");
      const r = await api.putPhoto(memory.id, blob);
      memory = { ...memory, photo_key: r.photo_key, photo_content_type: r.photo_content_type };
    } catch {
      photoNote.value = "写真だけ、あとでもう一度";
    }
  }
  saved.value = memory;
  body.value = "";
  photo.value = null;
  saving.value = false;
  facts.value = [];
  recalls.value = [];
  if (alive) polling.start();
};

const another = () => {
  polling.stop();
  saved.value = null;
  facts.value = [];
  recalls.value = [];
  precision.value = "day";
  date.value = toIsoDate(new Date());
  dateTouched.value = false;
  shownIds.value = new Set();
};

// 残しておいた S1 に戻ってきたとき。日をまたいで残っていても、触っていない既定の日付は今日にする
const refreshDefaultDate = () => {
  if (!saved.value && !dateTouched.value) date.value = toIsoDate(new Date());
};

// 保存した記憶を S3 で開いて戻ってきたとき、S3 で決めた候補・添え直した写真・届いた札を映す。
// 記憶が消えていたら（404）入力に戻す。ほかの失敗は静かに今のまま
const recheckSaved = async (id: string) => {
  try {
    const d = await api.getMemory(id);
    if (saved.value?.id !== id) return;
    saved.value = d.memory;
    if (d.memory.photo_key) photoNote.value = "";
    facts.value = keepDecided(facts.value, d.facts.items);
    recalls.value = d.recalls.items;
  } catch (e) {
    if (e instanceof ApiError && e.status === 404 && saved.value?.id === id) another();
  }
};

onActivated(() => {
  refreshDefaultDate();
  if (saved.value) void recheckSaved(saved.value.id);
});
// 離れるとき: シートを閉じ（選んだ値はそのまま残る）、いま見えているカードと札を「見せた」に数える
onDeactivated(() => {
  sheetOpen.value = false;
  shownIds.value = new Set([...(saved.value ? [saved.value.id] : []), ...recalls.value.map((r) => r.id)]);
});

// S3 で消した記憶のカードや札を残さない（非アクティブの間に届く）
useMemoryDeleted((id) => {
  if (saved.value?.id === id) another();
  else recalls.value = recalls.value.filter((r) => r.related_memory.id !== id);
});
</script>

<template>
  <main class="flex flex-1 flex-col gap-6 py-6">
    <template v-if="!saved">
      <header class="flex items-baseline justify-between">
        <h1 class="text-[22px]">{{ headingDate }}</h1>
        <button ref="whenButton" type="button" class="min-h-11 px-2 text-sm text-ink-soft" @click="sheetOpen = true">いつ？</button>
      </header>

      <section class="card p-4">
        <label class="sr-only" for="body">きょうのひとこと</label>
        <textarea
          id="body"
          v-model="body"
          rows="5"
          class="field-sizing-content w-full resize-none bg-transparent leading-relaxed outline-none"
          placeholder="きょうのひとこと"
        ></textarea>
        <p v-if="remaining < 100" class="text-right text-sm text-ink-soft" aria-live="polite">あと {{ remaining }} 文字</p>
      </section>

      <PhotoPicker v-model="photo" />

      <div class="flex flex-col items-center gap-3">
        <button class="btn btn-primary px-10" type="button" :disabled="!canSave" @click="save">保存する</button>
        <p v-if="error" class="text-sm text-ink-soft" role="alert">{{ error }}</p>
      </div>

      <DateSheet
        v-if="sheetOpen"
        v-model:precision="precision"
        v-model:date="date"
        @update:precision="dateTouched = true"
        @update:date="dateTouched = true"
        @close="closeSheet"
      />
    </template>

    <template v-else>
      <p class="text-sm text-ink-soft" role="status">残しました</p>
      <article class="card overflow-hidden" :class="shownIds.has(saved.id) ? '' : 'appear'">
        <PhotoImg v-if="saved.photo_key" :photo-key="saved.photo_key" class="h-[200px] w-full object-cover" />
        <div class="p-4">
          <p class="text-sm text-ink-soft">{{ formatHappenedOn(saved.happened_on, saved.happened_on_precision) }}</p>
          <p class="mt-1 whitespace-pre-wrap leading-relaxed">{{ saved.body }}</p>
          <FactChips v-if="facts.length > 0" class="mt-4" :facts="facts" />
        </div>
      </article>
      <!-- 写真だけ失敗したとき: 案内のすぐ下に、いま書いた記憶の S3（「写真を添える」がある）へのリンクを置く。
           札の「ひらく ›」（昔の記憶へ）と取り違えないよう、行き先を文言で言う。読み上げが文だけで済むよう alert の外に置く -->
      <div v-if="photoNote" class="flex flex-col items-start">
        <p class="text-sm text-ink-soft" role="alert">{{ photoNote }}</p>
        <a :href="hrefFor({ name: 'memory', id: saved.id, from: 'today' })" class="inline-flex min-h-11 items-center text-sm text-ink-soft">写真を添え直す ›</a>
      </div>
      <RecallCard v-for="r in recalls" :key="r.id" :recall="r" from="today" :animate="!shownIds.has(r.id)" />
      <div class="flex items-baseline gap-6">
        <button type="button" class="min-h-11 border-b border-ember text-ink" @click="another">もうひとつ書く</button>
        <!-- いま書いた記憶へ。札の「ひらく ›」は昔の記憶へ行くので、同じ文言にしない -->
        <a :href="hrefFor({ name: 'memory', id: saved.id, from: 'today' })" class="inline-flex min-h-11 items-center text-sm text-ink-soft">このひとことをひらく ›</a>
      </div>
    </template>
  </main>
</template>
