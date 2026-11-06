// S3（記憶の詳細）のフォーカスと読み上げ（wireframes 6 節フォーカス）。押したボタンや画面の中身が消えても、
// フォーカスが body に落ちたままにならず、結果が読み上げで伝わる。DOM は web/test/fakeDom.ts の最小のもの
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { nextTick } from "vue";
import type { Fact, MemoryDetail } from "../src/api/types";
import { fakeDocument, mount, resetFakeDocument, type FakeElement } from "./fakeDom";

const { ApiError, getMemory, decideFact } = vi.hoisted(() => {
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
  };
});
vi.mock("../src/api", () => ({
  ApiError,
  api: {
    getMemory: (id: string) => getMemory(id),
    decideFact: (id: string, status: string) => decideFact(id, status),
  },
}));
// 写真の部品はカメラや取得を使うので、中身の無い部品に置き換える（このテストでは描かない）
vi.mock("../src/components/PhotoPicker.vue", async () => {
  const { defineComponent, h } = await import("vue");
  return { default: defineComponent({ props: { modelValue: { type: null } }, emits: ["update:modelValue"], render: () => h("div") }) };
});
vi.mock("../src/components/PhotoImg.vue", async () => {
  const { defineComponent, h } = await import("vue");
  return { default: defineComponent({ props: { photoKey: String, boxClass: String }, render: () => h("div") }) };
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
