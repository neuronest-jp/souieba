// 「そういえば。」の札（RecallCard）。「関係ないかも」と返した札の退き方（見直し n=6）と、届いたときの触覚（arrive）。
// DOM は web/test/fakeDom.ts の最小のもの。触覚は手ざわりの名前で呼ばれたかだけを見る（@capacitor/haptics は読まない）
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { nextTick } from "vue";
import type { Recall } from "../src/api/types";
import { mount, resetFakeDocument, fakeDocument, type FakeElement } from "./fakeDom";

const haptic = vi.hoisted(() => ({ tap: vi.fn(), select: vi.fn(), stamp: vi.fn(), saved: vi.fn(), arrive: vi.fn(), failed: vi.fn() }));
vi.mock("../src/haptics", () => haptic);

const RecallCard = (await import("../src/components/RecallCard.vue")).default;

// 描いた札は各テストの終わりに外す（前のテストの札の触覚の予約が次のテストに漏れない）
const views: Array<ReturnType<typeof mount>> = [];
const show = (props: Record<string, unknown>) => {
  const v = mount(RecallCard, props);
  views.push(v);
  return v;
};

const recall = (feedback: Recall["feedback"] = "none", id = "r1"): Recall => ({
  id,
  reason: "青梅の季節の記憶につながる。",
  evidence: "青梅を水に浸けて",
  feedback,
  created_at: "2026-11-07T00:00:00.000Z",
  related_memory: { id: "mem_old", body: "青梅を水に浸けて、ひとつずつヘタを取るのを手伝った。", happened_on: "2024-06", happened_on_precision: "month", photo_key: null },
});
const macrotask = async () => {
  await new Promise((r) => setTimeout(r, 0));
  await nextTick();
};
const motifs = (root: FakeElement, name: string) => root.findAll((el) => el.getAttribute("data-motif") === name);

beforeEach(() => {
  resetFakeDocument();
  vi.stubGlobal("document", fakeDocument);
  // matchMedia の無い環境は「動きを減らす」扱い（待たずに状態だけ切り替える）
  vi.stubGlobal("window", { addEventListener: vi.fn(), removeEventListener: vi.fn(), dispatchEvent: vi.fn() });
  Object.values(haptic).forEach((f) => f.mockReset());
});
afterEach(() => {
  views.splice(0).forEach((v) => v.unmount());
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("「関係ないかも」と返した札（見直し n=6）", () => {
  it("S1 の札（見出しあり）: 地の色の紙（note-quiet）に退き、封蝋と押し葉を外す。見出し「そういえば。」と「ひらく ›」は残す", async () => {
    const { container, errors } = show({ recall: recall("not_related"), from: "today" });
    await nextTick();
    const card = container.querySelector("article")!;
    expect(card.hasClass("note") && card.hasClass("note-quiet")).toBe(true);
    expect(motifs(container, "seal")).toEqual([]);
    expect(motifs(container, "leaf")).toEqual([]);
    expect(container.querySelector("h2")?.textContent).toBe("そういえば。");
    expect(container.findAll((el) => el.tagName === "A").map((el) => el.textContent)).toEqual(["ひらく ›"]);
    expect(errors).toEqual([]);
  });

  it("S3 の一覧の札（見出しなし）も同じく退く。ふつうの札と「そうだった」の札は封蝋のまま", async () => {
    const quiet = show({ recall: recall("not_related"), from: "past", heading: false });
    const plain = show({ recall: recall("none"), from: "past", heading: false });
    const kept = show({ recall: recall("helpful"), from: "past", heading: false });
    await nextTick();
    expect(quiet.container.querySelector("article")!.hasClass("note-quiet")).toBe(true);
    expect(motifs(quiet.container, "seal")).toEqual([]);
    for (const v of [plain, kept]) {
      expect(v.container.querySelector("article")!.hasClass("note-quiet")).toBe(false);
      expect(motifs(v.container, "seal").length).toBe(1);
    }
  });
});

describe("札が届いたときの触覚（arrive）", () => {
  it("現れる動きのある札（animate）だけ、届いたときに arrive を鳴らす。もう見せた札（animate=false）では鳴らさない", async () => {
    show({ recall: recall("none", "a"), from: "today", animate: false });
    await macrotask();
    expect(haptic.arrive).not.toHaveBeenCalled();
    show({ recall: recall("none", "b"), from: "today" });
    await macrotask(); // 動きを減らす設定（matchMedia の無いこの環境）では待たずに鳴らす
    expect(haptic.arrive).toHaveBeenCalledTimes(1);
    // ほかの触覚は鳴らさない（利用者が押したのではない）
    expect(haptic.tap).not.toHaveBeenCalled();
    expect(haptic.stamp).not.toHaveBeenCalled();
  });

  it("「関係ないかも」の札は提案として届いたのではないので鳴らさない", async () => {
    show({ recall: recall("not_related", "c"), from: "today" });
    await macrotask();
    expect(haptic.arrive).not.toHaveBeenCalled();
  });

  it("動きのある環境では、封蝋が押される瞬間（届いてから約 0.56 秒）に合わせて 1 度だけ鳴らす。同時に届いた札で何度も鳴らさない", async () => {
    vi.useFakeTimers({ now: 100_000 });
    vi.stubGlobal("window", {
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
      matchMedia: () => ({ matches: false }),
    });
    show({ recall: recall("none", "d"), from: "today" });
    show({ recall: recall("none", "e"), from: "today" });
    await nextTick();
    expect(haptic.arrive).not.toHaveBeenCalled();
    vi.advanceTimersByTime(600);
    expect(haptic.arrive).toHaveBeenCalledTimes(1);
  });

  it("届く前に札が外れたら鳴らさない", async () => {
    vi.useFakeTimers({ now: 200_000 });
    vi.stubGlobal("window", {
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
      matchMedia: () => ({ matches: false }),
    });
    const { unmount } = show({ recall: recall("none", "f"), from: "today" });
    await nextTick();
    unmount();
    vi.advanceTimersByTime(1000);
    expect(haptic.arrive).not.toHaveBeenCalled();
  });
});
