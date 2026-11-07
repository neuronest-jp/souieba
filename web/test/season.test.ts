// 季節・時間帯・日替わりの種（web/src/season.ts、ブラッシュアップ 11/7）の境目と、時間帯の紙（applyTimeOfDay）。
// 時刻は UTC の ISO 文字列で渡すので、テストを動かす端末の TZ に依らない。そのうえで端末の時刻設定を UTC などに替えても
// 日本（Asia/Tokyo）の暦と時刻で決まることを、process.env.TZ を替えて確かめる（CI は UTC）
import { afterEach, describe, expect, it, vi } from "vitest";
import { applyTimeOfDay, daySeed, seasonOf, timeOfDayOf } from "../src/season";

const at = (iso: string) => new Date(iso);

describe("seasonOf（春 3〜5 月 / 夏 6〜8 月 / 秋 9〜11 月 / 冬 12〜2 月、JST の月）", () => {
  it("JST の月末 23:59:59 までは前の季節、翌月 1 日の 0:00 から次の季節", () => {
    // [JST の月末 23:59:59 の UTC, その季節, 翌月 1 日 0:00 の UTC, 次の季節]
    const edges: Array<[string, string, string, string]> = [
      ["2026-02-28T14:59:59Z", "winter", "2026-02-28T15:00:00Z", "spring"],
      ["2026-05-31T14:59:59Z", "spring", "2026-05-31T15:00:00Z", "summer"],
      ["2026-08-31T14:59:59Z", "summer", "2026-08-31T15:00:00Z", "autumn"],
      ["2026-11-30T14:59:59Z", "autumn", "2026-11-30T15:00:00Z", "winter"],
      ["2028-02-29T14:59:59Z", "winter", "2028-02-29T15:00:00Z", "spring"], // うるう年の 2 月
    ];
    for (const [before, s1, after, s2] of edges) {
      expect(seasonOf(at(before)), before).toBe(s1);
      expect(seasonOf(at(after)), after).toBe(s2);
    }
  });

  it("年をまたぐ冬（12 月 31 日の夜から 1 月 1 日）は冬のまま", () => {
    expect(seasonOf(at("2026-12-31T14:59:59Z"))).toBe("winter");
    expect(seasonOf(at("2026-12-31T15:00:00Z"))).toBe("winter");
  });

  it("どの月もちょうど 1 つの季節に入る（月の真ん中の正午で見る）", () => {
    const want = ["winter", "winter", "spring", "spring", "spring", "summer", "summer", "summer", "autumn", "autumn", "autumn", "winter"];
    const got = want.map((_, m) => seasonOf(at(`2026-${String(m + 1).padStart(2, "0")}-15T03:00:00Z`)));
    expect(got).toEqual(want);
  });
});

describe("timeOfDayOf（朝 5〜10 時 / 昼 11〜16 時 / 夕 17〜20 時 / 夜 21〜4 時、JST の時刻）", () => {
  it("それぞれの境目の 1 秒前と、ちょうどの時刻", () => {
    // [UTC, JST, 時間帯]
    const cases: Array<[string, string, string]> = [
      ["2026-11-06T19:59:59Z", "04:59:59", "night"],
      ["2026-11-06T20:00:00Z", "05:00", "morning"],
      ["2026-11-07T01:59:59Z", "10:59:59", "morning"],
      ["2026-11-07T02:00:00Z", "11:00", "day"],
      ["2026-11-07T07:59:59Z", "16:59:59", "day"],
      ["2026-11-07T08:00:00Z", "17:00", "evening"],
      ["2026-11-07T11:59:59Z", "20:59:59", "evening"],
      ["2026-11-07T12:00:00Z", "21:00", "night"],
      ["2026-11-07T14:59:59Z", "23:59:59", "night"],
      ["2026-11-07T15:00:00Z", "0:00（翌日）", "night"],
    ];
    for (const [iso, jst, want] of cases) expect(timeOfDayOf(at(iso)), `JST ${jst}`).toBe(want);
  });
});

describe("daySeed（その日のうちは同じ、日ごとに違う。JST の日付）", () => {
  it("JST の 0:00 から 23:59:59 までは同じ数、0:00 をまたぐと変わる", () => {
    const start = daySeed(at("2026-11-06T15:00:00Z")); // JST 11/7 0:00
    expect(daySeed(at("2026-11-07T03:00:00Z"))).toBe(start); // JST 11/7 12:00
    expect(daySeed(at("2026-11-07T14:59:59Z"))).toBe(start); // JST 11/7 23:59:59
    expect(daySeed(at("2026-11-06T14:59:59Z"))).not.toBe(start); // JST 11/6 23:59:59
    expect(daySeed(at("2026-11-07T15:00:00Z"))).not.toBe(start); // JST 11/8 0:00
  });

  it("JST の月末と年末をまたいでも、日ごとに違う数が増えていく（3 年ぶんで重なりなし）", () => {
    const seeds: number[] = [];
    for (let t = Date.parse("2025-12-31T15:00:00Z"); t < Date.parse("2028-12-31T15:00:00Z"); t += 86_400_000) {
      seeds.push(daySeed(new Date(t + 3 * 3_600_000))); // JST の各日 3:00
    }
    expect(seeds.length).toBe(365 + 365 + 366); // JST 2026-01-01〜2028-12-31（2028 はうるう年）
    expect(new Set(seeds).size).toBe(seeds.length);
    expect(seeds.every((s, i) => i === 0 || s > seeds[i - 1]!)).toBe(true);
    // 年の境目: 12/31 の夜と 1/1 の朝で違い、1/1 は新しい年の数
    expect(daySeed(at("2026-12-31T14:59:59Z"))).toBeLessThan(daySeed(at("2026-12-31T15:00:00Z")));
    expect(daySeed(at("2026-12-31T15:00:00Z"))).toBe(daySeed(at("2027-01-01T03:00:00Z")));
  });
});

describe("端末の時刻設定が日本でないとき", () => {
  const original = process.env.TZ;
  afterEach(() => {
    if (original === undefined) delete process.env.TZ;
    else process.env.TZ = original;
  });

  it("UTC・ロサンゼルス・キリティマティ（UTC+14）でも、季節・時間帯・日替わりは日本の暦と時刻のまま", () => {
    // UTC 11/30 15:30 は JST 12/1 0:30。UTC の端末では「11 月の昼」に見えるが、日本ではもう冬の夜
    const monthEnd = at("2026-11-30T15:30:00Z");
    // UTC 5/31 20:00 は JST 6/1 5:00（夏の朝）。UTC の端末ではまだ 5 月の夜
    const juneMorning = at("2026-05-31T20:00:00Z");
    const want = { s1: "winter", t1: "night", s2: "summer", t2: "morning", seed: daySeed(at("2026-12-01T03:00:00Z")) };
    for (const tz of ["UTC", "America/Los_Angeles", "Pacific/Kiritimati", "Asia/Tokyo"]) {
      process.env.TZ = tz;
      if (tz === "UTC") {
        // 端末の時刻設定が本当に替わっていること（替わらなければ、このテストは何も確かめていない）
        expect(monthEnd.getMonth()).toBe(10);
        expect(monthEnd.getHours()).toBe(15);
      }
      expect({ s1: seasonOf(monthEnd), t1: timeOfDayOf(monthEnd), s2: seasonOf(juneMorning), t2: timeOfDayOf(juneMorning), seed: daySeed(monthEnd) }, tz).toEqual(want);
    }
  });
});

describe("applyTimeOfDay（<html data-time> に時間帯を映す）", () => {
  type Listener = () => void;
  const fakeDoc = () => {
    const listeners = new Map<string, Listener[]>();
    return {
      documentElement: { dataset: {} as Record<string, string | undefined> },
      visibilityState: "visible" as "visible" | "hidden",
      addEventListener: (type: string, fn: Listener) => listeners.set(type, [...(listeners.get(type) ?? []), fn]),
      removeEventListener: (type: string, fn: Listener) => listeners.set(type, (listeners.get(type) ?? []).filter((l) => l !== fn)),
      fire: (type: string) => (listeners.get(type) ?? []).forEach((fn) => fn()),
      count: (type: string) => (listeners.get(type) ?? []).length,
    };
  };
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("呼んだときの時間帯をすぐ付け、開いたまま 17:00 をまたぐと 1 分以内に夕方へ替わる", () => {
    vi.useFakeTimers();
    vi.setSystemTime(at("2026-11-07T07:59:30Z")); // JST 16:59:30
    const doc = fakeDoc();
    vi.stubGlobal("document", doc);
    const stop = applyTimeOfDay();
    expect(doc.documentElement.dataset.time).toBe("day");
    vi.advanceTimersByTime(60_000); // JST 17:00:30
    expect(doc.documentElement.dataset.time).toBe("evening");
    stop();
  });

  it("裏にいる間（タイマーが止まる）に夜になっても、前に戻ったとき（visibilitychange）に替わる。隠れたときは見直さない", () => {
    vi.useFakeTimers();
    vi.setSystemTime(at("2026-11-07T08:30:00Z")); // JST 17:30
    const doc = fakeDoc();
    vi.stubGlobal("document", doc);
    const stop = applyTimeOfDay();
    expect(doc.documentElement.dataset.time).toBe("evening");
    vi.setSystemTime(at("2026-11-07T13:00:00Z")); // JST 22:00（タイマーは進めない）
    doc.visibilityState = "hidden";
    doc.fire("visibilitychange");
    expect(doc.documentElement.dataset.time).toBe("evening");
    doc.visibilityState = "visible";
    doc.fire("visibilitychange");
    expect(doc.documentElement.dataset.time).toBe("night");
    stop();
  });

  it("返す関数で止めると、タイマーも visibilitychange も外れる", () => {
    vi.useFakeTimers();
    vi.setSystemTime(at("2026-11-06T22:00:00Z")); // JST 7:00
    const doc = fakeDoc();
    vi.stubGlobal("document", doc);
    const stop = applyTimeOfDay();
    expect(doc.documentElement.dataset.time).toBe("morning");
    expect(doc.count("visibilitychange")).toBe(1);
    stop();
    expect(doc.count("visibilitychange")).toBe(0);
    vi.advanceTimersByTime(6 * 3_600_000); // JST 13:00
    expect(doc.documentElement.dataset.time).toBe("morning");
  });

  it("時計を渡せる（既定は今の時刻）", () => {
    const doc = fakeDoc();
    vi.stubGlobal("document", doc);
    const stop = applyTimeOfDay(() => at("2026-11-07T12:00:00Z")); // JST 21:00
    expect(doc.documentElement.dataset.time).toBe("night");
    stop();
  });

  it("document の無い所（node）では何もせず、止める関数だけ返す", () => {
    expect(typeof document).toBe("undefined");
    const stop = applyTimeOfDay();
    expect(() => stop()).not.toThrow();
  });
});
