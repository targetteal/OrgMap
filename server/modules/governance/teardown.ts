import type { OrganizationTeardownParticipant } from "../../src/organization-lifecycle-contract.js";

/** Database grants and 510 verify authority; creation of this object does not. */
export function createGovernanceTeardownParticipant(): OrganizationTeardownParticipant {
  const ownedSets = [
    "gov_tension_links", "gov_ballots", "gov_objections", "gov_nominations", "gov_commits",
    "gov_rounds", "gov_revisions", "gov_proposals", "gov_tensions", "gov_branches",
    "gov_history", "gov_policies", "gov_document_versions", "gov_documents", "gov_document_types",
  ] as const;
  return {
    contextId: "governance", version: 1,
    describe: () => ({ ownedSets, after: [] }),
    async runBatch(ctx, input) {
      const { rows } = await ctx.c.query(
        "SELECT public.governance_teardown_batch($1,$2,$3,$4,$5,$6,$7) AS result",
        [ctx.organizationId,ctx.jobId,ctx.lifecycleFence,ctx.leaseToken,input.phase,input.cursor,input.limit],
      );
      const result = rows[0]?.result;
      if (!result || typeof result.done !== "boolean" || !Array.isArray(result.blobReferences))
        throw Error("INVALID_TEARDOWN_BATCH_RESULT");
      return result;
    },
  };
}
