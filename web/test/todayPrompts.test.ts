// S1 の問いかけ（components/today/prompts.ts）。言葉の数、禁止語、同じ日の同じ時間帯で替わらないこと、日ごと・時間帯ごとに替わること
import { describe, expect, it } from "vitest";
import { ALL_WORDS, GREETINGS, QUESTIONS, SEASON_GREETINGS, SEASON_QUESTIONS, promptFor, thatDayLabel } from "../src/components/today/prompts";

// JST の時刻（+09:00）で書く
const at = (iso: string) => new Date(iso);

describe("問いかけの言葉", () => {
  it("30 以上あり、重ならない", () => {
    expect(ALL_WORDS.length).toBeGreaterThanOrEqual(30);
    expect(new Set(ALL_WORDS).size).toBe(ALL_WORDS.length);
  });

  it("画面に出してはいけない言葉を使わない。続けた日数や、急かす・責める言い方もしない", () => {
    for (const w of ALL_WORDS) {
      expect(w).not.toMatch(/AI|生成|送信|関連|履歴/);
      expect(w).not.toMatch(/連続|日目|毎日|忘れ|まだ書いて|さぼ|ください/);
    }
  });

  it("どれも短い（あいさつ 16 字、問い 18 字まで）", () => {
    for (const w of [...Object.values(GREETINGS).flat(), ...Object.values(SEASON_GREETINGS).flat()]) expect(Array.from(w).length).toBeLessThanOrEqual(16);
    for (const w of [...Object.values(QUESTIONS).flat(), ...Object.values(SEASON_QUESTIONS).flat()]) expect(Array.from(w).length).toBeLessThanOrEqual(18);
  });
});

describe("promptFor", () => {
  it("同じ日の同じ時間帯なら、何度でも同じ言葉", () => {
    const a = promptFor(at("2026-11-07T08:00:00+09:00"));
    const b = promptFor(at("2026-11-07T10:59:00+09:00"));
    expect(b).toEqual(a);
  });

  it("朝のあいさつと問いは朝の束、夜は夜の束から選ぶ（季節の束といつでもの問いを混ぜる）", () => {
    const morning = promptFor(at("2026-11-07T07:00:00+09:00"));
    expect([...GREETINGS.morning, ...SEASON_GREETINGS.autumn]).toContain(morning.greeting);
    const night = promptFor(at("2026-11-07T23:00:00+09:00"));
    expect([...GREETINGS.night, ...SEASON_GREETINGS.autumn]).toContain(night.greeting);
    expect(night.question).not.toBe(morning.question);
  });

  it("端末の時刻設定に左右されず Asia/Tokyo で決まる（UTC 22 時は JST の翌朝 7 時）", () => {
    expect(promptFor(at("2026-11-06T22:00:00Z"))).toEqual(promptFor(at("2026-11-07T07:00:00+09:00")));
  });

  it("1 週間の朝の問いは、毎日替わる", () => {
    const week = Array.from({ length: 7 }, (_, i) => promptFor(at(`2026-11-${String(i + 1).padStart(2, "0")}T08:00:00+09:00`)).question);
    for (let i = 1; i < week.length; i += 1) expect(week[i]).not.toBe(week[i - 1]);
  });
});

describe("thatDayLabel", () => {
  it("同じ月日・前後 3 日・同じ月で言い分ける", () => {
    expect(thatDayLabel({ years: 1, match: "day" })).toBe("1年まえの、きょう");
    expect(thatDayLabel({ years: 2, match: "near" })).toBe("2年まえの、きょうのころ");
    expect(thatDayLabel({ years: 3, match: "month" })).toBe("3年まえの、いまごろ");
  });
});
