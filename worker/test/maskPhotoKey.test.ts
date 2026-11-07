// ログに出す写真のキーで、メールアドレスの区切りを伏せる（ADR-0013。ログに個人の識別子を出さない）
import { describe, expect, it } from "vitest";
import { maskPhotoKey, photoKeyFor } from "../src/routes/photos";

describe("maskPhotoKey", () => {
  it("photos/<メール>/<記憶の ID>/<ファイル名> のメールだけを伏せ、探す手がかり（記憶の ID とファイル名）は残す", () => {
    const key = photoKeyFor("someone@example.com", "mem-1", "jpg");
    const masked = maskPhotoKey(key);
    expect(masked).not.toContain("someone@example.com");
    expect(masked).toMatch(/^photos\/<user>\/mem-1\/[0-9a-f-]+\.jpg$/);
  });
  it("形の違うキーはそのまま", () => {
    expect(maskPhotoKey("other/key.png")).toBe("other/key.png");
  });
});
