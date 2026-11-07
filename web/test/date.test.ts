import { describe, expect, it } from "vitest";
import type { Precision } from "../src/api/types";
import { clampDay, firstLine, formatDateJa, formatFactDate, formatHappenedOn, gapPhrase, isRealYmd, toIsoDate, todayInTokyo } from "../src/date";

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

  it("「今年」は Asia/Tokyo の年。端末の時刻設定が UTC などでも、既定の日付（todayInTokyo）と食い違わない", () => {
    // UTC の時刻で渡すので、テストを動かす端末の TZ に依らない。端末が JST だと直す前でも通るので、TZ=UTC と
    // TZ=Pacific/Kiritimati でも回して確かめる（CI は UTC）
    const newYearInTokyo = new Date("2026-12-31T20:00:00Z"); // JST 2027-01-01 05:00。UTC ではまだ 2026 年
    expect(formatHappenedOn(todayInTokyo(newYearInTokyo), "day", newYearInTokyo)).toBe("1月1日（金）");
    const newYearEveInTokyo = new Date("2026-12-31T12:00:00Z"); // JST 2026-12-31 21:00。UTC+14 ではもう 2027 年
    expect(formatHappenedOn(todayInTokyo(newYearEveInTokyo), "day", newYearEveInTokyo)).toBe("12月31日（木）");
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

describe("つながりの組の日付（formatHappenedOn をそのまま使う）", () => {
  const NOV7 = new Date("2026-11-07T03:00:00Z"); // JST 2026-11-07（土）12:00
  it("今年の day は曜日付き、month は年月、year は年、unknown は「いつだったか」", () => {
    expect(formatHappenedOn("2026-11-07", "day", NOV7)).toBe("11月7日（土）");
    expect(formatHappenedOn("2026-04-06", "day", NOV7)).toBe("4月6日（月）");
    expect(formatHappenedOn("2024-06-01", "month", NOV7)).toBe("2024年6月");
    expect(formatHappenedOn("2025-05-11", "day", NOV7)).toBe("2025年5月11日");
    expect(formatHappenedOn("2024-01-01", "year", NOV7)).toBe("2024年");
    expect(formatHappenedOn(null, "unknown", NOV7)).toBe("いつだったか");
  });
});

describe("gapPhrase（つながりのへだたり。gen.py の gap_phrase と同じ規則）", () => {
  const at = (happened_on: string | null, happened_on_precision: Precision) => ({ happened_on, happened_on_precision });
  const NOV7 = at("2026-11-07", "day");

  it("見本の 3 本: 2024年6月（month）→ 11/7、2024/4/14 → 11/7、2025/5/11 → 2026/4/6", () => {
    expect(gapPhrase(NOV7, at("2024-06-01", "month"))).toBe("2年5か月まえの、あのとき");
    expect(gapPhrase(NOV7, at("2024-04-14", "day"))).toBe("2年6か月まえの、あのとき");
    expect(gapPhrase(at("2026-04-06", "day"), at("2025-05-11", "day"))).toBe("10か月まえの、あのとき");
  });

  it("同じ日は「おなじ日の」、1 か月に満たなければ日数（11/7 と 10/20 は 18 日）", () => {
    expect(gapPhrase(NOV7, NOV7)).toBe("おなじ日の、あのとき");
    expect(gapPhrase(NOV7, at("2026-10-20", "day"))).toBe("18日まえの、あのとき");
    expect(gapPhrase(NOV7, at("2026-11-06", "day"))).toBe("1日まえの、あのとき");
  });

  it("day どうしは日が届いていない月を数えない。ちょうど 1 年なら「1年まえの」", () => {
    expect(gapPhrase(NOV7, at("2025-11-07", "day"))).toBe("1年まえの、あのとき");
    expect(gapPhrase(NOV7, at("2025-11-08", "day"))).toBe("11か月まえの、あのとき");
    expect(gapPhrase(NOV7, at("2026-10-07", "day"))).toBe("1か月まえの、あのとき");
    expect(gapPhrase(NOV7, at("2026-10-08", "day"))).toBe("30日まえの、あのとき");
  });

  it("月をまたいで日数を数えるときは、その月の長さで数える（閏年の 2 月も）", () => {
    expect(gapPhrase(at("2024-03-01", "day"), at("2024-02-01", "day"))).toBe("1か月まえの、あのとき");
    expect(gapPhrase(at("2024-03-01", "day"), at("2024-02-02", "day"))).toBe("28日まえの、あのとき");
    expect(gapPhrase(at("2025-03-01", "day"), at("2025-02-02", "day"))).toBe("27日まえの、あのとき");
  });

  it("month が混じれば月の差だけ（日は見ない）。同じ月なら「おなじ月の」", () => {
    expect(gapPhrase(at("2026-10-01", "month"), at("2026-10-28", "day"))).toBe("おなじ月の、あのとき");
    expect(gapPhrase(NOV7, at("2026-10-01", "month"))).toBe("1か月まえの、あのとき");
    expect(gapPhrase(NOV7, at("2024-11-01", "month"))).toBe("2年まえの、あのとき");
  });

  it("year が混じれば年だけ（「2年まえの」「おなじ年の」）", () => {
    expect(gapPhrase(NOV7, at("2024-01-01", "year"))).toBe("2年まえの、あのとき");
    expect(gapPhrase(at("2024-01-01", "year"), at("2024-12-31", "day"))).toBe("おなじ年の、あのとき");
    expect(gapPhrase(at("2026-01-01", "year"), at("2024-06-01", "month"))).toBe("2年まえの、あのとき");
  });

  it("unknown が片方でもあれば null（隔たりの行を出さない）。日付が無い・形が違うときも null", () => {
    expect(gapPhrase(NOV7, at(null, "unknown"))).toBeNull();
    expect(gapPhrase(at(null, "unknown"), at("2024-06-01", "month"))).toBeNull();
    expect(gapPhrase(at(null, "unknown"), at(null, "unknown"))).toBeNull();
    expect(gapPhrase(NOV7, at(null, "day"))).toBeNull();
    expect(gapPhrase(NOV7, at("2024-06", "month"))).toBeNull();
  });

  it("昔の側の方が後の日なら「〜あとの」", () => {
    expect(gapPhrase(at("2024-06-01", "month"), NOV7)).toBe("2年5か月あとの、あのとき");
    expect(gapPhrase(at("2026-10-20", "day"), NOV7)).toBe("18日あとの、あのとき");
    expect(gapPhrase(at("2024-04-14", "day"), NOV7)).toBe("2年6か月あとの、あのとき");
    expect(gapPhrase(at("2024-01-01", "year"), NOV7)).toBe("2年あとの、あのとき");
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
