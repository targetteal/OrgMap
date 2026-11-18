import type { OrganizationTeardownParticipant } from "../../src/organization-lifecycle-contract.js";

/** Database grants and 510 verify authority; creation of this object does not. */
export function createInteroperabilityTeardownParticipant(): OrganizationTeardownParticipant {
  const ownedSets = ["interop_project_output_deliveries","interop_project_output_configs","interop_provider_oauth_flows","interop_provider_grants","interop_auth_flows","interop_federated_identities","interop_saml_cache","interop_saml_replays","interop_scim_sources","interop_credentials","interop_webhook_inbox","interop_deliveries","interop_scim_users","interop_calendar_events","interop_connections"] as const;
  return {
    contextId: "interoperability", version: 1,
    describe: () => ({ ownedSets, after: [] }),
    async runBatch(ctx, input) {
      const { rows } = await ctx.c.query(
        "SELECT public.interoperability_teardown_batch($1,$2,$3,$4,$5,$6,$7) AS result",
        [ctx.organizationId,ctx.jobId,ctx.lifecycleFence,ctx.leaseToken,input.phase,input.cursor,input.limit],
      );
      const result = rows[0]?.result;
      if (!result || typeof result.done !== "boolean" || !Array.isArray(result.blobReferences))
        throw Error("INVALID_TEARDOWN_BATCH_RESULT");
      return result;
    },
  };
}
