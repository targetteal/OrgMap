import { test } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPair, exportJWK, createLocalJWKSet, SignJWT } from "jose";
import {
  verifyOidcToken,
  oidcAuthorization,
} from "../../server/modules/interoperability/oidc.js";
import {
  signWebhook,
  verifyWebhook,
} from "../../server/modules/interoperability/webhook.js";
test("OIDC rejects wrong issuer/audience/nonce, expired or tampered JWT and insecure configuration", async () => {
  const keys = await generateKeyPair("RS256"),
    jwk = await exportJWK(keys.publicKey);
  jwk.kid = "test";
  const resolver = createLocalJWKSet({ keys: [jwk] });
  const config = {
    issuer: "https://idp.example.test",
    clientId: "client",
    authorizationEndpoint: "https://idp.example.test/authorize",
    tokenEndpoint: "https://idp.example.test/token",
    jwksUri: "https://idp.example.test/jwks",
    redirectUri: "https://orgmap.example.test/callback",
  };
  async function token(
    issuer = config.issuer,
    audience = "client",
    nonce = "expected",
    expiry = "5m",
    evidence: Record<string, unknown> = {},
  ) {
    return new SignJWT({ ...evidence, nonce })
      .setProtectedHeader({ alg: "RS256", kid: "test" })
      .setIssuer(issuer)
      .setAudience(audience)
      .setSubject("synthetic")
      .setIssuedAt()
      .setExpirationTime(expiry)
      .sign(keys.privateKey);
  }
  assert.equal(
    (await verifyOidcToken(config, await token(), "expected", resolver)).sub,
    "synthetic",
  );
  const authTime = Math.floor(Date.now() / 1000) - 30;
  const verifiedEvidence = await verifyOidcToken(config,
    await token(config.issuer, "client", "expected", "5m", { amr: ["pwd", "otp"], auth_time: authTime }),
    "expected", resolver);
  assert.deepEqual(verifiedEvidence.amr, ["pwd", "otp"]);
  assert.equal(verifiedEvidence.auth_time, authTime);
  for (const evidence of [
    { amr: "mfa" }, { amr: ["otp", 1] }, { amr: [""] },
    { auth_time: "123" }, { auth_time: -1 }, { auth_time: authTime + 3600 },
  ]) await assert.rejects(() => token(config.issuer, "client", "expected", "5m", evidence)
    .then(jwt => verifyOidcToken(config, jwt, "expected", resolver)));
  for (const jwt of [
    await token("https://other.test"),
    await token(config.issuer, "other-client"),
    await token(config.issuer, "client", "wrong"),
    await token(config.issuer, "client", "expected", "-1m"),
  ])
    await assert.rejects(() =>
      verifyOidcToken(config, jwt, "expected", resolver),
    );
  const jwt = await token(),
    parts = jwt.split(".");
  parts[1] = Buffer.from(JSON.stringify({ sub: "attacker" })).toString(
    "base64url",
  );
  await assert.rejects(() =>
    verifyOidcToken(config, parts.join("."), "expected", resolver),
  );
  assert.throws(() =>
    oidcAuthorization({
      ...config,
      tokenEndpoint: "http://outside.example.test/token",
    }),
  );
});
test("webhook timestamp/signature reject expiry, future replay and changed exact bytes", () => {
  const bytes = Buffer.from('{"a":1}'),
    now = Date.now(),
    timestamp = Math.floor(now / 1000),
    signature = signWebhook("synthetic", "event", timestamp, bytes);
  assert.doesNotThrow(() =>
    verifyWebhook("synthetic", "event", timestamp, bytes, signature, now),
  );
  assert.throws(() =>
    verifyWebhook(
      "synthetic",
      "event",
      timestamp,
      Buffer.from('{"a":2}'),
      signature,
      now,
    ),
  );
  assert.throws(() =>
    verifyWebhook(
      "synthetic",
      "event",
      timestamp,
      bytes,
      signature,
      now + 301000,
    ),
  );
  assert.throws(() =>
    verifyWebhook(
      "synthetic",
      "event",
      timestamp,
      bytes,
      signature,
      now - 301000,
    ),
  );
});
