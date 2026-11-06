// 取り直した候補に、画面で決めた印を重ねる（S1 に戻ったとき、S3 の取り直し）。
import { describe, expect, it } from "vitest";
import type { Fact } from "../src/api/types";
import { keepDecided } from "../src/facts";

const fact = (id: string, status: Fact["status"]): Fact => ({
  id,
  kind: "thing",
  value: id,
  status,
  source: "ai",
  evidence: id,
  created_at: "2026-11-06T00:00:00.000Z",
  decided_at: null,
});

describe("keepDecided", () => {
  it("画面で決めた行（そう / ちがう）はそのオブジェクトのまま残す", () => {
    const mine = fact("f1", "confirmed");
    const out = keepDecided([mine], [fact("f1", "candidate")]);
    expect(out[0]).toBe(mine); // 記録に失敗して FactChips が印を戻すとき、画面に出ている行が戻る
    expect(keepDecided([fact("f1", "rejected")], [fact("f1", "candidate")])[0]!.status).toBe("rejected");
  });

  it("画面がまだ候補なら、取り直した側（ほかの画面で決めた分）を使う", () => {
    expect(keepDecided([fact("f1", "candidate")], [fact("f1", "confirmed")])[0]!.status).toBe("confirmed");
    expect(keepDecided([fact("f1", "candidate")], [fact("f1", "rejected")])[0]!.status).toBe("rejected");
  });

  it("並びと行は取り直した側に合わせる（新しく届いた候補は足し、無くなった行は落とす）", () => {
    const out = keepDecided([fact("gone", "confirmed"), fact("f1", "candidate")], [fact("f2", "candidate"), fact("f1", "candidate")]);
    expect(out.map((f) => f.id)).toEqual(["f2", "f1"]);
  });
});
