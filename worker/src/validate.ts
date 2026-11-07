// 記憶の入力検証（純粋関数）。requirements F2、architecture 5.4。
import { ApiError } from "./errors";

export type Precision = "day" | "month" | "year" | "unknown";
export const PRECISIONS: readonly Precision[] = ["day", "month", "year", "unknown"] as const;

export type MemoryInput = {
  body: string;
  happened_on: string | null; // 'YYYY-MM-DD'。unknown のとき null
  happened_on_precision: Precision;
};

export const BODY_MAX = 2000;

// JST の今日を 'YYYY-MM-DD' で返す（Worker は UTC で動くため明示する）。
export const todayInTokyo = (now: Date = new Date()): string =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);

const isRealDate = (y: number, m: number, d: number): boolean => {
  if (m < 1 || m > 12 || d < 1 || d > 31) return false;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
};

const bad = (message: string): never => {
  throw new ApiError(400, "validation", message);
};

// 精度に応じて happened_on を正規化する。
//   day:   'YYYY-MM-DD'
//   month: 'YYYY-MM' または 'YYYY-MM-DD' → 'YYYY-MM-01'
//   year:  'YYYY' または 'YYYY-MM(-DD)' → 'YYYY-01-01'
//   unknown: null
export const normalizeHappenedOn = (value: unknown, precision: Precision, today: string): string | null => {
  if (precision === "unknown") return null;
  // 省略（undefined / null）は今日。空文字は「消した」状態なので誤って今日にせず 400 にする。
  const raw = value === undefined || value === null ? today : value;
  if (typeof raw !== "string" || raw === "") return bad("起きた日を入れてください");
  const m = /^(\d{4})(?:-(\d{2})(?:-(\d{2}))?)?$/.exec(raw);
  if (!m) return bad("起きた日の形式が違います");
  const y = Number(m[1]);
  const mo = m[2] ? Number(m[2]) : 1;
  const d = m[3] ? Number(m[3]) : 1;
  if (y < 1900 || y > 2100) return bad("起きた日の年が範囲外です");
  if (precision === "day") {
    if (!m[2] || !m[3]) return bad("起きた日は年月日で指定してください");
    if (!isRealDate(y, mo, d)) return bad("存在しない日付です");
    return raw;
  }
  if (precision === "month") {
    if (!m[2]) return bad("起きた日は年月で指定してください");
    if (mo < 1 || mo > 12) return bad("存在しない月です");
    if (m[3] && !isRealDate(y, mo, d)) return bad("存在しない日付です");
    return `${m[1]}-${m[2]}-01`;
  }
  // year
  if (m[2] && (mo < 1 || mo > 12)) return bad("存在しない月です");
  if (m[3] && !isRealDate(y, mo, d)) return bad("存在しない日付です");
  return `${m[1]}-01-01`;
};

export const countChars = (s: string): number => Array.from(s).length;

export const parseMemoryInput = (input: unknown, today: string = todayInTokyo()): MemoryInput => {
  if (typeof input !== "object" || input === null || Array.isArray(input)) return bad("本文がありません");
  const o = input as Record<string, unknown>;
  if (typeof o.body !== "string") return bad("本文がありません");
  const body = o.body.trim();
  const n = countChars(body);
  if (n === 0) return bad("本文を入れてください");
  if (n > BODY_MAX) return bad(`本文は ${BODY_MAX} 文字までです`);

  const p = o.happened_on_precision === undefined || o.happened_on_precision === null ? "day" : o.happened_on_precision;
  if (typeof p !== "string" || !(PRECISIONS as readonly string[]).includes(p)) return bad("起きた日の精度が不正です");
  const precision = p as Precision;
  const happened_on = normalizeHappenedOn(o.happened_on, precision, today);
  return { body, happened_on, happened_on_precision: precision };
};

// 一覧の始まり（GET /api/memories の month / year / undated。S2 の「年月で探す」、ADR-0015）。
// 返すのは COALESCE(happened_on,'') の上限（この値より小さい行から始める。LIST_ORDER は降順なので、その区切りのいちばん新しい行が先頭になる）。
//   month=YYYY-MM: その月の行から（上限は翌月の 1 日）
//   year=YYYY:     年だけの行から。年だけの行は YYYY-01-01 に並ぶので、上限は 1 月 2 日（その日の 1 月の行も前に入る）
//   undated=1:     日付なしの行から（'' より大きく、どの日付（1900 年以降）より小さい "0" を上限にする）
// どれも無ければ null（いちばん新しい行から）。空の値は無いものとみなす。2 つ以上、または形の誤りは 400
export const UNDATED_BOUND = "0";

const yearOf = (raw: string): number => {
  const y = Number(raw);
  if (y < 1900 || y > 2100) bad("年が範囲外です");
  return y;
};

export const parseListStart = (q: { month?: string | undefined; year?: string | undefined; undated?: string | undefined }): string | null => {
  const month = q.month || undefined;
  const year = q.year || undefined;
  const undated = q.undated || undefined;
  const given = [month, year, undated].filter((v) => v !== undefined).length;
  if (given === 0) return null;
  if (given > 1) bad("month・year・undated はどれか 1 つにしてください");
  if (month !== undefined) {
    const m = /^(\d{4})-(\d{2})$/.exec(month);
    if (!m) return bad("month は YYYY-MM で指定してください");
    const y = yearOf(m[1]!);
    const mo = Number(m[2]);
    if (mo < 1 || mo > 12) bad("存在しない月です");
    return mo === 12 ? `${y + 1}-01-01` : `${m[1]}-${String(mo + 1).padStart(2, "0")}-01`;
  }
  if (year !== undefined) {
    if (!/^\d{4}$/.test(year)) return bad("year は YYYY で指定してください");
    yearOf(year);
    return `${year}-01-02`;
  }
  if (undated !== "1") bad("undated は 1 だけです");
  return UNDATED_BOUND;
};
