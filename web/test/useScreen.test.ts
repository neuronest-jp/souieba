import { describe, expect, it } from "vitest";
import { hrefFor, parseHash, type Screen } from "../src/composables/useScreen";

describe("parseHash", () => {
  it("空・未知のハッシュは S1 きょう", () => {
    expect(parseHash("")).toEqual({ name: "today" });
    expect(parseHash("#")).toEqual({ name: "today" });
    expect(parseHash("#today")).toEqual({ name: "today" });
    expect(parseHash("#nowhere")).toEqual({ name: "today" });
    expect(parseHash("#memory/")).toEqual({ name: "today" });
  });

  it("#past は S2", () => {
    expect(parseHash("#past")).toEqual({ name: "past" });
  });

  it("#memory/<id> は S3。from の既定は past", () => {
    expect(parseHash("#memory/mem_1")).toEqual({ name: "memory", id: "mem_1", from: "past" });
    expect(parseHash("#memory/mem_1?from=today")).toEqual({ name: "memory", id: "mem_1", from: "today" });
    expect(parseHash("#memory/mem_1?from=elsewhere")).toEqual({ name: "today" });
  });

  it("札から開いた S3 は ?recall=<recall_id> を持つ。from と並べても順番は問わない（wireframes 4.2）", () => {
    const want = { name: "memory", id: "mem_1", from: "today", recall: "rc_1" };
    expect(parseHash("#memory/mem_1?from=today&recall=rc_1")).toEqual(want);
    expect(parseHash("#memory/mem_1?recall=rc_1&from=today")).toEqual(want);
    expect(parseHash("#memory/mem_1?recall=rc_1")).toEqual({ name: "memory", id: "mem_1", from: "past", recall: "rc_1" });
    // 空の recall は持たない
    expect(parseHash("#memory/mem_1?recall=")).toStrictEqual({ name: "memory", id: "mem_1", from: "past" });
    expect(parseHash("#memory/mem_1?recall=rc_1&from=elsewhere")).toEqual({ name: "today" });
  });

  it("壊れたパーセントエンコードでも例外を投げず S1 に倒す", () => {
    expect(() => parseHash("#memory/%E0%A4%A")).not.toThrow();
    expect(parseHash("#memory/%E0%A4%A")).toEqual({ name: "today" });
  });
});

describe("hrefFor", () => {
  it("parseHash と往復できる", () => {
    const screens: Screen[] = [
      { name: "today" },
      { name: "past" },
      { name: "memory", id: "mem_1", from: "past" },
      { name: "memory", id: "mem_1", from: "today" },
      { name: "memory", id: "a/b?c d#e", from: "today" }, // 区切り文字を含む id もエンコードで守られる
      { name: "memory", id: "梅干し", from: "past" },
      { name: "memory", id: "mem_1", from: "today", recall: "rc_1" },
      { name: "memory", id: "mem_1", from: "past", recall: "rc_1" },
      { name: "memory", id: "a/b?c", from: "today", recall: "r&c=1#x" }, // recall 側の区切り文字も守られる
    ];
    for (const s of screens) expect(parseHash(hrefFor(s))).toEqual(s);
  });

  it("from=past はクエリを付けない", () => {
    expect(hrefFor({ name: "memory", id: "x", from: "past" })).toBe("#memory/x");
    expect(hrefFor({ name: "memory", id: "x", from: "today" })).toBe("#memory/x?from=today");
    expect(hrefFor({ name: "memory", id: "x", from: "today", recall: "rc_1" })).toBe("#memory/x?from=today&recall=rc_1");
    expect(hrefFor({ name: "memory", id: "x", from: "past", recall: "rc_1" })).toBe("#memory/x?recall=rc_1");
  });
});
