// 保存直後のポーリング（architecture 7.2、requirements N-2）。2 秒間隔、done になるか 30 秒（15 回）で止まる。
import { onUnmounted, ref } from "vue";

export const POLL_INTERVAL_MS = 2000;
export const POLL_MAX_TRIES = 15;

export function usePolling<T>(fetcher: () => Promise<T>, isDone: (v: T) => boolean) {
  const value = ref<T | null>(null) as { value: T | null };
  const active = ref(false);
  let timer: ReturnType<typeof setTimeout> | null = null;
  let tries = 0;
  let generation = 0; // start / stop のたびに進める。飛行中の古い fetch の結果は捨てる
  // 画面が外れたら立てる。外れたあとに届いた応答の続きから start されても（読み込み中に S3 を離れたときなど）、走らせない
  let disposed = false;

  const stop = () => {
    generation += 1;
    active.value = false;
    if (timer) clearTimeout(timer);
    timer = null;
  };

  const tick = async (gen: number) => {
    if (!active.value || gen !== generation) return;
    tries += 1;
    try {
      const v = await fetcher();
      if (gen !== generation) return; // その間に stop / start された
      value.value = v;
      if (isDone(v)) {
        stop();
        return;
      }
    } catch {
      /* 失敗は静かに。次の tick でまた試す */
      if (gen !== generation) return;
    }
    if (tries >= POLL_MAX_TRIES) {
      stop();
      return;
    }
    timer = setTimeout(() => void tick(gen), POLL_INTERVAL_MS);
  };

  const start = () => {
    if (disposed) return;
    stop();
    tries = 0;
    value.value = null;
    active.value = true;
    void tick(generation);
  };

  onUnmounted(() => {
    disposed = true;
    stop();
  });
  return { value, active, start, stop };
}
