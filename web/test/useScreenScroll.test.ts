// S1 / S2 は KeepAlive で残すので、離れたときの位置を覚えて戻ったときに戻す。S3 は毎回いちばん上。
// DOM は使わず window（location / scrollY / scrollTo / history / hashchange）を差し替える。
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { nextTick } from "vue";

vi.mock("vue", async (orig) => ({
  ...(await orig<typeof import("vue")>()),
  onMounted: (fn: () => void) => fn(),
  onUnmounted: vi.fn(),
}));

const { useScreen } = await import("../src/composables/useScreen");

type FakeWindow = {
  location: { hash: string };
  scrollY: number;
  scrollTo: ReturnType<typeof vi.fn>;
  history: { scrollRestoration: string; back: ReturnType<typeof vi.fn> };
  addEventListener: (type: string, fn: () => void) => void;
  removeEventListener: ReturnType<typeof vi.fn>;
};
let win: FakeWindow;
let onHashChange: () => void = () => {};

const goTo = async (hash: string, fromScrollY: number) => {
  win.scrollY = fromScrollY;
  win.location.hash = hash;
  win.scrollTo.mockClear();
  onHashChange();
  await nextTick();
};
const lastTop = () => (win.scrollTo.mock.calls.at(-1)?.[0] as { top: number } | undefined)?.top;

beforeEach(() => {
  win = {
    location: { hash: "#past" },
    scrollY: 0,
    scrollTo: vi.fn(),
    history: { scrollRestoration: "auto", back: vi.fn() },
    addEventListener: (type, fn) => {
      if (type === "hashchange") onHashChange = fn;
    },
    removeEventListener: vi.fn(),
  };
  vi.stubGlobal("window", win);
  // 画面が変わると h1 へフォーカスを移す（useScreenFocus.test.ts）。ここでは見出しの無い画面として扱う
  vi.stubGlobal("document", { body: {}, activeElement: null, querySelector: () => null });
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("useScreen の位置", () => {
  it("位置は自分で戻す（ブラウザの自動の位置戻しを止める）", () => {
    useScreen();
    expect(win.history.scrollRestoration).toBe("manual");
  });

  it("S2 → S3 → S2 で、S2 を離れたときの位置に戻る。S3 はいちばん上", async () => {
    const { screen } = useScreen();
    await goTo("#memory/mem_1", 500);
    expect(screen.value).toEqual({ name: "memory", id: "mem_1", from: "past" });
    expect(lastTop()).toBe(0);
    await goTo("#past", 120);
    expect(screen.value).toEqual({ name: "past" });
    expect(lastTop()).toBe(500);
  });

  it("初めて開く画面と、S3 から別の S3 へ移ったときはいちばん上", async () => {
    useScreen();
    await goTo("#today", 300); // #past(300) → #today は初めて
    expect(lastTop()).toBe(0);
    await goTo("#memory/a", 40);
    await goTo("#memory/b", 200);
    expect(lastTop()).toBe(0);
  });

  it("S1 と S2 の位置は別々に覚える", async () => {
    useScreen();
    await goTo("#today", 700); // S2 を 700 で離れる
    await goTo("#past", 80); // S1 を 80 で離れる
    expect(lastTop()).toBe(700);
    await goTo("#today", 10);
    expect(lastTop()).toBe(80);
  });
});
