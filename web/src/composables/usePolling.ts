// 保存直後のポーリング（architecture 7.2、requirements N-2）。2 秒間隔、done になるか 30 秒（15 回）で止まる。
import { onUnmounted, ref } from "vue";

export const POLL_INTERVAL_MS = 2000;
export const POLL_MAX_TRIES = 15;

// startedAt（ms）に始めたポーリングに、now の時点で残っている回数。止めて続け直すときも 30 秒を始めた時刻から数える
// （S1 は離れている間止め、戻ったときに残りだけ続ける）。残りの回はすべて始めてから 30 秒より前に収まる
export const triesLeft = (startedAt: number, now = Date.now()) =>
  Math.min(POLL_MAX_TRIES, Math.max(0, POLL_MAX_TRIES - Math.floor((now - startedAt) / POLL_INTERVAL_MS)));

export function usePolling<T>(fetcher: () => Promise<T>, isDone: (v: T) => boolean) {
  const value = ref<T | null>(null) as { value: T | null };
  const active = ref(false);
  let timer: ReturnType<typeof setTimeout> | null = null;
  let tries = 0;
  let maxTries = POLL_MAX_TRIES;
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
    if (tries >= maxTries) {
      stop();
      return;
    }
    timer = setTimeout(() => void tick(gen), POLL_INTERVAL_MS);
  };

  // limit は打ち切りまでの回数（既定 15 回 = 30 秒）。0 以下なら走らせない（走っていた分は止める）
  const start = (limit = POLL_MAX_TRIES) => {
    if (disposed) return;
    stop();
    tries = 0;
    maxTries = limit;
    value.value = null;
    if (maxTries <= 0) return;
    active.value = true;
    void tick(generation);
  };

  onUnmounted(() => {
    disposed = true;
    stop();
  });
  return { value, active, start, stop };
}
