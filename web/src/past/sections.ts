// S2 これまでの区切り（年月で探す。ADR-0015、wireframes 10 節）。一覧を起きた日の年月ごとに区切り、左上に浮かべる札の文言を決める。
//   精度 day と month: その年月（「2025年 11月」）。精度 year: 年だけ（「2025年」）。日付なし（unknown）: 最後に「日付なし」
// 並びは API の LIST_ORDER のまま（起きた日の降順、同じ日は作成の降順）。ただし年だけの記憶は YYYY-01-01 に並び、
// 同じ日の 1 月の記憶（1 月 1 日の day と、1 月の month）と作成の順で混ざるので、同じ起きた日の中でだけ年だけの記憶を後ろに回す
// （1 月の区切りが年だけの区切りで割れない。並べ替えるのは起きた日が同じ行の中だけなので、続きを足しても区切りの順は崩れない）
import type { ListStart, Memory } from "../api/types";

type Dated = Pick<Memory, "happened_on" | "happened_on_precision">;

export const UNDATED = "undated";

/** 区切りの鍵: YYYY-MM（day と month）/ YYYY（year）/ undated */
export const sectionKeyOf = (m: Dated): string => {
  if (!m.happened_on || m.happened_on_precision === "unknown") return UNDATED;
  if (m.happened_on_precision === "year") return m.happened_on.slice(0, 4);
  return m.happened_on.slice(0, 7);
};

/** 札の文言（「2025年 11月」「2025年」「日付なし」） */
export const sectionLabel = (key: string): string => {
  if (key === UNDATED) return "日付なし";
  const y = Number(key.slice(0, 4));
  if (key.length === 4) return `${y}年`;
  return `${y}年 ${Number(key.slice(5, 7))}月`;
};

/** その区切りから読み直すときの始まり（GET /api/memories の month= / year= / undated=1） */
export const startOf = (key: string): ListStart => {
  if (key === UNDATED) return { undated: true };
  if (key.length === 4) return { year: key };
  return { month: key };
};


export type Section = { key: string; label: string; items: Memory[] };

export const toSections = (items: readonly Memory[]): Section[] => {
  // 起きた日が同じ行の中で、年だけの行を後ろへ（それ以外の順は変えない）
  const ordered: Memory[] = [];
  let run: Memory[] = [];
  const flush = () => {
    const isYear = (m: Memory) => sectionKeyOf(m).length === 4;
    ordered.push(...run.filter((m) => !isYear(m)), ...run.filter(isYear));
    run = [];
  };
  for (const m of items) {
    if (run.length > 0 && (run[0]!.happened_on ?? "") !== (m.happened_on ?? "")) flush();
    run.push(m);
  }
  flush();

  const sections: Section[] = [];
  for (const m of ordered) {
    const key = sectionKeyOf(m);
    const last = sections[sections.length - 1];
    if (last && last.key === key) last.items.push(m);
    else sections.push({ key, label: sectionLabel(key), items: [m] });
  }
  return sections;
};
