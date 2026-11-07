// つながりの一組（S5。一組 = 一本の糸 = 一枚）の画面側の形と、その言い方。
// API は not_related を返さないが、画面の中では「関係ないかも」にした後もシートを閉じるまで組を残すので、feedback を広げて持つ。
import type { Connection, MemorySummary, Recall } from "../api/types";
import { formatHappenedOn, gapPhrase } from "../date";

export type Pair = Omit<Connection, "feedback"> & { feedback: Recall["feedback"] };

// 糸の見た目の状態（style.css の data-stitch）。
//   basting = しつけ糸（まだ確かめていない。ember の破線と中空の結び目）
//   sewn    = 本縫い（「そうだった」。実線と塗った結び目）
//   loose   = ほどけた糸（「関係ないかも」。line-strong の破線。シートを閉じると一覧と帯から外れる）
// 確定の見た目（実線・塗り）にするのは、利用者が「そうだった」と確かめたものだけ（推測を事実として見せない。原則 1）
export type StitchState = "basting" | "sewn" | "loose";

export const stitchOf = (feedback: Recall["feedback"]): StitchState =>
  feedback === "helpful" ? "sewn" : feedback === "not_related" ? "loose" : "basting";

// 一組の上下の紙片。上下は起きた日の順（上 = 後の日、下 = 前の日）で、書いた順ではない。
// ふつうは書いたひとこと（memory）が後の日だが、昔のことを今日書くと、思い出した方（related_memory）が後の日になる
// （11/7 実機: 2019 年の引っ越しを今日書き、2026 年 7 月の「冷蔵庫が壊れた」を思い出した組が、上に 2019 年、下に 2026 年、
//  「7年3か月あとの」と逆に見えた）。どちらかが「いつだったか」か、同じ日・同じころなら、書いた方を上に置く。
// recalled は思い出された側（札の related_memory）。思い出した一文（evidence）はこちらの本文からの引用なので、
// 印（mark）と、S3 を札の形（?recall=）で開くリンクは、上下ではなくこちらに付ける
export type Side = { memory: MemorySummary; recalled: boolean };

export const sidesOf = (p: Pair): { upper: Side; lower: Side } => {
  const written: Side = { memory: p.memory, recalled: false };
  const recalled: Side = { memory: p.related_memory, recalled: true };
  // gapPhrase は 2 つめの方が後の日なら「〜あとの」を返す（同じ日・同じころ・不明は「あと」にならない）
  const later = gapPhrase(p.memory, p.related_memory)?.includes("あとの") ?? false;
  return later ? { upper: recalled, lower: written } : { upper: written, lower: recalled };
};

// 紙片の日付（「11月7日（土）」「2024年6月」「いつだったか」）。画面では「〜のひとこと」と続ける
export const dateOf = (side: Side, now?: Date): string =>
  formatHappenedOn(side.memory.happened_on, side.memory.happened_on_precision, now);

// 隔たり（「2年5か月まえの、あのとき」）。上（後の日）から下（前の日）を見るので、いつも「まえ」か「おなじ」。
// どちらかが「いつだったか」なら null（行ごと出さない）
export const gapOf = (p: Pair): string | null => {
  const { upper, lower } = sidesOf(p);
  return gapPhrase(upper.memory, lower.memory);
};
