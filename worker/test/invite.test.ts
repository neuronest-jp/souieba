import { describe, expect, it } from "vitest";
import { matchInvite, parseInviteConfig } from "../src/invite";

describe("parseInviteConfig", () => {
  it("コード=メールの対応表を読む（前後の空白を除き、メールは小文字に）", () => {
    expect(parseInviteConfig(" c1=A@Example.com , c2 = b@example.com ", false)).toEqual({
      kind: "table",
      entries: [
        { code: "c1", email: "a@example.com" },
        { code: "c2", email: "b@example.com" },
      ],
    });
  });

  it("同じメールに別のコードは可", () => {
    expect(parseInviteConfig("c1=a@example.com,c2=a@example.com", false).kind).toBe("table");
  });

  it("= の無い値は development だけ any、それ以外は invalid", () => {
    expect(parseInviteConfig("dev", true)).toEqual({ kind: "any", code: "dev" });
    expect(parseInviteConfig("dev", false)).toMatchObject({ kind: "invalid", reason: "not_a_table" });
  });

  it("壊れた形は invalid。理由に値そのものは含めない", () => {
    const cases: [string | undefined, string][] = [
      [undefined, "empty"],
      ["  ", "empty"],
      ["=a@example.com", "entry_1_empty_code"],
      ["c1=nope", "entry_1_bad_email"],
      ["c1=a@example.com,c1=b@example.com", "entry_2_duplicate_code"],
      ["c1=a@example.com,dev", "entry_2_no_equals"],
      ["c1=a@example.com,", "entry_2_no_equals"],
    ];
    for (const [raw, reason] of cases) {
      const r = parseInviteConfig(raw, true);
      expect(r, String(raw)).toEqual({ kind: "invalid", reason });
    }
  });
});

describe("matchInvite", () => {
  const table = parseInviteConfig("c1=a@example.com,c2=b@example.com", false);
  if (table.kind === "invalid") throw new Error("unreachable");

  it("コードとメールの組が一致したときだけ対応表のメールを返す", () => {
    expect(matchInvite(table, "c1", "a@example.com")).toBe("a@example.com");
    expect(matchInvite(table, "c2", "b@example.com")).toBe("b@example.com");
    expect(matchInvite(table, "c1", "b@example.com")).toBeNull();
    expect(matchInvite(table, "c3", "a@example.com")).toBeNull();
    expect(matchInvite(table, "", "a@example.com")).toBeNull();
  });

  it("any はコードだけを比べ、入力のメールを返す", () => {
    expect(matchInvite({ kind: "any", code: "dev" }, "dev", "x@example.com")).toBe("x@example.com");
    expect(matchInvite({ kind: "any", code: "dev" }, "devx", "x@example.com")).toBeNull();
  });
});
