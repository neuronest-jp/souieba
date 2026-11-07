// GET /api/today（S1 の「このごろ」「あの日のひとこと」と総数）。日付の読み替えは純粋関数で、境目と他人の記憶は Worker を通して確かめる。
// 「きょう」は vi.setSystemTime で決める（Date だけを偽にする。タイマーは本物のまま）
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../src/index";
import { DEV_USER_HEADER } from "../src/auth";
import type { Env } from "../src/env";
import {
  addDays,
  nearDaysOf,
  nearLatestOf,
  pickThatDay,
  tokyoDateOf,
  tokyoMidnightIso,
  weekOf,
  type ThatDay,
  type WeekDay,
} from "../src/routes/today";
import type { ThatDayRow } from "../src/db/memories";
import { createTestD1, fakeR2, type TestD1 } from "./sqlite-d1";

const ME = "me@example.com";
const OTHER = "other@example.com";

type Body = { today: string; week: WeekDay[]; that_day: ThatDay | null; total: number };

let db: TestD1;
let env: Env;
let seq = 0;

const addUser = (id: string) =>
  db.raw.prepare("INSERT OR IGNORE INTO users (id, display_name, created_at, last_seen_at) VALUES (?, NULL, ?, ?)").run(id, "2024-01-01T00:00:00.000Z", "2024-01-01T00:00:00.000Z");

const addMemory = (user: string, createdAt: string, happenedOn: string | null = null, precision = "unknown", id = `m${++seq}`) => {
  addUser(user);
  db.raw
    .prepare("INSERT INTO memories (id, user_id, body, happened_on, happened_on_precision, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .run(id, user, `本文 ${id}`, happenedOn, precision, createdAt, createdAt);
  return id;
};

const get = async (user = ME): Promise<Body> => {
  const res = await createApp().request("/api/today", { headers: { [DEV_USER_HEADER]: user } }, env);
  expect(res.status).toBe(200);
  return (await res.json()) as Body;
};

beforeEach(() => {
  db = createTestD1();
  env = { DB: db, PHOTOS: fakeR2(), ASSETS: {} as Fetcher, ENVIRONMENT: "development", ANTHROPIC_MODEL: "claude-opus-5-5", APP_VERSION: "test" } as Env;
  vi.useFakeTimers({ toFake: ["Date"] });
  // 2026-11-07（土）12:00 JST
  vi.setSystemTime(new Date("2026-11-07T03:00:00.000Z"));
});
afterEach(() => {
  vi.useRealTimers();
});

describe("日付の読み替え（Asia/Tokyo）", () => {
  it("UTC 14:59:59.999 はその日、15:00 からは翌日（JST の 0 時が境目）", () => {
    expect(tokyoDateOf("2026-11-06T14:59:59.999Z")).toBe("2026-11-06");
    expect(tokyoDateOf("2026-11-06T15:00:00.000Z")).toBe("2026-11-07");
    expect(tokyoMidnightIso("2026-11-07")).toBe("2026-11-06T15:00:00.000Z");
  });

  it("月末・年末・うるう年をまたいで日をずらす", () => {
    expect(addDays("2026-12-30", 3)).toBe("2027-01-02");
    expect(addDays("2028-03-01", -1)).toBe("2028-02-29");
    expect(addDays("2027-03-01", -1)).toBe("2027-02-28");
  });

  it("このごろは、きょうを右端にした古い順の 7 日", () => {
    const week = weekOf("2026-11-07", ["2026-11-06T15:00:00.000Z", "2026-11-02T03:00:00.000Z", "2026-11-02T09:00:00.000Z"]);
    expect(week.map((d) => d.date)).toEqual(["2026-11-01", "2026-11-02", "2026-11-03", "2026-11-04", "2026-11-05", "2026-11-06", "2026-11-07"]);
    expect(week.filter((d) => d.wrote).map((d) => d.date)).toEqual(["2026-11-02", "2026-11-07"]);
  });

  it("あの日の月日は前後 3 日。年末は年をまたぎ、うるう年でない年は 2/29 も拾う", () => {
    expect(nearDaysOf("2026-12-30").map((n) => `${n.year}-${n.md}`)).toEqual([
      "2026-12-27",
      "2026-12-28",
      "2026-12-29",
      "2026-12-30",
      "2026-12-31",
      "2027-01-01",
      "2027-01-02",
    ]);
    expect(nearDaysOf("2027-03-01").map((n) => n.md)).toContain("02-29");
    expect(nearDaysOf("2028-03-01").filter((n) => n.md === "02-29")).toHaveLength(1);
    expect(nearLatestOf("2026-11-07")).toBe("2025-11-10");
    expect(nearLatestOf("2026-12-30")).toBe("2026-01-02");
  });
});

describe("あの日のひとこと（選び方）", () => {
  const row = (id: string, happened_on: string, precision: ThatDayRow["happened_on_precision"] = "day"): ThatDayRow => ({
    id,
    body: id,
    happened_on,
    happened_on_precision: precision,
    photo_key: null,
  });

  it("同じ月日がいちばん先。次に、ずれが小さい順 → 新しい年の順", () => {
    const picked = pickThatDay("2026-11-07", [row("a", "2024-11-05"), row("b", "2023-11-07"), row("c", "2025-11-08")], []);
    expect(picked).toMatchObject({ memory: { id: "b" }, years: 3, match: "day" });
    const near = pickThatDay("2026-11-07", [row("a", "2024-11-05"), row("c", "2025-11-08"), row("d", "2024-11-08")], []);
    expect(near).toMatchObject({ memory: { id: "c" }, years: 1, match: "near" });
  });

  it("年をまたぐ前後 3 日は、年の数え方もまたいだ側で数える（12/30 に 1/1 の記憶は 1 年まえ）", () => {
    expect(pickThatDay("2026-12-30", [row("a", "2026-01-01")], [])).toMatchObject({ memory: { id: "a" }, years: 1, match: "near" });
  });

  it("日の候補が無ければ同じ月。新しい年 → 日のずれが小さい day 精度 → month 精度の順", () => {
    const picked = pickThatDay("2026-11-07", [], [row("m", "2025-11-01", "month"), row("far", "2025-11-28"), row("close", "2025-11-12"), row("old", "2024-11-07")]);
    expect(picked).toMatchObject({ memory: { id: "close" }, years: 1, match: "month" });
    expect(pickThatDay("2026-11-07", [], [row("m", "2024-11-01", "month")])).toMatchObject({ years: 2, match: "month" });
  });

  it("どちらも無ければ null（画面は何も出さない）", () => {
    expect(pickThatDay("2026-11-07", [], [])).toBeNull();
  });
});

describe("GET /api/today", () => {
  it("認証なしは 401", async () => {
    const res = await createApp().request("/api/today", {}, env);
    expect(res.status).toBe(401);
  });

  it("記憶が 0 件: 7 日とも書いていない、あの日のひとことは null、総数 0", async () => {
    const body = await get();
    expect(body.today).toBe("2026-11-07");
    expect(body.week).toHaveLength(7);
    expect(body.week.every((d) => !d.wrote)).toBe(true);
    expect(body.that_day).toBeNull();
    expect(body.total).toBe(0);
  });

  it("他人の記憶は、書いた日にも、あの日のひとことにも、総数にも混ざらない", async () => {
    addMemory(OTHER, "2026-11-05T01:00:00.000Z");
    addMemory(OTHER, "2025-12-01T00:00:00.000Z", "2025-11-07", "day");
    addMemory(ME, "2026-11-03T01:00:00.000Z");
    const mine = await get();
    expect(mine.week.filter((d) => d.wrote).map((d) => d.date)).toEqual(["2026-11-03"]);
    expect(mine.that_day).toBeNull();
    expect(mine.total).toBe(1);

    const theirs = await get(OTHER);
    expect(theirs.week.filter((d) => d.wrote).map((d) => d.date)).toEqual(["2026-11-05"]);
    expect(theirs.that_day).toMatchObject({ years: 1, match: "day" });
    expect(theirs.total).toBe(2);
  });

  it("JST の 0 時が境目: UTC 15:00 に書いたものは翌日の押し葉。8 日まえ以前は列に入らない", async () => {
    addMemory(ME, "2026-11-06T14:59:59.999Z"); // JST 11/6 23:59
    addMemory(ME, "2026-11-06T15:00:00.000Z"); // JST 11/7 00:00
    addMemory(ME, "2026-10-31T14:59:59.999Z"); // JST 10/31 23:59（列の外）
    addMemory(ME, "2026-10-31T15:00:00.000Z"); // JST 11/1 00:00（列の左端）
    const body = await get();
    expect(body.week.map((d) => [d.date.slice(5), d.wrote])).toEqual([
      ["11-01", true],
      ["11-02", false],
      ["11-03", false],
      ["11-04", false],
      ["11-05", false],
      ["11-06", true],
      ["11-07", true],
    ]);
    expect(body.total).toBe(4);
  });

  it("JST の 0 時を過ぎると「きょう」が翌日に移る（UTC ではまだ 11/7）", async () => {
    addMemory(ME, "2026-11-07T03:00:00.000Z"); // JST 11/7 12:00
    vi.setSystemTime(new Date("2026-11-07T15:00:00.000Z")); // JST 11/8 00:00
    const body = await get();
    expect(body.today).toBe("2026-11-08");
    expect(body.week.at(-1)).toEqual({ date: "2026-11-08", wrote: false });
    expect(body.week.at(-2)).toEqual({ date: "2026-11-07", wrote: true });
  });

  it("あの日のひとこと: 去年以前の前後 3 日の day 精度。今年の同じころと、きょう書いたものは出さない", async () => {
    addMemory(ME, "2026-11-05T00:00:00.000Z", "2026-11-05", "day"); // 今年（2 日まえ）
    addMemory(ME, "2026-11-07T01:00:00.000Z", "2025-11-07", "day", "written_today"); // きょう書いた去年のこと
    const near = addMemory(ME, "2025-11-09T00:00:00.000Z", "2025-11-09", "day"); // 1 年まえの 2 日あと
    addMemory(ME, "2024-11-11T00:00:00.000Z", "2024-11-11", "day"); // 4 日ずれ（外）
    const body = await get();
    expect(body.that_day).toMatchObject({ memory: { id: near, happened_on: "2025-11-09", happened_on_precision: "day" }, years: 1, match: "near" });
    expect(Object.keys(body.that_day!.memory).sort()).toEqual(["body", "happened_on", "happened_on_precision", "id", "photo_key"]);
  });

  it("日の候補が無ければ同じ月（day 精度と month 精度）。year 精度と今年の同じ月は出さない", async () => {
    addMemory(ME, "2026-01-01T00:00:00.000Z", "2024-01-01", "year");
    addMemory(ME, "2026-11-01T00:00:00.000Z", "2026-11-01", "month");
    const month = addMemory(ME, "2024-12-01T00:00:00.000Z", "2024-11-01", "month");
    const body = await get();
    expect(body.that_day).toMatchObject({ memory: { id: month }, years: 2, match: "month" });
  });

  it("その日のうちは何度読んでも同じものを返す", async () => {
    addMemory(ME, "2025-01-01T00:00:00.000Z", "2024-11-07", "day", "x2");
    addMemory(ME, "2025-01-01T00:00:00.000Z", "2023-11-07", "day", "x3");
    vi.setSystemTime(new Date("2026-11-06T15:00:01.000Z")); // JST 11/7 の朝
    const morning = await get();
    vi.setSystemTime(new Date("2026-11-07T14:59:00.000Z")); // JST 11/7 の夜
    const night = await get();
    expect(morning.that_day?.memory.id).toBe("x2");
    expect(night.that_day?.memory.id).toBe("x2");
  });
});
