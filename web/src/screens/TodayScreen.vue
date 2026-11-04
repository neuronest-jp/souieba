<script setup lang="ts">
// S1 きょう。入力 → 保存 → 「残しました」。候補と札は 11/6 で足す。
import { computed, nextTick, ref, watch } from "vue";
import { api, photoUrl } from "../api";
import type { Fact, Memory, Precision, Recall } from "../api/types";
import FactChips from "../components/FactChips.vue";
import RecallCard from "../components/RecallCard.vue";
import { usePolling } from "../composables/usePolling";
import DateSheet from "../components/DateSheet.vue";
import PhotoPicker from "../components/PhotoPicker.vue";
import { PHOTO_MAX_BYTES, shrinkPhoto } from "../photo";
import { formatHappenedOn, toIsoDate } from "../date";
import { hrefFor } from "../composables/useScreen";

const body = ref("");
const precision = ref<Precision>("day");
const date = ref(toIsoDate(new Date())); // 常に YYYY-MM-DD。精度に応じて POST 時に切り詰める
const sheetOpen = ref(false);
const whenButton = ref<HTMLButtonElement | null>(null);
const saving = ref(false);
const error = ref("");
const saved = ref<Memory | null>(null);
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
  polling.start();
};

const another = () => {
  polling.stop();
  saved.value = null;
  facts.value = [];
  recalls.value = [];
  precision.value = "day";
  date.value = toIsoDate(new Date());
};
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

      <DateSheet v-if="sheetOpen" v-model:precision="precision" v-model:date="date" @close="closeSheet" />
    </template>

    <template v-else>
      <p class="text-sm text-ink-soft" role="status">残しました</p>
      <article class="card appear overflow-hidden">
        <img v-if="saved.photo_key" :src="photoUrl(saved.photo_key)" alt="" class="h-[200px] w-full object-cover" />
        <div class="p-4">
          <p class="text-sm text-ink-soft">{{ formatHappenedOn(saved.happened_on, saved.happened_on_precision) }}</p>
          <p class="mt-1 whitespace-pre-wrap leading-relaxed">{{ saved.body }}</p>
          <FactChips v-if="facts.length > 0" class="mt-4" :facts="facts" />
        </div>
      </article>
      <p v-if="photoNote" class="text-sm text-ink-soft" role="alert">{{ photoNote }}</p>
      <RecallCard v-for="r in recalls" :key="r.id" :recall="r" from="today" />
      <div class="flex items-baseline gap-6">
        <button type="button" class="min-h-11 border-b border-ember text-ink" @click="another">もうひとつ書く</button>
        <a :href="hrefFor({ name: 'memory', id: saved.id, from: 'today' })" class="min-h-11 text-ink-soft">ひらく ›</a>
      </div>
    </template>
  </main>
</template>
