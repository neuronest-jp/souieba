// 季節の押し葉と封蝋（components/motifs、ブラッシュアップ 11/7）。季節ごとに違う形を描き、どれも読み上げに出さない（aria-hidden）。
// season を渡さないときは今日の季節（Asia/Tokyo）。今の呼び出し（S1 の札、S2 の見出し、S3 / S5 の封蝋）は props なしのまま動く。
// 形の見た目（色・大きさ）はブラウザで撮って確かめる。DOM は web/test/fakeDom.ts の最小のもの
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { nextTick } from "vue";
import type { Season } from "../src/season";
import { fakeDocument, mount, resetFakeDocument, type FakeElement } from "./fakeDom";

const Leaf = (await import("../src/components/motifs/Leaf.vue")).default;
const Seal = (await import("../src/components/motifs/Seal.vue")).default;

const SEASONS: Season[] = ["spring", "summer", "autumn", "winter"];
const svgOf = (root: FakeElement) => root.findAll((el) => el.tagName === "SVG")[0]!;
// 描いた形（path の d を順に）。封蝋は浮き出しの線画だけ（蝋の外形は季節で変わらない）
const shapeOf = (svg: FakeElement) => svg.findAll((el) => el.tagName === "PATH").map((el) => el.getAttribute("d") ?? "");
const embossOf = (svg: FakeElement) =>
  svg.findAll((el) => el.hasClass("stroke-seal-emboss"))[0]!.findAll((el) => el.tagName === "PATH").map((el) => el.getAttribute("d") ?? "");

beforeEach(() => {
  resetFakeDocument();
  vi.stubGlobal("document", fakeDocument);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("押し葉（Leaf）", () => {
  it("春・夏・秋・冬でそれぞれ違う形を描き、どれも 58×34 で aria-hidden（focusable も false）", async () => {
    const shapes = new Map<Season, string>();
    for (const season of SEASONS) {
      const { container, errors } = mount(Leaf, { season });
      await nextTick();
      const svg = svgOf(container);
      expect(svg.getAttribute("data-motif")).toBe("leaf");
      expect(svg.getAttribute("data-season")).toBe(season);
      expect(svg.getAttribute("aria-hidden")).toBe("true");
      expect(svg.getAttribute("focusable")).toBe("false");
      expect([svg.getAttribute("width"), svg.getAttribute("height"), svg.getAttribute("viewBox")]).toEqual(["58", "34", "0 0 58 34"]);
      // 文字を持たない（読み上げに出るものが無い）
      expect(svg.textContent).toBe("");
      const d = shapeOf(svg);
      expect(d.length).toBeGreaterThanOrEqual(3);
      expect(d.every((x) => x.length > 0)).toBe(true);
      shapes.set(season, d.join("|"));
      expect(errors).toEqual([]);
    }
    expect(new Set(shapes.values()).size).toBe(4);
  });

  it("季節の色はトークンの class で付ける（春 = 桜、夏 = 青もみじ、秋 = 紅葉、冬 = 南天の実）", async () => {
    const tones = async (season: Season) => {
      const { container } = mount(Leaf, { season });
      await nextTick();
      return svgOf(container)
        .findAll((el) => el.tagName === "PATH")
        .flatMap((el) => (el.getAttribute("class") ?? "").split(/\s+/));
    };
    expect(await tones("spring")).toContain("fill-sakura");
    expect(await tones("summer")).toContain("fill-aomomiji");
    expect(await tones("autumn")).toContain("fill-momiji");
    expect(await tones("winter")).toContain("fill-nanten");
  });

  it("season を渡さなければ今日の季節（JST）。UTC ではまだ 11 月 30 日でも、JST で 12 月 1 日なら冬", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const cases: Array<[string, Season]> = [
      ["2026-04-10T03:00:00Z", "spring"],
      ["2026-07-10T03:00:00Z", "summer"],
      ["2026-11-07T03:00:00Z", "autumn"],
      ["2026-11-30T15:30:00Z", "winter"],
    ];
    for (const [iso, want] of cases) {
      vi.setSystemTime(new Date(iso));
      const { container } = mount(Leaf);
      await nextTick();
      expect(svgOf(container).getAttribute("data-season"), iso).toBe(want);
    }
  });
});

describe("封蝋（Seal）", () => {
  it("浮き出しの線画が季節ごとに違い、蝋の外形と輪は同じ。どれも aria-hidden で、押される動きの class（seal）を持つ", async () => {
    const emboss = new Map<Season, string>();
    let wax: string | null = null;
    for (const season of SEASONS) {
      const { container, errors } = mount(Seal, { season });
      await nextTick();
      const svg = svgOf(container);
      expect(svg.getAttribute("data-motif")).toBe("seal");
      expect(svg.getAttribute("data-season")).toBe(season);
      expect(svg.getAttribute("aria-hidden")).toBe("true");
      expect(svg.getAttribute("focusable")).toBe("false");
      expect(svg.hasClass("seal")).toBe(true);
      expect(svg.textContent).toBe("");
      const lines = embossOf(svg);
      expect(lines.length).toBeGreaterThanOrEqual(2);
      emboss.set(season, lines.join("|"));
      // 蝋の外形（最初の path）は季節で変わらない
      const outline = shapeOf(svg)[0]!;
      wax ??= outline;
      expect(outline).toBe(wax);
      expect(svg.findAll((el) => el.tagName === "CIRCLE").length).toBe(2);
      expect(errors).toEqual([]);
    }
    expect(new Set(emboss.values()).size).toBe(4);
  });

  it("season を渡さなければ今日の季節（JST）", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-02-28T15:00:00Z")); // JST 3/1 0:00
    const { container } = mount(Seal);
    await nextTick();
    expect(svgOf(container).getAttribute("data-season")).toBe("spring");
  });
});
