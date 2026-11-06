// 保存直後のポーリング（requirements N-2、architecture 7.2）。2 秒間隔、done か 15 回で止まる、古い応答は捨てる。
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// コンポーネントの外で呼ぶため onUnmounted だけ差し替える（Vue の警告を出さない）。渡された関数は取っておき、外れたときを再現する
const unmounted: Array<() => void> = [];
vi.mock("vue", async (orig) => ({
  ...(await orig<typeof import("vue")>()),
  onUnmounted: (fn: () => void) => unmounted.push(fn),
}));

const { POLL_INTERVAL_MS, POLL_MAX_TRIES, usePolling } = await import("../src/composables/usePolling");

type V = { pending: boolean; n: number };

beforeEach(() => {
  unmounted.length = 0;
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("usePolling", () => {
  it("start で即 1 回、以後 2 秒ごと。done で止まり最後の値が残る", async () => {
    let n = 0;
    const fetcher = vi.fn(async (): Promise<V> => ({ pending: ++n < 3, n }));
    const p = usePolling(fetcher, (v) => !v.pending);
    p.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(p.active.value).toBe(true);
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS);
    expect(fetcher).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS);
    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(p.active.value).toBe(false);
    expect(p.value.value).toEqual({ pending: false, n: 3 });
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS * 5);
    expect(fetcher).toHaveBeenCalledTimes(3);
  });

  it("終わらなければ 15 回（30 秒）で打ち切る", async () => {
    const fetcher = vi.fn(async (): Promise<V> => ({ pending: true, n: 0 }));
    const p = usePolling(fetcher, (v) => !v.pending);
    p.start();
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS * 40);
    expect(fetcher).toHaveBeenCalledTimes(POLL_MAX_TRIES);
    expect(POLL_MAX_TRIES * POLL_INTERVAL_MS).toBe(30_000);
    expect(p.active.value).toBe(false);
  });

  it("失敗は静かに次の回へ。失敗も回数に数える", async () => {
    let n = 0;
    const fetcher = vi.fn(async (): Promise<V> => {
      n += 1;
      if (n <= 2) throw new Error("network");
      return { pending: false, n };
    });
    const p = usePolling(fetcher, (v) => !v.pending);
    p.start();
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS * 2);
    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(p.value.value).toEqual({ pending: false, n: 3 });
    expect(p.active.value).toBe(false);
  });

  it("飛行中に stop されたら、その応答は捨てて次も呼ばない", async () => {
    let release!: (v: V) => void;
    const fetcher = vi.fn(() => new Promise<V>((r) => (release = r)));
    const p = usePolling(fetcher, (v) => !v.pending);
    p.start();
    await vi.advanceTimersByTimeAsync(0);
    p.stop();
    release({ pending: true, n: 1 });
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS * 3);
    expect(p.value.value).toBeNull();
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("start し直すと回数と値がリセットされ、前の世代の応答は混ざらない", async () => {
    const releases: Array<(v: V) => void> = [];
    const fetcher = vi.fn(() => new Promise<V>((r) => releases.push(r)));
    const p = usePolling(fetcher, (v) => !v.pending);
    p.start();
    await vi.advanceTimersByTimeAsync(0);
    p.start(); // 「もうひとつ書く」→ 保存、のように続けて start
    await vi.advanceTimersByTimeAsync(0);
    releases[0]!({ pending: false, n: 1 }); // 古い世代
    await vi.advanceTimersByTimeAsync(0);
    expect(p.value.value).toBeNull();
    expect(p.active.value).toBe(true);
    releases[1]!({ pending: false, n: 2 });
    await vi.advanceTimersByTimeAsync(0);
    expect(p.value.value).toEqual({ pending: false, n: 2 });
    expect(p.active.value).toBe(false);
  });

  it("外れたあと（onUnmounted のあと）の start は何もしない（読み込み中に S3 を離れたとき）", async () => {
    const fetcher = vi.fn(async (): Promise<V> => ({ pending: true, n: 0 }));
    const p = usePolling(fetcher, (v) => !v.pending);
    for (const fn of unmounted) fn();
    p.start();
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS * 40);
    expect(fetcher).not.toHaveBeenCalled();
    expect(p.active.value).toBe(false);
  });

  it("外れたら走っているポーリングも止まる", async () => {
    const fetcher = vi.fn(async (): Promise<V> => ({ pending: true, n: 0 }));
    const p = usePolling(fetcher, (v) => !v.pending);
    p.start();
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS);
    expect(fetcher).toHaveBeenCalledTimes(2);
    for (const fn of unmounted) fn();
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS * 40);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(p.active.value).toBe(false);
  });
});
