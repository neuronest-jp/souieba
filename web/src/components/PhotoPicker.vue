<script setup lang="ts">
// 写真を添える。JPEG / PNG のみ。選ぶとプレビュー、保存時に縮小して PUT する（縮小は TodayScreen 側）。
import { onUnmounted, ref, watch } from "vue";
import { PHOTO_MAX_BYTES } from "../photo";

const model = defineModel<File | null>({ required: true });
const input = ref<HTMLInputElement | null>(null);
const preview = ref<string | null>(null);
const message = ref("");

const onChange = (e: Event) => {
  const f = (e.target as HTMLInputElement).files?.[0] ?? null;
  message.value = "";
  if (!f) return;
  if (f.type !== "image/jpeg" && f.type !== "image/png") {
    message.value = "JPEG か PNG の写真だけ添えられます";
    if (input.value) input.value.value = "";
    return;
  }
  if (f.size > PHOTO_MAX_BYTES * 4) {
    // 縮小前でも極端に大きいものは断る（縮小後 10MB 以下になる見込みが無い）
    message.value = "写真が大きすぎるみたいです（10MB まで）";
    if (input.value) input.value.value = "";
    return;
  }
  model.value = f;
};

const clear = () => {
  model.value = null;
  if (input.value) input.value.value = "";
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
});
</script>

<template>
  <div class="flex flex-col gap-3">
    <div v-if="preview" class="card overflow-hidden">
      <img :src="preview" alt="添えた写真" class="h-[200px] w-full object-cover" />
    </div>
    <div class="flex items-center gap-4">
      <label class="btn btn-quiet cursor-pointer px-4 text-sm">
        {{ preview ? "写真を変える" : "写真を添える" }}
        <input ref="input" type="file" accept="image/jpeg,image/png" class="sr-only" @change="onChange" />
      </label>
      <button v-if="preview" type="button" class="min-h-11 px-2 text-sm text-ink-soft" @click="clear">はずす</button>
    </div>
    <p v-if="message" class="text-sm text-ink-soft" role="alert">{{ message }}</p>
  </div>
</template>
