// S2 これまでを年月で探す（ADR-0015、wireframes 10 節）。区切りと札の文言、精度ごとの区切り、札を押すとシート、
// 月を押すと month= で読み直して先頭へ、「いちばん新しいひとことへ」で戻る、無い月は押せない、戻ってきたときと続きの始まり。
// DOM は web/test/fakeDom.ts の最小のもの。札が上に貼り付いて押し出される見た目（sticky）はブラウザで撮って確かめる
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defineComponent, h, KeepAlive, nextTick, ref } from "vue";
import type { ListStart, Memory, MemoryList, MemoryMonths, Precision } from "../src/api/types";
import { FakeElement, fakeDocument, mount, resetFakeDocument } from "./fakeDom";

const { listMemories, memoryMonths, haptic } = vi.hoisted(() => ({
  listMemories: vi.fn<(cursor?: string | null, start?: ListStart | null) => Promise<MemoryList>>(),
  memoryMonths: vi.fn<() => Promise<MemoryMonths>>(),
  haptic: { tap: vi.fn(), select: vi.fn(), stamp: vi.fn(), saved: vi.fn(), arrive: vi.fn(), failed: vi.fn() },
}));
vi.mock("../src/api", () => ({
  ApiError: class extends Error {},
  api: {
    listMemories: (cursor?: string | null, start?: ListStart | null) => listMemories(cursor, start),
    memoryMonths: () => memoryMonths(),
  },
}));
vi.mock("../src/haptics", () => haptic);

const TimelineScreen = (await import("../src/screens/TimelineScreen.vue")).default;

const mem = (id: string, happened_on: string | null, happened_on_precision: Precision, created_at = "2026-11-06T00:00:00.000Z"): Memory => ({
  id,
  body: `${id} のひとこと`,
  happened_on,
  happened_on_precision,
  photo_key: null,
  photo_content_type: null,
  created_at,
  updated_at: created_at,
});
const page = (items: Memory[], next_cursor: string | null = null): MemoryList => ({ items, next_cursor });

// いちばん新しい記憶からの一覧（精度ごとに 1 つ以上）
const NEWEST = [
  mem("nov3", "2025-11-03", "day"),
  mem("nov1", "2025-11-01", "day"),
  mem("oct", "2025-10-12", "day"),
  mem("jun-m", "2024-06-01", "month"),
  mem("y2023", "2023-01-01", "year"),
  mem("unk", null, "unknown"),
];
const MONTHS: MemoryMonths = {
  months: [
    { month: "2025-11", count: 2 },
    { month: "2025-10", count: 1 },
    { month: "2024-06", count: 1 },
  ],
  years_only: [{ year: "2023", count: 1 }],
  undated: 1,
};
const FROM_JUNE = [mem("jun-m", "2024-06-01", "month"), mem("y2023", "2023-01-01", "year"), mem("unk", null, "unknown")];

const settle = async () => {
  for (let i = 0; i < 5; i += 1) {
    await new Promise((r) => setTimeout(r, 0));
    await nextTick();
  }
};
const byTag = (root: FakeElement, tag: string) => root.findAll((el) => el.tagName === tag);
const labels = (root: FakeElement) => byTag(root, "H2").map((el) => el.textContent.trim());
const tag = (root: FakeElement, label: string) =>
  root.findAll((el) => el.tagName === "BUTTON" && el.getAttribute("aria-label") === `${label}。年月で探す`)[0];
const rowIds = (root: FakeElement) => root.findAll((el) => el.tagName === "A" && (el.getAttribute("href") ?? "").startsWith("#memory/")).map((el) => el.getAttribute("href")!.slice(8));
const sectionRows = (root: FakeElement) =>
  root.findAll((el) => el.tagName === "SECTION" && el.hasAttribute("data-section")).map((s) => [
    s.getAttribute("data-section"),
    s.findAll((el) => el.tagName === "A").map((a) => a.getAttribute("href")!.slice(8)),
  ]);
const dialog = () => fakeDocument.body.findAll((el) => el.getAttribute("role") === "dialog")[0];
const cell = (label: string) => dialog()?.findAll((el) => el.tagName === "BUTTON" && el.getAttribute("aria-label") === label)[0];
const cellOf = (key: string) => dialog()?.findAll((el) => el.tagName === "BUTTON" && el.getAttribute("data-month") === key)[0];
const buttonText = (root: FakeElement, text: string) => root.findAll((el) => el.tagName === "BUTTON" && el.textContent.trim() === text)[0];
const focused = () => {
  const el = fakeDocument.activeElement;
  if (!el || el === fakeDocument.body) return "body";
  return `${el.tagName}:${el.getAttribute("aria-label") ?? el.textContent.trim()}`;
};

let listeners: Map<string, Set<(e: unknown) => void>>;
const pressKey = (key: string) => listeners.get("keydown")?.forEach((fn) => fn({ key }));
let scrollTo: ReturnType<typeof vi.fn>;

beforeEach(() => {
  resetFakeDocument();
  vi.stubGlobal("document", fakeDocument);
  listeners = new Map();
  scrollTo = vi.fn();
  vi.stubGlobal("window", {
    addEventListener: (type: string, fn: (e: unknown) => void) => {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type)!.add(fn);
    },
    removeEventListener: (type: string, fn: (e: unknown) => void) => listeners.get(type)?.delete(fn),
    dispatchEvent: vi.fn(),
    scrollTo,
  });
  listMemories.mockReset();
  memoryMonths.mockReset();
  Object.values(haptic).forEach((fn) => fn.mockReset());
  listMemories.mockImplementation(async (_cursor, start) => (start ? page(FROM_JUNE) : page(NEWEST)));
  memoryMonths.mockResolvedValue(MONTHS);
});
afterEach(() => {
  vi.unstubAllGlobals();
  delete (FakeElement.prototype as unknown as { scrollIntoView?: unknown }).scrollIntoView;
});

const open = async () => {
  const view = mount(TimelineScreen);
  await settle();
  return view;
};
const openSheet = async (root: FakeElement, label: string) => {
  tag(root, label)!.click(1);
  await settle();
};

describe("S2 の区切りと札", () => {
  it("起きた日の年月ごとに区切り、札（h2）は「2025年 11月」「2023年」「日付なし」。札のボタンの名前は「…。年月で探す」", async () => {
    const { container, errors } = await open();
    expect(listMemories).toHaveBeenCalledWith(null, null);
    expect(labels(container)).toEqual(["2025年 11月", "2025年 10月", "2024年 6月", "2023年", "日付なし"]);
    expect(sectionRows(container)).toEqual([
      ["2025-11", ["nov3", "nov1"]],
      ["2025-10", ["oct"]],
      ["2024-06", ["jun-m"]],
      ["2023", ["y2023"]],
      ["undated", ["unk"]],
    ]);
    // 札は見出しの中のボタン（読み上げは見出し → ボタンの名前）
    for (const h2 of byTag(container, "H2")) {
      const b = h2.querySelector("button")!;
      expect(b.getAttribute("aria-label")).toBe(`${h2.textContent.trim()}。年月で探す`);
      expect(b.getAttribute("aria-haspopup")).toBe("dialog");
    }
    // 札を開くまで件数は読まない（一覧の読み込みは 1 回だけ）
    expect(memoryMonths).not.toHaveBeenCalled();
    expect(listMemories).toHaveBeenCalledTimes(1);
    expect(errors).toEqual([]);
  });

  it("精度 month はその年月、year は年だけ。同じ 1 月 1 日に並んだ年だけの記憶は、1 月の区切りを割らずにその後ろへ", async () => {
    // API の並び（起きた日の降順、同じ日は作成の降順）: 年だけ（あとで書いた）が 1 月 1 日の day より先に来る
    listMemories.mockResolvedValue(
      page([
        mem("jan5", "2024-01-05", "day"),
        mem("yr", "2024-01-01", "year", "2026-10-01T00:00:00.000Z"),
        mem("jan-m", "2024-01-01", "month", "2025-05-01T00:00:00.000Z"),
        mem("jan1", "2024-01-01", "day", "2024-01-01T00:00:00.000Z"),
        mem("dec", "2023-12-20", "day"),
      ]),
    );
    const { container } = await open();
    expect(labels(container)).toEqual(["2024年 1月", "2024年", "2023年 12月"]);
    expect(sectionRows(container)).toEqual([
      ["2024-01", ["jan5", "jan-m", "jan1"]],
      ["2024", ["yr"]],
      ["2023-12", ["dec"]],
    ]);
  });

  it("「もっと前を見る」で足した行も同じ区切りに入る（続きは cursor だけで読む）", async () => {
    listMemories.mockResolvedValueOnce(page([mem("a", "2025-11-03", "day"), mem("b", "2025-11-01", "day")], "c1"));
    listMemories.mockResolvedValueOnce(page([mem("c", "2025-11-01", "day"), mem("d", "2025-09-01", "day")]));
    const { container } = await open();
    buttonText(container, "もっと前を見る")!.click(1);
    await settle();
    expect(listMemories).toHaveBeenLastCalledWith("c1", undefined);
    expect(labels(container)).toEqual(["2025年 11月", "2025年 9月"]);
    expect(sectionRows(container)[0]).toEqual(["2025-11", ["a", "b", "c"]]);
  });
});

describe("年月で探すシート", () => {
  it("札を押すと body の直下にシートが開き、見出しにフォーカス、後ろは inert。触覚は鳴らさない", async () => {
    const { container, errors } = await open();
    await openSheet(container, "2025年 10月");
    expect(dialog()).toBeTruthy();
    expect(dialog()!.getAttribute("aria-labelledby")).toBe("month-sheet-title");
    expect(focused()).toBe("H2:年月で探す");
    expect(container.hasAttribute("inert")).toBe(true);
    expect(memoryMonths).toHaveBeenCalledTimes(1);
    expect(Object.values(haptic).every((fn) => fn.mock.calls.length === 0)).toBe(true);
    // 年ごと（新しい年から）に 12 か月のマス。記憶のある月だけ「2025年 11月、2 こ」と読む
    expect(dialog()!.findAll((el) => el.tagName === "H3").map((el) => el.textContent.trim())).toEqual(["2025年", "2024年", "2023年"]);
    expect(cell("2025年 11月、2 こ")).toBeTruthy();
    expect(cell("2024年 6月、1 こ")).toBeTruthy();
    expect(dialog()!.findAll((el) => el.tagName === "BUTTON" && el.hasAttribute("data-month") && (el.getAttribute("data-month") ?? "").startsWith("2025-"))).toHaveLength(12);
    // 押した札の区切りを、いま見ている区切りとして示す
    expect(cellOf("2025-10")!.getAttribute("aria-current")).toBe("true");
    expect(cellOf("2025-11")!.getAttribute("aria-current")).toBeNull();
    // 年だけと日付なしもシートから選べる
    expect(cell("2023年、年だけ、1 こ")).toBeTruthy();
    expect(cell("日付なし、1 こ")).toBeTruthy();
    expect(errors).toEqual([]);
  });

  it("記憶の無い月は薄く置くだけで押せず、読み上げない", async () => {
    const { container } = await open();
    await openSheet(container, "2025年 11月");
    const sep = cellOf("2025-09")!;
    expect(sep.hasAttribute("disabled")).toBe(true);
    expect(sep.getAttribute("aria-hidden")).toBe("true");
    expect(sep.hasClass("text-ink-faint")).toBe(true);
    expect(sep.textContent.trim()).toBe("9月");
    sep.click(1);
    await settle();
    expect(listMemories).toHaveBeenCalledTimes(1);
    expect(dialog()).toBeTruthy();
    expect(haptic.select).not.toHaveBeenCalled();
  });

  it("Esc で閉じると inert を外し、押した札へフォーカスを返す（一覧はそのまま）", async () => {
    const { container } = await open();
    await openSheet(container, "2025年 10月");
    pressKey("Escape");
    await settle();
    expect(dialog()).toBeUndefined();
    expect(container.hasAttribute("inert")).toBe(false);
    expect(focused()).toBe("BUTTON:2025年 10月。年月で探す");
    expect(listMemories).toHaveBeenCalledTimes(1);
  });

  it("件数が読めなかったら、シートの中に「読み込めませんでした」と「もう一度」", async () => {
    memoryMonths.mockRejectedValueOnce(new Error("network"));
    const { container } = await open();
    await openSheet(container, "2025年 11月");
    expect(dialog()!.textContent).toContain("読み込めませんでした");
    buttonText(dialog()!, "もう一度")!.click(1);
    await settle();
    expect(memoryMonths).toHaveBeenCalledTimes(2);
    expect(cell("2025年 11月、2 こ")).toBeTruthy();
  });
});

describe("月から読み直す", () => {
  it("月を押すと select の触覚、month= でその月から読み直して先頭へ。先頭に「いちばん新しいひとことへ」、フォーカスは新しい最初の札", async () => {
    const { container, errors } = await open();
    expect(buttonText(container, "いちばん新しいひとことへ")).toBeUndefined();
    await openSheet(container, "2025年 11月");
    cell("2024年 6月、1 こ")!.click(1);
    await settle();
    expect(haptic.select).toHaveBeenCalledTimes(1);
    expect(listMemories).toHaveBeenLastCalledWith(null, { month: "2024-06" });
    expect(dialog()).toBeUndefined();
    expect(container.hasAttribute("inert")).toBe(false);
    expect(labels(container)).toEqual(["2024年 6月", "2023年", "日付なし"]);
    expect(rowIds(container)).toEqual(["jun-m", "y2023", "unk"]);
    expect(scrollTo).toHaveBeenLastCalledWith({ top: 0 });
    expect(buttonText(container, "いちばん新しいひとことへ")).toBeTruthy();
    expect(focused()).toBe("BUTTON:2024年 6月。年月で探す");
    expect(errors).toEqual([]);
  });

  it("「いちばん新しいひとことへ」で最初から読み直し、ボタンは消える", async () => {
    const { container } = await open();
    await openSheet(container, "2025年 11月");
    cell("2024年 6月、1 こ")!.click(1);
    await settle();
    scrollTo.mockClear();
    buttonText(container, "いちばん新しいひとことへ")!.click(1);
    await settle();
    expect(listMemories).toHaveBeenLastCalledWith(null, null);
    expect(haptic.select).toHaveBeenCalledTimes(2);
    expect(labels(container)[0]).toBe("2025年 11月");
    expect(rowIds(container)).toEqual(NEWEST.map((m) => m.id));
    expect(scrollTo).toHaveBeenLastCalledWith({ top: 0 });
    expect(buttonText(container, "いちばん新しいひとことへ")).toBeUndefined();
    expect(focused()).toBe("BUTTON:2025年 11月。年月で探す");
  });

  it("年だけ・日付なしもシートから year= / undated=1 で読み直す。先頭の区切りでなければ、その区切りの頭へ送る", async () => {
    const scrolled: string[] = [];
    (FakeElement.prototype as unknown as { scrollIntoView: () => void }).scrollIntoView = function (this: FakeElement) {
      scrolled.push(this.getAttribute("data-section") ?? this.tagName);
    };
    listMemories.mockImplementation(async (_c, start) => {
      if (start && "year" in start) return page([mem("jan1", "2023-01-01", "day"), mem("y2023", "2023-01-01", "year"), mem("unk", null, "unknown")]);
      if (start && "undated" in start) return page([mem("unk", null, "unknown")]);
      return page(NEWEST);
    });
    const { container } = await open();
    await openSheet(container, "2025年 11月");
    cell("2023年、年だけ、1 こ")!.click(1);
    await settle();
    expect(listMemories).toHaveBeenLastCalledWith(null, { year: "2023" });
    // 同じ 1 月 1 日の day の行が先に来るので、年だけの区切りの頭へ送り、フォーカスもその札へ
    expect(labels(container)).toEqual(["2023年 1月", "2023年", "日付なし"]);
    expect(scrolled).toEqual(["2023"]);
    expect(focused()).toBe("BUTTON:2023年。年月で探す");

    await openSheet(container, "日付なし");
    expect(cellOf("undated")!.getAttribute("aria-current")).toBe("true");
    cell("日付なし、1 こ")!.click(1);
    await settle();
    expect(listMemories).toHaveBeenLastCalledWith(null, { undated: true });
    expect(labels(container)).toEqual(["日付なし"]);
  });

  it("読み直した一覧は、戻ってきたときの取り直しも同じ始まり。シートを開いたまま画面を離れたら閉じて inert を外す", async () => {
    const shown = ref<"past" | "other">("past");
    const Other = defineComponent({ name: "Other", setup: () => () => h("main", [h("h1", "つながり")]) });
    const App = defineComponent({ setup: () => () => h(KeepAlive, { include: "TimelineScreen" }, [shown.value === "past" ? h(TimelineScreen) : h(Other)]) });
    const { container } = mount(App);
    await settle();
    await openSheet(container, "2025年 11月");
    cell("2024年 6月、1 こ")!.click(1);
    await settle();
    await openSheet(container, "2024年 6月");
    expect(container.hasAttribute("inert")).toBe(true);
    shown.value = "other";
    await settle();
    expect(dialog()).toBeUndefined();
    expect(container.hasAttribute("inert")).toBe(false);
    shown.value = "past";
    await settle();
    expect(listMemories).toHaveBeenLastCalledWith(null, { month: "2024-06" });
    expect(labels(container)[0]).toBe("2024年 6月");
    expect(buttonText(container, "いちばん新しいひとことへ")).toBeTruthy();
  });

  it("読み直しに失敗したら「読み込めませんでした」。「もう一度」は同じ月から、「いちばん新しいひとことへ」も出す", async () => {
    const { container } = await open();
    await openSheet(container, "2025年 11月");
    listMemories.mockRejectedValueOnce(new Error("network"));
    cell("2024年 6月、1 こ")!.click(1);
    await settle();
    expect(container.textContent).toContain("読み込めませんでした");
    expect(buttonText(container, "いちばん新しいひとことへ")).toBeTruthy();
    buttonText(container, "もう一度")!.click(1);
    await settle();
    expect(listMemories).toHaveBeenLastCalledWith(null, { month: "2024-06" });
    expect(labels(container)[0]).toBe("2024年 6月");
  });
});
