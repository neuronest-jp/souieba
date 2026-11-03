import { describe, expect, it } from "vitest";
import { afterEach, beforeEach, vi } from "vitest";
import { AccessVerifyError, certsUrlFor, fetchJwksCached, resetJwksCacheForTests, verifyAccessJwt } from "../src/access";
import { AUD, ISS, TEAM, makeTestKey, signJwt, signJwtHs256WithPublicKey, validClaims } from "./helpers";

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

  it("未知の kid は1回だけ取り直し、それでも無ければ拒否する", async () => {
    const key = await makeTestKey("kid-x");
    const token = await signJwt(key, validClaims(NOW), { alg: "RS256", kid: "kid-y" });
    const calls: Array<{ forceRefresh?: boolean } | undefined> = [];
    await expectReason(
      verifyAccessJwt(token, {
        teamDomain: TEAM,
        aud: AUD,
        fetchJwks: async (_url, opts) => {
          calls.push(opts);
          return key.jwks;
        },
        now: () => NOW,
      }),
      "unknown_kid",
    );
    expect(calls).toEqual([undefined, { forceRefresh: true }]);
  });

  it("鍵がローテーションされた直後は取り直した JWKS で受理する", async () => {
    const oldKey = await makeTestKey("kid-old");
    const newKey = await makeTestKey("kid-new");
    const token = await signJwt(newKey, validClaims(NOW));
    const claims = await verifyAccessJwt(token, {
      teamDomain: TEAM,
      aud: AUD,
      fetchJwks: async (_url, opts) => (opts?.forceRefresh ? newKey.jwks : oldKey.jwks),
      now: () => NOW,
    });
    expect(claims.email).toBe("hana@example.com");
  });

  it("aud が文字列1つでも受理し、配列に正規化する", async () => {
    const key = await makeTestKey();
    const token = await signJwt(key, validClaims(NOW, { aud: AUD }));
    const claims = await verifyAccessJwt(token, { teamDomain: TEAM, aud: AUD, fetchJwks: async () => key.jwks, now: () => NOW });
    expect(claims.aud).toEqual([AUD]);
  });

  it("nbf が未来なら拒否する", async () => {
    const key = await makeTestKey();
    const token = await signJwt(key, validClaims(NOW, { nbf: NOW + 100 }));
    await expectReason(
      verifyAccessJwt(token, { teamDomain: TEAM, aud: AUD, fetchJwks: async () => key.jwks, now: () => NOW }),
      "not_yet_valid",
    );
  });

  it("exp が無い・数値でない場合も expired として拒否する", async () => {
    const key = await makeTestKey();
    for (const exp of [undefined, String(NOW + 600)]) {
      const token = await signJwt(key, validClaims(NOW, { exp }));
      await expectReason(
        verifyAccessJwt(token, { teamDomain: TEAM, aud: AUD, fetchJwks: async () => key.jwks, now: () => NOW }),
        "expired",
      );
    }
  });

  it("RSA 公開鍵を HMAC 鍵にした HS256 トークン（alg 混同）を拒否する", async () => {
    const key = await makeTestKey();
    const token = await signJwtHs256WithPublicKey(key, validClaims(NOW));
    await expectReason(
      verifyAccessJwt(token, { teamDomain: TEAM, aud: AUD, fetchJwks: async () => key.jwks, now: () => NOW }),
      "bad_alg",
    );
  });

  it("JWKS の kty が RSA でなければ AccessVerifyError 以外で失敗する（呼び出し側で verify_failed になる）", async () => {
    const key = await makeTestKey();
    const token = await signJwt(key, validClaims(NOW));
    const ecJwks = { keys: [{ kty: "EC", crv: "P-256", x: "AA", y: "AA", kid: key.kid }] };
    await expect(
      verifyAccessJwt(token, { teamDomain: TEAM, aud: AUD, fetchJwks: async () => ecJwks, now: () => NOW }),
    ).rejects.toBeDefined();
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

describe("fetchJwksCached", () => {
  const url = certsUrlFor(TEAM);
  const jwks = { keys: [{ kty: "RSA", n: "x", e: "AQAB", kid: "k1" }] };
  const fetchMock = vi.fn();
  beforeEach(() => {
    resetJwksCacheForTests();
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });

  it("5分以内の同じ URL は再取得しない", async () => {
    fetchMock.mockImplementation(async () => ok(jwks));
    expect(await fetchJwksCached(url)).toEqual(jwks);
    expect(await fetchJwksCached(url)).toEqual(jwks);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("forceRefresh なら取り直す。URL が違えば別に取る", async () => {
    fetchMock.mockImplementation(async () => ok(jwks));
    await fetchJwksCached(url);
    await fetchJwksCached(url, { forceRefresh: true });
    await fetchJwksCached(certsUrlFor("other"));
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("非 2xx は jwks_fetch_failed", async () => {
    fetchMock.mockResolvedValue(new Response("nope", { status: 500 }));
    await expect(fetchJwksCached(url)).rejects.toMatchObject({ reason: "jwks_fetch_failed" });
  });

  it("ネットワーク例外も jwks_fetch_failed", async () => {
    fetchMock.mockRejectedValue(new TypeError("fetch failed"));
    await expect(fetchJwksCached(url)).rejects.toMatchObject({ reason: "jwks_fetch_failed" });
  });

  it("keys が無ければ jwks_malformed", async () => {
    fetchMock.mockResolvedValue(ok({}));
    await expect(fetchJwksCached(url)).rejects.toMatchObject({ reason: "jwks_malformed" });
  });
});
