// 日付の表示。「11月3日（火）」のように、年は今年なら省く。
const WEEKDAYS = ["日", "月", "火", "水", "木", "金", "土"] as const;

export const formatDateJa = (d: Date, opts: { withYear?: boolean } = {}): string => {
  const now = new Date();
  const withYear = opts.withYear ?? d.getFullYear() !== now.getFullYear();
  const y = withYear ? `${d.getFullYear()}年` : "";
  return `${y}${d.getMonth() + 1}月${d.getDate()}日（${WEEKDAYS[d.getDay()]}）`;
};

export const toIsoDate = (d: Date): string => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
};
