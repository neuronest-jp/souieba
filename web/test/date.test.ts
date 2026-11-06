import { describe, expect, it } from "vitest";
import { clampDay, firstLine, formatDateJa, formatFactDate, formatHappenedOn, isRealYmd, toIsoDate, todayInTokyo } from "../src/date";

// 端末ローカルの日付として扱う（new Date(y, m, d)）。TZ に依らない
const NOW = new Date(2026, 10, 5, 12, 0, 0); // 2026-11-05（木）

describe("toIsoDate", () => {
  it("端末ローカルの年月日を YYYY-MM-DD にゼロ埋めで", () => {
    expect(toIsoDate(new Date(2026, 0, 3))).toBe("2026-01-03");
    expect(toIsoDate(new Date(2026, 10, 5, 23, 59))).toBe("2026-11-05");
  });
});

describe("todayInTokyo（requirements 第8節 #14）", () => {
  // UTC の時刻で渡すので、テストを動かす端末の TZ に依らない
  it("UTC で前日の夜でも、JST で日付が変わっていれば翌日", () => {
    expect(todayInTokyo(new Date("2026-11-05T23:30:00Z"))).toBe("2026-11-06");
    expect(todayInTokyo(new Date("2026-11-05T15:00:00Z"))).toBe("2026-11-06");
  });

  it("JST 23:59 まではその日、0:00 で翌日", () => {
    expect(todayInTokyo(new Date("2026-11-06T14:59:00Z"))).toBe("2026-11-06");
    expect(todayInTokyo(new Date("2026-11-06T15:00:00Z"))).toBe("2026-11-07");
  });

  it("年をまたぐときも YYYY-MM-DD にゼロ埋めで", () => {
    expect(todayInTokyo(new Date("2026-12-31T15:00:00Z"))).toBe("2027-01-01");
    expect(todayInTokyo(new Date("2027-01-01T00:00:00Z"))).toBe("2027-01-01");
  });
});

describe("clampDay（「いつ？」で月や年だけ変えたとき）", () => {
  it("日をその月の末日に丸める", () => {
    expect(clampDay(2026, 11, 31)).toBe("2026-11-30");
    expect(clampDay(2025, 2, 29)).toBe("2025-02-28");
    expect(clampDay(2026, 4, 31)).toBe("2026-04-30");
  });

  it("実在する日はそのまま（閏年の 2/29、12/31）", () => {
    expect(clampDay(2024, 2, 29)).toBe("2024-02-29");
    expect(clampDay(2000, 2, 29)).toBe("2000-02-29");
    expect(clampDay(2026, 12, 31)).toBe("2026-12-31");
    expect(clampDay(2026, 1, 3)).toBe("2026-01-03");
  });

  it("100 で割れて 400 で割れない年は閏年にしない", () => {
    expect(clampDay(1900, 2, 29)).toBe("1900-02-28");
  });

  it("日が取れない（Number(\"\") の 0、NaN）ときは 1 日", () => {
    expect(clampDay(2026, 11, Number(""))).toBe("2026-11-01");
    expect(clampDay(2026, 11, Number.NaN)).toBe("2026-11-01");
  });
});

describe("isRealYmd", () => {
  it("形が YYYY-MM-DD で、しかも実在する日付だけ true", () => {
    expect(isRealYmd("2026-11-30")).toBe(true);
    expect(isRealYmd("2024-02-29")).toBe(true);
    expect(isRealYmd("2026-11-31")).toBe(false);
    expect(isRealYmd("2025-02-29")).toBe(false);
    expect(isRealYmd("2026-13-01")).toBe(false);
    expect(isRealYmd("2026-00-10")).toBe(false);
    expect(isRealYmd("2026-11-00")).toBe(false);
  });

  it("形が違えば false", () => {
    expect(isRealYmd("2026-11")).toBe(false);
    expect(isRealYmd("")).toBe(false);
    expect(isRealYmd("2026/11/30")).toBe(false);
  });
});

describe("formatHappenedOn（wireframes 3.2）", () => {
  it("day: 今年は曜日付き、去年以前は年付きで曜日なし", () => {
    expect(formatHappenedOn("2026-11-03", "day", NOW)).toBe("11月3日（火）");
    expect(formatHappenedOn("2025-06-15", "day", NOW)).toBe("2025年6月15日");
  });

  it("month / year は精度で丸めて出す", () => {
    expect(formatHappenedOn("2024-06-01", "month", NOW)).toBe("2024年6月");
    expect(formatHappenedOn("2024-01-01", "year", NOW)).toBe("2024年");
  });

  it("unknown、null、形の違う値は「いつだったか」", () => {
    expect(formatHappenedOn("2024-06-01", "unknown", NOW)).toBe("いつだったか");
    expect(formatHappenedOn(null, "day", NOW)).toBe("いつだったか");
    expect(formatHappenedOn("2024-06", "day", NOW)).toBe("いつだったか");
  });
});

describe("formatDateJa", () => {
  it("withYear を明示すれば年の有無が決まる", () => {
    expect(formatDateJa(new Date(2026, 10, 5), { withYear: false })).toBe("11月5日（木）");
    expect(formatDateJa(new Date(2024, 5, 1), { withYear: true })).toBe("2024年6月1日（土）");
  });
});

describe("formatFactDate（wireframes 2.3）", () => {
  it("値の長さで精度を判定し、月・年は「ごろ」を付ける", () => {
    expect(formatFactDate("2026-06-14")).toBe("2026年6月14日");
    expect(formatFactDate("2026-06")).toBe("2026年6月ごろ");
    expect(formatFactDate("2026")).toBe("2026年ごろ");
  });

  it("日付の形でなければそのまま返す", () => {
    expect(formatFactDate("去年の夏")).toBe("去年の夏");
    expect(formatFactDate("2026/06")).toBe("2026/06");
  });
});

describe("firstLine", () => {
  it("空行を飛ばして最初の行を trim して返す", () => {
    expect(firstLine("\n  \n  スーパーで青梅を見かけた  \n二行目")).toBe("スーパーで青梅を見かけた");
    expect(firstLine("一行目\r\n二行目")).toBe("一行目");
  });

  it("中身が無ければ空文字", () => {
    expect(firstLine("")).toBe("");
    expect(firstLine("\n \n")).toBe("");
  });
});
