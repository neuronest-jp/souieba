// 候補の「そう」「ちがう」の手ざわり（ブラッシュアップ 11/7）。「そう」は判が押される動きと stamp()、「ちがう」は打ち消し線が引かれる動きと tap()。
// 動きはこの操作で決めた行だけ（読み込んだときから確定・却下の行は動かさない）。記録に失敗したら failed() で知らせ、動きの印も外す。
// S1 の控えでは候補が少しずつずれて現れる（stagger）。DOM は web/test/fakeDom.ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { nextTick } from "vue";
import type { Fact } from "../src/api/types";
import { fakeDocument, mount, resetFakeDocument, type FakeElement } from "./fakeDom";

const { decideFact, haptic } = vi.hoisted(() => ({
  decideFact: vi.fn(async (_id: string, _status: string) => undefined as unknown),
  haptic: { tap: vi.fn(), stamp: vi.fn(), failed: vi.fn(), select: vi.fn(), saved: vi.fn(), arrive: vi.fn() },
}));
vi.mock("../src/api", () => ({ api: { decideFact: (id: string, status: string) => decideFact(id, status) } }));
vi.mock("../src/haptics", () => haptic);
const FactChips = (await import("../src/components/FactChips.vue")).default;

const fact = (id: string, value: string, status: Fact["status"]): Fact => ({
  id,
  kind: "thing",
  value,
  status,
  source: "ai",
  evidence: value,
  created_at: "2026-11-07T00:00:00.000Z",
  decided_at: null,
});
const settle = async () => {
  for (let i = 0; i < 5; i += 1) {
    await new Promise((r) => setTimeout(r, 0));
    await nextTick();
  }
};
const row = (root: FakeElement, id: string) => root.querySelector(`li[data-fact-id="${id}"]`)!;
const button = (root: FakeElement, id: string, label: string) => row(root, id).findAll((el) => el.tagName === "BUTTON" && el.textContent === label)[0]!;
const has = (root: FakeElement, cls: string) => root.findAll((el) => el.hasClass(cls)).length > 0;

beforeEach(() => {
  resetFakeDocument();
  vi.stubGlobal("document", fakeDocument);
  decideFact.mockReset();
  decideFact.mockResolvedValue(undefined);
  Object.values(haptic).forEach((f) => f.mockClear());
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("「そう」で判が押される", () => {
  it("押した瞬間に stamp() と、判に沈んで輪が広がる印（stamp-press）。しばらくすると印は外れ、静かな判に戻る", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const { container, errors } = mount(FactChips, { facts: [fact("f1", "青梅", "candidate")] });
    await nextTick();
    button(container, "f1", "そう").click(1);
    expect(haptic.stamp).toHaveBeenCalledTimes(1);
    expect(haptic.tap).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(0);
    await nextTick();
    expect(has(row(container, "f1"), "stamp-press")).toBe(true);
    await vi.advanceTimersByTimeAsync(1000);
    await nextTick();
    expect(has(row(container, "f1"), "stamp-press")).toBe(false);
    expect(row(container, "f1").textContent).toContain("✓ そう");
    expect(errors).toEqual([]);
  });

  it("読み込んだときから確定の行には、判の動きを付けない", async () => {
    const { container } = mount(FactChips, { facts: [fact("f1", "青梅", "confirmed")] });
    await nextTick();
    expect(has(container, "stamp-press")).toBe(false);
  });
});

describe("「ちがう」で打ち消し線が引かれる", () => {
  it("押した瞬間に tap() と、線を引く印（strike-draw）。線そのもの（line-through）は値にだけ残す", async () => {
    const { container } = mount(FactChips, { facts: [fact("f1", "駅前", "candidate")] });
    await nextTick();
    button(container, "f1", "ちがう").click(1);
    expect(haptic.tap).toHaveBeenCalledTimes(1);
    expect(haptic.stamp).not.toHaveBeenCalled();
    await settle();
    const struck = row(container, "f1").findAll((el) => el.hasClass("line-through"));
    expect(struck.map((el) => el.textContent)).toEqual(["駅前"]);
    expect(struck[0]!.hasClass("strike-draw")).toBe(true);
  });
});

describe("記録に失敗したとき", () => {
  it("failed() で知らせ、判の印を外して候補に戻す", async () => {
    decideFact.mockRejectedValueOnce(new Error("x"));
    const { container } = mount(FactChips, { facts: [fact("f1", "青梅", "candidate")] });
    await nextTick();
    button(container, "f1", "そう").click(1);
    await settle();
    expect(haptic.failed).toHaveBeenCalledTimes(1);
    expect(has(container, "stamp-press")).toBe(false);
    expect(button(container, "f1", "そう")).toBeTruthy();
    expect(row(container, "f1").textContent).toContain("記録できませんでした");
  });
});

describe("S1 の控えで、候補が少しずつずれて現れる", () => {
  it("stagger のときだけ、行に現れる印（chip-in）を付ける（順番の遅れは style の --i）", async () => {
    const facts = [fact("f1", "青梅", "candidate"), fact("f2", "スーパー", "candidate")];
    const a = mount(FactChips, { facts, stagger: true });
    await nextTick();
    expect(row(a.container, "f1").hasClass("chip-in")).toBe(true);
    expect(row(a.container, "f2").hasClass("chip-in")).toBe(true);
    a.unmount();
    resetFakeDocument();
    const b = mount(FactChips, { facts });
    await nextTick();
    expect(row(b.container, "f1").hasClass("chip-in")).toBe(false);
  });
});
