import { lockActiveOrganization } from "../../src/organization-lifecycle.js";
import {
  SAML,
  ValidateInResponseTo,
  type CacheProvider,
} from "@node-saml/node-saml";
import { transaction } from "../../src/db.js";
import { digest, fail } from "../../src/core.js";
export type SamlConfiguration = {
  entryPoint: string;
  issuer: string;
  idpIssuer: string;
  callbackUrl: string;
  idpCert: string;
  allowLocalHttp?: boolean;
  authnContextAmr?: Record<string, readonly string[]>;
};
function validate(config: SamlConfiguration) {
  for (const value of [config.entryPoint, config.callbackUrl]) {
    const u = new URL(value);
    if (
      u.protocol !== "https:" &&
      !(
        config.allowLocalHttp &&
        u.protocol === "http:" &&
        ["localhost", "127.0.0.1"].includes(u.hostname)
      )
    )
      fail(400, "INSECURE_PROVIDER_URL");
  }
  if (config.authnContextAmr && Object.values(config.authnContextAmr).some((amr) => !Array.isArray(amr) || amr.length > 32 || amr.some((method) => typeof method !== "string" || !method || method.length > 100)))
    fail(400, "INVALID_PROVIDER_CONFIGURATION");
  if (!config.issuer || !config.idpIssuer || !config.idpCert)
    fail(400, "INVALID_PROVIDER_CONFIGURATION");
}
export function samlAdapter(
  config: SamlConfiguration,
  cacheProvider: CacheProvider,
  forceReauthentication = false,
) {
  validate(config);
  const saml = new SAML({
    entryPoint: config.entryPoint,
    issuer: config.issuer,
    idpIssuer: config.idpIssuer,
    callbackUrl: config.callbackUrl,
    idpCert: config.idpCert,
    audience: config.issuer,
    validateInResponseTo: ValidateInResponseTo.always,
    wantAssertionsSigned: true,
    wantAuthnResponseSigned: true,
    acceptedClockSkewMs: 5000,
    maxAssertionAgeMs: 300000,
    requestIdExpirationPeriodMs: 300000,
    cacheProvider,
    forceAuthn: forceReauthentication,
    signatureAlgorithm: "sha256",
    digestAlgorithm: "sha256",
  });
  return {
    authorize: (state: string) =>
      saml.getAuthorizeUrlAsync(state, undefined, {}),
    async verify(response: string) {
      if (response.length > 131072) fail(400, "SAML_RESPONSE_TOO_LARGE");
      let result;
      try {
        result = await saml.validatePostResponseAsync({
          SAMLResponse: response,
        });
      } catch {
        fail(401, "SAML_ASSERTION_INVALID");
      }
      const profile = result!.profile;
      if (
        !profile ||
        result!.loggedOut ||
        profile.issuer !== config.idpIssuer ||
        !profile.nameID ||
        !profile.getAssertion
      )
        fail(401, "SAML_CLAIMS_INVALID");
      // Inspect the assertion object returned from the library's verified assertion, never raw unsigned XML.
      const assertion = (profile!.getAssertion?.() as any)?.Assertion;
      if (typeof assertion?.$?.ID !== "string" || !assertion.$.ID)
        fail(401, "SAML_ASSERTION_ID_INVALID");
      const confirmations = assertion?.Subject?.[0]?.SubjectConfirmation;
      if (
        !Array.isArray(confirmations) ||
        !confirmations.some(
          (confirmation: any) =>
            confirmation?.$?.Method ===
              "urn:oasis:names:tc:SAML:2.0:cm:bearer" &&
            confirmation.SubjectConfirmationData?.[0]?.$?.Recipient ===
              config.callbackUrl,
        )
      )
        fail(401, "SAML_RECIPIENT_INVALID");
      const statements = assertion?.AuthnStatement;
      let amr: readonly string[] | undefined, authTime: Date | undefined;
      if (config.authnContextAmr && statements !== undefined) {
        if (!Array.isArray(statements) || statements.length !== 1)
          fail(401, "SAML_AUTHENTICATION_EVIDENCE_INVALID");
        const statement = statements[0],
          contexts = statement?.AuthnContext?.[0]?.AuthnContextClassRef,
          contextNode = Array.isArray(contexts) && contexts.length === 1 ? contexts[0] : undefined,
          context = typeof contextNode === "string" ? contextNode : contextNode?._;
        if (typeof context === "string" && Object.hasOwn(config.authnContextAmr, context)) {
          amr = [...config.authnContextAmr[context]];
          const instant = statement?.$?.AuthnInstant;
          if (typeof instant !== "string" || !/(Z|[+-]\d{2}:\d{2})$/.test(instant))
            fail(401, "SAML_AUTHENTICATION_EVIDENCE_INVALID");
          authTime = new Date(instant);
          if (!Number.isFinite(authTime.getTime()) || +authTime > Date.now() + 5000)
            fail(401, "SAML_AUTHENTICATION_EVIDENCE_INVALID");
        }
      }
      return {
        amr,
        authTime,
        issuer: profile!.issuer,
        subject: profile!.nameID,
        assertionId: assertion.$.ID as string,
        claims: Object.fromEntries(
          Object.entries(profile!).filter(
            ([, value]) =>
              typeof value === "string" ||
              (Array.isArray(value) &&
                value.every((v) => typeof v === "string")),
          ),
        ),
      };
    },
  };
}
export function persistentSamlCache(
  organizationId: string,
  connectionId: string,
): CacheProvider {
  async function scoped<T>(fn: (c: import("pg").PoolClient) => Promise<T>) {
    return transaction(async (c) => {
      await c.query("SELECT set_config('orgmap.organization_id',$1,true)", [
        organizationId,
      ]);
      await lockActiveOrganization(c, organizationId);
      return fn(c);
    });
  }
  return {
    saveAsync: async (key, value) =>
      scoped(async (c) => {
        const row = (
          await c.query(
            "INSERT INTO interop_saml_cache(organization_id,connection_id,key,value,expires_at) VALUES($1,$2,$3,$4,now()+interval '5 minutes') ON CONFLICT DO NOTHING RETURNING created_at",
            [organizationId, connectionId, key, value],
          )
        ).rows[0];
        return row
          ? { value, createdAt: new Date(row.created_at).getTime() }
          : null;
      }),
    getAsync: async (key) =>
      scoped(
        async (c) =>
          (
            await c.query(
              "SELECT value FROM interop_saml_cache WHERE organization_id=$1 AND connection_id=$2 AND key=$3 AND expires_at>now()",
              [organizationId, connectionId, key],
            )
          ).rows[0]?.value ?? null,
      ),
    removeAsync: async (key) =>
      scoped(
        async (c) =>
          (
            await c.query(
              "DELETE FROM interop_saml_cache WHERE organization_id=$1 AND connection_id=$2 AND key=$3 RETURNING value",
              [organizationId, connectionId, key],
            )
          ).rows[0]?.value ?? null,
      ),
  };
}
export async function consumeSamlAssertion(
  organizationId: string,
  connectionId: string,
  assertionId: string,
) {
  await transaction(async (c) => {
    await c.query("SELECT set_config('orgmap.organization_id',$1,true)", [
      organizationId,
    ]);
    await lockActiveOrganization(c, organizationId);
    const row = await c.query(
      "INSERT INTO interop_saml_replays(organization_id,connection_id,assertion_hash,expires_at) VALUES($1,$2,$3,now()+interval '10 minutes') ON CONFLICT DO NOTHING RETURNING assertion_hash",
      [organizationId, connectionId, digest(assertionId)],
    );
    if (!row.rowCount) fail(401, "SAML_REPLAY_DENIED");
  });
}
