import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NOTICE_MS, useNotice } from "../src/composables/useNotice";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("useNotice", () => {
  it("出した知らせは数秒で消える", () => {
    const n = useNotice();
    n.show("記録できませんでした", "r1");
    expect(n.message.value).toBe("記録できませんでした");
    expect(n.key.value).toBe("r1");
    vi.advanceTimersByTime(NOTICE_MS - 1);
    expect(n.message.value).toBe("記録できませんでした");
    vi.advanceTimersByTime(1);
    expect(n.message.value).toBe("");
    expect(n.key.value).toBeNull();
  });

  it("続けて出すと時間は最後のものから数え直す", () => {
    const n = useNotice(1000);
    n.show("a", "r1");
    vi.advanceTimersByTime(800);
    n.show("b", "r2");
    vi.advanceTimersByTime(800);
    expect(n.message.value).toBe("b");
    expect(n.key.value).toBe("r2");
    vi.advanceTimersByTime(200);
    expect(n.message.value).toBe("");
  });

  it("clear ですぐ消える", () => {
    const n = useNotice();
    n.show("a");
    n.clear();
    expect(n.message.value).toBe("");
    expect(vi.getTimerCount()).toBe(0);
  });
});
