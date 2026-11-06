// 候補の行（FactChips）の読み上げ。確定・却下した行は、行を読むだけで状態が分かる（wireframes 6 節「色だけに頼らない」）。
// DOM は web/test/fakeDom.ts の最小のもの
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { nextTick } from "vue";
import type { Fact } from "../src/api/types";
import { fakeDocument, mount, resetFakeDocument, type FakeElement } from "./fakeDom";

const decideFact = vi.fn(async (_id: string, _status: string) => undefined);
vi.mock("../src/api", () => ({ api: { decideFact: (id: string, status: string) => decideFact(id, status) } }));
const FactChips = (await import("../src/components/FactChips.vue")).default;

const fact = (id: string, value: string, status: Fact["status"]): Fact => ({
  id,
  kind: "place",
  value,
  status,
  source: "ai",
  evidence: `${value}で会った`,
  created_at: "2026-11-06T00:00:00.000Z",
  decided_at: null,
});

const settle = async () => {
  for (let i = 0; i < 5; i += 1) {
    await new Promise((r) => setTimeout(r, 0));
    await nextTick();
  }
};
const row = (root: FakeElement, id: string) => root.querySelector(`li[data-fact-id="${id}"]`)!;
const button = (root: FakeElement, label: string) => root.findAll((el) => el.tagName === "BUTTON" && el.textContent === label)[0]!;

beforeEach(() => {
  resetFakeDocument();
  vi.stubGlobal("document", fakeDocument);
  decideFact.mockClear();
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("却下した行の読み上げ", () => {
  it("却下した行は、打ち消し線の値に加えて読み上げ用の「ちがう」を持つ（線は値にだけ引く）", async () => {
    const { container, errors } = mount(FactChips, { facts: [fact("f1", "駅前の喫茶店", "rejected")] });
    await nextTick();
    const li = row(container, "f1");
    expect(li.textContent).toContain("ちがう");
    const struck = li.findAll((el) => el.hasClass("line-through"));
    expect(struck.map((el) => el.textContent)).toEqual(["駅前の喫茶店"]);
    expect(errors).toEqual([]);
  });

  it("S1 でキーボードから「ちがう」を押すと、フォーカスを置き直した行を読むだけで却下したことが分かる", async () => {
    const { container, errors } = mount(FactChips, { facts: [fact("f1", "駅前の喫茶店", "candidate")] });
    await nextTick();
    const no = button(container, "ちがう");
    no.focus();
    no.click(0);
    await settle();
    const li = row(container, "f1");
    expect(fakeDocument.activeElement).toBe(li);
    expect(li.textContent).toContain("ちがう");
    // 記録できたことは、これまでどおり見えない role="status" でも伝える
    expect(container.querySelector('[role="status"]')?.textContent).toBe("駅前の喫茶店、ちがう");
    expect(errors).toEqual([]);
  });

  it("候補の行と確定の行には「ちがう」の読み上げを足さない", async () => {
    const { container } = mount(FactChips, { facts: [fact("f1", "駅前", "candidate"), fact("f2", "公園", "confirmed")] });
    await nextTick();
    expect(row(container, "f1").findAll((el) => el.hasClass("sr-only"))).toEqual([]);
    expect(row(container, "f2").textContent).not.toContain("ちがう");
  });
});

// fakeDom には配置の計算が無いので、ここでは行の作りだけを固定する。375px で横にはみ出さないことはブラウザで測った
describe("空白の無い長い英数字（URL など）", () => {
  const LONG = "https://tabelog.com/tokyo/A1301/A130101/13000000/dtlrvwlst/B123456789/";
  // 種別と値のまとまり（flex-auto）と、値と根拠の列（flex-1）。どちらも flex の子で、既定の min-width: auto のままだと
  // overflow-wrap: break-word の折り返し位置が min-content に数えられず、URL の幅より細くならない
  const columns = (li: FakeElement) => {
    const group = li.children[0]!;
    return { group, value: group.children[1]! };
  };

  it("根拠に長い URL があっても、種別と値のまとまりと値の列の両方が枠の幅まで縮む（min-w-0）", async () => {
    const f = { ...fact("f1", "公園", "candidate"), evidence: `${LONG} の公園で` };
    const { container, errors } = mount(FactChips, { facts: [f] });
    await nextTick();
    const { group, value } = columns(row(container, "f1"));
    expect(value.textContent).toContain(LONG);
    // a1c0bd2 の折り返し方（まとまりを行の折り返しの単位にし、ボタンを次の段の右端に回す）はそのまま
    expect(group.hasClass("flex-auto") && group.hasClass("min-w-0")).toBe(true);
    expect(value.hasClass("flex-1") && value.hasClass("min-w-0")).toBe(true);
    expect(errors).toEqual([]);
  });

  it("根拠を出さず値を「」で囲むときも、長い値は同じ列に入る", async () => {
    const f = { ...fact("f1", LONG, "candidate"), evidence: LONG };
    const { container } = mount(FactChips, { facts: [f] });
    await nextTick();
    const { group, value } = columns(row(container, "f1"));
    expect(value.textContent).toBe(`「${LONG}」`);
    expect(group.hasClass("min-w-0") && value.hasClass("min-w-0")).toBe(true);
  });
});
