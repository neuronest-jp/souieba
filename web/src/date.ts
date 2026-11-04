// 日付の表示。
import type { Precision } from "./api/types";

const WEEKDAYS = ["日", "月", "火", "水", "木", "金", "土"] as const;

const parseYmd = (s: string): { y: number; m: number; d: number } | null => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return null;
  return { y: Number(m[1]), m: Number(m[2]), d: Number(m[3]) };
};

// 今日の日付（端末のローカル）を 'YYYY-MM-DD' で。
export const toIsoDate = (d: Date): string => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
};

export const formatDateJa = (d: Date, opts: { withYear?: boolean } = {}): string => {
  const now = new Date();
  const withYear = opts.withYear ?? d.getFullYear() !== now.getFullYear();
  const y = withYear ? `${d.getFullYear()}年` : "";
  return `${y}${d.getMonth() + 1}月${d.getDate()}日（${WEEKDAYS[d.getDay()]}）`;
};

// 起きた日の表示（wireframes 3.2）: day は今年なら「11月3日（月）」、去年以前は「2025年6月15日」。
// month は「2025年6月」、year は「2025年」、unknown は「いつだったか」。
export const formatHappenedOn = (happenedOn: string | null, precision: Precision, now: Date = new Date()): string => {
  if (precision === "unknown" || !happenedOn) return "いつだったか";
  const p = parseYmd(happenedOn);
  if (!p) return "いつだったか";
  if (precision === "year") return `${p.y}年`;
  if (precision === "month") return `${p.y}年${p.m}月`;
  const d = new Date(p.y, p.m - 1, p.d);
  if (p.y === now.getFullYear()) return `${p.m}月${p.d}日（${WEEKDAYS[d.getDay()]}）`;
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
