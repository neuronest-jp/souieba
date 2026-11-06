import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { isValidDateValue, verifyFacts, verifyRecall } from "../src/ai/verify";
import { createTestD1 } from "./sqlite-d1";

const FIX = join(__dirname, "..", "..", "demo", "fixtures");
const load = (rel: string) => JSON.parse(readFileSync(join(FIX, rel), "utf8")) as unknown;

// seed.sql をテスト用 D1 に流して、本文の Map を作る
const seedBodies = () => {
  const db = createTestD1();
  db.raw.exec(readFileSync(join(FIX, "seed.sql"), "utf8"));
  // 想起の入力は同一ユーザー（demo@example.com）の記憶だけ。他ユーザーの行は Map に入らない
  const rows = db.raw.prepare("SELECT id, body FROM memories WHERE user_id = 'demo@example.com'").all() as Array<{ id: string; body: string }>;
  return new Map(rows.map((r) => [r.id, r.body]));
};
const scenarios = load("scenarios.json") as { scenarios?: Array<{ id: string; input: { body: string } }> } | Array<{ id: string; input: { body: string } }>;
const scenarioList = Array.isArray(scenarios) ? scenarios : (scenarios.scenarios ?? []);
const inputBody = (id: string) => scenarioList.find((s) => s.id.toLowerCase().includes(id))!.input.body;

describe("verifyRecall（デモのフィクスチャ）", () => {
  const bodies = seedBodies();
  it("D1 / D4 の正しい出力は通る", () => {
    const d1 = verifyRecall(load("ai/recall-d1.json"), bodies, "new-id");
    expect(d1.items).toHaveLength(1);
    expect(d1.items[0]!.related_memory_id).toBe("mem_d1_01");
    const d4 = verifyRecall(load("ai/recall-d4.json"), bodies, "new-id");
    expect(d4.items).toHaveLength(1);
  });
  it("D2 の空出力は 0 件", () => {
    expect(verifyRecall(load("ai/recall-d2-empty.json"), bodies, "new-id").items).toEqual([]);
  });
  it("invalid: 引用が本文に無い → 捨てる", () => {
    const r = verifyRecall(load("invalid/recall-evidence-not-in-body.json"), bodies, "new-id");
    expect(r.items).toEqual([]);
    expect(r.stats.dropped[0]!.reason).toBe("evidence_not_in_body");
  });
  it("invalid: 他ユーザーの id → 捨てる", () => {
    const r = verifyRecall(load("invalid/recall-related-other-user.json"), bodies, "new-id");
    expect(r.items).toEqual([]);
    expect(r.stats.dropped[0]!.reason).toBe("unknown_id");
  });
  it("invalid: 4 件以上 → 先頭 3 件（検証を通ったもの）だけ", () => {
    const r = verifyRecall(load("invalid/recall-too-many.json"), bodies, "new-id");
    expect(r.items.length).toBeLessThanOrEqual(3);
    expect(r.stats.dropped.some((d) => d.reason === "over_max" || d.reason === "evidence_not_in_body")).toBe(true);
  });
  it("自分自身、重複、reason の長さ、形式不正を落とす", () => {
    const b = new Map([["a", "本文 A です"], ["b", "本文 B です"], ["c", "本文 C です"], ["d", "本文 D です"]]);
    const out = {
      items: [
        { related_memory_id: "self", reason: "x", evidence: "本文" },
        { related_memory_id: "a", reason: "ok", evidence: "本文 A" },
        { related_memory_id: "a", reason: "dup", evidence: "本文 A" },
        { related_memory_id: "b", reason: "あ".repeat(81), evidence: "本文 B" }, // 切り詰めて残す
        { related_memory_id: "c", reason: "", evidence: "本文 C" },
        { related_memory_id: "c", evidence: "本文 C" },
        { related_memory_id: "d", reason: "空の引用", evidence: "" },
      ],
    };
    const r = verifyRecall(out, new Map([...b, ["self", "self body"]]), "self");
    expect(r.items.map((i) => i.related_memory_id)).toEqual(["a", "b"]);
    expect(r.stats.dropped.map((d) => d.reason)).toEqual(["self", "duplicate", "reason_length", "malformed", "evidence_not_in_body"]);
  });
  it("NFC 正規化や空白除去はしない（完全一致のみ）", () => {
    const b = new Map([["a", "おばあちゃんは毎年6月に"]]);
    expect(verifyRecall({ items: [{ related_memory_id: "a", reason: "r", evidence: "おばあちゃんは 毎年6月に" }] }, b, "x").items).toEqual([]);
    expect(verifyRecall({ items: [{ related_memory_id: "a", reason: "r", evidence: "おばあちゃんは毎年６月に" }] }, b, "x").items).toEqual([]);
  });
  it("エスケープされた記号を含む引用は逆変換して照合し、元の記号で保存する", () => {
    const b = new Map([["a", 'A&W で "ルートビア" を飲んだ <最高>']]);
    const r = verifyRecall({ items: [{ related_memory_id: "a", reason: "r", evidence: "A&amp;W で &quot;ルートビア&quot;" }] }, b, "x");
    expect(r.items[0]!.evidence).toBe('A&W で "ルートビア"');
    const f = verifyFacts({ items: [{ kind: "thing", value: "&quot;ルートビア&quot;", evidence: "&lt;最高&gt;", date_precision: "unknown" }] }, b.get("a")!);
    expect(f.items[0]).toEqual({ kind: "thing", value: '"ルートビア"', evidence: "<最高>" });
  });
  it("reason が 80 文字を超えたら切り詰めて残す（捨てない）", () => {
    const b = new Map([["a", "本文"]]);
    const r = verifyRecall({ items: [{ related_memory_id: "a", reason: "あ".repeat(100), evidence: "本文" }] }, b, "x");
    expect(r.items).toHaveLength(1);
    expect(Array.from(r.items[0]!.reason).length).toBe(80);
  });
  it("items が無い出力は malformed", () => {
    expect(verifyRecall({ foo: 1 }, new Map(), "x").stats.dropped[0]!.reason).toBe("malformed");
    expect(verifyRecall("text", new Map(), "x").items).toEqual([]);
  });
});

describe("verifyFacts", () => {
  it("D1 / D3 のフィクスチャは本文に対して通る", () => {
    const d1 = verifyFacts(load("ai/facts-d1.json"), inputBody("d1"));
    expect(d1.items.length).toBeGreaterThan(0);
    const d3 = verifyFacts(load("ai/facts-d3.json"), inputBody("d3"));
    expect(d3.items.length).toBeGreaterThan(0);
  });
  it("kind、空、引用、日付の形、重複、上限 10 件", () => {
    const body = "2024年6月15日、おばあちゃんと公園で梅を見た。";
    const out = {
      items: [
        { kind: "person", value: "おばあちゃん", evidence: "おばあちゃん", date_precision: "unknown" },
        { kind: "person", value: "おばあちゃん", evidence: "おばあちゃん", date_precision: "unknown" },
        { kind: "place", value: "公園", evidence: "公園", date_precision: "unknown" },
        { kind: "date", value: "2024-06-15", evidence: "2024年6月15日", date_precision: "day" },
        { kind: "date", value: "2024-06-31", evidence: "2024年6月15日", date_precision: "day" },
        { kind: "date", value: "6月15日", evidence: "2024年6月15日", date_precision: "day" },
        { kind: "thing", value: "桜", evidence: "桜", date_precision: "unknown" },
        { kind: "emotion", value: "嬉しい", evidence: "梅", date_precision: "unknown" },
        { kind: "thing", value: "", evidence: "梅", date_precision: "unknown" },
      ],
    };
    const r = verifyFacts(out, body);
    expect(r.items.map((i) => `${i.kind}:${i.value}`)).toEqual(["person:おばあちゃん", "place:公園", "date:2024-06-15"]);
    expect(r.stats.dropped.map((d) => d.reason)).toEqual(["duplicate", "bad_date", "bad_date", "evidence_not_in_body", "bad_kind", "empty"]);
    // 上限: value も本文にある 12 件を渡す
    const manyBody = Array.from({ length: 12 }, (_, i) => `梅${i}`).join(" ");
    const many = { items: Array.from({ length: 12 }, (_, i) => ({ kind: "thing", value: `梅${i}`, evidence: `梅${i}`, date_precision: "unknown" })) };
    expect(verifyFacts(many, manyBody).items).toHaveLength(10);
  });
  it("date 以外の value が本文に無ければ捨てる（関係性の推測や言い換え。原則 1・3）", () => {
    const d4 = "はると、今日補助輪なしで乗れた";
    const r = verifyFacts(
      {
        items: [
          { kind: "person", value: "はると（息子）", evidence: "はると", date_precision: "unknown" },
          { kind: "person", value: "息子", evidence: "はると", date_precision: "unknown" },
          { kind: "thing", value: "自転車", evidence: "補助輪なしで乗れた", date_precision: "unknown" },
          { kind: "person", value: "はると", evidence: "はると", date_precision: "unknown" },
          { kind: "thing", value: "補助輪", evidence: "補助輪なしで乗れた", date_precision: "unknown" },
        ],
      },
      d4,
    );
    expect(r.items.map((i) => `${i.kind}:${i.value}`)).toEqual(["person:はると", "thing:補助輪"]);
    expect(r.stats.dropped.map((d) => d.reason)).toEqual(["value_not_in_body", "value_not_in_body", "value_not_in_body"]);
    // 引用は本文にあっても、本文に無い呼び方は通さない
    const d1 = "おばあちゃんは毎年6月になると、縁側で梅干しを漬けていた";
    expect(verifyFacts({ items: [{ kind: "person", value: "祖母", evidence: "おばあちゃん", date_precision: "unknown" }] }, d1).stats.dropped[0]!.reason).toBe(
      "value_not_in_body",
    );
  });
  it("date の value は本文の表記と違ってよい（相対表現を解いた値。形と実在だけを見る）", () => {
    const d2 = "電気代を払った。先月より少し安かった";
    const r = verifyFacts({ items: [{ kind: "date", value: "2026-10", evidence: "先月", date_precision: "month" }] }, d2, "2026-11-07");
    expect(r.items).toEqual([{ kind: "date", value: "2026-10", evidence: "先月" }]);
  });
  it("起きた日が不明（happened_on が null）なら、本文に年が無い date は捨てる（年を当てはめない。原則 1）", () => {
    const date = (value: string, evidence: string) => ({ items: [{ kind: "date", value, evidence, date_precision: value.length === 10 ? "day" : "year" }] });
    // 相対表現も、月日だけの表記も、年の根拠が無い
    const a = verifyFacts(date("2026-11-06", "きのう"), "きのう公園で花を見た", null);
    expect(a.items).toEqual([]);
    expect(a.stats.dropped[0]!.reason).toBe("date_no_year");
    expect(verifyFacts(date("2025-06-15", "6月15日"), "6月15日に公園で花を見た", null).stats.dropped[0]!.reason).toBe("date_no_year");
    // 年が本文にあれば残す（引用が月日だけでも、本文のどこかに年があればよい）。全角の数字も見る
    expect(verifyFacts(date("2019-06-15", "6月15日"), "2019年の6月15日に公園で花を見た", null).items).toHaveLength(1);
    expect(verifyFacts(date("2019", "２０１９年"), "２０１９年の夏、公園で花を見た", null).items).toHaveLength(1);
    // 省略時は不明として扱う
    expect(verifyFacts(date("2026-11-06", "きのう"), "きのう公園で花を見た").items).toEqual([]);
  });
  it("起きた日があれば、相対表現を解いた date は残す（D4: 今日 → 2026-11-07）", () => {
    const d4 = "はると、今日補助輪なしで乗れた";
    const r = verifyFacts({ items: [{ kind: "date", value: "2026-11-07", evidence: "今日", date_precision: "day" }] }, d4, "2026-11-07");
    expect(r.items).toEqual([{ kind: "date", value: "2026-11-07", evidence: "今日" }]);
  });
  it("value のエスケープの有無で同じ候補が 2 つ残らない", () => {
    const body = 'A&W で "ルートビア" を飲んだ';
    const r = verifyFacts(
      {
        items: [
          { kind: "thing", value: "&quot;ルートビア&quot;", evidence: "ルートビア", date_precision: "unknown" },
          { kind: "thing", value: '"ルートビア"', evidence: "ルートビア", date_precision: "unknown" },
          { kind: "place", value: "A&amp;W", evidence: "A&amp;W", date_precision: "unknown" },
        ],
      },
      body,
    );
    expect(r.items).toEqual([
      { kind: "thing", value: '"ルートビア"', evidence: "ルートビア" },
      { kind: "place", value: "A&W", evidence: "A&W" },
    ]);
    expect(r.stats.dropped.map((d) => d.reason)).toEqual(["duplicate"]);
  });
  it("isValidDateValue", () => {
    expect(isValidDateValue("2024")).toBe(true);
    expect(isValidDateValue("2024-06")).toBe(true);
    expect(isValidDateValue("2024-02-29")).toBe(true);
    expect(isValidDateValue("2023-02-29")).toBe(false);
    expect(isValidDateValue("2024-13")).toBe(false);
    expect(isValidDateValue("1899")).toBe(false);
    expect(isValidDateValue("2024/06/15")).toBe(false);
  });
});
