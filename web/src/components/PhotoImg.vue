<script setup lang="ts">
// 写真の表示。<img src> では Authorization ヘッダが付かないため、Bearer 付きで取得して blob URL で描く。
// 同じ鍵は一度だけ取得する（画面内の一覧と詳細で共有）。
// boxClass: 読み込み中と読めなかったときの枠の class。省くと写真と同じ class（呼び出し側の class）で枠を描く。
// S3 のように写真を自分の比率で出す（幅も高さも決めない）ときは、そのままでは枠の大きさが 0 になるので別に渡す。
// quiet: 読めなかったときも文言を出さず、読み込み中と同じ空の枠にする（S2 の 56px の焼き付け。14px の文言は収まらない。見直し n=12）。
// 読めなかった写真は、画面に戻ったとき（KeepAlive の activated）と通信が戻ったとき（online）に取り直す。
// 読めた写真は、焼き付けがふわっと出る（.photo-develop。load までは透明。動きを減らす設定では待たずに出す）
import { onActivated, onMounted, onUnmounted, ref, watch } from "vue";
import { fetchPhotoObjectUrl, releasePhotoObjectUrl } from "../photos";

defineOptions({ inheritAttrs: false }); // 呼び出し側の class は下の 3 つの要素に自分で配る
const props = defineProps<{ photoKey: string; alt?: string; boxClass?: string; quiet?: boolean }>();
const src = ref<string | null>(null);
const failed = ref(false);
const shown = ref(false);
// 参照数を持っている鍵。取得に失敗した鍵は photos.ts がもう捨てているので持たない
// （持ったままだと、取り直しや外したときの release が、同じ鍵を持つほかの写真の参照数を減らしてしまう）
let current: string | null = null;

const load = async (key: string) => {
  failed.value = false;
  if (current) releasePhotoObjectUrl(current);
  current = key;
  try {
    const url = await fetchPhotoObjectUrl(key);
    if (current === key) src.value = url;
  } catch {
    if (current === key) {
      current = null;
      failed.value = true;
    }
  }
};
const retry = () => {
  if (failed.value) void load(props.photoKey);
};
// 取れた blob が描けなかった（先に手放された URL など）ときも、失敗として取り直せるようにする
const onError = () => {
  if (current) releasePhotoObjectUrl(current);
  current = null;
  src.value = null;
  failed.value = true;
};

watch(() => props.photoKey, (k) => void load(k), { immediate: true });
watch(src, () => (shown.value = false));
onActivated(retry);
onMounted(() => window.addEventListener("online", retry));
onUnmounted(() => {
  window.removeEventListener("online", retry);
  if (current) releasePhotoObjectUrl(current);
  current = null;
});
</script>

<template>
  <img v-if="src" :src="src" :alt="alt ?? ''" v-bind="$attrs" class="photo-develop" :class="shown ? 'is-shown' : ''" @load="shown = true" @error="onError" />
  <div v-else-if="!failed || quiet" class="bg-line/40" v-bind="boxClass === undefined ? $attrs : { ...$attrs, class: boxClass }" aria-hidden="true"></div>
  <div v-else class="flex items-center justify-center bg-line/40 text-sm text-ink-soft" v-bind="boxClass === undefined ? $attrs : { ...$attrs, class: boxClass }">写真を読めませんでした</div>
</template>
