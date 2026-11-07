// S3（記憶の詳細）のフォーカスと読み上げ（wireframes 6 節フォーカス）。押したボタンや画面の中身が消えても、
// フォーカスが body に落ちたままにならず、結果が読み上げで伝わる。DOM は web/test/fakeDom.ts の最小のもの
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { nextTick } from "vue";
import type { Fact, MemoryDetail } from "../src/api/types";
import { fakeDocument, mount, resetFakeDocument, type FakeElement } from "./fakeDom";

const { ApiError, getMemory, decideFact, putPhoto, recallFeedback, haptic } = vi.hoisted(() => {
  class ApiError extends Error {
    constructor(
      public readonly status: number,
      public readonly code: string,
      message: string,
    ) {
      super(message);
    }
  }
  return {
    ApiError,
    getMemory: vi.fn<(id: string) => Promise<MemoryDetail>>(),
    decideFact: vi.fn<(id: string, status: string) => Promise<unknown>>(),
    putPhoto: vi.fn<(id: string, blob: unknown) => Promise<{ photo_key: string; photo_content_type: string }>>(),
    recallFeedback: vi.fn<(id: string, feedback: string) => Promise<unknown>>(),
    haptic: { tap: vi.fn(), select: vi.fn(), stamp: vi.fn(), saved: vi.fn(), arrive: vi.fn(), failed: vi.fn() },
  };
});
vi.mock("../src/api", () => ({
  ApiError,
  api: {
    getMemory: (id: string) => getMemory(id),
    decideFact: (id: string, status: string) => decideFact(id, status),
    putPhoto: (id: string, blob: unknown) => putPhoto(id, blob),
    recallFeedback: (id: string, feedback: string) => recallFeedback(id, feedback),
  },
}));
vi.mock("../src/photo", () => ({ PHOTO_MAX_BYTES: 10 * 1024 * 1024, shrinkPhoto: async () => ({ size: 100 }) }));
// 触覚は手ざわりの名前で呼ばれたかだけを見る（@capacitor/haptics は読まない）
vi.mock("../src/haptics", () => haptic);
// 写真の部品はカメラや取得を使うので置き換える。PhotoPicker は「写真を添える」を押すと写真を 1 枚選んだことにするだけ
// （中身は today の受け持ち）。PhotoImg は alt を持つ img だけ
vi.mock("../src/components/PhotoPicker.vue", async () => {
  const { defineComponent, h } = await import("vue");
  return {
    default: defineComponent({
      props: { modelValue: { type: null } },
      emits: ["update:modelValue"],
      setup: (_p, { emit }) => () =>
        h("div", [h("button", { type: "button", onClick: () => emit("update:modelValue", { name: "p.jpg", type: "image/jpeg", size: 100 }) }, "写真を添える")]),
    }),
  };
});
vi.mock("../src/components/PhotoImg.vue", async () => {
  const { defineComponent, h } = await import("vue");
  return { default: defineComponent({ props: { photoKey: String, boxClass: String, alt: String }, setup: (p) => () => h("img", { alt: p.alt ?? "" }) }) };
});

const MemoryDetailScreen = (await import("../src/screens/MemoryDetailScreen.vue")).default;

const fact = (id: string, value: string, status: Fact["status"] = "candidate"): Fact => ({
  id,
  kind: "person",
  value,
  status,
  source: "ai",
  evidence: `${value}と駅前で会った`,
  created_at: "2026-11-06T00:00:00.000Z",
  decided_at: null,
});
const detail = (facts: Fact[]): MemoryDetail => ({
  memory: {
    id: "mem_1",
    body: "ゆきと駅前で会った",
    happened_on: "2025-10-05", // 今年でない日（表示に曜日が付かない）,
    happened_on_precision: "day",
    photo_key: null,
    photo_content_type: null,
    created_at: "2026-11-06T00:00:00.000Z",
    updated_at: "2026-11-06T00:00:00.000Z",
  },
  facts: { pending: false, items: facts },
  recalls: { pending: false, items: [] },
  recalled_by: { items: [] },
});

// 返事を待たせる約束。押した直後（記録の返事の前）と、返事の後を分けて確かめる
const deferred = <T>() => {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

const settle = async () => {
  for (let i = 0; i < 5; i += 1) {
    await new Promise((r) => setTimeout(r, 0));
    await nextTick();
  }
};
const byTag = (root: FakeElement, tag: string) => root.findAll((el) => el.tagName === tag);
const button = (root: FakeElement, label: string) => root.findAll((el) => el.tagName === "BUTTON" && el.textContent === label)[0];
const statusText = (root: FakeElement) => root.querySelectorAll('[role="status"]').map((el) => el.textContent);
// いまフォーカスのある所を短い文字で表す（失敗したとき、要素の中身を丸ごと並べずに済む）
const focused = () => {
  const el = fakeDocument.activeElement;
  if (!el || el === fakeDocument.body) return "body";
  const id = el.getAttribute("data-fact-id");
  return id ? `${el.tagName}[${id}]` : `${el.tagName}:${el.textContent}`;
};

beforeEach(() => {
  resetFakeDocument();
  vi.stubGlobal("document", fakeDocument);
  vi.stubGlobal("window", { addEventListener: vi.fn(), removeEventListener: vi.fn(), dispatchEvent: vi.fn() });
  getMemory.mockReset();
  decideFact.mockReset();
  putPhoto.mockReset();
  recallFeedback.mockReset();
  Object.values(haptic).forEach((f) => f.mockReset());
});
afterEach(() => {
  vi.unstubAllGlobals();
});

const open = async (facts: Fact[]) => {
  getMemory.mockResolvedValue(detail(facts));
  const view = mount(MemoryDetailScreen, { id: "mem_1", from: "past" });
  await settle();
  return view;
};

describe("S3 で見えている最後の候補を「ちがう」にしたとき", () => {
  it("キーボードで押すと、行も見出しも消えるので起きた日の h1 へフォーカスを置き、「（値）、ちがう」を読み上げる", async () => {
    const { container, errors } = await open([fact("f1", "ゆき")]);
    const answer = deferred<unknown>();
    decideFact.mockReturnValue(answer.promise);
    const no = button(container, "ちがう")!;
    no.focus();
    no.click(0);
    await settle();
    expect(focused()).toBe("H1:2025年10月5日");
    expect(byTag(container, "H2").map((el) => el.textContent)).not.toContain("おぼえていること"); // 0 件なら見出しごと出さない（4.1）
    answer.resolve({ id: "f1", status: "rejected", decided_at: "2026-11-07T00:00:00.000Z" });
    await settle();
    expect(statusText(container)).toContain("ゆき、ちがう");
    expect(focused()).toBe("H1:2025年10月5日");
    expect(errors).toEqual([]);
  });

  it("記録に失敗したら、戻した行へフォーカスを戻し、その行に「記録できませんでした」を出す", async () => {
    const { container, errors } = await open([fact("f1", "ゆき")]);
    const answer = deferred<unknown>();
    decideFact.mockReturnValue(answer.promise);
    const no = button(container, "ちがう")!;
    no.focus();
    no.click(0);
    await settle();
    answer.reject(new ApiError(500, "internal", "x"));
    await settle();
    const li = container.querySelector('li[data-fact-id="f1"]');
    expect(li).not.toBeNull();
    expect(li?.textContent).toContain("記録できませんでした");
    expect(focused()).toBe("LI[f1]");
    expect(button(container, "ちがう")).toBeDefined(); // 候補に戻り、もう一度押せる
    expect(errors).toEqual([]);
  });

  it("指で押したとき（click の detail が 1）はフォーカスを動かさず、失敗の知らせは出す", async () => {
    const { container, errors } = await open([fact("f1", "ゆき")]);
    const answer = deferred<unknown>();
    decideFact.mockReturnValue(answer.promise);
    fakeDocument.activeElement = fakeDocument.body;
    button(container, "ちがう")!.click(1);
    await settle();
    expect(focused()).toBe("body");
    answer.reject(new ApiError(0, "network", "x"));
    await settle();
    expect(container.querySelector('li[data-fact-id="f1"]')?.textContent).toContain("記録できませんでした");
    expect(focused()).toBe("body");
    expect(errors).toEqual([]);
  });

  it("却下済みの事実しか無い記憶では、これまでどおり「おぼえていること」を出さない（4.1）", async () => {
    const { container, errors } = await open([fact("f1", "ゆき", "rejected")]);
    expect(byTag(container, "H2").map((el) => el.textContent)).not.toContain("おぼえていること");
    expect(container.querySelector("li[data-fact-id]")).toBeNull();
    expect(errors).toEqual([]);
  });

  it("ほかの候補が残っていれば、これまでどおり同じ位置の行へ置く", async () => {
    decideFact.mockResolvedValue({});
    const { container } = await open([fact("f1", "ゆき"), fact("f2", "駅前")]);
    const no = button(container, "ちがう")!;
    no.focus();
    no.click(0);
    await settle();
    expect(focused()).toBe("LI[f2]");
    expect(statusText(container)).toContain("ゆき、ちがう");
  });
});

describe("S3 で記憶が見つからない・読み込めないとき", () => {
  it("見つからない（404）なら、その一文を h1 にしてフォーカスを置く（読み上げで画面が変わったことが伝わる）", async () => {
    getMemory.mockRejectedValue(new ApiError(404, "not_found", "x"));
    const { container, errors } = mount(MemoryDetailScreen, { id: "mem_gone", from: "past" });
    await settle();
    expect(focused()).toBe("H1:この記憶は見つかりませんでした");
    expect(byTag(container, "H1")).toHaveLength(1); // 画面ごとに h1 は 1 つ
    expect(errors).toEqual([]);
  });

  it("読み込めないときも一文へ置く。「もう一度」が消えてまた失敗しても、もう一度その一文へ置く", async () => {
    getMemory.mockRejectedValue(new ApiError(0, "network", "x"));
    const { container, errors } = mount(MemoryDetailScreen, { id: "mem_1", from: "past" });
    await settle();
    expect(focused()).toBe("H1:読み込めませんでした");
    const again = button(container, "もう一度")!;
    again.focus();
    again.click(0);
    await settle();
    expect(getMemory).toHaveBeenCalledTimes(2);
    expect(focused()).toBe("H1:読み込めませんでした");
    // 読めたら、これまでどおり起きた日の h1 へ
    getMemory.mockResolvedValue(detail([]));
    button(container, "もう一度")!.click(0);
    await settle();
    expect(focused()).toBe("H1:2025年10月5日");
    expect(errors).toEqual([]);
  });

  it("読み込みを待つ間に利用者が動かしたフォーカスは奪わない", async () => {
    const answer = deferred<MemoryDetail>();
    getMemory.mockReturnValue(answer.promise);
    const { container, errors } = mount(MemoryDetailScreen, { id: "mem_gone", from: "past" });
    await settle();
    button(container, "‹ これまで")!.focus();
    answer.reject(new ApiError(404, "not_found", "x"));
    await settle();
    expect(focused()).toBe("BUTTON:‹ これまで");
    expect(errors).toEqual([]);
  });
});

describe("S3 の戻るの文言（開いた元の画面）", () => {
  it("きょう・これまで・つながりから開いたとき、それぞれ「‹ きょう」「‹ これまで」「‹ つながり」", async () => {
    getMemory.mockResolvedValue(detail([]));
    const labels: string[] = [];
    for (const from of ["today", "past", "connections"] as const) {
      const { container, errors } = mount(MemoryDetailScreen, { id: "mem_1", from });
      await settle();
      labels.push(container.findAll((el) => el.tagName === "BUTTON" && el.textContent.startsWith("‹"))[0]!.textContent);
      expect(errors).toEqual([]);
    }
    expect(labels).toEqual(["‹ きょう", "‹ これまで", "‹ つながり"]);
  });
});

describe("S3 で写真を添えたとき（見直し n=13）", () => {
  const alertText = (root: FakeElement) => root.querySelectorAll('[role="alert"]').map((el) => el.textContent);

  it("押したボタンが消えても body に落とさず起きた日の h1 へ置き、「写真を添えました」を読み上げる。写真には本文の 1 行目を alt に入れる", async () => {
    getMemory.mockResolvedValue({ ...detail([]), memory: { ...detail([]).memory, body: "ゆきと駅前で会った\n雨だった" } });
    const { container, errors } = mount(MemoryDetailScreen, { id: "mem_1", from: "past" });
    await settle();
    const answer = deferred<{ photo_key: string; photo_content_type: string }>();
    putPhoto.mockReturnValue(answer.promise);
    const add = button(container, "写真を添える")!;
    add.focus();
    add.click(0);
    await settle();
    expect(statusText(container)).toContain("写真を添えています");
    answer.resolve({ photo_key: "u/mem_1.jpg", photo_content_type: "image/jpeg" });
    await settle();
    expect(focused()).toBe("H1:2025年10月5日");
    expect(statusText(container)).toContain("写真を添えました");
    expect(byTag(container, "IMG").map((el) => el.getAttribute("alt"))).toEqual(["ゆきと駅前で会った"]);
    expect(haptic.saved).toHaveBeenCalledTimes(1);
    expect(errors).toEqual([]);
  });

  it("添えられなかったときも h1 へ置き、知らせは alert（status は空に戻す）。失敗の触覚を鳴らし、もう一度押せる", async () => {
    getMemory.mockResolvedValue(detail([]));
    const { container, errors } = mount(MemoryDetailScreen, { id: "mem_1", from: "past" });
    await settle();
    putPhoto.mockRejectedValue(new ApiError(500, "internal", "x"));
    const add = button(container, "写真を添える")!;
    add.focus();
    add.click(0);
    await settle();
    expect(focused()).toBe("H1:2025年10月5日");
    expect(alertText(container)).toContain("写真を添えられませんでした。もう一度どうぞ");
    expect(statusText(container).filter((t) => t.includes("写真"))).toEqual([]);
    expect(haptic.failed).toHaveBeenCalledTimes(1);
    expect(button(container, "写真を添える")).toBeDefined();
    expect(errors).toEqual([]);
  });

  it("添えている間に利用者が動かしたフォーカスは奪わない", async () => {
    getMemory.mockResolvedValue(detail([]));
    const { container } = mount(MemoryDetailScreen, { id: "mem_1", from: "past" });
    await settle();
    const answer = deferred<{ photo_key: string; photo_content_type: string }>();
    putPhoto.mockReturnValue(answer.promise);
    button(container, "写真を添える")!.click(1);
    await settle();
    button(container, "‹ これまで")!.focus();
    answer.resolve({ photo_key: "u/mem_1.jpg", photo_content_type: "image/jpeg" });
    await settle();
    expect(focused()).toBe("BUTTON:‹ これまで");
  });
});

describe("S3 の札の手ざわり（ブラッシュアップ 11/7）", () => {
  const recall = (id: string) => ({
    id,
    reason: "青梅の季節の記憶につながる。",
    evidence: "駅前で",
    feedback: "none" as const,
    created_at: "2026-11-07T00:00:00.000Z",
    related_memory: { id: `old_${id}`, body: "駅前で", happened_on: "2024-06", happened_on_precision: "month" as const, photo_key: null },
  });
  const recalledBy = {
    id: "rb1",
    reason: "駅前の記憶につながる。",
    evidence: "駅前で会った",
    feedback: "none" as const,
    created_at: "2026-11-07T00:00:00.000Z",
    memory: { id: "mem_new", body: "駅前を通った", happened_on: "2026-11-07", happened_on_precision: "day" as const, photo_key: null },
  };

  it("開いたときからある札は動かさず、開いたあとに届いた札だけ現れる動きを付ける（届いた触覚もその札だけ）", async () => {
    const first = { ...detail([]), recalls: { pending: true, items: [recall("r1")] } };
    const later = { ...detail([]), recalls: { pending: false, items: [recall("r1"), recall("r2")] } };
    getMemory.mockResolvedValueOnce(first).mockResolvedValue(later);
    const { container, errors } = mount(MemoryDetailScreen, { id: "mem_1", from: "past" });
    await settle();
    const notes = container.findAll((el) => el.tagName === "ARTICLE" && el.hasClass("note"));
    expect(notes.map((el) => el.hasClass("appear"))).toEqual([false, true]);
    expect(haptic.arrive).toHaveBeenCalledTimes(1);
    expect(errors).toEqual([]);
  });

  it("「そうだった」で判の触覚（stamp）、記録に失敗したら印を戻して失敗の触覚（failed）", async () => {
    getMemory.mockResolvedValue({ ...detail([]), recalled_by: { items: [recalledBy] } });
    const answer = deferred<unknown>();
    recallFeedback.mockReturnValue(answer.promise);
    const { container, errors } = mount(MemoryDetailScreen, { id: "mem_1", from: "past" });
    await settle();
    button(container, "そうだった")!.click(1);
    await settle();
    expect(haptic.stamp).toHaveBeenCalledTimes(1);
    expect(haptic.failed).not.toHaveBeenCalled();
    answer.reject(new ApiError(0, "network", "x"));
    await settle();
    expect(haptic.failed).toHaveBeenCalledTimes(1);
    expect(button(container, "そうだった")!.hasAttribute("aria-pressed")).toBe(false);
    expect(errors).toEqual([]);
  });

  it("「消す」で開くシートは、やめるで閉じて「消す」へフォーカスを戻す（動きを減らす設定では待たない）", async () => {
    getMemory.mockResolvedValue(detail([]));
    const { container, errors } = mount(MemoryDetailScreen, { id: "mem_1", from: "past" });
    await settle();
    const del = button(container, "消す")!;
    del.focus();
    del.click(0);
    await settle();
    expect(container.querySelector('[role="dialog"]')).not.toBeNull();
    expect(focused()).toBe("BUTTON:やめる");
    button(container, "やめる")!.click(0);
    await settle();
    expect(container.querySelector('[role="dialog"]')).toBeNull();
    expect(focused()).toBe("BUTTON:消す");
    expect(errors).toEqual([]);
  });
});
