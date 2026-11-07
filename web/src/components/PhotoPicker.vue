<script setup lang="ts">
// 写真を添える。ネイティブでは撮影 / ライブラリ（@capacitor/camera）、Web では <input type="file">。
// variant:
//   letter … S1 の便箋の下の段（ブラッシュアップ 11/7）。カメラの小さな絵と「写真」の札。読み上げの名前は「写真を添える」のまま
//            （見える「写真」を名前の頭に含む）。添えた写真は白いふちの焼き付けのプリントで便箋の上に置く
//   button … S3 の副ボタン（これまでの形）
// 写真を開いている間（picking）は「写真を開いています」を出して二度押させない。iPhone の写真が iCloud にしか無いと、選んでから
// 届くまで数秒かかり、待てずに押し直すとプラグインが 1 枚目を 2 回目の呼び出しに返し、2 回目に選んだ写真を捨てる（見直し n=14）。
// 時間で外す仕掛けは入れない（どの道も resolve か reject で終わる。見えなくなったところで外すと、取り込み中に外れて同じ取り違えが戻る）。
// 開いている間は picking を親に知らせる（S1 は「保存する」を押させない。写真なしで残ってしまうため）。
// disabled（S1 で保存している間）は選び直しも「はずす」も効かない。上げている途中の写真は外せないので、押せる形にしない（見直し n=15）
import { nextTick, onUnmounted, ref, watch } from "vue";
import { pickPhoto } from "../camera";
import { tap } from "../haptics";
import { PHOTO_MAX_BYTES } from "../photo";

const props = withDefaults(defineProps<{ disabled?: boolean; variant?: "letter" | "button" }>(), { disabled: false, variant: "button" });
const emit = defineEmits<{ picking: [value: boolean] }>();
const model = defineModel<File | null>({ required: true });
const preview = ref<string | null>(null);
const message = ref("");
const picking = ref(false);
const chooseButton = ref<HTMLButtonElement | null>(null);
// いま選んだ写真だけ、プリントを置く動きを付ける（戻ってきたとき・最初から添えてあるときは動かさない）
const placed = ref(false);
let placedTimer: ReturnType<typeof setTimeout> | null = null;

const setPicking = (v: boolean) => {
  picking.value = v;
  emit("picking", v);
};

const choose = async () => {
  if (picking.value || props.disabled) return;
  tap();
  message.value = "";
  setPicking(true);
  try {
    const picked = await pickPhoto("prompt");
    if (!picked) return;
    if ("error" in picked) {
      message.value =
        picked.error === "denied" ? "写真を使う許可が必要です（端末の設定から変えられます）" : "写真を開けませんでした。もう一度押してみてください";
      return;
    }
    const f = picked.file;
    if (f.type !== "image/jpeg" && f.type !== "image/png") {
      message.value = "JPEG か PNG の写真だけ添えられます";
      return;
    }
    if (f.size > PHOTO_MAX_BYTES * 4) {
      // 縮小前でも極端に大きいものは断る（縮小後 10MB 以下になる見込みが無い）
      message.value = "写真が大きすぎるみたいです（10MB まで）";
      return;
    }
    model.value = f;
    placed.value = true;
    if (placedTimer) clearTimeout(placedTimer);
    placedTimer = setTimeout(() => (placed.value = false), 700);
  } finally {
    setPicking(false);
  }
};

// 「はずす」は押したボタンごと消える。キーボード（Enter / Space）や読み上げで押したとき（click の detail が 0）だけ、
// 同じ場所に残る「写真を添える」へフォーカスを戻す（FactChips と同じ決まり。指で押したときは動かさない。wireframes 6 節）。
// 利用者がほかへ動かしたフォーカスは奪わない
const clear = (e: MouseEvent) => {
  if (props.disabled) return;
  tap();
  model.value = null;
  message.value = "";
  if (e.detail !== 0) return;
  void nextTick(() => {
    const active = document.activeElement;
    if (!active || active === document.body) chooseButton.value?.focus({ preventScroll: true });
  });
};

watch(
  model,
  (f) => {
    if (preview.value) URL.revokeObjectURL(preview.value);
    preview.value = f ? URL.createObjectURL(f) : null;
  },
  { immediate: true },
);
onUnmounted(() => {
  if (preview.value) URL.revokeObjectURL(preview.value);
  if (placedTimer) clearTimeout(placedTimer);
});
</script>

<template>
  <!-- S1: 便箋の下の段。添えた写真は段の上に焼き付けのプリントで置く -->
  <div v-if="variant === 'letter'">
    <div v-if="preview" class="mt-3 flex items-end gap-3">
      <figure class="photo-print m-0" :class="placed ? 'is-placed' : ''">
        <img :src="preview" alt="添えた写真" class="block h-[84px] w-[112px] rounded-[2px] object-cover" />
      </figure>
      <button type="button" class="min-h-11 px-2 text-sm text-ink-soft disabled:text-ink-faint" :disabled="disabled" @click="clear">はずす</button>
    </div>
    <div class="photo-band mt-3 flex min-h-12 flex-wrap items-center gap-x-3 pt-1.5">
      <button
        ref="chooseButton"
        type="button"
        class="photo-tag press"
        :disabled="disabled || picking"
        :aria-label="preview ? undefined : '写真を添える'"
        @click="choose"
      >
        <!-- カメラの線画（飾り）。形はデータにせず 2 つだけ -->
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" aria-hidden="true" focusable="false">
          <path d="M4.5 8h2.8l1.6-2.2h6.2L16.7 8h2.8a1.5 1.5 0 0 1 1.5 1.5v8A1.5 1.5 0 0 1 19.5 19h-15A1.5 1.5 0 0 1 3 17.5v-8A1.5 1.5 0 0 1 4.5 8Z" />
          <circle cx="12" cy="13.2" r="3.3" />
        </svg>
        <span>{{ preview ? "写真を変える" : "写真" }}</span>
      </button>
      <p v-if="picking" class="text-sm text-ink-soft" role="status">写真を開いています</p>
    </div>
    <p v-if="message" class="mt-1 text-sm text-ink-soft" role="alert">{{ message }}</p>
  </div>

  <!-- S3: これまでの副ボタン -->
  <div v-else class="flex flex-col gap-3">
    <div v-if="preview" class="card overflow-hidden">
      <img :src="preview" alt="添えた写真" class="h-[200px] w-full object-cover" />
    </div>
    <div class="flex flex-wrap items-center gap-x-4 gap-y-2">
      <button ref="chooseButton" type="button" class="btn btn-quiet" :disabled="disabled || picking" @click="choose">
        {{ preview ? "写真を変える" : "写真を添える" }}
      </button>
      <button v-if="preview" type="button" class="min-h-11 px-2 text-sm text-ink-soft" :disabled="disabled" @click="clear">はずす</button>
      <p v-if="picking" class="text-sm text-ink-soft" role="status">写真を開いています</p>
    </div>
    <p v-if="message" class="text-sm text-ink-soft" role="alert">{{ message }}</p>
  </div>
</template>
