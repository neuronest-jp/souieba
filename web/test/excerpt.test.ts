// つながりの昔の紙片: 本文のうち思い出した一文（evidence）に印を付ける切り分け（web/src/connections/excerpt.ts）
import { describe, expect, it } from "vitest";
import { markEvidence } from "../src/connections/excerpt";

const UME = "おばあちゃんは毎年6月になると、縁側で梅干しを漬けていた。青梅を水に浸けて、ひとつずつヘタを取るのを手伝った。";

describe("markEvidence", () => {
  it("引用の前後を分け、引用だけを hit にする（短い本文は切らない）", () => {
    expect(markEvidence(UME, "青梅を水に浸けて、ひとつずつヘタを取るのを手伝った。", { limit: 80 })).toEqual([
      { text: "おばあちゃんは毎年6月になると、縁側で梅干しを漬けていた。", hit: false },
      { text: "青梅を水に浸けて、ひとつずつヘタを取るのを手伝った。", hit: true },
    ]);
    expect(markEvidence("はるとが三輪車で転んで泣いた。公園の坂道で", "はるとが三輪車で転んで泣いた。")).toEqual([
      { text: "はるとが三輪車で転んで泣いた。", hit: true },
      { text: "公園の坂道で", hit: false },
    ]);
  });

  it("80 字を超える本文は、引用の前後 24 字だけにして、切った側に「…」を付ける", () => {
    const head = "あ".repeat(60);
    const tail = "い".repeat(60);
    const parts = markEvidence(`${head}青梅を水に浸けて${tail}`, "青梅を水に浸けて", { limit: 80 });
    expect(parts).toEqual([
      { text: `…${"あ".repeat(24)}`, hit: false },
      { text: "青梅を水に浸けて", hit: true },
      { text: `${"い".repeat(24)}…`, hit: false },
    ]);
  });

  it("一覧の 56 字: 引用が末尾の 57〜80 字の本文も寄せて「…」を付ける（4 行で切っても印が見える。見直し n=5）", () => {
    const evidence = "店主は私を覚えていた。";
    for (const n of [57, 64, 72, 80]) {
      const body = `${"あ".repeat(n - evidence.length)}${evidence}`;
      const parts = markEvidence(body, evidence, { limit: 56, context: 24 });
      expect(parts[0]).toEqual({ text: `…${"あ".repeat(24)}`, hit: false });
      expect(parts[1]).toEqual({ text: evidence, hit: true });
      expect(parts).toHaveLength(2);
    }
  });

  it("長い引用は、前の文脈を縮めて「…」+ 前 + 引用 が limit に収まるようにする（後ろは行で切れてよい）", () => {
    const evidence = "う".repeat(40);
    const body = `${"あ".repeat(50)}${evidence}${"い".repeat(30)}`;
    const parts = markEvidence(body, evidence, { limit: 56, context: 24 });
    expect(parts[0]).toEqual({ text: `…${"あ".repeat(15)}`, hit: false });
    expect(parts[1]).toEqual({ text: evidence, hit: true });
    expect(parts[2]).toEqual({ text: `${"い".repeat(24)}…`, hit: false });
    expect([...(parts[0]!.text + parts[1]!.text)].length).toBe(56);
    // 引用だけで limit を超えるときは、前の文脈を付けない（引用は切らない）
    const huge = "え".repeat(70);
    const [first, second] = markEvidence(`${"あ".repeat(30)}${huge}`, huge, { limit: 56, context: 24 });
    expect(first).toEqual({ text: "…", hit: false });
    expect(second).toEqual({ text: huge, hit: true });
  });

  it("引用が本文の端にあれば、その側には「…」を付けない", () => {
    const body = `青梅を水に浸けて${"い".repeat(90)}`;
    expect(markEvidence(body, "青梅を水に浸けて", { limit: 80 })).toEqual([
      { text: "青梅を水に浸けて", hit: true },
      { text: `${"い".repeat(24)}…`, hit: false },
    ]);
  });

  it("絵文字（サロゲートペア）の途中では切らない", () => {
    const body = `${"あ".repeat(60)}🍑${"う".repeat(23)}引用${"い".repeat(60)}`;
    const [pre] = markEvidence(body, "引用", { limit: 80 });
    expect(pre?.text.startsWith("…🍑")).toBe(true);
  });

  it("引用が見つからない・空のときは、本文をそのまま返す（推測で印を付けない）", () => {
    expect(markEvidence(UME, "見つからない一文", { limit: 80 })).toEqual([{ text: UME, hit: false }]);
    expect(markEvidence(UME, "")).toEqual([{ text: UME, hit: false }]);
  });
});
