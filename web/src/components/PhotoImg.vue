<script setup lang="ts">
// 写真の表示。<img src> では Authorization ヘッダが付かないため、Bearer 付きで取得して blob URL で描く。
// 同じ鍵は一度だけ取得する（画面内の一覧と詳細で共有）。
// boxClass: 読み込み中と読めなかったときの枠の class。省くと写真と同じ class（呼び出し側の class）で枠を描く。
// S3 のように写真を自分の比率で出す（幅も高さも決めない）ときは、そのままでは枠の大きさが 0 になるので別に渡す
import { onUnmounted, ref, watch } from "vue";
import { fetchPhotoObjectUrl, releasePhotoObjectUrl } from "../photos";

defineOptions({ inheritAttrs: false }); // 呼び出し側の class は下の 3 つの要素に自分で配る
const props = defineProps<{ photoKey: string; alt?: string; boxClass?: string }>();
const src = ref<string | null>(null);
const failed = ref(false);
let current: string | null = null;

const load = async (key: string) => {
  failed.value = false;
  if (current) releasePhotoObjectUrl(current);
  current = key;
  try {
    const url = await fetchPhotoObjectUrl(key);
    if (current === key) src.value = url;
  } catch {
    if (current === key) failed.value = true;
  }
};

watch(() => props.photoKey, (k) => void load(k), { immediate: true });
onUnmounted(() => {
  if (current) releasePhotoObjectUrl(current);
});
</script>

<template>
  <img v-if="src" :src="src" :alt="alt ?? ''" v-bind="$attrs" />
  <div v-else-if="!failed" class="bg-line/40" v-bind="boxClass === undefined ? $attrs : { ...$attrs, class: boxClass }" aria-hidden="true"></div>
  <div v-else class="flex items-center justify-center bg-line/40 text-sm text-ink-soft" v-bind="boxClass === undefined ? $attrs : { ...$attrs, class: boxClass }">写真を読めませんでした</div>
</template>
