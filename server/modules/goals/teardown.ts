import type { OrganizationTeardownParticipant } from "../../src/organization-lifecycle-contract.js";

/** Database grants and 510 verify authority; creation of this object does not. */
export function createGoalsTeardownParticipant(): OrganizationTeardownParticipant {
  const ownedSets = ["goal_assignments", "goal_resource_links", "goal_history", "goal_origins", "goal_period_links", "goal_key_results", "goals", "goal_periods"] as const;
  return {
    contextId: "goals", version: 1,
    describe: () => ({ ownedSets, after: [] }),
    async runBatch(ctx, input) {
      const { rows } = await ctx.c.query(
        "SELECT public.goals_teardown_batch($1,$2,$3,$4,$5,$6,$7) AS result",
        [ctx.organizationId,ctx.jobId,ctx.lifecycleFence,ctx.leaseToken,input.phase,input.cursor,input.limit],
      );
      const result = rows[0]?.result;
      if (!result || typeof result.done !== "boolean" || !Array.isArray(result.blobReferences))
        throw Error("INVALID_TEARDOWN_BATCH_RESULT");
      return result;
    },
  };
}
