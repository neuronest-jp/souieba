// S6 ことばの地図（ADR-0014、wireframes 第10節）。S2 の入口、空・少ない・待つ・失敗・地図の表示、言葉を押すとシートに引用、S3 へのリンク、
// 集めなおし（新しいひとこと / 集めなおせなかった）、画面を離れたときのシート、最初の表示だけ動かすこと。DOM は web/test/fakeDom.ts の最小のもの
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defineComponent, h, KeepAlive, nextTick, ref } from "vue";
import type { KeywordMap, KeywordsResponse, MapKeyword, MemoryList } from "../src/api/types";
import { fakeDocument, mount, resetFakeDocument, type FakeElement } from "./fakeDom";

const { keywords, collectKeywords, listMemories, haptic, MockApiError } = vi.hoisted(() => ({
  keywords: vi.fn<() => Promise<KeywordsResponse>>(),
  collectKeywords: vi.fn<() => Promise<KeywordsResponse>>(),
  listMemories: vi.fn<(cursor?: string | null) => Promise<MemoryList>>(),
  haptic: { tap: vi.fn(), select: vi.fn(), stamp: vi.fn(), saved: vi.fn(), arrive: vi.fn(), failed: vi.fn() },
  MockApiError: class extends Error {
    constructor(
      public readonly status: number,
      public readonly code: string,
      message: string,
    ) {
      super(message);
    }
  },
}));
vi.mock("../src/api", () => ({
  ApiError: MockApiError,
  api: {
    keywords: () => keywords(),
    collectKeywords: () => collectKeywords(),
    listMemories: (cursor?: string | null) => listMemories(cursor),
  },
}));
vi.mock("../src/haptics", () => haptic);

const WordsScreen = (await import("../src/screens/WordsScreen.vue")).default;
const TimelineScreen = (await import("../src/screens/TimelineScreen.vue")).default;

const kw = (label: string, role: MapKeyword["role"], years: Array<[number, number]>, mentions: MapKeyword["mentions"] = []): MapKeyword => ({
  label,
  kind: "thing",
  role,
  years: years.map(([year, count]) => ({ year, count })),
  total: years.reduce((n, [, c]) => n + c, 0),
  mentions,
});
const TENBO = [
  { memory_id: "m_2023", happened_on: "2023-11-22", happened_on_precision: "day" as const, sentence: "あの山の上の展望台で、みさきにプロポーズした。", surface: "展望台" },
  { memory_id: "m_2020", happened_on: "2020-07-12", happened_on_precision: "day" as const, sentence: "思い立ってレンタカーを借りて、ひとりで山の上の展望台まで走った。", surface: "展望台" },
];
const MAP: KeywordMap = {
  generated_at: "2026-11-06T12:00:00.000Z",
  years: [
    { year: 2020, count: 17 },
    { year: 2023, count: 12 },
    { year: 2025, count: 13 },
  ],
  keywords: [
    kw("展望台", "bridge", [[2020, 1], [2023, 1]], TENBO),
    kw("ドラマ", "leaf", [[2020, 5]]),
    kw("そら", "leaf", [[2025, 9]], [{ memory_id: "m_sora", happened_on: "2025-01-19", happened_on_precision: "day", sentence: "そらが生まれた。", surface: "そら" }]),
  ],
};
const ready = (over: Partial<KeywordsResponse> = {}): KeywordsResponse => ({ map: MAP, stale_count: 0, memory_count: 77, ...over });

const settle = async () => {
  for (let i = 0; i < 5; i += 1) {
    await new Promise((r) => setTimeout(r, 0));
    await nextTick();
  }
};
const deferred = <T>() => {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

const button = (root: FakeElement, label: string) => root.findAll((el) => el.tagName === "BUTTON" && el.textContent.trim() === label)[0];
const words = (root: FakeElement) => root.findAll((el) => el.tagName === "BUTTON" && el.hasAttribute("data-word"));
const wordButton = (root: FakeElement, label: string) => words(root).find((el) => el.textContent.trim() === label)!;
const live = (root: FakeElement) => root.findAll((el) => el.getAttribute("role") === "status" && el.hasAttribute("data-live"))[0]!;
const dialog = () => fakeDocument.body.findAll((el) => el.getAttribute("role") === "dialog")[0];
const focused = () => {
  const el = fakeDocument.activeElement;
  if (!el || el === fakeDocument.body) return "body";
  return `${el.tagName}:${el.getAttribute("aria-label") ?? el.textContent.trim()}`;
};

let listeners: Map<string, Set<(e: unknown) => void>>;
const pressKey = (key: string) => listeners.get("keydown")?.forEach((fn) => fn({ key }));

beforeEach(() => {
  resetFakeDocument();
  vi.stubGlobal("document", fakeDocument);
  listeners = new Map();
  vi.stubGlobal("window", {
    addEventListener: (type: string, fn: (e: unknown) => void) => {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type)!.add(fn);
    },
    removeEventListener: (type: string, fn: (e: unknown) => void) => listeners.get(type)?.delete(fn),
    dispatchEvent: vi.fn(),
    location: { hash: "#words" },
    history: { back: vi.fn() },
  });
  keywords.mockReset();
  collectKeywords.mockReset();
  listMemories.mockReset();
  Object.values(haptic).forEach((fn) => fn.mockReset());
});
afterEach(() => {
  vi.unstubAllGlobals();
});

const open = async (r: KeywordsResponse) => {
  keywords.mockResolvedValue(r);
  const view = mount(WordsScreen);
  await settle();
  return view;
};

describe("S2 の入口", () => {
  it("見出しの行の右に「ことばの地図 ›」（#words）。一覧には触らない", async () => {
    listMemories.mockResolvedValue({ items: [], next_cursor: null });
    const { container, errors } = mount(TimelineScreen);
    await settle();
    const header = container.querySelector("header")!;
    const link = header.querySelector('a[href="#words"]')!;
    expect(link.textContent.trim()).toBe("ことばの地図 ›");
    // 読む順は 見出し → 入口
    const order = header.findAll((el) => el.tagName === "H1" || el.tagName === "A").map((el) => el.tagName);
    expect(order).toEqual(["H1", "A"]);
    expect(errors).toEqual([]);
  });
});

describe("S6 ことばの地図: 地図が無いとき", () => {
  it("読み込み中は「よみこみ中」。見出しは h1「ことばの地図」、戻るは「‹ これまで」", async () => {
    keywords.mockReturnValue(deferred<KeywordsResponse>().promise);
    const { container, errors } = mount(WordsScreen);
    await settle();
    expect(container.findAll((el) => el.tagName === "H1").map((el) => el.textContent)).toEqual(["ことばの地図"]);
    expect(button(container, "‹ これまで")).toBeDefined();
    expect(container.findAll((el) => el.getAttribute("role") === "status").map((el) => el.textContent)).toContain("よみこみ中");
    expect(errors).toEqual([]);
  });

  it("記憶が 8 件未満: 「もう少し書きためると、ことばの地図ができます。」だけで、集めるボタンは出さない", async () => {
    const { container, errors } = await open({ map: null, stale_count: 0, memory_count: 5, reason: "few" });
    expect(container.textContent).toContain("もう少し書きためると、ことばの地図ができます。");
    expect(button(container, "ことばを集める")).toBeUndefined();
    expect(container.querySelector('a[href="#today"]')?.textContent).toBe("きょうのひとことから");
    expect(container.textContent).not.toContain("見つかりませんでした");
    expect(collectKeywords).not.toHaveBeenCalled();
    expect(errors).toEqual([]);
  });

  it("「ことばを集める」→ 待つ間は「ことばを集めています」（role=status）→ 地図が現れ、h1 へフォーカス", async () => {
    const { container, errors } = await open({ map: null, stale_count: 0, memory_count: 77 });
    expect(container.textContent).toContain("くり返し出てくることばを集めて");
    const answer = deferred<KeywordsResponse>();
    collectKeywords.mockReturnValue(answer.promise);
    button(container, "ことばを集める")!.click();
    await settle();
    expect(live(container).textContent).toBe("ことばを集めています");
    expect(container.textContent).toContain("ことばを集めています");
    expect(button(container, "ことばを集める")).toBeUndefined();
    answer.resolve(ready({ refreshed: true }));
    await settle();
    expect(words(container).map((el) => el.textContent.trim())).toEqual(["ドラマ", "展望台", "そら"]);
    expect(live(container).textContent).toBe("ことばの地図ができました");
    expect(haptic.saved).toHaveBeenCalledTimes(1);
    expect(focused()).toBe("H1:ことばの地図");
    expect(errors).toEqual([]);
  });

  it("集められなかったら温かい一文と「もう一度」。「見つかりませんでした」とは言わない", async () => {
    const { container, errors } = await open({ map: null, stale_count: 0, memory_count: 77 });
    collectKeywords.mockRejectedValue(new MockApiError(502, "unavailable", "x"));
    button(container, "ことばを集める")!.click();
    await settle();
    expect(container.textContent).toContain("いまは、うまく集められませんでした。");
    expect(container.textContent).not.toContain("見つかりませんでした");
    expect(live(container).textContent).toBe("いまは、うまく集められませんでした");
    expect(haptic.failed).toHaveBeenCalledTimes(1);
    collectKeywords.mockResolvedValue(ready({ refreshed: true }));
    button(container, "もう一度")!.click();
    await settle();
    expect(words(container)).toHaveLength(3);
    expect(errors).toEqual([]);
  });

  it("集めた言葉がくり返し出てこなかった（地図が空）ときも「もう少し書きためると」", async () => {
    const { container, errors } = await open(ready({ map: { ...MAP, keywords: [] } }));
    expect(container.textContent).toContain("もう少し書きためると、ことばの地図ができます。");
    expect(words(container)).toEqual([]);
    expect(errors).toEqual([]);
  });

  it("読み込めなかったら「読み込めませんでした」と「もう一度」", async () => {
    keywords.mockRejectedValue(new Error("network"));
    const { container, errors } = mount(WordsScreen);
    await settle();
    expect(container.textContent).toContain("読み込めませんでした");
    keywords.mockResolvedValue(ready());
    button(container, "もう一度")!.click();
    await settle();
    expect(words(container)).toHaveLength(3);
    expect(errors).toEqual([]);
  });
});

describe("S6 ことばの地図: 地図", () => {
  it("年を古い順に、年 → その年の言葉 → 次の年とのあいだの言葉 の順で読む。線は読み上げから外す", async () => {
    const { container, errors } = await open(ready());
    expect(container.textContent).toContain("くり返し出てくることばを、年ごとに");
    const list = container.findAll((el) => el.getAttribute("aria-label") === "年ごとのことば")[0]!;
    expect(list.tagName).toBe("OL");
    expect(list.getAttribute("role")).toBe("list");
    const read = list.findAll((el) => (el.tagName === "P" && el.hasClass("words-year")) || el.hasAttribute("data-word")).map((el) => el.textContent.trim());
    expect(read).toEqual(["2020年", "ドラマ", "展望台", "2023年", "2025年", "そら"]);
    expect(wordButton(container, "展望台").getAttribute("aria-label")).toBe("展望台、2020年と2023年に 2 こ");
    expect(wordButton(container, "ドラマ").getAttribute("aria-label")).toBe("ドラマ、2020年に 5 こ");
    expect(wordButton(container, "展望台").getAttribute("aria-haspopup")).toBe("dialog");
    const svg = container.findAll((el) => el.tagName === "SVG")[0]!;
    expect(svg.getAttribute("aria-hidden")).toBe("true");
    // 線: leaf 2 本 + 展望台の糸 2 本
    expect(svg.findAll((el) => el.tagName === "PATH")).toHaveLength(4);
    expect(svg.findAll((el) => el.hasClass("words-thread"))).toHaveLength(2);
    expect(container.textContent).toContain("11月6日（金）に集めました");
    expect(errors).toEqual([]);
  });

  it("言葉を押すと、下からのシートにその言葉が出てくるひとことを新しい順に（日付と一文、言葉の所に印）。押すと S3（from=words）", async () => {
    const { container, errors } = await open(ready());
    wordButton(container, "展望台").click();
    await settle();
    const d = dialog()!;
    expect(d.getAttribute("aria-modal")).toBe("true");
    expect(focused()).toBe("H2:展望台");
    expect(d.textContent).toContain("2020年・2023年に、あわせて 2 こ");
    const links = d.findAll((el) => el.tagName === "A");
    expect(links.map((el) => el.getAttribute("href"))).toEqual(["#memory/m_2023?from=words", "#memory/m_2020?from=words"]);
    expect(links[0]!.textContent).toContain("2023年11月22日");
    // 一文は本文のまま（読み上げ用の「」を除くと、Worker が返した一文と同じ）
    expect(links[0]!.textContent.replace(/[「」]/g, "")).toContain("あの山の上の展望台で、みさきにプロポーズした。");
    expect(d.findAll((el) => el.tagName === "MARK").map((el) => el.textContent)).toEqual(["展望台", "展望台"]);
    // 印は色だけに頼らない（読み上げは「」で読む）
    expect(links[1]!.textContent).toContain("山の上の「展望台」まで");
    // 後ろの画面は inert
    expect(container.getAttribute("inert")).toBe("");
    expect(wordButton(container, "展望台").getAttribute("aria-controls")).toBe("word-sheet");
    pressKey("Escape");
    await settle();
    expect(dialog()).toBeUndefined();
    expect(container.hasAttribute("inert")).toBe(false);
    expect(focused()).toBe("BUTTON:展望台、2020年と2023年に 2 こ");
    expect(errors).toEqual([]);
  });

  it("leaf のシートは「2025年に 9 こ」。mentions より多いときは「新しい N こを並べています」", async () => {
    const many = { ...MAP, keywords: [kw("そら", "leaf", [[2025, 12]], [MAP.keywords[2]!.mentions[0]!])] };
    const { container, errors } = await open(ready({ map: many }));
    wordButton(container, "そら").click();
    await settle();
    expect(dialog()!.textContent).toContain("2025年に 12 こ");
    expect(dialog()!.textContent).toContain("新しい 1 こを並べています");
    button(dialog()!, "とじる")!.click();
    await settle();
    expect(dialog()).toBeUndefined();
    expect(errors).toEqual([]);
  });

  it("新しいひとことがあれば「新しいひとことが N こあります。」と「集めなおす」。集めなおせなかったら前の地図のまま「もう一度」", async () => {
    const { container, errors } = await open(ready({ stale_count: 2 }));
    expect(container.textContent).toContain("新しいひとことが 2 こあります。");
    const answer = deferred<KeywordsResponse>();
    collectKeywords.mockReturnValue(answer.promise);
    button(container, "集めなおす")!.click();
    await settle();
    // 集めている間も地図はそのまま（少し薄くする）
    expect(live(container).textContent).toBe("ことばを集めています");
    expect(words(container)).toHaveLength(3);
    expect(container.findAll((el) => el.hasClass("words-map"))[0]!.hasClass("is-collecting")).toBe(true);
    answer.resolve(ready({ stale_count: 2, refreshed: false }));
    await settle();
    expect(container.textContent).toContain("いまは集めなおせませんでした。");
    expect(button(container, "もう一度")).toBeDefined();
    expect(words(container)).toHaveLength(3);
    expect(haptic.failed).toHaveBeenCalledTimes(1);
    expect(errors).toEqual([]);
  });

  it("集めなおしを待つ間に開いた言葉が、集め終えた地図で役が変わったら（leaf → bridge）、シートを閉じて inert を外し、見出しへフォーカス", async () => {
    const { container, errors } = await open(ready({ stale_count: 2 }));
    const answer = deferred<KeywordsResponse>();
    collectKeywords.mockReturnValue(answer.promise);
    button(container, "集めなおす")!.click();
    await settle();
    // 集めている間も、薄くなった地図の言葉は押せる
    wordButton(container, "そら").click();
    await settle();
    expect(dialog()).toBeDefined();
    expect(container.getAttribute("inert")).toBe("");
    const next: KeywordMap = {
      ...MAP,
      generated_at: "2026-11-07T12:00:00.000Z",
      keywords: [MAP.keywords[0]!, MAP.keywords[1]!, kw("そら", "bridge", [[2023, 2], [2025, 9]], MAP.keywords[2]!.mentions)],
    };
    answer.resolve(ready({ map: next, refreshed: true }));
    await settle();
    expect(dialog()).toBeUndefined();
    expect(container.hasAttribute("inert")).toBe(false);
    expect(focused()).toBe("H1:ことばの地図");
    // 画面はまた押せる（開いている言葉の印も残らない）
    expect(wordButton(container, "そら").getAttribute("data-role")).toBe("bridge");
    wordButton(container, "展望台").click();
    await settle();
    expect(dialog()!.textContent).toContain("展望台");
    expect(errors).toEqual([]);
  });

  it("集めなおせず、前の地図を数え直したら開いている言葉が消えていた（2 回を割った）ときも、シートを閉じて inert を外す", async () => {
    const { container, errors } = await open(ready({ stale_count: 1 }));
    const answer = deferred<KeywordsResponse>();
    collectKeywords.mockReturnValue(answer.promise);
    button(container, "集めなおす")!.click();
    await settle();
    wordButton(container, "ドラマ").click();
    await settle();
    expect(container.getAttribute("inert")).toBe("");
    answer.resolve(ready({ map: { ...MAP, keywords: [MAP.keywords[0]!, MAP.keywords[2]!] }, refreshed: false }));
    await settle();
    expect(dialog()).toBeUndefined();
    expect(container.hasAttribute("inert")).toBe(false);
    expect(errors).toEqual([]);
  });

  it("bridge が挙げた年のほかの年にも出ていれば、読み上げの名前に「など」を付ける（挙げた年だけで合計を数えたように読まない）", async () => {
    const wide: KeywordMap = { ...MAP, keywords: [{ ...kw("展望台", "bridge", [[2020, 2], [2023, 2], [2025, 2]], TENBO), total: 7 }] };
    const { container, errors } = await open(ready({ map: wide }));
    expect(wordButton(container, "展望台").getAttribute("aria-label")).toBe("展望台、2020年、2023年と2025年などに 7 こ");
    wordButton(container, "展望台").click();
    await settle();
    expect(dialog()!.textContent).toContain("2020年・2023年・2025年などに、あわせて 7 こ");
    expect(errors).toEqual([]);
  });

  it("記憶が 8 件未満になっていたら、地図はそのまま出し、集めなおしは勧めない", async () => {
    const { container, errors } = await open(ready({ stale_count: 3, memory_count: 7, reason: "few" }));
    expect(words(container)).toHaveLength(3);
    expect(container.textContent).not.toContain("新しいひとことが");
    expect(errors).toEqual([]);
  });
});

describe("S6 ことばの地図: 画面の行き来と動き", () => {
  const host = () => {
    const shown = ref<"words" | "other">("words");
    const Other = defineComponent({ name: "OtherScreen", render: () => h("main", [h("h1", "記憶")]) });
    const App = defineComponent({
      setup: () => () => h(KeepAlive, { include: "WordsScreen" }, [shown.value === "words" ? h(WordsScreen) : h(Other)]),
    });
    return { App, shown };
  };

  it("シートを開いたまま S3 へ移ったら、シートを閉じて inert を外す。戻ったら「よみこみ中」を出さずに裏で取り直す", async () => {
    keywords.mockResolvedValue(ready());
    const { App, shown } = host();
    const { container, errors } = mount(App);
    await settle();
    wordButton(container, "展望台").click();
    await settle();
    expect(dialog()).toBeDefined();
    shown.value = "other";
    await settle();
    expect(dialog()).toBeUndefined();
    expect(container.hasAttribute("inert")).toBe(false);
    keywords.mockResolvedValue(ready({ stale_count: 1 }));
    shown.value = "words";
    await nextTick();
    expect(container.textContent).not.toContain("よみこみ中");
    await settle();
    expect(keywords).toHaveBeenCalledTimes(2);
    expect(container.textContent).toContain("新しいひとことが 1 こあります。");
    expect(errors).toEqual([]);
  });

  it("地図が現れる動きは最初の表示だけ（動きを減らす設定では付けない）", async () => {
    (window as unknown as { matchMedia: (q: string) => { matches: boolean } }).matchMedia = () => ({ matches: false });
    const { container, errors } = await open(ready());
    expect(container.findAll((el) => el.hasClass("words-map"))[0]!.hasClass("is-weaving")).toBe(true);
    resetFakeDocument();
    (window as unknown as { matchMedia: (q: string) => { matches: boolean } }).matchMedia = () => ({ matches: true });
    const reduced = await open(ready());
    expect(reduced.container.findAll((el) => el.hasClass("words-map"))[0]!.hasClass("is-weaving")).toBe(false);
    expect(errors).toEqual([]);
  });
});
