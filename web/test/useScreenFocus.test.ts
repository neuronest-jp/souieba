// 画面が変わったら新しい画面の h1 にフォーカスを置く（押したリンクごと前の画面が消え、読み上げで何も読まれないため。wireframes 6 節）。
// DOM は使わず window と document を最小のスタブで差し替える（useScreenScroll.test.ts と同じ書き方）。
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { nextTick, watch } from "vue";

vi.mock("vue", async (orig) => ({
  ...(await orig<typeof import("vue")>()),
  onMounted: (fn: () => void) => fn(),
  onUnmounted: vi.fn(),
}));

const { focusHeading, useScreen } = await import("../src/composables/useScreen");

type FakeEl = {
  isConnected: boolean;
  attrs: Map<string, string>;
  setAttribute: (k: string, v: string) => void;
  removeAttribute: (k: string) => void;
  addEventListener: (type: string, fn: () => void) => void;
  focus: ReturnType<typeof vi.fn>;
  blur: () => void;
};
type FakeDoc = { body: object; activeElement: unknown; querySelector: ReturnType<typeof vi.fn> };

let doc: FakeDoc;
let onHashChange: () => void = () => {};

const fakeEl = (isConnected = true): FakeEl => {
  const listeners: Array<() => void> = [];
  const el: FakeEl = {
    isConnected,
    attrs: new Map(),
    setAttribute: (k, v) => void el.attrs.set(k, v),
    removeAttribute: (k) => void el.attrs.delete(k),
    addEventListener: (type, fn) => {
      if (type === "blur") listeners.push(fn);
    },
    focus: vi.fn(() => {
      doc.activeElement = el;
    }),
    blur: () => {
      doc.activeElement = doc.body;
      listeners.splice(0).forEach((fn) => fn());
    },
  };
  return el;
};

beforeEach(() => {
  vi.stubGlobal("window", {
    location: { hash: "#today" },
    scrollY: 0,
    scrollTo: vi.fn(),
    history: { scrollRestoration: "auto", back: vi.fn() },
    addEventListener: (type: string, fn: () => void) => {
      if (type === "hashchange") onHashChange = fn;
    },
    removeEventListener: vi.fn(),
  });
  const body = {};
  doc = { body, activeElement: body, querySelector: vi.fn(() => null) };
  vi.stubGlobal("document", doc);
});
afterEach(() => {
  vi.unstubAllGlobals();
});

const goTo = async (hash: string) => {
  (window as unknown as { location: { hash: string } }).location.hash = hash;
  onHashChange();
  await nextTick();
};

describe("画面が変わったときのフォーカス", () => {
  it("新しい画面の main の h1 に、位置を動かさずにフォーカスを置く", async () => {
    const h1 = fakeEl();
    doc.querySelector.mockReturnValue(h1);
    useScreen();
    await goTo("#past");
    // 画面の移り変わりの間は離れていく画面（data-leaving）も残っていて文書の順で先に来るので、それを除いた main の h1
    expect(doc.querySelector).toHaveBeenCalledWith("main:not([data-leaving]) h1");
    expect(h1.focus).toHaveBeenCalledWith({ preventScroll: true });
    expect(doc.activeElement).toBe(h1);
  });

  it("フォーカスを置くのは新しい画面が描かれたあと。hashchange の時点でまだ出ている前の画面の h1 には置かない", async () => {
    // App.vue の描き直しの代わり。screen を変えると予約され、次の flush で main の h1 が新しい画面のものに替わる。
    // ここで確かめられるのは「同期で置かない」「flush の後で置く」まで。実際の画面で新しい h1 が読まれるかは
    // ブラウザ（VoiceOver）で目視する（requirements 第2節「検証方法」の「画面」）
    const todayH1 = fakeEl(); // 離れる S1 の見出し（hashchange の時点ではまだ繋がっている）
    const pastH1 = fakeEl();
    const { screen } = useScreen();
    let shown = screen.value.name;
    watch(screen, (s) => {
      shown = s.name;
    });
    doc.querySelector.mockImplementation(() => (shown === "past" ? pastH1 : todayH1));
    (window as unknown as { location: { hash: string } }).location.hash = "#past";
    onHashChange();
    expect(pastH1.focus).not.toHaveBeenCalled(); // この時点ではまだ置かない
    await nextTick();
    expect(todayH1.focus).not.toHaveBeenCalled();
    expect(pastH1.focus).toHaveBeenCalledTimes(1);
    expect(pastH1.focus).toHaveBeenCalledWith({ preventScroll: true });
  });

  it("下部ナビのリンクにフォーカスが残っていても、新しい画面の h1 へ移す", async () => {
    const h1 = fakeEl();
    doc.querySelector.mockReturnValue(h1);
    doc.activeElement = { tagName: "A" }; // 下部ナビの「これまで」は消えずに残る
    useScreen();
    await goTo("#past");
    expect(h1.focus).toHaveBeenCalledTimes(1);
  });

  it("下部ナビの「つながり」から S5 へ移ったときも、S5 の h1 へ移す", async () => {
    const h1 = fakeEl();
    doc.querySelector.mockReturnValue(h1);
    doc.activeElement = { tagName: "A" };
    const { screen } = useScreen();
    await goTo("#connections");
    expect(screen.value).toEqual({ name: "connections" });
    expect(h1.focus).toHaveBeenCalledWith({ preventScroll: true });
    expect(doc.activeElement).toBe(h1);
  });

  it("S3 の読み込み中のように h1 が無い画面では何もしない", async () => {
    useScreen();
    await expect(goTo("#memory/mem_1")).resolves.toBeUndefined();
    expect(doc.activeElement).toBe(doc.body);
  });
});

describe("focusHeading", () => {
  it("tabindex=-1 は置くあいだだけ付け、離れたら外す（指で見出しに触れてもフォーカスが移らない）", () => {
    const h1 = fakeEl();
    focusHeading(h1 as unknown as HTMLElement);
    expect(h1.attrs.get("tabindex")).toBe("-1");
    h1.blur();
    expect(h1.attrs.has("tabindex")).toBe(false);
  });

  it("フォーカスが body に落ちているときだけ置く。利用者が動かしたフォーカスは奪わない", () => {
    const h1 = fakeEl();
    doc.activeElement = { tagName: "BUTTON" };
    focusHeading(h1 as unknown as HTMLElement);
    expect(h1.focus).not.toHaveBeenCalled();
    doc.activeElement = null;
    focusHeading(h1 as unknown as HTMLElement);
    expect(h1.focus).toHaveBeenCalledTimes(1);
  });

  it("force なら、ほかにフォーカスがあっても置く", () => {
    const h1 = fakeEl();
    doc.activeElement = { tagName: "A" };
    focusHeading(h1 as unknown as HTMLElement, { force: true });
    expect(h1.focus).toHaveBeenCalledWith({ preventScroll: true });
  });

  it("無い要素や、外れている要素（KeepAlive で離れている画面の見出し）には置かない", () => {
    expect(() => focusHeading(null)).not.toThrow();
    expect(() => focusHeading(undefined)).not.toThrow();
    const detached = fakeEl(false);
    focusHeading(detached as unknown as HTMLElement, { force: true });
    expect(detached.focus).not.toHaveBeenCalled();
    expect(detached.attrs.has("tabindex")).toBe(false);
  });
});
