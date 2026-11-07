// GET /api/today（S1 きょう。ブラッシュアップ 11/7）。書く画面の「このごろ」（7 日分の書いた日）と「あの日のひとこと」（0〜1 件）と
// 記憶の総数を 1 往復で返す。自分の記憶だけ（X-11）。日付はすべて Asia/Tokyo（requirements 第8節 #14。validate.ts の todayInTokyo と同じ日）。
// 「あの日のひとこと」が無い日は null（画面は何も出さない。原則 2）。どれを返すかはその日のうち変わらない（乱数を使わず、順位だけで決める）
import { Hono } from "hono";
import { countMemories, listThatDayMonth, listThatDayNear, listWrittenAt, type ThatDayRow } from "../db/memories";
import type { Env, Variables } from "../env";

const DAY_MS = 86_400_000;
const JST_MS = 9 * 3_600_000; // Asia/Tokyo は夏時間が無く、いつも UTC+9

const toUtcMs = (ymd: string): number => Date.UTC(Number(ymd.slice(0, 4)), Number(ymd.slice(5, 7)) - 1, Number(ymd.slice(8, 10)));
const fromUtcMs = (ms: number): string => new Date(ms).toISOString().slice(0, 10);

/** その時刻の Asia/Tokyo の日付（YYYY-MM-DD）。created_at（UTC の ISO）を「書いた日」に読み替えるのにも使う */
export const tokyoDateOf = (at: Date | string): string => fromUtcMs(new Date(at).getTime() + JST_MS);
/** YYYY-MM-DD を n 日ずらす（月末・年末・うるう年をまたいでもよい） */
export const addDays = (ymd: string, n: number): string => fromUtcMs(toUtcMs(ymd) + n * DAY_MS);
/** その日（Asia/Tokyo）の 0 時を UTC の ISO 文字列で。created_at（toISOString の形）と文字列のまま比べる */
export const tokyoMidnightIso = (ymd: string): string => new Date(toUtcMs(ymd) - JST_MS).toISOString();

export type WeekDay = { date: string; wrote: boolean };

/** このごろ: きょうを右端にした 7 日分（古い順）。書いた日 = created_at の Asia/Tokyo の日付 */
export const weekOf = (today: string, writtenAt: string[]): WeekDay[] => {
  const wrote = new Set(writtenAt.map((at) => tokyoDateOf(at)));
  return Array.from({ length: 7 }, (_, i) => {
    const date = addDays(today, i - 6);
    return { date, wrote: wrote.has(date) };
  });
};

export const NEAR_DAYS = 3;
type NearDay = { md: string; offset: number; year: number };

/**
 * あの日のひとこと（日）の月日: きょうの前後 3 日の MM-DD と、その日がきょうから何日ずれているか（offset）と、その日の年。
 * 年末年始は年をまたぐ（12/30 なら 12/27〜1/2）。うるう年でない年に 2/28 と 3/1 が両方入るときは、2/29 の記憶も拾う
 */
export const nearDaysOf = (today: string): NearDay[] => {
  const out: NearDay[] = [];
  for (let offset = -NEAR_DAYS; offset <= NEAR_DAYS; offset += 1) {
    const d = addDays(today, offset);
    out.push({ md: d.slice(5), offset, year: Number(d.slice(0, 4)) });
  }
  const feb28 = out.find((n) => n.md === "02-28");
  const mar1 = out.find((n) => n.md === "03-01");
  if (feb28 && mar1 && !out.some((n) => n.md === "02-29")) out.push({ md: "02-29", offset: (feb28.offset + mar1.offset) / 2, year: feb28.year });
  return out;
};

/** あの日のひとこと（日）の起きた日の上限: 1 年まえのきょうの 3 日あと。これより後の記憶は「去年以前の同じ日付のあたり」に入らない */
export const nearLatestOf = (today: string): string => {
  const y = Number(today.slice(0, 4));
  const oneYearBefore = fromUtcMs(Date.UTC(y - 1, Number(today.slice(5, 7)) - 1, Number(today.slice(8, 10))));
  return addDays(oneYearBefore, NEAR_DAYS);
};

export type ThatDay = {
  memory: ThatDayRow;
  years: number; // 何年まえか（1 以上）
  match: "day" | "near" | "month"; // day: 同じ月日 / near: 前後 3 日 / month: 同じ月
};

const summaryOf = (r: ThatDayRow): ThatDayRow => ({
  id: r.id,
  body: r.body,
  happened_on: r.happened_on,
  happened_on_precision: r.happened_on_precision,
  photo_key: r.photo_key,
});

/**
 * 候補から 1 つ選ぶ。日の候補があれば、きょうとのずれが小さい順 → 新しい年の順 → id の順で先頭。
 * 無ければ月の候補から、新しい年の順 → （day 精度なら）日のずれが小さい順、month 精度はその後 → id の順で先頭。
 * 乱数を使わないので、その日のうちは（その記憶を消さない限り）変わらない
 */
export const pickThatDay = (today: string, nearRows: ThatDayRow[], monthRows: ThatDayRow[]): ThatDay | null => {
  const nearDays = nearDaysOf(today);
  const near = nearRows
    .flatMap((r) => {
      const n = nearDays.find((x) => x.md === r.happened_on?.slice(5, 10));
      return n && r.happened_on ? [{ r, n }] : [];
    })
    .sort(
      (a, b) =>
        Math.abs(a.n.offset) - Math.abs(b.n.offset) ||
        (b.r.happened_on ?? "").localeCompare(a.r.happened_on ?? "") ||
        a.r.id.localeCompare(b.r.id),
    )[0];
  if (near) {
    return {
      memory: summaryOf(near.r),
      years: near.n.year - Number(near.r.happened_on!.slice(0, 4)),
      match: near.n.offset === 0 ? "day" : "near",
    };
  }
  const todayDay = Number(today.slice(8, 10));
  const dayGap = (r: ThatDayRow) => (r.happened_on_precision === "day" ? Math.abs(Number(r.happened_on!.slice(8, 10)) - todayDay) : 99);
  const month = monthRows
    .filter((r) => r.happened_on)
    .sort(
      (a, b) =>
        b.happened_on!.slice(0, 4).localeCompare(a.happened_on!.slice(0, 4)) || dayGap(a) - dayGap(b) || a.id.localeCompare(b.id),
    )[0];
  if (!month) return null;
  return { memory: summaryOf(month), years: Number(today.slice(0, 4)) - Number(month.happened_on!.slice(0, 4)), match: "month" };
};

export const todayRoute = () => {
  const app = new Hono<{ Bindings: Env; Variables: Variables }>();
  app.get("/", async (c) => {
    const user = c.get("user");
    const db = c.env.DB;
    const today = tokyoDateOf(new Date());
    const startOfToday = tokyoMidnightIso(today);
    // 4 つの読みを 1 往復で（D1 の batch は 1 トランザクション。食い違わない）
    const [written, near, month, count] = await db.batch([
      listWrittenAt(db, user.id, tokyoMidnightIso(addDays(today, -6)), tokyoMidnightIso(addDays(today, 1))),
      listThatDayNear(db, user.id, nearDaysOf(today).map((n) => n.md), nearLatestOf(today), startOfToday),
      listThatDayMonth(db, user.id, today.slice(5, 7), today.slice(0, 4), startOfToday),
      countMemories(db, user.id),
    ]);
    const writtenAt = ((written?.results ?? []) as Array<{ created_at: string }>).map((r) => r.created_at);
    const thatDay = pickThatDay(today, (near?.results ?? []) as ThatDayRow[], (month?.results ?? []) as ThatDayRow[]);
    const total = Number(((count?.results ?? []) as Array<{ n: number }>)[0]?.n ?? 0);
    return c.json({ today, week: weekOf(today, writtenAt), that_day: thatDay, total });
  });
  return app;
};
