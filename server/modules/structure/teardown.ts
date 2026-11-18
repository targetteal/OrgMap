import type { OrganizationTeardownParticipant } from "../../src/organization-lifecycle-contract.js";

/** Database grants and 510 verify authority; creation of this object does not. */
export function createStructureTeardownParticipant(): OrganizationTeardownParticipant {
  const ownedSets = [
    "structure_values", "structure_field_revisions", "structure_fields",
    "structure_records", "structure_indicators", "structure_role_settings", "structure_templates",
    "structure_mandates", "structure_aliases", "structure_views", "structure_history",
    "structure_snapshots", "structure_circle_policies", "structure_collective_policies",
    "structure_circle_creations", "structure_circle_display", "structure_role_functions",
    "structure_governance_models", "structure_model_revisions", "structure_model_functions",
    "structure_model_circles", "structure_model_occupancy_context", "structure_model_events",
  ] as const;
  return {
    contextId: "structure", version: 1,
    describe: () => ({ ownedSets, after: [] }),
    async runBatch(ctx, input) {
      const { rows } = await ctx.c.query(
        "SELECT public.structure_teardown_batch($1,$2,$3,$4,$5,$6,$7) AS result",
        [ctx.organizationId,ctx.jobId,ctx.lifecycleFence,ctx.leaseToken,input.phase,input.cursor,input.limit],
      );
      const result = rows[0]?.result;
      if (!result || typeof result.done !== "boolean" || !Array.isArray(result.blobReferences))
        throw Error("INVALID_TEARDOWN_BATCH_RESULT");
      return result;
    },
  };
}
