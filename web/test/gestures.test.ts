// なぞりの決め方（S3 の左端から戻る / シートを下へ閉じる）と、画面の移り変わりで離れていく画面の留め方。
// 指の動きそのものと見た目は headless Chrome（タッチの再現）と iPhone の実機で確かめる。ここは決め方の数だけを固定する
import { afterEach, describe, expect, it, vi } from "vitest";
import { SWIPE, swipeDecision } from "../src/composables/useEdgeSwipe";
import { SHEET, sheetDecision, velocityOf } from "../src/composables/useSheetDrag";
import { pinLeaving, prefersMotion, unpinLeaving } from "../src/motion";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("S3 の左端からなぞって戻る（swipeDecision）", () => {
  const width = 402;
  it("ゆっくりでも、幅の半分より右で離せば戻る。半分より手前なら元に戻る", () => {
    expect(swipeDecision({ dx: width * 0.5 + 1, vx: 0, width })).toBe("back");
    expect(swipeDecision({ dx: width * 0.5 - 1, vx: 0.1, width })).toBe("stay");
  });
  it("右へ速く払えば、短くても戻る（ただし少しは動いていること）", () => {
    expect(swipeDecision({ dx: 60, vx: SWIPE.flick + 0.05, width })).toBe("back");
    expect(swipeDecision({ dx: SWIPE.flickMin - 1, vx: 2, width })).toBe("stay");
  });
  it("左へ速く払い戻したら、半分より右でも戻らない（iPhone と同じ）", () => {
    expect(swipeDecision({ dx: 300, vx: -(SWIPE.flick + 0.05), width })).toBe("stay");
  });
  it("拾う左端は 24px、向きを決めるまで 10px、動きを減らす設定では 32px なぞった時点で戻る", () => {
    expect(SWIPE.edge).toBe(24);
    expect(SWIPE.slop).toBe(10);
    expect(SWIPE.reduceCommit).toBe(32);
  });
});

describe("シートを下へなぞって閉じる（sheetDecision）", () => {
  it("高さの 30%（ただし 140px まで）より下げて離せば閉じる", () => {
    expect(sheetDecision({ dy: 259 * 0.3 + 1, vy: 0, height: 259 })).toBe("close");
    expect(sheetDecision({ dy: 259 * 0.3 - 1, vy: 0, height: 259 })).toBe("stay");
    expect(sheetDecision({ dy: SHEET.closeDistance + 1, vy: 0, height: 800 })).toBe("close"); // 背の高いシートでも 140px で閉じる
  });
  it("下へ速く払えば短くても閉じ、上へ速く払い戻したら閉じない", () => {
    expect(sheetDecision({ dy: 30, vy: SHEET.flick + 0.1, height: 400 })).toBe("close");
    expect(sheetDecision({ dy: SHEET.flickMin - 1, vy: 3, height: 400 })).toBe("stay");
    expect(sheetDecision({ dy: 200, vy: -(SHEET.flick + 0.1), height: 400 })).toBe("stay");
  });
});

describe("指の速さ（velocityOf）", () => {
  it("終わりの 80ms の動きから px/ms を出す。記録が 1 つなら 0", () => {
    expect(velocityOf([])).toBe(0);
    expect(velocityOf([{ t: 0, v: 10 }])).toBe(0);
    // 0ms〜200ms はゆっくり、最後の 80ms で 80px 動いた
    expect(velocityOf([{ t: 0, v: 0 }, { t: 120, v: 20 }, { t: 160, v: 60 }, { t: 200, v: 100 }])).toBeCloseTo(80 / 80);
  });
});

describe("prefersMotion", () => {
  it("matchMedia の無い環境（テスト）と、動きを減らす設定では false", () => {
    vi.stubGlobal("window", {});
    expect(prefersMotion()).toBe(false);
    vi.stubGlobal("window", { matchMedia: () => ({ matches: true }) });
    expect(prefersMotion()).toBe(false);
    vi.stubGlobal("window", { matchMedia: () => ({ matches: false }) });
    expect(prefersMotion()).toBe(true);
  });
});

describe("離れていく画面を見ていた位置に留める（pinLeaving / unpinLeaving）", () => {
  const fakeMain = () => {
    const attrs = new Map<string, string>();
    return {
      offsetTop: 47, // セーフエリアの上の余白
      offsetLeft: 20,
      offsetWidth: 362,
      offsetHeight: 2400,
      inert: false,
      style: { transform: "translate3d(120px, 0, 0)", transition: "none" } as Record<string, string>,
      setAttribute: (k: string, v: string) => void attrs.set(k, v),
      removeAttribute: (k: string) => void attrs.delete(k),
      hasAttribute: (k: string) => attrs.has(k),
      attrs,
    };
  };

  it("hashchange の前に見ていた位置（scrollY）から、見えていた所のまま fixed で留める。読み上げと指から外し、見出しの探し先からも外す", () => {
    const el = fakeMain();
    pinLeaving(el as unknown as HTMLElement, 900);
    expect(el.style).toMatchObject({ position: "fixed", top: `${47 - 900}px`, left: "20px", width: "362px", height: "2400px", margin: "0" });
    expect(el.inert).toBe(true);
    expect(el.attrs.get("aria-hidden")).toBe("true");
    expect(el.attrs.has("data-leaving")).toBe(true);
    // なぞって戻るときの指の位置の transform は消さない（S3 はそこから右へ出ていく）
    expect(el.style.transform).toBe("translate3d(120px, 0, 0)");
  });

  it("動き終わったら付けたものを全部外す（KeepAlive で残す画面が、次に出てきたとき流れに戻る）", () => {
    const el = fakeMain();
    el.attrs.set("data-dragging", "");
    pinLeaving(el as unknown as HTMLElement, 0);
    el.style.opacity = "0"; // push の終わりに App.vue が隠したもの
    unpinLeaving(el as unknown as HTMLElement);
    for (const k of ["position", "top", "left", "width", "height", "margin", "transform", "transition", "opacity"]) expect(el.style[k]).toBe("");
    expect(el.inert).toBe(false);
    expect([...el.attrs.keys()]).toEqual([]);
  });

  it("留めていない要素（動きを減らす設定のとき）には何もしない", () => {
    const el = fakeMain();
    unpinLeaving(el as unknown as HTMLElement);
    expect(el.style.transform).toBe("translate3d(120px, 0, 0)");
  });
});

describe("useSheetDrag（指の動きを最小の要素で再現）", () => {
  type Handler = (e: unknown) => void;
  const fakePanel = () => {
    const handlers: Record<string, Handler> = {};
    const host = { addEventListener: vi.fn(), removeEventListener: vi.fn() };
    const el = {
      style: {} as Record<string, string>,
      offsetHeight: 260,
      parentElement: host,
      contains: () => true,
      addEventListener: (type: string, fn: Handler) => void (handlers[type] = fn),
      removeEventListener: vi.fn(),
    };
    return { el, handlers };
  };
  const touch = (y: number, t: number, target: unknown) => ({
    touches: [{ clientX: 100, clientY: y }],
    timeStamp: t,
    target,
    cancelable: true,
    preventDefault: vi.fn(),
  });

  it("下へゆっくり 30% より下げて離すと、紙を下げてから onClose を 1 回呼ぶ。短く下げただけなら戻す", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("window", { matchMedia: () => ({ matches: false }) });
    const { nextTick } = await import("vue");
    const { useSheetDrag } = await import("../src/composables/useSheetDrag");
    const onClose = vi.fn();
    const { panel } = useSheetDrag({ onClose });
    const { el, handlers } = fakePanel();
    panel.value = el as unknown as HTMLElement;
    await nextTick();
    handlers.touchstart!(touch(600, 0, el));
    handlers.touchmove!(touch(640, 300, el));
    handlers.touchend!({});
    expect(el.style.transform).toBe(""); // 32px は戻す
    handlers.touchstart!(touch(600, 1000, el));
    handlers.touchmove!(touch(620, 1100, el));
    handlers.touchmove!(touch(700, 1500, el));
    expect(el.style.transform).toBe("translate3d(0, 92px, 0)");
    handlers.touchend!({});
    expect(el.style.transform).toBe("translate3d(0, calc(100% + 24px), 0)");
    expect(onClose).not.toHaveBeenCalled();
    vi.advanceTimersByTime(300);
    expect(onClose).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it("なぞっている途中に閉じた（Esc など）ら、指を離しても閉じる動きを戻さない", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("window", { matchMedia: () => ({ matches: false }) });
    const { nextTick } = await import("vue");
    const { useSheetDrag } = await import("../src/composables/useSheetDrag");
    const onClose = vi.fn();
    const { panel, close } = useSheetDrag({ onClose });
    const { el, handlers } = fakePanel();
    panel.value = el as unknown as HTMLElement;
    await nextTick();
    handlers.touchstart!(touch(600, 0, el));
    handlers.touchmove!(touch(630, 100, el));
    close();
    handlers.touchend!({});
    expect(el.style.transform).toBe("translate3d(0, calc(100% + 24px), 0)");
    vi.advanceTimersByTime(300);
    expect(onClose).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });
});
