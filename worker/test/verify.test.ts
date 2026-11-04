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
    const b = new Map([["a", "本文 A です"], ["b", "本文 B です"]]);
    const out = {
      items: [
        { related_memory_id: "self", reason: "x", evidence: "本文" },
        { related_memory_id: "a", reason: "ok", evidence: "本文 A" },
        { related_memory_id: "a", reason: "dup", evidence: "本文 A" },
        { related_memory_id: "b", reason: "あ".repeat(81), evidence: "本文 B" },
        { related_memory_id: "b", reason: "", evidence: "本文 B" },
        { related_memory_id: "b", evidence: "本文 B" },
        { related_memory_id: "b", reason: "空の引用", evidence: "" },
      ],
    };
    const r = verifyRecall(out, new Map([...b, ["self", "self body"]]), "self");
    expect(r.items.map((i) => i.related_memory_id)).toEqual(["a"]);
    expect(r.stats.dropped.map((d) => d.reason)).toEqual(["self", "duplicate", "reason_length", "reason_length", "malformed", "evidence_not_in_body"]);
  });
  it("NFC 正規化や空白除去はしない（完全一致のみ）", () => {
    const b = new Map([["a", "おばあちゃんは毎年6月に"]]);
    expect(verifyRecall({ items: [{ related_memory_id: "a", reason: "r", evidence: "おばあちゃんは 毎年6月に" }] }, b, "x").items).toEqual([]);
    expect(verifyRecall({ items: [{ related_memory_id: "a", reason: "r", evidence: "おばあちゃんは毎年６月に" }] }, b, "x").items).toEqual([]);
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
    const many = { items: Array.from({ length: 12 }, (_, i) => ({ kind: "thing", value: `梅${i}`, evidence: "梅", date_precision: "unknown" })) };
    expect(verifyFacts(many, body).items).toHaveLength(10);
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
