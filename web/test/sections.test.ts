// S2 の区切り（web/src/past/sections.ts、ADR-0015）。鍵・札の文言・読み直す始まり・並びの扱い
import { describe, expect, it } from "vitest";
import type { Memory, Precision } from "../src/api/types";
import { sectionKeyOf, sectionLabel, startOf, toSections, UNDATED } from "../src/past/sections";

const mem = (id: string, happened_on: string | null, happened_on_precision: Precision): Memory => ({
  id,
  body: id,
  happened_on,
  happened_on_precision,
  photo_key: null,
  photo_content_type: null,
  created_at: "2026-11-06T00:00:00.000Z",
  updated_at: "2026-11-06T00:00:00.000Z",
});

describe("区切りの鍵と札の文言", () => {
  it("day と month は年月、year は年、unknown と日付の無いものは日付なし", () => {
    expect(sectionKeyOf(mem("a", "2025-11-03", "day"))).toBe("2025-11");
    expect(sectionKeyOf(mem("a", "2025-06-01", "month"))).toBe("2025-06");
    expect(sectionKeyOf(mem("a", "2024-01-01", "year"))).toBe("2024");
    expect(sectionKeyOf(mem("a", null, "unknown"))).toBe(UNDATED);
    expect(sectionKeyOf(mem("a", null, "day"))).toBe(UNDATED);
  });
  it("札は「2025年 11月」「2025年 6月」「2024年」「日付なし」（月は 0 を付けない）", () => {
    expect(sectionLabel("2025-11")).toBe("2025年 11月");
    expect(sectionLabel("2025-06")).toBe("2025年 6月");
    expect(sectionLabel("2024")).toBe("2024年");
    expect(sectionLabel(UNDATED)).toBe("日付なし");
  });
  it("読み直す始まりは month / year / undated", () => {
    expect(startOf("2025-11")).toEqual({ month: "2025-11" });
    expect(startOf("2024")).toEqual({ year: "2024" });
    expect(startOf(UNDATED)).toEqual({ undated: true });
  });
});

describe("toSections", () => {
  it("並びは変えずに、続いた同じ区切りをまとめる", () => {
    const s = toSections([mem("a", "2025-11-03", "day"), mem("b", "2025-11-01", "month"), mem("c", "2025-10-31", "day"), mem("d", null, "unknown")]);
    expect(s.map((x) => [x.key, x.label, x.items.map((m) => m.id)])).toEqual([
      ["2025-11", "2025年 11月", ["a", "b"]],
      ["2025-10", "2025年 10月", ["c"]],
      [UNDATED, "日付なし", ["d"]],
    ]);
  });
  it("同じ起きた日（YYYY-01-01）の中でだけ年だけの記憶を後ろへ回し、1 月の区切りを割らない", () => {
    const s = toSections([mem("y1", "2024-01-01", "year"), mem("d1", "2024-01-01", "day"), mem("y2", "2024-01-01", "year"), mem("m1", "2024-01-01", "month"), mem("old", "2023-12-31", "day")]);
    expect(s.map((x) => [x.key, x.items.map((m) => m.id)])).toEqual([
      ["2024-01", ["d1", "m1"]],
      ["2024", ["y1", "y2"]],
      ["2023-12", ["old"]],
    ]);
  });
  it("空なら区切りも無い", () => {
    expect(toSections([])).toEqual([]);
  });
});
