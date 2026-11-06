<script setup lang="ts">
// S3 記憶の詳細。本文、起きた日、確定済みの事実、「そういえば。」の枠、削除。
// 写真の無い記憶には「写真を添える」を出す（S1 で写真だけ失敗したときの添え直し先）。
// 札の「ひらく ›」から来たとき（?recall=）は、その札を本文のすぐ下に反応ボタン付きで出す（wireframes 4.2）。
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from "vue";
import { api, ApiError } from "../api";
import PhotoImg from "../components/PhotoImg.vue";
import PhotoPicker from "../components/PhotoPicker.vue";
import { PHOTO_MAX_BYTES, shrinkPhoto } from "../photo";
import type { MemoryDetail, RecalledBy } from "../api/types";
import FactChips from "../components/FactChips.vue";
import RecallCard from "../components/RecallCard.vue";
import RecalledByCard from "../components/RecalledByCard.vue";
import { formatHappenedOn } from "../date";
import { useNotice } from "../composables/useNotice";
import { back as goBack, go } from "../composables/useScreen";

const props = defineProps<{ id: string; from: "today" | "past"; recall?: string }>();

const detail = ref<MemoryDetail | null>(null);
const state = ref<"loading" | "ready" | "missing" | "error">("loading");
const confirming = ref(false);
const deleting = ref(false);
const deleteError = ref("");
const deleteButton = ref<HTMLButtonElement | null>(null);
const cancelButton = ref<HTMLButtonElement | null>(null);

const openConfirm = () => {
  confirming.value = true;
  void nextTick(() => cancelButton.value?.focus());
};
const closeConfirm = () => {
  confirming.value = false;
  void nextTick(() => deleteButton.value?.focus());
};
const onKey = (e: KeyboardEvent) => {
  if (e.key === "Escape" && confirming.value) closeConfirm();
};
onMounted(() => window.addEventListener("keydown", onKey));
onUnmounted(() => window.removeEventListener("keydown", onKey));

const load = async () => {
  state.value = "loading";
  try {
    detail.value = await api.getMemory(props.id);
    state.value = "ready";
  } catch (e) {
    state.value = e instanceof ApiError && e.status === 404 ? "missing" : "error";
  }
};

// 候補と確定済みを並べる。却下は描かない（architecture 4.3）
const visibleFacts = computed(() => detail.value?.facts.items.filter((f) => f.status !== "rejected") ?? []);

// 本文中の引用（recalled_by の evidence）を強調する。最初の一致だけ（X-7）
const bodyParts = computed(() => {
  const d = detail.value;
  if (!d) return [] as Array<{ text: string; hit: boolean }>;
  const body = d.memory.body;
  const evidences = d.recalled_by.items.map((r) => r.evidence).filter((e) => e && body.includes(e));
  if (evidences.length === 0) return [{ text: body, hit: false }];
  const ranges = evidences
    .map((e) => ({ start: body.indexOf(e), end: body.indexOf(e) + e.length }))
    .sort((a, b) => a.start - b.start);
  const parts: Array<{ text: string; hit: boolean }> = [];
  let pos = 0;
  for (const r of ranges) {
    if (r.start < pos) continue; // 重なりは最初のものだけ
    if (r.start > pos) parts.push({ text: body.slice(pos, r.start), hit: false });
    parts.push({ text: body.slice(r.start, r.end), hit: true });
    pos = r.end;
  }
  if (pos < body.length) parts.push({ text: body.slice(pos), hit: false });
  return parts;
});

// 札から開いたときの札（recalled_by のうち ?recall= と同じ id）。見つからなければ 4.1 の並びのまま
const pinned = computed(() => (props.recall ? (detail.value?.recalled_by.items.find((r) => r.id === props.recall) ?? null) : null));
const restRecalledBy = computed(() => detail.value?.recalled_by.items.filter((r) => r.id !== pinned.value?.id) ?? []);

const feedbackBusy = ref<Set<string>>(new Set());
const feedbackNotice = useNotice();
const noticeFor = (r: RecalledBy) => (feedbackNotice.key.value === r.id ? feedbackNotice.message.value : "");
const react = async (r: RecalledBy, feedback: "helpful" | "not_related") => {
  if (feedbackBusy.value.has(r.id)) return;
  feedbackBusy.value.add(r.id);
  const prev = r.feedback;
  r.feedback = r.feedback === feedback ? "none" : feedback; // 同じ札をもう一度押すと取り消し
  try {
    await api.recallFeedback(r.id, r.feedback);
  } catch {
    r.feedback = prev; // 印を戻し、その札の下にそっと知らせる（F6 エラー時）
    feedbackNotice.show("記録できませんでした", r.id);
  } finally {
    feedbackBusy.value.delete(r.id);
  }
};

const remove = async () => {
  deleting.value = true;
  deleteError.value = "";
  try {
    await api.deleteMemory(props.id);
    go({ name: "past" });
  } catch {
    closeConfirm();
    deleteError.value = "消せませんでした";
  } finally {
    deleting.value = false;
  }
};

// 写真をあとから添える。新しい API は使わず PUT /api/memories/:id/photo（S1 と同じ）。本文には触らない
const addingPhoto = ref<File | null>(null);
const photoBusy = ref(false);
const photoError = ref("");
watch(addingPhoto, async (file) => {
  if (!file || photoBusy.value) return;
  const id = props.id;
  photoBusy.value = true;
  photoError.value = "";
  try {
    const blob = await shrinkPhoto(file);
    if (blob.size > PHOTO_MAX_BYTES) throw new Error("too large");
    const r = await api.putPhoto(id, blob);
    if (detail.value && detail.value.memory.id === id) {
      detail.value.memory = { ...detail.value.memory, photo_key: r.photo_key, photo_content_type: r.photo_content_type };
    }
  } catch {
    photoError.value = "写真を添えられませんでした。もう一度どうぞ";
  } finally {
    addingPhoto.value = null;
    photoBusy.value = false;
  }
});

const back = () => goBack({ name: props.from });

onMounted(load);
watch(() => props.id, load);
</script>

<template>
  <main class="flex flex-1 flex-col gap-4 py-4">
    <button type="button" class="self-start min-h-11 text-ink-soft" @click="back">‹ {{ from === "today" ? "きょう" : "これまで" }}</button>

    <p v-if="state === 'loading'" class="py-16 text-center text-sm text-ink-faint" role="status">よみこみ中</p>
    <p v-else-if="state === 'missing'" class="py-16 text-center text-ink-soft">この記憶は見つかりませんでした</p>
    <section v-else-if="state === 'error'" class="flex flex-col items-center gap-3 py-16">
      <p class="text-ink-soft">読み込めませんでした</p>
      <button type="button" class="btn btn-quiet" @click="load">もう一度</button>
    </section>

    <template v-else-if="detail">
      <h1 class="text-[22px]">{{ formatHappenedOn(detail.memory.happened_on, detail.memory.happened_on_precision) }}</h1>
      <PhotoImg v-if="detail.memory.photo_key" :photo-key="detail.memory.photo_key" class="max-h-[360px] min-h-[120px] w-full rounded-card object-cover" />
      <p class="whitespace-pre-wrap leading-relaxed">
        <template v-for="(p, i) in bodyParts" :key="i">
          <mark v-if="p.hit" class="rounded bg-ember-soft text-ink">{{ p.text }}</mark>
          <template v-else>{{ p.text }}</template>
        </template>
      </p>

      <RecalledByCard v-if="pinned" :item="pinned" heading :notice="noticeFor(pinned)" @react="(f) => react(pinned!, f)" />

      <div v-if="!detail.memory.photo_key" class="flex flex-col gap-2">
        <p v-if="photoBusy" class="text-sm text-ink-soft" role="status">写真を添えています</p>
        <PhotoPicker v-else v-model="addingPhoto" />
        <p v-if="photoError" class="text-sm text-ink-soft" role="alert">{{ photoError }}</p>
      </div>

      <FactChips v-if="visibleFacts.length > 0" class="mt-6" :facts="visibleFacts" title="おぼえていること" />

      <section v-if="restRecalledBy.length > 0 || detail.recalls.items.length > 0" class="mt-6 flex flex-col gap-3">
        <h2 class="font-display text-[22px] font-bold text-ember">そういえば。</h2>
        <!-- この記憶が思い出された側（相手 = 新しい記憶）。反応はここで返す。本文の下に出した札はここに重ねない -->
        <RecalledByCard v-for="r in restRecalledBy" :key="r.id" :item="r" :notice="noticeFor(r)" @react="(f) => react(r, f)" />
        <!-- この記憶を書いたとき浮かんだ札（相手 = 昔の記憶） -->
        <RecallCard v-for="r in detail.recalls.items" :key="r.id" :recall="r" :from="from" :heading="false" />
      </section>

      <div class="mt-auto flex flex-col items-end gap-3 pt-6">
        <p v-if="deleteError" class="text-sm text-ink-soft" role="alert">{{ deleteError }}</p>
        <button ref="deleteButton" type="button" class="min-h-11 px-2 text-sm text-ink-soft" @click="openConfirm">消す</button>
      </div>

      <div v-if="confirming" class="fixed inset-0 z-20 flex items-end justify-center bg-ink/30" @click.self="closeConfirm">
        <div class="w-full max-w-[560px] rounded-t-[20px] bg-card p-5 shadow-card" role="dialog" aria-modal="true" aria-labelledby="delete-title">
          <h2 id="delete-title" class="text-[22px]">この記憶を消しますか</h2>
          <p class="mt-2 text-sm text-ink-soft">写真も、この記憶から浮かんだ「そういえば。」も一緒に消えます。</p>
          <div class="mt-5 flex flex-col items-center gap-3">
            <button type="button" class="btn btn-primary px-10" :disabled="deleting" @click="remove">消す</button>
            <button ref="cancelButton" type="button" class="min-h-11 px-4 text-ink-soft" @click="closeConfirm">やめる</button>
          </div>
        </div>
      </div>
    </template>
  </main>
</template>
