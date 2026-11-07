// S1 の問いかけ（ブラッシュアップ 11/7、ADR-0011）。日付の見出しの下の短いあいさつと、入力欄の placeholder の問い。
// 時間帯（timeOfDayOf）と季節（seasonOf）で束を作り、日替わりの数（daySeed）で 1 つ選ぶ。乱数は使わないので、
// 同じ日の同じ時間帯なら何度開いても同じ言葉になる（朝と夜では替わる）。どれも Asia/Tokyo。
// 言葉は押し付けない: 「書いてください」とは言わず、思い出すきっかけだけを置く。続けた日数や途切れには触れない。
// 入力欄の名前（sr-only の label「きょうのひとこと」）は替えない。問いは placeholder だけに置く（読み上げで欄の名前が日替わりにならない）
import type { ThatDay } from "../../api/types";
import { daySeed, seasonOf, timeOfDayOf, type Season, type TimeOfDay } from "../../season";

/** 日付の見出しの下のあいさつ（時間帯ごと） */
export const GREETINGS: Record<TimeOfDay, readonly string[]> = {
  morning: ["おはようございます。", "けさは、どんな朝でしたか。", "ゆっくり、はじめましょう。"],
  day: ["こんにちは。", "ひと息つくあいだに、どうぞ。", "おひるの、すきまに。"],
  evening: ["おかえりなさい。", "きょうも、おつかれさまでした。", "夕方の、ひとやすみに。"],
  night: ["こんばんは。", "きょうのおわりに、すこしだけ。", "おやすみの前に、ひとこと。"],
};

/** 季節のあいさつ（時間帯のものと同じ束に混ぜる） */
export const SEASON_GREETINGS: Record<Season, readonly string[]> = {
  spring: ["日がのびてきましたね。", "あたたかくなってきました。"],
  summer: ["暑い日がつづきますね。", "夕立のにおいの季節です。"],
  autumn: ["日がみじかくなってきました。", "空が高い季節ですね。"],
  winter: ["息が白い季節ですね。", "あたたかくして、どうぞ。"],
};

/** 入力欄の問い（時間帯ごと） */
export const QUESTIONS: Record<TimeOfDay, readonly string[]> = {
  morning: ["けさ、目に入ったものは？", "朝ごはんは、なんでしたか？", "起きてすぐ、思ったこと", "けさの空は、どんな色でしたか？"],
  day: ["きょう、だれかと話したこと", "おひるに食べたもの", "きょう、ちょっとうれしかったこと", "いま、窓の外に見えるもの"],
  evening: ["帰り道に見たもの", "きょう、いちばん笑ったこと", "夕方の空のこと", "きょう、手にとったもの"],
  night: ["きょう、心に残ったこと", "ねる前に、思い出すこと", "きょう会った人のこと", "きょうの、小さなできごと"],
};

/** 季節の問い */
export const SEASON_QUESTIONS: Record<Season, readonly string[]> = {
  spring: ["見かけた花のこと", "春になって、はじめてしたこと"],
  summer: ["すずしかった場所のこと", "夏の音で、聞こえたもの"],
  autumn: ["色づいてきたもの", "秋の味で、食べたもの"],
  winter: ["あたたかかったもの", "冬の空気で、思い出したこと"],
};

/** いつでも使う問い */
export const ANY_QUESTIONS: readonly string[] = ["ふと思い出した、むかしのこと", "きょうのにおいのこと", "なんでもない、きょうのこと"];

const TIMES: readonly TimeOfDay[] = ["morning", "day", "evening", "night"];

const pick = (list: readonly string[], n: number): string => list[((n % list.length) + list.length) % list.length]!;

export type Prompt = { greeting: string; question: string };

/**
 * その時刻の問いかけ。あいさつは「時間帯の 3 つ + 季節の 2 つ」、問いは「時間帯の 4 つ + 季節の 2 つ + いつでもの 3 つ」から、
 * 日替わりの数で 1 つずつ選ぶ。時間帯ごとに選ぶ位置をずらし、同じ日の朝と夜で同じ番目にならないようにする
 */
export const promptFor = (now: Date = new Date()): Prompt => {
  const time = timeOfDayOf(now);
  const season = seasonOf(now);
  const seed = daySeed(now);
  const band = TIMES.indexOf(time);
  const greetings = [...GREETINGS[time], ...SEASON_GREETINGS[season]];
  const questions = [...QUESTIONS[time], ...SEASON_QUESTIONS[season], ...ANY_QUESTIONS];
  return { greeting: pick(greetings, seed + band * 2), question: pick(questions, seed * 7 + band * 3) };
};

/** あの日のひとことの見出し（「1年まえの、きょうのころ」）。day = 同じ月日、near = 前後 3 日、month = 同じ月 */
export const thatDayLabel = (t: Pick<ThatDay, "years" | "match">): string => {
  const head = `${t.years}年まえの、`;
  if (t.match === "day") return `${head}きょう`;
  if (t.match === "near") return `${head}きょうのころ`;
  return `${head}いまごろ`;
};

/** すべての言葉（文書と検査のため） */
export const ALL_WORDS: readonly string[] = [
  ...Object.values(GREETINGS).flat(),
  ...Object.values(SEASON_GREETINGS).flat(),
  ...Object.values(QUESTIONS).flat(),
  ...Object.values(SEASON_QUESTIONS).flat(),
  ...ANY_QUESTIONS,
];
