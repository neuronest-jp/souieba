// 写真からの気づき候補（F7、ADR-0012）の行。evidence が photo: で始まる候補は「写真から」と添え、候補のあいだは値に「でしょうか」を付けて
// 本文の候補と同じ並びに出す（引用の「」は出さない）。「そう」「ちがう」は本文の候補と同じ PATCH。読み上げは「写真から、桜でしょうか」の順。
// DOM は web/test/fakeDom.ts
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

const KEY = "photos/hana@example.com/mem_1/abc.jpg";
const photoFact = (id: string, value: string, status: Fact["status"] = "candidate", kind: Fact["kind"] = "thing"): Fact => ({
  id,
  kind,
  value,
  status,
  source: "ai",
  evidence: `photo:${KEY}`,
  created_at: "2026-11-07T00:00:10.000Z",
  decided_at: null,
});
const textFact = (id: string, value: string): Fact => ({
  id,
  kind: "place",
  value,
  status: "candidate",
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
const srOnly = (el: FakeElement) => el.findAll((x) => x.hasClass("sr-only")).map((x) => x.textContent);
const hidden = (el: FakeElement) => el.findAll((x) => x.getAttribute("aria-hidden") === "true" && x.tagName === "SPAN").map((x) => x.textContent);
const status = (root: FakeElement) => root.findAll((el) => el.getAttribute("role") === "status" && el.tagName === "P").at(-1)?.textContent;

beforeEach(() => {
  resetFakeDocument();
  vi.stubGlobal("document", fakeDocument);
  decideFact.mockReset();
  decideFact.mockResolvedValue(undefined);
  Object.values(haptic).forEach((f) => f.mockClear());
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("写真候補の見せ方", () => {
  it("F7-1: 値に「でしょうか」を付け、「写真から」と添える。「」も根拠の引用（photo:…）も出さない", async () => {
    const { container, errors } = mount(FactChips, { facts: [photoFact("p1", "桜")] });
    await nextTick();
    const li = row(container, "p1");
    expect(li.textContent).toContain("桜でしょうか");
    expect(li.textContent).not.toContain("「");
    expect(li.textContent).not.toContain("photo:");
    expect(hidden(li)).toEqual(["写真から"]);
    // 候補は鉛筆書き（点線の下線と点線の区切り）。本文の候補と同じ
    expect(li.findAll((el) => el.hasClass("decoration-dotted")).map((el) => el.textContent)).toEqual(["桜でしょうか"]);
    expect(li.hasClass("border-dashed")).toBe(true);
    // 種別は本文の候補と同じ札（thing = もの、place = 場所）
    expect(li.textContent.startsWith("もの")).toBe(true);
    expect(errors).toEqual([]);
  });

  it("読み上げは「写真から、桜でしょうか」の順（見える「写真から」は読み上げから外す）", async () => {
    const { container } = mount(FactChips, { facts: [photoFact("p1", "桜")] });
    await nextTick();
    const li = row(container, "p1");
    expect(srOnly(li)).toEqual(["写真から、"]);
    // 文書の順（読み上げの順）は 種別 → 出どころ → 尋ねる形の値 → （見えるだけの「写真から」）→ そう / ちがう
    expect(li.textContent).toBe("もの写真から、桜でしょうか写真からそうちがう");
  });

  it("本文の候補と同じ並びに、受け取った順のまま出す。本文の候補の見せ方は変えない", async () => {
    const { container } = mount(FactChips, { facts: [textFact("t1", "公園"), photoFact("p1", "公園", "candidate", "place"), photoFact("p2", "桜")] });
    await nextTick();
    const ids = container.findAll((el) => el.tagName === "LI").map((el) => el.getAttribute("data-fact-id"));
    expect(ids).toEqual(["t1", "p1", "p2"]);
    expect(row(container, "t1").textContent).toContain("「公園」");
    expect(row(container, "t1").textContent).not.toContain("でしょうか");
    expect(row(container, "t1").textContent).not.toContain("写真から");
    expect(row(container, "p1").textContent).toContain("公園でしょうか");
    expect(row(container, "p1").textContent.startsWith("場所")).toBe(true);
  });

  it("確かめた写真候補は言い切りの値（「桜」）と判。却下した写真候補は打ち消し線と読み上げ用の「ちがう」で、行は残る", async () => {
    const { container } = mount(FactChips, { facts: [photoFact("p1", "桜", "confirmed"), photoFact("p2", "紅葉", "rejected")] });
    await nextTick();
    const yes = row(container, "p1");
    expect(yes.textContent).not.toContain("でしょうか");
    expect(yes.textContent).toContain("桜");
    expect(yes.textContent).toContain("✓ そう");
    expect(hidden(yes)).toContain("写真から");
    const no = row(container, "p2");
    expect(no.findAll((el) => el.hasClass("line-through")).map((el) => el.textContent)).toEqual(["紅葉"]);
    expect(srOnly(no)).toEqual(["写真から、", "、ちがう"]);
  });
});

describe("写真候補を決める", () => {
  it("F7-3: 「そう」で PATCH confirmed。値は言い切りに替わり、「写真から、桜でしょうか、そう」と知らせる", async () => {
    const { container, errors } = mount(FactChips, { facts: [photoFact("p1", "桜")] });
    await nextTick();
    button(container, "p1", "そう").click(1);
    await settle();
    expect(decideFact).toHaveBeenCalledWith("p1", "confirmed");
    expect(haptic.stamp).toHaveBeenCalledTimes(1);
    const li = row(container, "p1");
    expect(li.textContent).not.toContain("でしょうか");
    expect(li.textContent).toContain("✓ そう");
    expect(status(container)).toBe("写真から、桜でしょうか、そう");
    expect(errors).toEqual([]);
  });

  it("F7-2: 「ちがう」で PATCH rejected。行は打ち消し線で残り、「写真から、桜でしょうか、ちがう」と知らせる", async () => {
    const { container, errors } = mount(FactChips, { facts: [photoFact("p1", "桜")] });
    await nextTick();
    button(container, "p1", "ちがう").click(1);
    await settle();
    expect(decideFact).toHaveBeenCalledWith("p1", "rejected");
    expect(haptic.tap).toHaveBeenCalledTimes(1);
    const li = row(container, "p1");
    expect(li.findAll((el) => el.hasClass("line-through")).map((el) => el.textContent)).toEqual(["桜"]);
    expect(li.findAll((el) => el.tagName === "BUTTON")).toEqual([]);
    expect(status(container)).toBe("写真から、桜でしょうか、ちがう");
    expect(errors).toEqual([]);
  });

  it("記録に失敗したら候補の形（「桜でしょうか」と「そう」「ちがう」）に戻し、「記録できませんでした」", async () => {
    decideFact.mockRejectedValueOnce(new Error("x"));
    const { container } = mount(FactChips, { facts: [photoFact("p1", "桜")] });
    await nextTick();
    button(container, "p1", "ちがう").click(1);
    await settle();
    const li = row(container, "p1");
    expect(li.textContent).toContain("桜でしょうか");
    expect(li.textContent).toContain("記録できませんでした");
    expect(button(container, "p1", "そう")).toBeTruthy();
    expect(haptic.failed).toHaveBeenCalledTimes(1);
  });
});
