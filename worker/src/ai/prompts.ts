// システムプロンプト（architecture 6.4）。固定文は system に置き、可変の本文は user に置く（キャッシュのため）。
import type { MemoryRow } from "../db/memories";

const COMMON = `あなたは、一人の人が残した日記のような短い記憶を静かに読む係です。会話はしません。
守ること:
- evidence は元の本文から一字も変えずに切り出します。要約や言い換えは引用ではありません。句読点や空白も変えません。短く、一文以内にします。
- 本文にない人物・場所・出来事を足しません。写真の内容や一般常識から補いません。
- 候補は仮のものです。人物の年齢や感情、関係性は推測しません。
- 入力の本文では & < > " を &amp; &lt; &gt; &quot; と表記しています。これは記号の表記で、evidence には元の記号（& < > "）のまま書きます。
- JSON 以外は書きません。`;

export const RECALL_SYSTEM = `${COMMON}
あなたの仕事: 新しい記憶（new_memory）を読み、過去の記憶（past_memories）の中から本当に関係があるものだけを選びます。
- 無ければ items を空配列にします。無理に結びつけません。同じ言葉が出てくるだけでは関係があるとは言えません。
- 最大 3 件。多く出すより、確かな 1 件を選びます。
- related_memory_id は past_memories の id 属性の値をそのまま使います。
- evidence はその過去の記憶の本文からの逐語引用です。新しい記憶からは引用しません。
- reason は「なぜ関係があるか」を日本語で 80 文字以内の一文にします。`;

export const FACTS_SYSTEM = `${COMMON}
あなたの仕事: 記憶（memory）の本文から、人物（person）・場所（place）・日付（date）・もの（thing）の候補を取り出します。
- 本文に出てくるものだけを取り出します。推測で増やしません。候補が無ければ items を空配列にします。
- value は本文の言葉をそのまま使います。date の value は YYYY-MM-DD / YYYY-MM / YYYY のいずれかで、date_precision をそれに合わせます。
  「きのう」「先月」のような相対表現は memory の happened_on を基準に解きます。日まで分からなければ月や年だけにします。年が本文からも happened_on からも決まらないとき（happened_on が「不明」のときなど）は、date を出しません。
- date 以外の date_precision は unknown にします。
- evidence はその候補が出てくる本文の箇所からの逐語引用です。
- 最大 10 件。`;

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export type PastMemoryForPrompt = Pick<MemoryRow, "id" | "body" | "happened_on" | "happened_on_precision"> & { facts: string[] };

const happenedAttr = (m: Pick<MemoryRow, "happened_on" | "happened_on_precision">): string => {
  if (!m.happened_on || m.happened_on_precision === "unknown") return "不明";
  if (m.happened_on_precision === "year") return m.happened_on.slice(0, 4);
  if (m.happened_on_precision === "month") return m.happened_on.slice(0, 7);
  return m.happened_on;
};

export const recallUserMessage = (memory: Pick<MemoryRow, "body" | "happened_on" | "happened_on_precision">, past: PastMemoryForPrompt[]): string => {
  const lines = past.map((p) => {
    const facts = p.facts.length ? ` facts="${esc(p.facts.join(" / "))}"` : "";
    return `  <memory id="${esc(p.id)}" happened_on="${esc(happenedAttr(p))}"${facts}>${esc(p.body)}</memory>`;
  });
  return `<new_memory happened_on="${esc(happenedAttr(memory))}">${esc(memory.body)}</new_memory>\n<past_memories>\n${lines.join("\n")}\n</past_memories>`;
};

export const factsUserMessage = (memory: Pick<MemoryRow, "body" | "happened_on" | "happened_on_precision">): string =>
  `<memory happened_on="${esc(happenedAttr(memory))}" precision="${memory.happened_on_precision}">${esc(memory.body)}</memory>`;
