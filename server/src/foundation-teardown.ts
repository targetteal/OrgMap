import type { OrganizationTeardownParticipant } from "./organization-lifecycle-contract.js";
import { foundationDisposition } from "./organization-deletion-catalog.js";

/** Unregistered until a verified drain, mixed Account replay contract, and the
 * other owners' authoritative absence checks have all been installed. */
export function createFoundationTeardownParticipant(): OrganizationTeardownParticipant {
  return {
    contextId: "foundation", version: 1,
    describe: () => ({ ownedSets: foundationDisposition.tenantCandidate,
      after: ["administration", "platform", "structure", "governance", "work", "goals", "meetings", "interoperability"] }),
    async runBatch(ctx, input) {
      const { rows } = await ctx.c.query(
        "SELECT public.foundation_teardown_batch($1,$2,$3,$4,$5,$6,$7) AS result",
        [ctx.organizationId, ctx.jobId, ctx.lifecycleFence, ctx.leaseToken, input.phase, input.cursor, input.limit],
      );
      const result = rows[0]?.result;
      if (!result || typeof result.done !== "boolean" || !Array.isArray(result.blobReferences))
        throw Error("INVALID_TEARDOWN_BATCH_RESULT");
      return result;
    },
  };
}
