import { describe, expect, it } from "vitest";
import { AccessVerifyError, certsUrlFor, verifyAccessJwt } from "../src/access";
import { AUD, ISS, TEAM, makeTestKey, signJwt, validClaims } from "./helpers";

const NOW = 1_800_000_000;

describe("verifyAccessJwt", () => {
  it("正しい JWT を受理し、メールを小文字にして返す", async () => {
    const key = await makeTestKey();
    const token = await signJwt(key, validClaims(NOW));
    const claims = await verifyAccessJwt(token, {
      teamDomain: TEAM,
      aud: AUD,
      fetchJwks: async (url) => {
        expect(url).toBe(certsUrlFor(TEAM));
        return key.jwks;
      },
      now: () => NOW,
    });
    expect(claims.email).toBe("hana@example.com");
    expect(claims.iss).toBe(ISS);
  });

  const expectReason = async (p: Promise<unknown>, reason: string) => {
    await expect(p).rejects.toBeInstanceOf(AccessVerifyError);
    await p.catch((e: AccessVerifyError) => expect(e.reason).toBe(reason));
  };

  it("別の鍵で署名された JWT を拒否する", async () => {
    const key = await makeTestKey("kid-a");
    const other = await makeTestKey("kid-a");
    const token = await signJwt(other, validClaims(NOW));
    await expectReason(
      verifyAccessJwt(token, { teamDomain: TEAM, aud: AUD, fetchJwks: async () => key.jwks, now: () => NOW }),
      "bad_signature",
    );
  });

  it("aud が違えば拒否する", async () => {
    const key = await makeTestKey();
    const token = await signJwt(key, validClaims(NOW, { aud: ["someone-else"] }));
    await expectReason(
      verifyAccessJwt(token, { teamDomain: TEAM, aud: AUD, fetchJwks: async () => key.jwks, now: () => NOW }),
      "bad_aud",
    );
  });

  it("iss が違えば拒否する", async () => {
    const key = await makeTestKey();
    const token = await signJwt(key, validClaims(NOW, { iss: "https://evil.cloudflareaccess.com" }));
    await expectReason(
      verifyAccessJwt(token, { teamDomain: TEAM, aud: AUD, fetchJwks: async () => key.jwks, now: () => NOW }),
      "bad_iss",
    );
  });

  it("期限切れを拒否する", async () => {
    const key = await makeTestKey();
    const token = await signJwt(key, validClaims(NOW, { exp: NOW - 1 }));
    await expectReason(
      verifyAccessJwt(token, { teamDomain: TEAM, aud: AUD, fetchJwks: async () => key.jwks, now: () => NOW }),
      "expired",
    );
  });

  it("alg=none を拒否する", async () => {
    const key = await makeTestKey();
    const token = await signJwt(key, validClaims(NOW), { alg: "none", kid: key.kid });
    await expectReason(
      verifyAccessJwt(token, { teamDomain: TEAM, aud: AUD, fetchJwks: async () => key.jwks, now: () => NOW }),
      "bad_alg",
    );
  });

  it("未知の kid を拒否する", async () => {
    const key = await makeTestKey("kid-x");
    const token = await signJwt(key, validClaims(NOW), { alg: "RS256", kid: "kid-y" });
    await expectReason(
      verifyAccessJwt(token, { teamDomain: TEAM, aud: AUD, fetchJwks: async () => key.jwks, now: () => NOW }),
      "unknown_kid",
    );
  });

  it("email が無ければ拒否する", async () => {
    const key = await makeTestKey();
    const token = await signJwt(key, validClaims(NOW, { email: undefined }));
    await expectReason(
      verifyAccessJwt(token, { teamDomain: TEAM, aud: AUD, fetchJwks: async () => key.jwks, now: () => NOW }),
      "no_email",
    );
  });

  it("ACCESS_TEAM_DOMAIN / ACCESS_AUD が未設定なら検証しない", async () => {
    const key = await makeTestKey();
    const token = await signJwt(key, validClaims(NOW));
    await expectReason(
      verifyAccessJwt(token, { teamDomain: "", aud: "", fetchJwks: async () => key.jwks, now: () => NOW }),
      "not_configured",
    );
  });

  it("形式が壊れていれば拒否する", async () => {
    await expectReason(
      verifyAccessJwt("abc", { teamDomain: TEAM, aud: AUD, fetchJwks: async () => ({ keys: [] }), now: () => NOW }),
      "malformed",
    );
  });
});
