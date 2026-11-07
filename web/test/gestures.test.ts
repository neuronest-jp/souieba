// なぞりの決め方（S3 の左端から戻る / シートを下へ閉じる）と、画面の移り変わりで離れていく画面の留め方。
// 指の動きそのものと見た目は headless Chrome（タッチの再現）と iPhone の実機で確かめる。ここは決め方の数だけを固定する
import { afterEach, describe, expect, it, vi } from "vitest";
import { defineComponent, h, KeepAlive, nextTick, ref } from "vue";
import { SWIPE, swipeDecision, useEdgeSwipe } from "../src/composables/useEdgeSwipe";
import { SHEET, sheetDecision, velocityOf } from "../src/composables/useSheetDrag";
import { pinLeaving, prefersMotion, unpinLeaving } from "../src/motion";
import { mount, resetFakeDocument } from "./fakeDom";

// 触覚は鳴らした回数だけを見る（motion.ts が読む arrive も置いておく）
const { haptic } = vi.hoisted(() => ({ haptic: { select: vi.fn(), arrive: vi.fn() } }));
vi.mock("../src/haptics", () => haptic);

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  haptic.select.mockClear();
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
  it("離した時刻が最後の記録から 80ms より後なら、指は止まっていたので 0（iPhone は止まっている間 touchmove を出さない）", () => {
    const samples = [{ t: 0, v: 0 }, { t: 120, v: 20 }, { t: 160, v: 60 }, { t: 200, v: 100 }];
    expect(velocityOf(samples, 200 + 81)).toBe(0);
    expect(velocityOf(samples, 200 + 80)).toBeCloseTo(1);
    expect(velocityOf(samples, undefined)).toBeCloseTo(1); // 離した時刻の分からないとき（timeStamp の無いイベント）は今までどおり
  });
});

describe("useEdgeSwipe（左端からなぞって戻る。指の動きを最小の要素で再現）", () => {
  type Handler = (e: unknown) => void;
  const setup = async () => {
    vi.useFakeTimers();
    vi.stubGlobal("window", { matchMedia: () => ({ matches: false }), innerWidth: 402 });
    const handlers: Record<string, Handler> = {};
    vi.stubGlobal("document", { addEventListener: (type: string, fn: Handler) => void (handlers[type] = fn), removeEventListener: vi.fn() });
    const attrs = new Map<string, string>();
    const el = {
      style: {} as Record<string, string>,
      offsetWidth: 402,
      isConnected: true,
      setAttribute: (k: string, v: string) => void attrs.set(k, v),
      removeAttribute: (k: string) => void attrs.delete(k),
      hasAttribute: (k: string) => attrs.has(k),
    };
    const onBack = vi.fn();
    resetFakeDocument();
    const target = ref<HTMLElement | null>(el as unknown as HTMLElement);
    const { unmount } = mount(
      defineComponent({
        setup() {
          useEdgeSwipe(target, { onBack });
          return () => h("div");
        },
      }),
    );
    return { handlers, el, onBack, unmount };
  };
  const touch = (x: number, t: number) => ({ touches: [{ clientX: x, clientY: 400 }], timeStamp: t, cancelable: true, preventDefault: vi.fn() });
  // 左端（x=5）から 48ms で 60px 右へ速く払う
  const flick = (handlers: Record<string, Handler>) => {
    handlers.touchstart!(touch(5, 0));
    handlers.touchmove!(touch(20, 16));
    handlers.touchmove!(touch(40, 32));
    handlers.touchmove!(touch(65, 48));
  };

  it("速く払ってすぐ離せば、短くても戻る", async () => {
    const { handlers, el, onBack, unmount } = await setup();
    flick(handlers);
    expect(el.style.transform).toBe("translate3d(60px, 0, 0)");
    handlers.touchend!({ timeStamp: 56 });
    expect(onBack).toHaveBeenCalledTimes(1);
    expect(haptic.select).toHaveBeenCalledTimes(1);
    unmount();
  });

  it("速く払ってから 200ms 止めて離したら、迷って止めたとみなして戻らない（元の位置へ戻す）", async () => {
    const { handlers, el, onBack, unmount } = await setup();
    flick(handlers);
    handlers.touchend!({ timeStamp: 48 + 200 });
    expect(onBack).not.toHaveBeenCalled();
    expect(haptic.select).not.toHaveBeenCalled();
    expect(el.style.transform).toBe("");
    unmount();
  });
});

describe("useEdgeSwipe を KeepAlive で残す画面で使う（S6 ことばの地図。仕舞われている間は拾わない）", () => {
  type Handler = (e: unknown) => void;
  const fakeEl = () => {
    const attrs = new Map<string, string>();
    return {
      style: {} as Record<string, string>,
      offsetWidth: 402,
      isConnected: true,
      attrs,
      setAttribute: (k: string, v: string) => void attrs.set(k, v),
      removeAttribute: (k: string) => void attrs.delete(k),
      hasAttribute: (k: string) => attrs.has(k),
    };
  };
  // document の受け手は種類ごとにいくつでも持ち、外せる（本物と同じ）
  const setup = async () => {
    vi.useFakeTimers();
    vi.stubGlobal("window", { matchMedia: () => ({ matches: false }), innerWidth: 402 });
    const listeners = new Map<string, Set<Handler>>();
    vi.stubGlobal("document", {
      addEventListener: (type: string, fn: Handler) => {
        if (!listeners.has(type)) listeners.set(type, new Set());
        listeners.get(type)!.add(fn);
      },
      removeEventListener: (type: string, fn: Handler) => void listeners.get(type)?.delete(fn),
    });
    const fire = (type: string, e: unknown) => [...(listeners.get(type) ?? [])].forEach((fn) => fn(e));
    const words = fakeEl();
    const detail = fakeEl();
    const onWordsBack = vi.fn();
    const onDetailBack = vi.fn();
    const screen = (name: string, el: unknown, onBack: () => void) =>
      defineComponent({
        name,
        setup() {
          useEdgeSwipe(ref(el as HTMLElement), { onBack });
          return () => h("main");
        },
      });
    const Words = screen("WordsScreen", words, onWordsBack);
    const Detail = screen("MemoryDetailScreen", detail, onDetailBack);
    const shown = ref<"words" | "detail">("words");
    resetFakeDocument();
    const view = mount(defineComponent({ setup: () => () => h(KeepAlive, { include: "WordsScreen" }, [shown.value === "words" ? h(Words) : h(Detail)]) }));
    await nextTick();
    return { listeners, fire, words, detail, onWordsBack, onDetailBack, shown, ...view };
  };
  const touch = (x: number, t: number) => ({ touches: [{ clientX: x, clientY: 400 }], timeStamp: t, cancelable: true, preventDefault: vi.fn() });
  // 左端（x=5）から右へ速く払って離す
  const flick = (fire: (type: string, e: unknown) => void) => {
    fire("touchstart", touch(5, 0));
    fire("touchmove", touch(20, 16));
    fire("touchmove", touch(40, 32));
    fire("touchmove", touch(65, 48));
    fire("touchend", { timeStamp: 56 });
  };

  it("S6 から開いた S3 でなぞると、S3 の戻るだけが走る。仕舞われた S6 は拾わず、印も付かない", async () => {
    const { listeners, fire, words, onWordsBack, onDetailBack, shown, errors, unmount } = await setup();
    shown.value = "detail";
    await nextTick();
    expect(listeners.get("touchstart")?.size).toBe(1);
    flick(fire);
    expect(onDetailBack).toHaveBeenCalledTimes(1);
    expect(onWordsBack).not.toHaveBeenCalled();
    expect(haptic.select).toHaveBeenCalledTimes(1);
    expect(words.style.transform ?? "").toBe("");
    expect(words.attrs.has("data-dragging")).toBe(false);
    // S6 に戻ると、作り直さない S3 の受け手は外れ、S6 のなぞりがまた効く
    shown.value = "words";
    await nextTick();
    expect(listeners.get("touchstart")?.size).toBe(1);
    flick(fire);
    expect(onWordsBack).toHaveBeenCalledTimes(1);
    expect(onDetailBack).toHaveBeenCalledTimes(1);
    expect(errors).toEqual([]);
    unmount();
    expect(listeners.get("touchstart")?.size).toBe(0);
  });

  it("なぞって S6 から戻ったあと、また S6 を開けば、もう一度なぞって戻れる（右へ出たままの印も残さない）", async () => {
    const { fire, words, onWordsBack, shown, errors, unmount } = await setup();
    flick(fire);
    expect(onWordsBack).toHaveBeenCalledTimes(1);
    expect(words.style.transform).toBe("translate3d(100vw, 0, 0)");
    // App.vue が離れていく S6 を留めて（data-leaving）、仕舞う。右へ出ていく inline の動きはそのまま
    words.setAttribute("data-leaving", "");
    shown.value = "detail";
    await nextTick();
    expect(words.style.transform).toBe("translate3d(100vw, 0, 0)");
    words.removeAttribute("data-leaving");
    words.isConnected = false;
    vi.advanceTimersByTime(1000);
    // また S6 を開く
    words.isConnected = true;
    shown.value = "words";
    await nextTick();
    expect(words.style.transform).toBe("");
    expect(words.attrs.has("data-dragging")).toBe(false);
    flick(fire);
    expect(onWordsBack).toHaveBeenCalledTimes(2);
    expect(errors).toEqual([]);
    unmount();
  });

  it("戻ったのに画面が変わらなかったら、1 秒で元の位置へ戻し、次のなぞりも拾う", async () => {
    const { fire, words, onWordsBack, unmount } = await setup();
    flick(fire);
    expect(onWordsBack).toHaveBeenCalledTimes(1);
    flick(fire); // 戻る途中のなぞりは拾わない
    expect(onWordsBack).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1000);
    expect(words.style.transform).toBe("");
    flick(fire);
    expect(onWordsBack).toHaveBeenCalledTimes(2);
    unmount();
  });

  it("外れた要素・離れていく途中の要素では拾わない", async () => {
    const { fire, words, onWordsBack, unmount } = await setup();
    words.isConnected = false;
    flick(fire);
    words.isConnected = true;
    words.setAttribute("data-leaving", "");
    flick(fire);
    expect(onWordsBack).not.toHaveBeenCalled();
    expect(haptic.select).not.toHaveBeenCalled();
    unmount();
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

  // 掴み手から 48ms で 48px 下へ速く払う（離したときの下げ幅は 40px。高さ 260px の 30% には届かない）
  const flickDown = (handlers: Record<string, Handler>, el: unknown) => {
    handlers.touchstart!(touch(600, 0, el));
    handlers.touchmove!(touch(616, 16, el));
    handlers.touchmove!(touch(632, 32, el));
    handlers.touchmove!(touch(648, 48, el));
  };
  const setupSheet = async (reduce: boolean) => {
    vi.useFakeTimers();
    vi.stubGlobal("window", { matchMedia: () => ({ matches: reduce }) });
    const { nextTick } = await import("vue");
    const { useSheetDrag } = await import("../src/composables/useSheetDrag");
    const onClose = vi.fn();
    const { panel, backdrop } = useSheetDrag({ onClose });
    const { el, handlers } = fakePanel();
    const bd = { style: {} as Record<string, string> };
    backdrop.value = bd as unknown as HTMLElement;
    panel.value = el as unknown as HTMLElement;
    await nextTick();
    return { el, bd, handlers, onClose };
  };

  it("下へ速く払ってすぐ離せば、短くても閉じる", async () => {
    const { el, handlers, onClose } = await setupSheet(false);
    flickDown(handlers, el);
    expect(el.style.transform).toBe("translate3d(0, 40px, 0)");
    handlers.touchend!({ timeStamp: 56 });
    expect(el.style.transform).toBe("translate3d(0, calc(100% + 24px), 0)");
    vi.advanceTimersByTime(300);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("下へ速く払ってから 200ms 止めて離したら、閉じずに戻す", async () => {
    const { el, handlers, onClose } = await setupSheet(false);
    flickDown(handlers, el);
    handlers.touchend!({ timeStamp: 48 + 200 });
    expect(el.style.transform).toBe("");
    vi.advanceTimersByTime(1000);
    expect(onClose).not.toHaveBeenCalled();
  });

  it("動きを減らす設定では、なぞっても紙と地は指に付いてこず、下へ一定の距離を越えた時点で待たずに 1 回閉じる", async () => {
    const { el, bd, handlers, onClose } = await setupSheet(true);
    handlers.touchstart!(touch(600, 0, el));
    handlers.touchmove!(touch(620, 16, el));
    handlers.touchmove!(touch(600 + SHEET.reduceCommit, 32, el));
    expect(el.style.transform ?? "").toBe("");
    expect(el.style.transition ?? "").toBe("");
    expect(bd.style.opacity ?? "").toBe("");
    expect(onClose).not.toHaveBeenCalled();
    handlers.touchmove!(touch(600 + SHEET.reduceCommit + 1, 48, el));
    expect(onClose).toHaveBeenCalledTimes(1); // タイマーを進めなくても閉じている
    handlers.touchmove!(touch(720, 64, el));
    handlers.touchend!({ timeStamp: 72 });
    vi.advanceTimersByTime(1000);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(el.style.transform ?? "").toBe("");
  });

  it("動きを減らす設定で少しだけなぞって離したら、ばねで戻さず、inline の動きを残さない", async () => {
    const { el, bd, handlers, onClose } = await setupSheet(true);
    // ゆっくり 30px（閾値の手前）
    handlers.touchstart!(touch(600, 0, el));
    handlers.touchmove!(touch(615, 150, el));
    handlers.touchmove!(touch(630, 300, el));
    expect(el.style.transform ?? "").toBe("");
    handlers.touchend!({ timeStamp: 310 });
    for (const k of ["transform", "transition"]) expect(el.style[k] ?? "").toBe("");
    for (const k of ["opacity", "transition"]) expect(bd.style[k] ?? "").toBe("");
    vi.advanceTimersByTime(1000);
    expect(onClose).not.toHaveBeenCalled();
  });
});
