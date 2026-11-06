// S3 で記憶を消したことを、KeepAlive で残している S1 / S2 に知らせる（App.vue）。
// 残した画面が、もう無い記憶のカードや行を描き続けないように。新しい API は使わない。
import { onMounted, onUnmounted } from "vue";

export const MEMORY_DELETED = "souieba:memory-deleted";

export const notifyMemoryDeleted = (id: string) => {
  window.dispatchEvent(new CustomEvent(MEMORY_DELETED, { detail: { id } }));
};

// 画面が残っている間（非アクティブの間も）受け取る。onActivated ではなく onMounted で付ける
export function useMemoryDeleted(onDeleted: (id: string) => void) {
  const handler = (e: Event) => {
    const id: unknown = (e as CustomEvent<{ id?: unknown } | null>).detail?.id;
    if (typeof id === "string") onDeleted(id);
  };
  onMounted(() => window.addEventListener(MEMORY_DELETED, handler));
  onUnmounted(() => window.removeEventListener(MEMORY_DELETED, handler));
}
