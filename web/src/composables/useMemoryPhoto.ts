// S3 で写真を添えたことを、KeepAlive で残している S1 / S2 に知らせる（App.vue）。
// 添えている途中で S3 を離れると、戻った画面の取り直しが PUT より先に終わり、写真の無いまま残るため。新しい API は使わない。
import { onMounted, onUnmounted } from "vue";

export const MEMORY_PHOTO = "souieba:memory-photo";

type Detail = { id?: unknown; photo_key?: unknown; photo_content_type?: unknown } | null;

export const notifyMemoryPhoto = (id: string, photo_key: string, photo_content_type: string) => {
  window.dispatchEvent(new CustomEvent(MEMORY_PHOTO, { detail: { id, photo_key, photo_content_type } }));
};

// 画面が残っている間（非アクティブの間も）受け取る。onActivated ではなく onMounted で付ける
export function useMemoryPhoto(onPhoto: (id: string, photo_key: string, photo_content_type: string) => void) {
  const handler = (e: Event) => {
    const d = (e as CustomEvent<Detail>).detail;
    if (typeof d?.id === "string" && typeof d.photo_key === "string" && typeof d.photo_content_type === "string") {
      onPhoto(d.id, d.photo_key, d.photo_content_type);
    }
  };
  onMounted(() => window.addEventListener(MEMORY_PHOTO, handler));
  onUnmounted(() => window.removeEventListener(MEMORY_PHOTO, handler));
}
