// つながりの一組の上下と隔たり（pair.ts）。上下は起きた日の順（上 = 後の日）で、書いた順ではない。
// 11/7 実機: 2019 年の引っ越しを今日書き、2026 年 7 月の「冷蔵庫が壊れた」を思い出した組が、上に 2019 年・下に 2026 年、
// 「7年3か月あとの、あのとき」と逆に見えた。
import { describe, expect, it } from "vitest";
import type { MemorySummary } from "../src/api/types";
import { dateOf, gapOf, sidesOf, type Pair } from "../src/connections/pair";

const mem = (id: string, happened_on: string | null, happened_on_precision: MemorySummary["happened_on_precision"]): MemorySummary => ({
  id,
  body: `${id} の本文`,
  happened_on,
  happened_on_precision,
  photo_key: null,
});
const pair = (memory: MemorySummary, related: MemorySummary): Pair => ({
  id: "r1",
  reason: "理由",
  evidence: "本文",
  feedback: "none",
  created_at: "2026-11-07T03:00:00.000Z",
  memory,
  related_memory: related,
});

describe("sidesOf / gapOf", () => {
  it("ふつう（書いた方が後の日）: 上が書いた方、下が思い出した方、「〜まえの」", () => {
    const p = pair(mem("new", "2026-11-07", "day"), mem("old", "2024-06-01", "month"));
    const { upper, lower } = sidesOf(p);
    expect([upper.memory.id, upper.recalled]).toEqual(["new", false]);
    expect([lower.memory.id, lower.recalled]).toEqual(["old", true]);
    expect(gapOf(p)).toBe("2年5か月まえの、あのとき");
  });

  it("昔のことを今日書いた（思い出した方が後の日）: 上下を入れ替え、「あと」にしない", () => {
    const p = pair(mem("moved", "2019-04-07", "day"), mem("fridge", "2026-07-19", "day"));
    const { upper, lower } = sidesOf(p);
    expect([upper.memory.id, upper.recalled]).toEqual(["fridge", true]);
    expect([lower.memory.id, lower.recalled]).toEqual(["moved", false]);
    expect(gapOf(p)).toBe("7年3か月まえの、あのとき");
    expect(dateOf(upper, new Date("2026-11-07T03:00:00Z"))).toBe("7月19日（日）");
    expect(dateOf(lower, new Date("2026-11-07T03:00:00Z"))).toBe("2019年4月7日");
  });

  it("同じ日・同じころは書いた方を上に置く", () => {
    const sameDay = pair(mem("a", "2026-11-07", "day"), mem("b", "2026-11-07", "day"));
    expect(sidesOf(sameDay).upper.memory.id).toBe("a");
    expect(gapOf(sameDay)).toBe("おなじ日の、あのとき");
    const sameMonth = pair(mem("a", "2024-06-01", "month"), mem("b", "2024-06-20", "day"));
    expect(sidesOf(sameMonth).upper.memory.id).toBe("a");
    expect(gapOf(sameMonth)).toBe("おなじ月の、あのとき");
  });

  it("どちらかが「いつだったか」なら書いた方を上に置き、隔たりは出さない", () => {
    const p = pair(mem("a", null, "unknown"), mem("b", "2026-07-19", "day"));
    expect(sidesOf(p).upper.memory.id).toBe("a");
    expect(gapOf(p)).toBeNull();
    const q = pair(mem("a", "2019-04-07", "day"), mem("b", null, "unknown"));
    expect(sidesOf(q).upper.memory.id).toBe("a");
    expect(gapOf(q)).toBeNull();
  });

  it("精度が粗い方で比べる（年だけの記憶が後の年なら入れ替える）", () => {
    const p = pair(mem("a", "2019-04-07", "day"), mem("b", "2022-07-01", "year"));
    expect(sidesOf(p).upper.memory.id).toBe("b");
    expect(gapOf(p)).toBe("3年まえの、あのとき");
  });
});
