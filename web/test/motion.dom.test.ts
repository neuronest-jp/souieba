// 画面全体の手ざわり（ブラッシュアップ 11/7、motion の受け持ち）。押したときの沈み（.press）、触覚を鳴らす所、
// シートの閉じ方、一覧の最初の現れ方。動きそのもの（速さ・曲線）はブラウザで撮って確かめる。DOM は web/test/fakeDom.ts の最小のもの
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defineComponent, h, KeepAlive, nextTick, ref } from "vue";
import type { Memory, RecalledBy } from "../src/api/types";
import { fakeDocument, mount, resetFakeDocument, type FakeElement } from "./fakeDom";

const { haptic, listMemories, login } = vi.hoisted(() => ({
  haptic: { tap: vi.fn(), select: vi.fn(), stamp: vi.fn(), saved: vi.fn(), arrive: vi.fn(), failed: vi.fn() },
  listMemories: vi.fn<(cursor?: string) => Promise<{ items: Memory[]; next_cursor: string | null }>>(),
  login: vi.fn<(code: string, email: string) => Promise<unknown>>(),
}));
vi.mock("../src/haptics", () => haptic);
vi.mock("../src/api", () => ({
  ApiError: class extends Error {
    constructor(
      public readonly status: number,
      public readonly code: string,
      message: string,
    ) {
      super(message);
    }
  },
  api: { listMemories: (cursor?: string) => listMemories(cursor), login: (c: string, e: string) => login(c, e) },
}));
vi.mock("../src/auth", () => ({ saveToken: vi.fn(async () => undefined) }));
vi.mock("../src/components/PhotoImg.vue", async () => {
  const { defineComponent, h } = await import("vue");
  return { default: defineComponent({ props: { photoKey: String, quiet: Boolean }, setup: (p) => () => h("div", { "data-quiet": p.quiet ? "" : undefined }) }) };
});

const BottomNav = (await import("../src/components/BottomNav.vue")).default;
const RecalledByCard = (await import("../src/components/RecalledByCard.vue")).default;
const DateSheet = (await import("../src/components/DateSheet.vue")).default;
const TimelineScreen = (await import("../src/screens/TimelineScreen.vue")).default;
const WelcomeScreen = (await import("../src/screens/WelcomeScreen.vue")).default;
const MemoryCard = (await import("../src/components/MemoryCard.vue")).default;

const settle = async () => {
  for (let i = 0; i < 5; i += 1) {
    await new Promise((r) => setTimeout(r, 0));
    await nextTick();
  }
};
const buttons = (root: FakeElement) => root.findAll((el) => el.tagName === "BUTTON");
const button = (root: FakeElement, label: string) => buttons(root).find((el) => el.textContent.trim() === label);
let windowListeners: Record<string, (e: unknown) => void> = {};
const stubWindow = (extra: Record<string, unknown> = {}) => {
  windowListeners = {};
  vi.stubGlobal("window", {
    addEventListener: (type: string, fn: (e: unknown) => void) => void (windowListeners[type] = fn),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
    location: { hash: "#past" },
    ...extra,
  });
};
const memory = (i: number): Memory => ({
  id: `m${i}`,
  body: `ひとこと ${i}`,
  happened_on: "2025-10-05",
  happened_on_precision: "day",
  photo_key: null,
  photo_content_type: null,
  created_at: "2026-11-06T00:00:00.000Z",
  updated_at: "2026-11-06T00:00:00.000Z",
});

beforeEach(() => {
  resetFakeDocument();
  vi.stubGlobal("document", fakeDocument);
  stubWindow();
  Object.values(haptic).forEach((f) => f.mockReset());
  listMemories.mockReset();
  login.mockReset();
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("下部ナビ", () => {
  it("項目は押すと沈む（.press）。画面が切り替わる項目を押したときだけ select の触覚（いま出ている画面の項目では鳴らさない）", async () => {
    const { container, errors } = mount(BottomNav, { current: "past" });
    await nextTick();
    const links = container.findAll((el) => el.tagName === "A");
    expect(links.every((el) => el.hasClass("press"))).toBe(true);
    links.find((el) => el.getAttribute("href") === "#past")!.click(1);
    expect(haptic.select).not.toHaveBeenCalled();
    links.find((el) => el.getAttribute("href") === "#connections")!.click(1);
    expect(haptic.select).toHaveBeenCalledTimes(1);
    expect(haptic.tap).not.toHaveBeenCalled();
    expect(errors).toEqual([]);
  });

  it("S3 にいる間（元の画面の項目が選ばれている）にその項目を押すと、元の画面へ戻るので鳴らす", async () => {
    stubWindow({ location: { hash: "#memory/m1" } });
    const { container } = mount(BottomNav, { current: "past" });
    await nextTick();
    container.findAll((el) => el.getAttribute("href") === "#past")[0]!.click(1);
    expect(haptic.select).toHaveBeenCalledTimes(1);
  });

  it("選ばれている項目の淡い地は、ばねでふくらんで落ち着く（.nav-pill-on）。ほかの項目には付けない", async () => {
    const { container } = mount(BottomNav, { current: "today" });
    await nextTick();
    expect(container.findAll((el) => el.hasClass("nav-pill-on")).length).toBe(1);
    expect(container.findAll((el) => el.hasClass("nav-pill-on"))[0]!.hasClass("bg-ember-soft")).toBe(true);
  });
});

describe("S3 の札（RecalledByCard）", () => {
  const item = (feedback: RecalledBy["feedback"]): RecalledBy => ({
    id: "rb1",
    reason: "理由",
    evidence: "引用",
    feedback,
    created_at: "2026-11-07T00:00:00.000Z",
    memory: { id: "mem_new", body: "新しいひとこと", happened_on: "2026-11-07", happened_on_precision: "day", photo_key: null },
  });

  it("「そうだった」を押すと判の触覚（stamp）と、判を押す動き（.recall-stamp）。取り消し（もう一度）はふつうの触覚（tap）", async () => {
    const card = mount(RecalledByCard, { item: item("none") });
    await nextTick();
    button(card.container, "そうだった")!.click(1);
    await nextTick();
    expect(haptic.stamp).toHaveBeenCalledTimes(1);
    expect(button(card.container, "そうだった")!.hasClass("recall-stamp")).toBe(true);
    const again = mount(RecalledByCard, { item: item("helpful") });
    await nextTick();
    button(again.container, "そうだった")!.click(1);
    expect(haptic.stamp).toHaveBeenCalledTimes(1);
    expect(haptic.tap).toHaveBeenCalledTimes(1);
  });

  it("「関係ないかも」はふつうの触覚（tap）。押した反応は親へ渡す（記録は親）", async () => {
    const onReact = vi.fn();
    const card = mount(RecalledByCard, { item: item("none"), onReact });
    await nextTick();
    button(card.container, "関係ないかも")!.click(1);
    expect(haptic.tap).toHaveBeenCalledTimes(1);
    expect(haptic.stamp).not.toHaveBeenCalled();
    expect(onReact).toHaveBeenCalledWith("not_related");
  });
});

describe("「いつ？」のシート（DateSheet）", () => {
  const open = (onClose = vi.fn()) => {
    const precision = ref<"day" | "month" | "year" | "unknown">("day");
    const date = ref("2025-10-05");
    const view = mount(
      defineComponent({
        setup: () => () =>
          h(DateSheet, {
            precision: precision.value,
            "onUpdate:precision": (v: "day" | "month" | "year" | "unknown") => (precision.value = v),
            date: date.value,
            "onUpdate:date": (v: string) => (date.value = v),
            onClose,
          }),
      }),
    );
    return { ...view, precision, onClose };
  };

  it("地（.sheet-backdrop）と紙（.sheet-paper、掴み手）を分けて描く。地を押すと閉じる", async () => {
    const { container, onClose, errors } = open();
    await nextTick();
    const backdrop = container.findAll((el) => el.hasClass("sheet-backdrop"))[0]!;
    const paper = container.querySelector('[role="dialog"]')!;
    expect(paper.hasClass("sheet-paper")).toBe(true);
    expect(paper.findAll((el) => el.hasClass("sheet-grip")).length).toBe(1);
    expect(backdrop.getAttribute("aria-hidden")).toBe("true");
    backdrop.click(1);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(errors).toEqual([]);
  });

  it("「とじる」と Esc でも閉じる。何度押しても close は 1 回（閉じる動きの間に重ねて閉じない）", async () => {
    const { container, onClose } = open();
    await nextTick();
    button(container, "とじる")!.click(1);
    windowListeners.keydown?.({ key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("精度を切り替えたときだけ select の触覚（いまの精度を押しても鳴らさない）。ボタンは押すと沈む", async () => {
    const { container, precision } = open();
    await nextTick();
    button(container, "日")!.click(1);
    expect(haptic.select).not.toHaveBeenCalled();
    button(container, "年")!.click(1);
    await nextTick();
    expect(precision.value).toBe("year");
    expect(haptic.select).toHaveBeenCalledTimes(1);
    expect(button(container, "とじる")!.hasClass("press")).toBe(true);
  });
});

describe("S2 これまで", () => {
  const rows = (root: FakeElement) => root.findAll((el) => el.tagName === "LI");

  it("行は押すと沈み（.press）、写真の小さな焼き付けは読めなくても文言を出さない（quiet）", async () => {
    const { container } = mount(MemoryCard, { memory: { ...memory(1), photo_key: "u/1.jpg", photo_content_type: "image/jpeg" } });
    await nextTick();
    expect(container.querySelector("a")!.hasClass("press")).toBe(true);
    expect(container.querySelector("a div [data-quiet]")).not.toBeNull();
  });

  it("最初に読み込めたときだけ、行が上から少しずつずれて現れる（.rise-in）。戻ってきたときの取り直しでは動かさない", async () => {
    stubWindow({ matchMedia: () => ({ matches: false }) });
    listMemories.mockResolvedValue({ items: [1, 2, 3, 4, 5, 6, 7].map(memory), next_cursor: null });
    const shown = ref<"past" | "other">("past");
    const Other = defineComponent({ name: "Other", setup: () => () => h("p", "other") });
    const App = defineComponent({ setup: () => () => h(KeepAlive, null, [shown.value === "past" ? h(TimelineScreen) : h(Other)]) });
    const { container, errors } = mount(App);
    await settle();
    expect(rows(container).map((el) => el.hasClass("rise-in"))).toEqual([true, true, true, true, true, true, true]);
    shown.value = "other";
    await settle();
    shown.value = "past";
    await settle();
    expect(listMemories).toHaveBeenCalledTimes(2); // 戻ってきたときの取り直し
    // 動き終わったら印を外す（ここではまだ付いていてもよいが、取り直しで付け直さない）
    await new Promise((r) => setTimeout(r, 900));
    await nextTick();
    expect(rows(container).some((el) => el.hasClass("rise-in"))).toBe(false);
    expect(errors).toEqual([]);
  });

  it("動きを減らす設定（とこのテストの既定の環境）では、最初から動かさない", async () => {
    listMemories.mockResolvedValue({ items: [1, 2].map(memory), next_cursor: null });
    const { container } = mount(TimelineScreen);
    await settle();
    expect(rows(container).some((el) => el.hasClass("rise-in"))).toBe(false);
  });
});

describe("S0 ようこそ", () => {
  it("入れなかったときは失敗の触覚（failed）。「はじめる」は押すと沈む", async () => {
    login.mockRejectedValue(new Error("network"));
    const { container, errors } = mount(WelcomeScreen);
    await nextTick();
    const [code, email] = container.findAll((el) => el.tagName === "INPUT");
    // v-model は input の value を読むので、最小の DOM では value を直に入れて input を出す
    (code as unknown as { value: string }).value = "dev";
    code!.dispatch("input");
    (email as unknown as { value: string }).value = "a@example.com";
    email!.dispatch("input");
    await nextTick();
    const start = button(container, "はじめる")!;
    expect(start.hasClass("press")).toBe(true);
    // 最小の DOM の dispatch は preventDefault を持たないので、送り出しの受け手（@submit.prevent）を直に呼ぶ
    const form = container.querySelector("form")!;
    const listeners = (form as unknown as { listeners: Map<string, Array<{ fn: (e: unknown) => void }>> }).listeners;
    listeners.get("submit")!.forEach((l) => l.fn({ type: "submit", preventDefault: () => {}, target: form, currentTarget: form }));
    await settle();
    expect(login).toHaveBeenCalledTimes(1);
    expect(haptic.failed).toHaveBeenCalledTimes(1);
    expect(errors).toEqual([]);
  });
});

describe("下部ナビ（起動直後）", () => {
  it("ハッシュの無い起動直後（きょう）に「きょう」を押しても鳴らさない", async () => {
    stubWindow({ location: { hash: "" } });
    const { container } = mount(BottomNav, { current: "today" });
    await nextTick();
    container.findAll((el) => el.getAttribute("href") === "#today")[0]!.click(1);
    expect(haptic.select).not.toHaveBeenCalled();
  });
});
