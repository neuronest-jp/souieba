// S1 / S2 / S5 は KeepAlive で残すので、離れたときの位置を覚えて戻ったときに戻す。S3 は毎回いちばん上。
// DOM は使わず window（location / scrollY / scrollTo / history / hashchange）を差し替える。
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { nextTick, watch } from "vue";

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

  it("位置を戻すのは、残した S2 が描き直されたあと（hashchange の時点ではまだ S3 が出ていて、すぐ戻すと S3 の高さで頭打ちになる）", async () => {
    // App.vue の描き直しの代わり。screen を変えると予約され、次の flush で「出ている画面」が変わる。
    // ここで確かめられるのは「同期で戻さない」「flush の後で戻す」まで。KeepAlive で S2 の DOM が実際に
    // 戻った後かどうかはブラウザで目視する（requirements 第2節「検証方法」の「画面」。S2 を下まで送る → S3 → 戻る）
    const { screen } = useScreen();
    let shown = screen.value.name;
    watch(screen, (s) => {
      shown = s.name;
    });
    const shownAtScroll: string[] = [];
    win.scrollTo.mockImplementation(() => void shownAtScroll.push(shown));
    await goTo("#memory/mem_1", 500);
    win.scrollY = 120;
    win.location.hash = "#past";
    win.scrollTo.mockClear();
    shownAtScroll.length = 0;
    onHashChange();
    expect(win.scrollTo.mock.calls).toEqual([[{ top: 0 }]]); // この時点ではいちばん上へ送るだけ
    await nextTick();
    expect(lastTop()).toBe(500);
    expect(shownAtScroll.at(-1)).toBe("past");
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

  it("S5 つながり → S3 → 戻るで、S5 を離れたときの位置に戻る。S1 / S2 とは別に覚える", async () => {
    const { screen } = useScreen();
    await goTo("#connections", 300); // S2 を 300 で離れる
    expect(screen.value).toEqual({ name: "connections" });
    expect(lastTop()).toBe(0); // 初めて開く
    await goTo("#memory/mem_old?from=connections&recall=rc_1", 640);
    expect(screen.value).toEqual({ name: "memory", id: "mem_old", from: "connections", recall: "rc_1" });
    expect(lastTop()).toBe(0);
    await goTo("#connections", 90);
    expect(lastTop()).toBe(640);
    await goTo("#past", 640);
    expect(lastTop()).toBe(300);
  });
});
