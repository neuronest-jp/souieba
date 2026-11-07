// S1 きょう（ブラッシュアップ 11/7）。問いかけ、このごろの押し葉、あの日のひとこと、残した瞬間（saved() の触覚、✓、N こめ）、
// 札を待つ間の糸（届いたら札に替わり、届かずに終わったら静かに消える）、保存中と写真を開いている間の止め（見直し n=14 / 15）。
// App.vue と同じく KeepAlive の中に描く（onActivated で読み込む）。DOM は web/test/fakeDom.ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { KeepAlive, defineComponent, h, nextTick } from "vue";
import type { Fact, Memory, Recall, TodayResponse } from "../src/api/types";
import type { PickedPhoto } from "../src/camera";
import { fakeDocument, mount, resetFakeDocument, type FakeElement } from "./fakeDom";

const { ApiError, api, haptic, pickPhoto } = vi.hoisted(() => {
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
    api: {
      today: vi.fn<() => Promise<TodayResponse>>(),
      createMemory: vi.fn<(input: unknown) => Promise<Memory>>(),
      getFacts: vi.fn<(id: string) => Promise<{ pending: boolean; items: Fact[] }>>(),
      getRecalls: vi.fn<(id: string) => Promise<{ pending: boolean; items: Recall[] }>>(),
      getMemory: vi.fn(),
      putPhoto: vi.fn(),
      decideFact: vi.fn(async () => undefined),
    },
    haptic: { tap: vi.fn(), select: vi.fn(), stamp: vi.fn(), saved: vi.fn(), arrive: vi.fn(), failed: vi.fn() },
    pickPhoto: vi.fn<() => Promise<PickedPhoto | null>>(),
  };
});
vi.mock("../src/api", () => ({ ApiError, api }));
vi.mock("../src/haptics", () => haptic);
vi.mock("../src/camera", () => ({ pickPhoto: () => pickPhoto() }));
vi.mock("../src/photo", () => ({ PHOTO_MAX_BYTES: 10 * 1024 * 1024, shrinkPhoto: async () => ({ size: 100 }) }));
vi.mock("../src/components/PhotoImg.vue", async () => {
  const { defineComponent, h } = await import("vue");
  return { default: defineComponent({ props: { photoKey: String }, setup: () => () => h("img", { alt: "" }) }) };
});

const TodayScreen = (await import("../src/screens/TodayScreen.vue")).default;
const { promptFor } = await import("../src/components/today/prompts");

const week = (wroteToday = false): TodayResponse["week"] =>
  ["2026-11-01", "2026-11-02", "2026-11-03", "2026-11-04", "2026-11-05", "2026-11-06", "2026-11-07"].map((date, i) => ({
    date,
    wrote: i === 6 ? wroteToday : i === 2 || i === 4,
  }));
const todayRes = (over: Partial<TodayResponse> = {}): TodayResponse => ({ today: "2026-11-07", week: week(), that_day: null, total: 41, ...over });
const memory: Memory = {
  id: "mem_new",
  body: "スーパーで青梅を見かけた",
  happened_on: "2026-11-07",
  happened_on_precision: "day",
  photo_key: null,
  photo_content_type: null,
  created_at: "2026-11-07T03:00:00.000Z",
  updated_at: "2026-11-07T03:00:00.000Z",
};
const recall: Recall = {
  id: "r1",
  reason: "青梅の季節の記憶",
  evidence: "青梅を水に浸けて",
  feedback: "none",
  created_at: "2026-11-07T03:00:10.000Z",
  related_memory: { id: "mem_old", body: "青梅を水に浸けて", happened_on: "2024-06-01", happened_on_precision: "month", photo_key: null },
};

const settle = async () => {
  for (let i = 0; i < 6; i += 1) {
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(0);
    await nextTick();
  }
};
const Host = defineComponent({ setup: () => () => h(KeepAlive, null, [h(TodayScreen)]) });
const text = (root: FakeElement) => root.textContent;
const button = (root: FakeElement, label: string) =>
  root.findAll((el) => el.tagName === "BUTTON" && (el.textContent.trim() === label || el.getAttribute("aria-label") === label))[0];
const statusTexts = (root: FakeElement) => root.findAll((el) => el.getAttribute("role") === "status").map((el) => el.textContent.trim());
const textarea = (root: FakeElement) => root.querySelector("textarea")! as FakeElement & { value: string };
const typeBody = async (root: FakeElement, v: string) => {
  const ta = textarea(root);
  ta.value = v;
  ta.dispatch("input");
  await nextTick();
};

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  resetFakeDocument();
  Object.assign(fakeDocument, { addEventListener: vi.fn(), removeEventListener: vi.fn(), visibilityState: "visible" });
  vi.stubGlobal("document", fakeDocument);
  vi.stubGlobal("window", { addEventListener: vi.fn(), removeEventListener: vi.fn(), dispatchEvent: vi.fn(), innerHeight: 874 });
  vi.stubGlobal("URL", Object.assign(URL, { createObjectURL: () => "blob:x", revokeObjectURL: () => {} }));
  Object.values(api).forEach((f) => f.mockReset());
  Object.values(haptic).forEach((f) => f.mockClear());
  pickPhoto.mockReset();
  api.today.mockResolvedValue(todayRes());
  api.decideFact.mockResolvedValue(undefined);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("書く画面", () => {
  it("見出しの下にあいさつ、入力欄に問い（欄の名前は「きょうのひとこと」のまま）", async () => {
    const { container, errors } = mount(Host);
    await settle();
    const p = promptFor(new Date());
    expect(container.querySelector("[data-greeting]")?.textContent).toBe(p.greeting);
    expect(textarea(container).getAttribute("placeholder")).toBe(p.question);
    expect(container.querySelector("label")?.textContent).toBe("きょうのひとこと");
    expect(errors).toEqual([]);
  });

  it("このごろ: 7 日の枠。書いた日は押し葉、きょうがまだなら「ここに」。続けた日数は出さない", async () => {
    const { container } = mount(Host);
    await settle();
    const slots = container.findAll((el) => el.tagName === "LI" && el.hasAttribute("data-date"));
    expect(slots.map((s) => s.getAttribute("data-wrote"))).toEqual(["false", "false", "true", "false", "true", "false", "false"]);
    expect(slots.filter((s) => s.findAll((el) => el.hasClass("day-leaf")).length > 0)).toHaveLength(2);
    expect(slots[6]!.textContent).toContain("ここに");
    expect(slots[6]!.textContent).toContain("きょう");
    expect(text(container)).not.toMatch(/連続|日目|続けて|日つづけて/);
  });

  it("あの日のひとこと: あるときだけ、折りたたんだ便箋で S3（from=today）へ", async () => {
    api.today.mockResolvedValue(
      todayRes({
        that_day: {
          memory: { id: "mem_ago", body: "仕事帰りに金木犀の香りがした。\nもう秋だ", happened_on: "2025-11-08", happened_on_precision: "day", photo_key: null },
          years: 1,
          match: "near",
        },
      }),
    );
    const { container } = mount(Host);
    await settle();
    const link = container.findAll((el) => el.tagName === "A" && el.hasClass("that-day"))[0]!;
    expect(link.getAttribute("href")).toBe("#memory/mem_ago?from=today");
    expect(link.textContent).toContain("1年まえの、きょうのころ");
    expect(link.textContent).toContain("2025年11月8日");
    expect(link.textContent).toContain("仕事帰りに金木犀の香りがした。");
    expect(link.textContent).not.toContain("もう秋だ");
  });

  it("あの日のひとことが無い日・読めなかった日は何も出さない（「見つかりませんでした」と言わない）", async () => {
    api.today.mockRejectedValue(new ApiError(500, "internal", "x"));
    const { container, errors } = mount(Host);
    await settle();
    expect(container.findAll((el) => el.hasClass("that-day"))).toHaveLength(0);
    expect(container.findAll((el) => el.hasAttribute("data-date"))).toHaveLength(0);
    expect(text(container)).not.toMatch(/見つかりません|ありません|読めません/);
    expect(errors).toEqual([]);
  });
});

describe("残した瞬間", () => {
  it("保存できたら saved() の触覚、手書きの ✓、「42こめのひとこと」。読み直した総数で合わせる", async () => {
    let done!: (m: Memory) => void;
    api.createMemory.mockImplementation(() => new Promise((r) => (done = r)));
    api.getFacts.mockResolvedValue({ pending: true, items: [] });
    api.getRecalls.mockResolvedValue({ pending: true, items: [] });
    const { container, errors } = mount(Host);
    await settle();
    await typeBody(container, "スーパーで青梅を見かけた");
    button(container, "保存する")!.click(1);
    await settle();
    // 保存している間: 便箋は沈み、本文は書き換えられず、写真の札も押せない（見直し n=15）
    expect(container.findAll((el) => el.hasClass("letter-sealing"))).toHaveLength(1);
    expect(textarea(container).hasAttribute("readonly")).toBe(true);
    expect(button(container, "写真を添える")!.hasAttribute("disabled")).toBe(true);
    expect(statusTexts(container)).toContain("残しています");

    api.today.mockResolvedValue(todayRes({ total: 42, week: week(true) }));
    done(memory);
    await settle();
    expect(haptic.saved).toHaveBeenCalledTimes(1);
    expect(container.querySelector("h1")?.textContent).toBe("残しました");
    expect(container.findAll((el) => el.hasClass("saved-check") && el.hasClass("is-drawing"))).toHaveLength(1);
    expect(container.findAll((el) => el.hasClass("letter-sealed"))).toHaveLength(1);
    expect(text(container)).toContain("42こめのひとこと");
    expect(errors).toEqual([]);
  });

  it("保存に失敗したら failed() の触覚。便箋は沈んだままにしない", async () => {
    api.createMemory.mockRejectedValue(new ApiError(500, "internal", "x"));
    const { container } = mount(Host);
    await settle();
    await typeBody(container, "ひとこと");
    button(container, "保存する")!.click(1);
    await settle();
    expect(haptic.failed).toHaveBeenCalledTimes(1);
    expect(haptic.saved).not.toHaveBeenCalled();
    expect(container.findAll((el) => el.hasClass("letter-sealing"))).toHaveLength(0);
    expect(text(container)).toContain("うまく保存できませんでした");
  });

  it("写真を開いている間は「保存する」を押せない（写真なしで残さない。見直し n=14）", async () => {
    pickPhoto.mockImplementation(() => new Promise(() => {}));
    const { container } = mount(Host);
    await settle();
    await typeBody(container, "ひとこと");
    expect(button(container, "保存する")!.hasAttribute("disabled")).toBe(false);
    button(container, "写真を添える")!.click(1);
    await settle();
    expect(button(container, "保存する")!.hasAttribute("disabled")).toBe(true);
    button(container, "保存する")!.click(1);
    await settle();
    expect(api.createMemory).not.toHaveBeenCalled();
  });
});

describe("札を待つ間", () => {
  const saveOnce = async (root: FakeElement) => {
    api.createMemory.mockResolvedValue(memory);
    await typeBody(root, "スーパーで青梅を見かけた");
    button(root, "保存する")!.click(1);
    await settle();
  };

  it("札がまだの間は「思い出しています」。届いたら札に入れ替わる", async () => {
    api.getFacts.mockResolvedValue({ pending: false, items: [] });
    api.getRecalls.mockResolvedValueOnce({ pending: true, items: [] }).mockResolvedValue({ pending: false, items: [recall] });
    const { container, errors } = mount(Host);
    await settle();
    await saveOnce(container);
    expect(statusTexts(container)).toContain("思い出しています");
    await vi.advanceTimersByTimeAsync(2000);
    await settle();
    expect(statusTexts(container)).not.toContain("思い出しています");
    expect(container.findAll((el) => el.tagName === "ARTICLE" && el.hasClass("note"))).toHaveLength(1);
    expect(errors).toEqual([]);
  });

  it("何も届かずに終わったら、静かに薄れて消える（何も言わない）", async () => {
    api.getFacts.mockResolvedValue({ pending: false, items: [] });
    api.getRecalls.mockResolvedValueOnce({ pending: true, items: [] }).mockResolvedValue({ pending: false, items: [] });
    const { container } = mount(Host);
    await settle();
    await saveOnce(container);
    expect(statusTexts(container)).toContain("思い出しています");
    await vi.advanceTimersByTimeAsync(2000);
    await settle();
    // 薄れている途中（is-leaving）
    expect(container.findAll((el) => el.hasClass("waiting-thread") && el.hasClass("is-leaving"))).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(400);
    await settle();
    expect(container.findAll((el) => el.hasClass("waiting-thread"))).toHaveLength(0);
    expect(text(container)).not.toMatch(/見つかりません|ありません/);
  });

  it("札が最初から pending でなければ、待つ糸は出さない", async () => {
    api.getFacts.mockResolvedValue({ pending: true, items: [] });
    api.getRecalls.mockResolvedValue({ pending: false, items: [] });
    const { container } = mount(Host);
    await settle();
    await saveOnce(container);
    expect(container.findAll((el) => el.hasClass("waiting-thread") && !el.hasClass("is-leaving"))).toHaveLength(0);
  });

  it("候補が届くと控えがすべり出て、候補が少しずつずれて現れる", async () => {
    const f: Fact = { id: "f1", kind: "thing", value: "青梅", status: "candidate", source: "ai", evidence: "青梅", created_at: "", decided_at: null };
    api.getFacts.mockResolvedValue({ pending: false, items: [f] });
    api.getRecalls.mockResolvedValue({ pending: false, items: [] });
    const { container } = mount(Host);
    await settle();
    await saveOnce(container);
    expect(container.findAll((el) => el.hasClass("slip-reveal") && el.hasClass("is-entering"))).toHaveLength(1);
    expect(container.querySelector('li[data-fact-id="f1"]')!.hasClass("chip-in")).toBe(true);
  });
});
