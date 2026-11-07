// 「便箋と押し葉」（ADR-0010）の形の区別。候補と確定、思い出された札と「関係ないかも」の札を、色だけでなく
// 形（封蝋・判・鉛筆・栞の有無と、区切りの線の種類）で分けていることを固定する（wireframes 6 節「色だけに頼らない」）。
// 見た目の細部（色や大きさ）はブラウザで撮って確かめる。DOM は web/test/fakeDom.ts の最小のもの
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { nextTick } from "vue";
import type { Fact, MemoryDetail, Recall, RecalledBy } from "../src/api/types";
import { fakeDocument, mount, resetFakeDocument, type FakeElement } from "./fakeDom";

const { getMemory } = vi.hoisted(() => ({ getMemory: vi.fn<(id: string) => Promise<MemoryDetail>>() }));
vi.mock("../src/api", () => ({
  ApiError: class extends Error {},
  api: { getMemory: (id: string) => getMemory(id), decideFact: vi.fn(async () => undefined) },
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

const FactChips = (await import("../src/components/FactChips.vue")).default;
const RecallCard = (await import("../src/components/RecallCard.vue")).default;
const RecalledByCard = (await import("../src/components/RecalledByCard.vue")).default;
const BottomNav = (await import("../src/components/BottomNav.vue")).default;
const MemoryDetailScreen = (await import("../src/screens/MemoryDetailScreen.vue")).default;

const motifs = (root: FakeElement, name: string) => root.findAll((el) => el.getAttribute("data-motif") === name);
const row = (root: FakeElement, id: string) => root.querySelector(`li[data-fact-id="${id}"]`)!;
const svgs = (root: FakeElement) => root.findAll((el) => el.tagName === "SVG");
// 押されているボタン（aria-pressed が true）。最小の DOM は false の属性を外し、true を空の文字で残す
const pressedButtons = (root: FakeElement) => root.findAll((el) => el.tagName === "BUTTON" && el.hasAttribute("aria-pressed"));
const settle = async () => {
  for (let i = 0; i < 5; i += 1) {
    await new Promise((r) => setTimeout(r, 0));
    await nextTick();
  }
};

const summary = { id: "mem_old", body: "青梅を水に浸けて、ひとつずつヘタを取るのを手伝った。", happened_on: "2024-06", happened_on_precision: "month" as const, photo_key: null };
const recall: Recall = {
  id: "r1",
  reason: "青梅の季節の記憶につながる。",
  evidence: "青梅を水に浸けて",
  feedback: "none",
  created_at: "2026-11-07T00:00:00.000Z",
  related_memory: summary,
};
const recalledBy = (feedback: RecalledBy["feedback"]): RecalledBy => ({
  id: "rb1",
  reason: "青梅の季節の記憶につながる。",
  evidence: "青梅を水に浸けて",
  feedback,
  created_at: "2026-11-07T00:00:00.000Z",
  memory: { id: "mem_new", body: "スーパーで青梅を見かけた", happened_on: "2026-11-07", happened_on_precision: "day", photo_key: null },
});
const fact = (id: string, status: Fact["status"]): Fact => ({
  id,
  kind: "place",
  value: "スーパー",
  status,
  source: "ai",
  evidence: "スーパーで青梅を見かけた。",
  created_at: "2026-11-07T00:00:00.000Z",
  decided_at: null,
});

beforeEach(() => {
  resetFakeDocument();
  vi.stubGlobal("document", fakeDocument);
  vi.stubGlobal("window", { addEventListener: vi.fn(), removeEventListener: vi.fn(), dispatchEvent: vi.fn() });
  getMemory.mockReset();
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("候補（鉛筆書き）と確定（判）", () => {
  it("候補の行は点線で区切り、値に点線の下線を引いて「そう」「ちがう」を出す。確定の行は実線で、ボタンの代わりに判（✓ の線画と読み上げの「✓ そう」）", async () => {
    const { container, errors } = mount(FactChips, { facts: [fact("f1", "candidate"), fact("f2", "confirmed")] });
    await nextTick();
    const cand = row(container, "f1");
    const done = row(container, "f2");
    expect(cand.hasClass("border-dashed")).toBe(true);
    expect(cand.findAll((el) => el.hasClass("decoration-dotted")).map((el) => el.textContent)).toEqual(["スーパー"]);
    expect(cand.findAll((el) => el.tagName === "BUTTON").map((el) => el.textContent)).toEqual(["そう", "ちがう"]);
    expect(done.hasClass("border-solid") && !done.hasClass("border-dashed")).toBe(true);
    expect(done.findAll((el) => el.tagName === "BUTTON")).toEqual([]);
    expect(done.findAll((el) => el.hasClass("decoration-dotted"))).toEqual([]);
    const stamp = done.findAll((el) => el.hasClass("shadow-stamp"))[0]!;
    expect(stamp.textContent).toBe("✓ そう");
    expect(svgs(stamp).every((el) => el.getAttribute("aria-hidden") === "true")).toBe(true);
    expect(errors).toEqual([]);
  });

  it("根拠は罫の上の言葉と同じ明朝で、「」ごと出す", async () => {
    const { container } = mount(FactChips, { facts: [fact("f1", "candidate")] });
    await nextTick();
    const evidence = row(container, "f1").findAll((el) => el.hasClass("font-letter"));
    expect(evidence.map((el) => el.textContent)).toEqual(["「スーパーで青梅を見かけた。」"]);
  });

  it("S1 の控え（slip）は見出しの前に鉛筆を置き、S3（page）は鉛筆の代わりに天の二重罫。どちらも見出しの文字は題だけ", async () => {
    const slip = mount(FactChips, { facts: [fact("f1", "candidate")] });
    const page = mount(FactChips, { facts: [fact("f1", "confirmed")], title: "おぼえていること", variant: "page" });
    await nextTick();
    const h1 = slip.container.querySelector("h2")!;
    const h2 = page.container.querySelector("h2")!;
    expect(h1.textContent).toBe("ひとことに出てきたもの");
    expect(svgs(h1).length).toBe(1);
    expect(h2.textContent).toBe("おぼえていること");
    expect(svgs(h2)).toEqual([]);
    expect(h2.hasClass("rule-double")).toBe(true);
  });
});

describe("一筆箋（「そういえば。」の札）", () => {
  it("S1 の札は封蝋と押し葉を付け、現れる動き（.appear）は animate のときだけ", async () => {
    const shown = mount(RecallCard, { recall, from: "today" });
    const back = mount(RecallCard, { recall, from: "today", animate: false });
    await nextTick();
    const card = shown.container.querySelector("article")!;
    expect(card.hasClass("note") && card.hasClass("appear")).toBe(true);
    expect(motifs(shown.container, "seal").length).toBe(1);
    expect(motifs(shown.container, "leaf").length).toBe(1);
    expect(back.container.querySelector("article")!.hasClass("appear")).toBe(false);
    expect(shown.errors).toEqual([]);
  });

  it("S3 の一覧の札（見出しなし）には押し葉を置かない（押し葉は S1 の札と S2 の見出しだけ）", async () => {
    const { container } = mount(RecallCard, { recall, from: "past", heading: false });
    await nextTick();
    expect(motifs(container, "seal").length).toBe(1);
    expect(motifs(container, "leaf")).toEqual([]);
  });

  it("「関係ないかも」と返した札は、封蝋を外して地の色の紙（note-quiet）に退く。「そうだった」の札は封蝋のまま", async () => {
    const quiet = mount(RecalledByCard, { item: recalledBy("not_related") });
    const kept = mount(RecalledByCard, { item: recalledBy("helpful") });
    await nextTick();
    expect(quiet.container.querySelector("article")!.hasClass("note-quiet")).toBe(true);
    expect(motifs(quiet.container, "seal")).toEqual([]);
    expect(pressedButtons(quiet.container).map((el) => el.textContent)).toEqual(["関係ないかも"]);
    expect(kept.container.querySelector("article")!.hasClass("note-quiet")).toBe(false);
    expect(motifs(kept.container, "seal").length).toBe(1);
    // 「そうだった」は判の形（二重の輪）で押されている
    const pressed = pressedButtons(kept.container);
    expect(pressed.map((el) => el.textContent)).toEqual(["そうだった"]);
    expect(pressed[0]!.hasClass("shadow-stamp")).toBe(true);
    expect(quiet.errors).toEqual([]);
  });
});

describe("下部ナビ", () => {
  it("帯の高さは pt-1 + 項目 58px + 下の余白（セーフエリアか 6px）だけで決まる。選択中は aria-current、太字、絵を白く抜く", async () => {
    const { container } = mount(BottomNav, { current: "past" });
    await nextTick();
    const nav = container.querySelector("nav")!;
    expect(nav.hasClass("pt-1") && nav.hasClass("pb-[max(env(safe-area-inset-bottom),6px)]")).toBe(true);
    const links = nav.findAll((el) => el.tagName === "A");
    expect(links.map((el) => el.hasClass("h-[58px]"))).toEqual([true, true, true]); // きょう / これまで / つながり（ADR-0009）
    const current = links.find((el) => el.getAttribute("aria-current") === "page")!;
    expect(current.textContent?.trim()).toBe("これまで");
    expect(current.hasClass("font-bold")).toBe(true);
    expect(current.findAll((el) => el.hasClass("fill-card")).length).toBe(1);
    const other = links.find((el) => el !== current)!;
    expect(other.findAll((el) => el.hasClass("fill-card"))).toEqual([]);
  });
});

describe("S3 の便箋の栞", () => {
  const detail = (rb: RecalledBy[]): MemoryDetail => ({
    memory: {
      id: "mem_old",
      body: summary.body,
      happened_on: "2024-06-01",
      happened_on_precision: "month",
      photo_key: null,
      photo_content_type: null,
      created_at: "2026-11-06T00:00:00.000Z",
      updated_at: "2026-11-06T00:00:00.000Z",
    },
    facts: { pending: false, items: [] },
    recalls: { pending: false, items: [] },
    recalled_by: { items: rb },
  });

  it("思い出されたことのある記憶（recalled_by がある）だけ、本文の便箋に栞を垂らし、引用の範囲に印を付ける", async () => {
    getMemory.mockResolvedValue(detail([recalledBy("none")]));
    const withRibbon = mount(MemoryDetailScreen, { id: "mem_old", from: "past" });
    await settle();
    expect(motifs(withRibbon.container, "ribbon").length).toBe(1);
    expect(withRibbon.container.querySelector("mark")?.textContent).toBe("青梅を水に浸けて");
    expect(withRibbon.errors).toEqual([]);

    getMemory.mockResolvedValue(detail([]));
    const plain = mount(MemoryDetailScreen, { id: "mem_old", from: "past" });
    await settle();
    expect(motifs(plain.container, "ribbon")).toEqual([]);
    expect(plain.container.querySelector("mark")).toBe(null);
  });
});
