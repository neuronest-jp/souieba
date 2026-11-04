<script setup lang="ts">
// 写真の表示。<img src> では Authorization ヘッダが付かないため、Bearer 付きで取得して blob URL で描く。
// 同じ鍵は一度だけ取得する（画面内の一覧と詳細で共有）。
import { onUnmounted, ref, watch } from "vue";
import { fetchPhotoObjectUrl, releasePhotoObjectUrl } from "../photos";

const props = defineProps<{ photoKey: string; alt?: string }>();
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
  <div v-else-if="!failed" class="bg-line/40" v-bind="$attrs" aria-hidden="true"></div>
  <div v-else class="flex items-center justify-center bg-line/40 text-sm text-ink-faint" v-bind="$attrs">写真を読めませんでした</div>
</template>
