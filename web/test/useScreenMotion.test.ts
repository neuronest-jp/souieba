// 画面の移り変わりの動きの向き（App.vue の <Transition name="screen-<motion>">）。下部ナビの並びで左右、S3 は押し出しと戻り、
// 左端からなぞって戻ったときは swipe。位置とフォーカスの扱い（useScreenScroll / useScreenFocus）はそのまま。
// DOM は使わず window と document を最小のスタブで差し替える（useScreenScroll.test.ts と同じ書き方）
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { nextTick } from "vue";

vi.mock("vue", async (orig) => ({
  ...(await orig<typeof import("vue")>()),
  onMounted: (fn: () => void) => fn(),
  onUnmounted: vi.fn(),
}));

const { back, leavingScrollY, motionBetween, parseHash, useScreen } = await import("../src/composables/useScreen");

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

const goTo = async (hash: string, fromScrollY = 0) => {
  win.scrollY = fromScrollY;
  win.location.hash = hash;
  onHashChange();
  await nextTick();
};

beforeEach(() => {
  win = {
    location: { hash: "#today" },
    scrollY: 0,
    scrollTo: vi.fn(),
    history: { scrollRestoration: "auto", back: vi.fn() },
    addEventListener: (type, fn) => {
      if (type === "hashchange") onHashChange = fn;
    },
    removeEventListener: vi.fn(),
  };
  vi.stubGlobal("window", win);
  vi.stubGlobal("document", { body: {}, activeElement: null, querySelector: () => null });
});
afterEach(() => {
  vi.unstubAllGlobals();
});

const S = (hash: string) => parseHash(hash);

describe("motionBetween（前の画面 → 次の画面）", () => {
  it("下部ナビの並び（きょう → これまで → つながり）で、右の画面へは forward、左の画面へは backward", () => {
    expect(motionBetween(S("#today"), S("#past"))).toBe("forward");
    expect(motionBetween(S("#past"), S("#connections"))).toBe("forward");
    expect(motionBetween(S("#today"), S("#connections"))).toBe("forward");
    expect(motionBetween(S("#connections"), S("#today"))).toBe("backward");
    expect(motionBetween(S("#past"), S("#today"))).toBe("backward");
    expect(motionBetween(S("#past"), S("#past"))).toBe("none");
  });

  it("S3 をひらくのは push。S3 から S3 へ（札の相手をひらく）も push", () => {
    expect(motionBetween(S("#past"), S("#memory/a"))).toBe("push");
    expect(motionBetween(S("#today"), S("#memory/a?from=today&recall=r1"))).toBe("push");
    expect(motionBetween(S("#memory/a"), S("#memory/b"))).toBe("push");
  });

  it("S3 から開いた元の画面へは pop（戻るボタンでも、下部ナビの同じ項目でも）。戻る操作から来た S3 → S3 も pop", () => {
    expect(motionBetween(S("#memory/a?from=connections"), S("#connections"))).toBe("pop");
    expect(motionBetween(S("#memory/a"), S("#past"))).toBe("pop");
    expect(motionBetween(S("#memory/b"), S("#memory/a"), "pop")).toBe("pop");
  });

  it("左端からなぞって戻ったときは swipe", () => {
    expect(motionBetween(S("#memory/a?from=today"), S("#today"), "swipe")).toBe("swipe");
    expect(motionBetween(S("#memory/b"), S("#memory/a"), "swipe")).toBe("swipe");
  });

  it("S3 から下部ナビでほかの画面へは、その S3 を開いた元の画面からの左右", () => {
    expect(motionBetween(S("#memory/a?from=today"), S("#connections"))).toBe("forward");
    expect(motionBetween(S("#memory/a?from=connections"), S("#past"))).toBe("backward");
  });
});

describe("motionBetween（S6 ことばの地図。S3 と同じく push で入り、S2 へ pop で戻る）", () => {
  it("S2 → S6 は push、S6 → S2 は pop（戻るボタンでも下部ナビの「これまで」でも）、なぞって戻ったら swipe", () => {
    expect(motionBetween(S("#past"), S("#words"))).toBe("push");
    expect(motionBetween(S("#words"), S("#past"))).toBe("pop");
    expect(motionBetween(S("#words"), S("#past"), "pop")).toBe("pop");
    expect(motionBetween(S("#words"), S("#past"), "swipe")).toBe("swipe");
  });

  it("S6 から S3 は push、S3 から S6 へ戻るのは pop。S6 から開いた S3 から下部ナビの「これまで」も pop", () => {
    expect(motionBetween(S("#words"), S("#memory/a?from=words"))).toBe("push");
    expect(motionBetween(S("#memory/a?from=words"), S("#words"), "pop")).toBe("pop");
    expect(motionBetween(S("#memory/a?from=words"), S("#words"))).toBe("pop");
    expect(motionBetween(S("#memory/a?from=words"), S("#past"))).toBe("pop");
  });

  it("S6 と、S6 から開いた S3 から下部ナビのほかの項目へは、S2 からの左右", () => {
    expect(motionBetween(S("#words"), S("#today"))).toBe("backward");
    expect(motionBetween(S("#words"), S("#connections"))).toBe("forward");
    expect(motionBetween(S("#memory/a?from=words"), S("#today"))).toBe("backward");
    expect(motionBetween(S("#memory/a?from=words"), S("#connections"))).toBe("forward");
  });
});

describe("useScreen の motion", () => {
  it("最初は none。hashchange のたび、画面と同じ描き直しで読めるよう画面より先に書き換える", async () => {
    const { screen, motion } = useScreen();
    expect(motion.value).toBe("none");
    await goTo("#past");
    expect(screen.value).toEqual({ name: "past" });
    expect(motion.value).toBe("forward");
    await goTo("#memory/m1", 300);
    expect(motion.value).toBe("push");
  });

  it("back() で戻ると pop、なぞりで戻ると swipe。印は 1 回の移り変わりだけ（次の S3 → S3 は push に戻る）", async () => {
    const { motion } = useScreen();
    await goTo("#memory/a");
    await goTo("#memory/b");
    expect(motion.value).toBe("push");
    back({ name: "past" });
    await goTo("#memory/a"); // history.back() の代わり
    expect(motion.value).toBe("pop");
    await goTo("#memory/b");
    expect(motion.value).toBe("push");
    back({ name: "past" }, { swipe: true });
    await goTo("#memory/a");
    expect(motion.value).toBe("swipe");
  });

  it("離れる画面を見ていた位置（leavingScrollY）は、S3 のように残さない画面でも hashchange の時点の scrollY", async () => {
    useScreen();
    await goTo("#memory/a", 420);
    expect(leavingScrollY()).toBe(420);
    await goTo("#memory/b", 960); // S3 は位置を覚えないが、離れていく S3 をその位置に留めるために要る
    expect(leavingScrollY()).toBe(960);
  });
});
