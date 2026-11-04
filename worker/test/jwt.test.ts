import { describe, expect, it } from "vitest";
import { JwtError, signJwt, timingSafeEqual, verifyJwt } from "../src/jwt";

const SECRET = "test-secret-0123456789abcdef0123456789";
const NOW = 1_800_000_000;

describe("HS256 JWT", () => {
  it("署名して検証できる", async () => {
    const t = await signJwt({ sub: "a@example.com", iat: NOW, exp: NOW + 100 }, SECRET);
    expect(t.split(".")).toHaveLength(3);
    expect(await verifyJwt(t, SECRET, NOW)).toEqual({ sub: "a@example.com", iat: NOW, exp: NOW + 100 });
  });
  const expectReason = async (p: Promise<unknown>, reason: string) => {
    await expect(p).rejects.toBeInstanceOf(JwtError);
    await p.catch((e: JwtError) => expect(e.reason).toBe(reason));
  };
  it("別の鍵は拒否", async () => {
    const t = await signJwt({ sub: "a@example.com", iat: NOW, exp: NOW + 100 }, "other");
    await expectReason(verifyJwt(t, SECRET, NOW), "bad_signature");
  });
  it("期限切れは拒否", async () => {
    const t = await signJwt({ sub: "a@example.com", iat: NOW, exp: NOW }, SECRET);
    await expectReason(verifyJwt(t, SECRET, NOW), "expired");
  });
  it("本文を書き換えたら拒否", async () => {
    const t = await signJwt({ sub: "a@example.com", iat: NOW, exp: NOW + 100 }, SECRET);
    const [h, , s] = t.split(".") as [string, string, string];
    const p = btoa(JSON.stringify({ sub: "b@example.com", iat: NOW, exp: NOW + 100 })).replace(/=+$/, "");
    await expectReason(verifyJwt(`${h}.${p}.${s}`, SECRET, NOW), "bad_signature");
  });
  it("alg=none は拒否", async () => {
    const h = btoa(JSON.stringify({ alg: "none", typ: "JWT" })).replace(/=+$/, "");
    const p = btoa(JSON.stringify({ sub: "a@example.com", iat: NOW, exp: NOW + 100 })).replace(/=+$/, "");
    await expectReason(verifyJwt(`${h}.${p}.`, SECRET, NOW), "bad_alg");
  });
  it("sub がメールでなければ拒否、形式不正も拒否", async () => {
    const t = await signJwt({ sub: "nobody", iat: NOW, exp: NOW + 100 }, SECRET);
    await expectReason(verifyJwt(t, SECRET, NOW), "bad_sub");
    await expectReason(verifyJwt("abc", SECRET, NOW), "malformed");
  });
  it("iat が 60 秒より未来なら拒否。header が null なら malformed", async () => {
    const t = await signJwt({ sub: "a@example.com", iat: NOW + 120, exp: NOW + 1000 }, SECRET);
    await expectReason(verifyJwt(t, SECRET, NOW), "not_yet_valid");
    const h = btoa("null").replace(/=+$/, "");
    const p = btoa(JSON.stringify({ sub: "a@example.com", iat: NOW, exp: NOW + 100 })).replace(/=+$/, "");
    await expectReason(verifyJwt(`${h}.${p}.x`, SECRET, NOW), "malformed");
  });
  it("timingSafeEqual", () => {
    expect(timingSafeEqual("abc", "abc")).toBe(true);
    expect(timingSafeEqual("abc", "abd")).toBe(false);
    expect(timingSafeEqual("abc", "abcd")).toBe(false);
    expect(timingSafeEqual("", "")).toBe(true);
  });
});
