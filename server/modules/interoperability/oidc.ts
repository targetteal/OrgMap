import { createHash, randomBytes } from "node:crypto";
import {
  createRemoteJWKSet,
  jwtVerify,
  type JWTVerifyGetKey,
  type JWTPayload,
} from "jose";
import { fail } from "../../src/core.js";
export type OidcConfiguration = {
  issuer: string;
  clientId: string;
  clientSecret?: string;
  authorizationEndpoint: string;
  tokenEndpoint: string;
  jwksUri: string;
  redirectUri: string;
  allowLocalHttp?: boolean;
};
function endpoint(value: string, local = false) {
  const url = new URL(value);
  if (
    url.protocol !== "https:" &&
    !(
      local &&
      url.protocol === "http:" &&
      (["127.0.0.1", "localhost"].includes(url.hostname) ||
        url.hostname.endsWith(".localhost"))
    )
  )
    fail(400, "INSECURE_PROVIDER_URL");
  if (url.username || url.password || url.hash)
    fail(400, "INVALID_PROVIDER_URL");
  return url;
}
export function validateOidcConfiguration(config: OidcConfiguration) {
  for (const value of [
    config.issuer,
    config.authorizationEndpoint,
    config.tokenEndpoint,
    config.jwksUri,
    config.redirectUri,
  ])
    endpoint(value, config.allowLocalHttp);
  if (!config.clientId) fail(400, "INVALID_PROVIDER_CONFIGURATION");
}
export const pkceChallenge = (verifier: string) =>
  createHash("sha256").update(verifier).digest("base64url");
export function oidcAuthorization(config: OidcConfiguration, options: { forceReauthentication?: boolean } = {}) {
  validateOidcConfiguration(config);
  const state = randomBytes(32).toString("base64url"),
    nonce = randomBytes(32).toString("base64url"),
    verifier = randomBytes(32).toString("base64url");
  const url = new URL(config.authorizationEndpoint);
  for (const [k, v] of Object.entries({
    response_type: "code",
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    scope: "openid",
    state,
    nonce,
    code_challenge: pkceChallenge(verifier),
    code_challenge_method: "S256",
  }))
    url.searchParams.set(k, v);
  if (options.forceReauthentication) { url.searchParams.set("max_age", "0"); url.searchParams.set("prompt", "login"); }
  return { state, nonce, verifier, url: url.href };
}
export async function verifyOidcToken(
  config: OidcConfiguration,
  token: string,
  nonce: string,
  key?: JWTVerifyGetKey,
): Promise<JWTPayload> {
  validateOidcConfiguration(config);
  const { payload } = await jwtVerify(
    token,
    key ?? createRemoteJWKSet(new URL(config.jwksUri)),
    {
      issuer: config.issuer,
      audience: config.clientId,
      algorithms: ["RS256", "ES256"],
      requiredClaims: ["exp", "iat", "sub", "nonce"],
      maxTokenAge: "10m",
      clockTolerance: 5,
    },
  ).catch(() => fail(401, "OIDC_TOKEN_INVALID"));
  if (
    payload.nonce !== nonce ||
    typeof payload.sub !== "string" ||
    !payload.sub ||
    (Array.isArray(payload.aud) &&
      payload.aud.length > 1 &&
      payload.azp !== config.clientId)
  )
    fail(401, "OIDC_CLAIMS_INVALID");
  // Optional authentication evidence is accepted only from this verified JWT.
  // Recognition of an MFA method and required freshness belong to IAM policy.
  if (
    (payload.amr !== undefined &&
      (!Array.isArray(payload.amr) || payload.amr.length > 32 ||
        !payload.amr.every((method) => typeof method === "string" && method.length > 0 && method.length <= 100))) ||
    (payload.auth_time !== undefined &&
      (typeof payload.auth_time !== "number" ||
        !Number.isSafeInteger(payload.auth_time) ||
        payload.auth_time < 0 ||
        payload.auth_time > Math.floor(Date.now() / 1000) + 5))
  )
    fail(401, "OIDC_CLAIMS_INVALID");
  return payload;
}
export async function exchangeOidcCode(
  config: OidcConfiguration,
  code: string,
  verifier: string,
  nonce: string,
) {
  validateOidcConfiguration(config);
  const form = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: config.redirectUri,
    client_id: config.clientId,
    code_verifier: verifier,
  });
  if (config.clientSecret) form.set("client_secret", config.clientSecret);
  const response = await fetch(config.tokenEndpoint, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: form,
    redirect: "error",
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) fail(401, "OIDC_TOKEN_EXCHANGE_FAILED");
  const content = await response.text();
  if (content.length > 65536) fail(401, "OIDC_TOKEN_EXCHANGE_FAILED");
  const tokens = JSON.parse(content);
  if (typeof tokens.id_token !== "string") fail(401, "OIDC_TOKEN_MISSING");
  return verifyOidcToken(config, tokens.id_token, nonce);
}
