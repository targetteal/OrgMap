import type { ModuleRuntime, Ctx } from "../../src/runtime.js";
import type { PoolClient } from "pg";
import { fail, id } from "../../src/core.js";
import type {
  EnrollmentConfiguration,
  ProvisioningProfile,
  ProvisioningSource,
  VerifiedProvisioningIdentity,
} from "./enrollment-ports.js";
import type { FederationConfiguration } from "./federation.js";
import type { SamlConfigurations } from "./saml-routes.js";
export function registerEnrollmentAuthority(
  core: ModuleRuntime,
  configuration: EnrollmentConfiguration,
  oidc: FederationConfiguration,
  saml: SamlConfigurations,
  federation: {
    consumeProvisioningProof(
      proof: unknown,
    ): VerifiedProvisioningIdentity | null;
  },
) {
  const iam = core;
  async function valid(
    c: PoolClient,
    org: string,
    source: ProvisioningSource,
    profile: ProvisioningProfile,
    activation: boolean,
  ) {
    const key = org + ":" + source.connectionId,
      mapping = configuration[key],
      providerIssuer = oidc[key]?.issuer ?? saml[key]?.idpIssuer;
    if (
      !mapping ||
      !providerIssuer ||
      !["MEMBER", "GUEST"].includes(mapping.requestedMemberType ?? "MEMBER") ||
      mapping.issuer !== providerIssuer ||
      !Number.isSafeInteger(mapping.mappingRevision) ||
      mapping.mappingRevision < 1 ||
      ["email", "email_verified", "preferred_username", "userName"].includes(
        mapping.claim,
      )
    )
      return false;
    if (
      mapping.externalIdToValue[source.externalId] !== profile.identity.value ||
      profile.identity.issuer !== mapping.issuer ||
      profile.identity.claim !== mapping.claim ||
      profile.identity.mappingRevision !== mapping.mappingRevision ||
      (profile.requestedMemberType ?? "MEMBER") !== (mapping.requestedMemberType ?? "MEMBER")
    )
      return false;
    const row = (
      await c.query(
        "SELECT s.administrative_active,s.user_name,s.email,s.requested_member_type FROM interop_scim_sources s JOIN interop_connections c ON c.organization_id=s.organization_id AND c.id=s.connection_id WHERE s.organization_id=$1 AND s.connection_id=$2 AND s.external_id=$3 AND s.deleted_at IS NULL AND c.state<>'REVOKED' AND c.provider IN ('OIDC','SAML')",
        [org, id(source.connectionId), source.externalId],
      )
    ).rows[0];
    return (
      !!row &&
      (!activation || row.administrative_active) &&
      row.user_name === profile.userName &&
      row.email === profile.email &&
      row.requested_member_type === (profile.requestedMemberType ?? "MEMBER")
    );
  }
  iam.registerProvisionedEnrollmentAuthority({
    authenticationPolicy: async (ctx) => {
      const connectionIds = Object.entries(configuration)
        .filter(
          ([key, value]) =>
            key.startsWith(ctx.org.id + ":") && value.ssoRequired,
        )
        .map(([key]) => key.slice(ctx.org.id.length + 1));
      return {
        mode: connectionIds.length ? "SSO_REQUIRED" : "ANY",
        connectionIds,
      };
    },
    validateSessionProvenance: async (ctx, provenance) => {
      if (
        provenance.method !== "FEDERATED" ||
        provenance.organizationId !== ctx.org.id ||
        !provenance.connectionId ||
        !provenance.issuer ||
        !provenance.subject
      )
        return false;
      const key = ctx.org.id + ":" + provenance.connectionId,
        issuer = oidc[key]?.issuer ?? saml[key]?.idpIssuer;
      if (issuer !== provenance.issuer) return false;
      return !!(
        await ctx.c.query(
          "SELECT 1 FROM interop_federated_identities i JOIN interop_connections c ON c.organization_id=i.organization_id AND c.id=i.connection_id WHERE i.organization_id=$1 AND i.connection_id=$2 AND i.account_id=$3 AND i.issuer=$4 AND i.subject=$5 AND c.state<>'REVOKED'",
          [
            ctx.org.id,
            provenance.connectionId,
            ctx.account.id,
            provenance.issuer,
            provenance.subject,
          ],
        )
      ).rowCount;
    },
    validateSource: async (ctx: Ctx, source, profile) => {
      if (!(await valid(ctx.c, ctx.org.id, source, profile, false)))
        fail(503, "PROVISIONING_MAPPING_REQUIRED");
    },
    revalidateSource: (c, org, source, profile) =>
      valid(c, org, source, profile, true),
    verifyFederationProof: async (_c, proof) =>
      federation.consumeProvisioningProof(proof),
    bindFederatedIdentity: async (c, input) => {
      const existing = (
        await c.query(
          "SELECT account_id FROM interop_federated_identities WHERE organization_id=$1 AND connection_id=$2 AND issuer=$3 AND subject=$4",
          [
            input.organizationId,
            input.connectionId,
            input.issuer,
            input.subject,
          ],
        )
      ).rows[0];
      if (existing && existing.account_id !== input.accountId)
        fail(409, "FEDERATED_IDENTITY_ALREADY_LINKED");
      if (!existing) {
        const { uuid } = await import("../../src/core.js");
        await c.query(
          "INSERT INTO interop_federated_identities(organization_id,id,connection_id,issuer,subject,account_id) VALUES($1,$2,$3,$4,$5,$6)",
          [
            input.organizationId,
            uuid(),
            input.connectionId,
            input.issuer,
            input.subject,
            input.accountId,
          ],
        );
      }
    },
  });
}
