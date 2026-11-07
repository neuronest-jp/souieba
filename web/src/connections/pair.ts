// つながりの一組（S5。一組 = 一本の糸 = 一枚）の画面側の形と、その言い方。
// API は not_related を返さないが、画面の中では「関係ないかも」にした後もシートを閉じるまで組を残すので、feedback を広げて持つ。
import type { Connection, Recall } from "../api/types";
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

// 紙片の日付（「11月7日（土）」「2024年6月」「いつだったか」）。画面では「〜のひとこと」と続ける
export const newDateOf = (p: Pair, now?: Date): string => formatHappenedOn(p.memory.happened_on, p.memory.happened_on_precision, now);
export const oldDateOf = (p: Pair, now?: Date): string =>
  formatHappenedOn(p.related_memory.happened_on, p.related_memory.happened_on_precision, now);

// 隔たり（「2年5か月まえの、あのとき」）。どちらかが「いつだったか」なら null（行ごと出さない）
export const gapOf = (p: Pair): string | null => gapPhrase(p.memory, p.related_memory);
