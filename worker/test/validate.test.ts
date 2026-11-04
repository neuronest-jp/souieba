import { describe, expect, it } from "vitest";
import { ApiError } from "../src/errors";
import { countChars, normalizeHappenedOn, parseMemoryInput, todayInTokyo } from "../src/validate";

const TODAY = "2026-11-05";
const expectValidation = (fn: () => unknown) => {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(ApiError);
    expect((e as ApiError).status).toBe(400);
    expect((e as ApiError).code).toBe("validation");
    return;
  }
  throw new Error("validation エラーになるはず");
};

describe("todayInTokyo", () => {
  it("UTC の 23:30 は JST では翌日", () => {
    expect(todayInTokyo(new Date("2026-11-04T23:30:00Z"))).toBe("2026-11-05");
    expect(todayInTokyo(new Date("2026-11-04T14:59:59Z"))).toBe("2026-11-04");
  });
});

describe("parseMemoryInput", () => {
  it("本文だけなら JST の今日・day", () => {
    expect(parseMemoryInput({ body: " スーパーで青梅を見かけた " }, TODAY)).toEqual({
      body: "スーパーで青梅を見かけた",
      happened_on: TODAY,
      happened_on_precision: "day",
    });
  });
  it("空・空白のみ・本文なしは 400", () => {
    expectValidation(() => parseMemoryInput({ body: "" }, TODAY));
    expectValidation(() => parseMemoryInput({ body: "   \n " }, TODAY));
    expectValidation(() => parseMemoryInput({}, TODAY));
    expectValidation(() => parseMemoryInput(null, TODAY));
    expectValidation(() => parseMemoryInput("x", TODAY));
  });
  it("2000 文字は通り、2001 文字は 400。サロゲートペアは 1 文字", () => {
    expect(parseMemoryInput({ body: "あ".repeat(2000) }, TODAY).body.length).toBe(2000);
    expectValidation(() => parseMemoryInput({ body: "あ".repeat(2001) }, TODAY));
    const emoji = "😀".repeat(2000); // UTF-16 では 4000
    expect(countChars(emoji)).toBe(2000);
    expect(parseMemoryInput({ body: emoji }, TODAY).body).toBe(emoji);
  });
  it("precision unknown は happened_on を NULL にし、与えられた日付は無視する", () => {
    expect(parseMemoryInput({ body: "x", happened_on_precision: "unknown", happened_on: "2020-01-01" }, TODAY)).toMatchObject({
      happened_on: null,
      happened_on_precision: "unknown",
    });
  });
  it("precision が不正なら 400", () => {
    expectValidation(() => parseMemoryInput({ body: "x", happened_on_precision: "week" }, TODAY));
  });
});

describe("normalizeHappenedOn", () => {
  it("day", () => {
    expect(normalizeHappenedOn("2025-06-15", "day", TODAY)).toBe("2025-06-15");
    expect(normalizeHappenedOn(undefined, "day", TODAY)).toBe(TODAY);
    expectValidation(() => normalizeHappenedOn("2025-06", "day", TODAY));
    expectValidation(() => normalizeHappenedOn("2025-02-30", "day", TODAY));
    expectValidation(() => normalizeHappenedOn("2025/06/15", "day", TODAY));
    expectValidation(() => normalizeHappenedOn(20250615, "day", TODAY));
  });
  it("month は 01 日に丸める", () => {
    expect(normalizeHappenedOn("2025-06", "month", TODAY)).toBe("2025-06-01");
    expect(normalizeHappenedOn("2025-06-15", "month", TODAY)).toBe("2025-06-01");
    expect(normalizeHappenedOn(undefined, "month", TODAY)).toBe("2026-11-01");
    expectValidation(() => normalizeHappenedOn("2025", "month", TODAY));
    expectValidation(() => normalizeHappenedOn("2025-13", "month", TODAY));
  });
  it("year は 1 月 1 日に丸める", () => {
    expect(normalizeHappenedOn("2024", "year", TODAY)).toBe("2024-01-01");
    expect(normalizeHappenedOn("2024-06-15", "year", TODAY)).toBe("2024-01-01");
    expect(normalizeHappenedOn(undefined, "year", TODAY)).toBe("2026-01-01");
    expectValidation(() => normalizeHappenedOn("1800", "year", TODAY));
  });
  it("未来日は許す", () => {
    expect(normalizeHappenedOn("2099-12-31", "day", TODAY)).toBe("2099-12-31");
  });
  it("年の範囲は 1900〜2100", () => {
    expect(normalizeHappenedOn("1900", "year", TODAY)).toBe("1900-01-01");
    expect(normalizeHappenedOn("2100-12-31", "day", TODAY)).toBe("2100-12-31");
    expectValidation(() => normalizeHappenedOn("1899", "year", TODAY));
    expectValidation(() => normalizeHappenedOn("2101-01-01", "day", TODAY));
  });
  it("空文字は 400、null / undefined は今日、precision null は day", () => {
    expectValidation(() => normalizeHappenedOn("", "day", TODAY));
    expect(normalizeHappenedOn(null, "day", TODAY)).toBe(TODAY);
    expect(parseMemoryInput({ body: "x", happened_on_precision: null }, TODAY).happened_on_precision).toBe("day");
    expectValidation(() => normalizeHappenedOn("2025-06-31", "month", TODAY));
  });
});
