// S3 で写真を添えたことを、KeepAlive で残している S1 / S2 に知らせる。DOM は使わず window を EventTarget で代える。
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mounted: Array<() => void> = [];
const unmounted: Array<() => void> = [];
vi.mock("vue", async (orig) => ({
  ...(await orig<typeof import("vue")>()),
  onMounted: (fn: () => void) => mounted.push(fn),
  onUnmounted: (fn: () => void) => unmounted.push(fn),
}));

const { MEMORY_PHOTO, notifyMemoryPhoto, useMemoryPhoto } = await import("../src/composables/useMemoryPhoto");

type Got = { id: string; photo_key: string; photo_content_type: string };

beforeEach(() => {
  mounted.length = 0;
  unmounted.length = 0;
  vi.stubGlobal("window", new EventTarget());
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("useMemoryPhoto", () => {
  it("付けている間は写真を添えた記憶の id と写真を受け取り、外したあとは受け取らない", () => {
    const got: Got[] = [];
    useMemoryPhoto((id, photo_key, photo_content_type) => got.push({ id, photo_key, photo_content_type }));
    for (const fn of mounted) fn();
    notifyMemoryPhoto("mem_1", "photos/u/mem_1/a.jpg", "image/jpeg");
    expect(got).toEqual([{ id: "mem_1", photo_key: "photos/u/mem_1/a.jpg", photo_content_type: "image/jpeg" }]);
    for (const fn of unmounted) fn();
    notifyMemoryPhoto("mem_2", "photos/u/mem_2/b.jpg", "image/jpeg");
    expect(got).toHaveLength(1);
  });

  it("形の違う知らせは無視する", () => {
    const got: Got[] = [];
    useMemoryPhoto((id, photo_key, photo_content_type) => got.push({ id, photo_key, photo_content_type }));
    for (const fn of mounted) fn();
    window.dispatchEvent(new Event(MEMORY_PHOTO));
    window.dispatchEvent(new CustomEvent(MEMORY_PHOTO, { detail: { id: "mem_1" } }));
    window.dispatchEvent(new CustomEvent(MEMORY_PHOTO, { detail: { id: 1, photo_key: "k", photo_content_type: "image/jpeg" } }));
    window.dispatchEvent(new CustomEvent(MEMORY_PHOTO, { detail: { id: "mem_1", photo_key: null, photo_content_type: "image/jpeg" } }));
    expect(got).toEqual([]);
  });
});
