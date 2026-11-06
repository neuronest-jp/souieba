// S3 で消した記憶を、KeepAlive で残している S1 / S2 に知らせる。DOM は使わず window を EventTarget で代える。
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mounted: Array<() => void> = [];
const unmounted: Array<() => void> = [];
vi.mock("vue", async (orig) => ({
  ...(await orig<typeof import("vue")>()),
  onMounted: (fn: () => void) => mounted.push(fn),
  onUnmounted: (fn: () => void) => unmounted.push(fn),
}));

const { MEMORY_DELETED, notifyMemoryDeleted, useMemoryDeleted } = await import("../src/composables/useMemoryDeleted");

beforeEach(() => {
  mounted.length = 0;
  unmounted.length = 0;
  vi.stubGlobal("window", new EventTarget());
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("useMemoryDeleted", () => {
  it("付けている間は消した記憶の id を受け取り、外したあとは受け取らない", () => {
    const got: string[] = [];
    useMemoryDeleted((id) => got.push(id));
    for (const fn of mounted) fn();
    notifyMemoryDeleted("mem_1");
    expect(got).toEqual(["mem_1"]);
    for (const fn of unmounted) fn();
    notifyMemoryDeleted("mem_2");
    expect(got).toEqual(["mem_1"]);
  });

  it("形の違う知らせは無視する", () => {
    const got: string[] = [];
    useMemoryDeleted((id) => got.push(id));
    for (const fn of mounted) fn();
    window.dispatchEvent(new Event(MEMORY_DELETED));
    window.dispatchEvent(new CustomEvent(MEMORY_DELETED, { detail: { id: 1 } }));
    expect(got).toEqual([]);
  });
});
