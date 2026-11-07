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
