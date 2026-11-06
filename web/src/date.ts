// 日付の表示。
import type { Precision } from "./api/types";

const WEEKDAYS = ["日", "月", "火", "水", "木", "金", "土"] as const;

const parseYmd = (s: string): { y: number; m: number; d: number } | null => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return null;
  return { y: Number(m[1]), m: Number(m[2]), d: Number(m[3]) };
};

// 今日の日付（端末のローカル）を 'YYYY-MM-DD' で。画面の「今日」には使わない（下の todayInTokyo を使う）。
export const toIsoDate = (d: Date): string => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
};

// Asia/Tokyo の今日を 'YYYY-MM-DD' で（requirements 第8節 #14「Worker・画面とも Asia/Tokyo」）。
// worker/src/validate.ts の todayInTokyo と同じ値を返す。端末の時刻設定が UTC などでも、JST 0〜9 時に前日にならない。
// 画面は端末ごとに ICU の版が違い、ロケールの書式（en-CA の YYYY-MM-DD）が変わりうるので、format ではなく formatToParts で組み立てる
const TOKYO_YMD = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit" });
export const todayInTokyo = (now: Date = new Date()): string => {
  const parts = TOKYO_YMD.formatToParts(now);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
};

// その月の日数（m は 1〜12）。Date を使わず計算するので、時差にも 0〜99 年の読み替えにも左右されない。
const daysInMonth = (y: number, m: number): number => {
  if (m === 2) return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0 ? 29 : 28;
  return m === 4 || m === 6 || m === 9 || m === 11 ? 30 : 31;
};

// 年月日を 'YYYY-MM-DD' にする。日はその月の末日に丸める（10/31 のまま 11 月にすると 11/30、2024/2/29 のまま 2025 年にすると 2/28）。
// 「いつ？」で月や年だけ変えたとき、存在しない日付（2026-11-31 など）を作らないために使う。日が取れない（NaN・0）ときは 1 日
export const clampDay = (y: number, m: number, d: number): string => {
  const mo = Math.min(Math.max(Math.trunc(m) || 1, 1), 12);
  const day = Math.min(Math.max(Math.trunc(d) || 1, 1), daysInMonth(y, mo));
  return `${String(y).padStart(4, "0")}-${String(mo).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
};

// 'YYYY-MM-DD' の形で、しかも実在する日付か（Worker の「存在しない日付です」と同じ判定）
export const isRealYmd = (s: string): boolean => {
  const p = parseYmd(s);
  return p !== null && p.m >= 1 && p.m <= 12 && p.d >= 1 && p.d <= daysInMonth(p.y, p.m);
};

export const formatDateJa = (d: Date, opts: { withYear?: boolean } = {}): string => {
  const now = new Date();
  const withYear = opts.withYear ?? d.getFullYear() !== now.getFullYear();
  const y = withYear ? `${d.getFullYear()}年` : "";
  return `${y}${d.getMonth() + 1}月${d.getDate()}日（${WEEKDAYS[d.getDay()]}）`;
};

// 起きた日の表示（wireframes 3.2）: day は今年なら「11月3日（月）」、去年以前は「2025年6月15日」。
// month は「2025年6月」、year は「2025年」、unknown は「いつだったか」。
// 「今年」は Asia/Tokyo の年（S1 の既定の日付 todayInTokyo や、Worker が決める happened_on と同じ基準）。
// 端末の年で見ると、端末の時刻設定が UTC などのとき、年明けの数時間だけ今日の日付が去年以前の書き方になる
export const formatHappenedOn = (happenedOn: string | null, precision: Precision, now: Date = new Date()): string => {
  if (precision === "unknown" || !happenedOn) return "いつだったか";
  const p = parseYmd(happenedOn);
  if (!p) return "いつだったか";
  if (precision === "year") return `${p.y}年`;
  if (precision === "month") return `${p.y}年${p.m}月`;
  // 曜日は年月日だけで決まる。端末のローカルで組み立てても TZ に左右されない
  const d = new Date(p.y, p.m - 1, p.d);
  if (p.y === Number(todayInTokyo(now).slice(0, 4))) return `${p.m}月${p.d}日（${WEEKDAYS[d.getDay()]}）`;
  return `${p.y}年${p.m}月${p.d}日`;
};

// 日付候補の表示（wireframes 2.3）。値の長さで精度を判定し、「2026年6月ごろ」のように語尾を付ける。
export const formatFactDate = (value: string): string => {
  const m = /^(\d{4})(?:-(\d{2})(?:-(\d{2}))?)?$/.exec(value);
  if (!m) return value;
  if (m[3]) return `${Number(m[1])}年${Number(m[2])}月${Number(m[3])}日`;
  if (m[2]) return `${Number(m[1])}年${Number(m[2])}月ごろ`;
  return `${Number(m[1])}年ごろ`;
};

// 本文の最初の一行（S2 の行）。
export const firstLine = (body: string): string => {
  const line = body.split(/\r?\n/).find((l) => l.trim().length > 0) ?? "";
  return line.trim();
};
