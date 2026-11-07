<script setup lang="ts">
// 写真を添える。ネイティブでは撮影 / ライブラリ（@capacitor/camera）、Web では <input type="file">。
import { onUnmounted, ref, watch } from "vue";
import { pickPhoto } from "../camera";
import { PHOTO_MAX_BYTES } from "../photo";

const model = defineModel<File | null>({ required: true });
const preview = ref<string | null>(null);
const message = ref("");

const choose = async () => {
  message.value = "";
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
};

const clear = () => {
  model.value = null;
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
      <button type="button" class="btn btn-quiet" @click="choose">{{ preview ? "写真を変える" : "写真を添える" }}</button>
      <button v-if="preview" type="button" class="min-h-11 px-2 text-sm text-ink-soft" @click="clear">はずす</button>
    </div>
    <p v-if="message" class="text-sm text-ink-soft" role="alert">{{ message }}</p>
  </div>
</template>
