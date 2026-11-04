// 保存直後のポーリング（architecture 7.2、requirements N-2）。2 秒間隔、done になるか 30 秒（15 回）で止まる。
import { onUnmounted, ref } from "vue";

export const POLL_INTERVAL_MS = 2000;
export const POLL_MAX_TRIES = 15;

export function usePolling<T>(fetcher: () => Promise<T>, isDone: (v: T) => boolean) {
  const value = ref<T | null>(null) as { value: T | null };
  const active = ref(false);
  let timer: ReturnType<typeof setTimeout> | null = null;
  let tries = 0;

  const stop = () => {
    active.value = false;
    if (timer) clearTimeout(timer);
    timer = null;
  };

  const tick = async () => {
    if (!active.value) return;
    tries += 1;
    try {
      const v = await fetcher();
      value.value = v;
      if (isDone(v)) {
        stop();
        return;
      }
    } catch {
      /* 失敗は静かに。次の tick でまた試す */
    }
    if (tries >= POLL_MAX_TRIES) {
      stop();
      return;
    }
    timer = setTimeout(() => void tick(), POLL_INTERVAL_MS);
  };

  const start = () => {
    stop();
    tries = 0;
    value.value = null;
    active.value = true;
    void tick();
  };

  onUnmounted(stop);
  return { value, active, start, stop };
}
