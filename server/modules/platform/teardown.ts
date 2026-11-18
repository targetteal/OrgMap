import type { OrganizationTeardownParticipant } from "../../src/organization-lifecycle-contract.js";
/** Only the database maintenance function grants authority; does not remove blob bytes. */
export function createPlatformTeardownParticipant(): OrganizationTeardownParticipant {
  const ownedSets = [
    "platform_scope_wakes",
    "platform_worker_scopes",
    "platform_job_attempts",
    "platform_artifacts",
    "platform_jobs",
    "platform_deliveries",
    "platform_comments",
    "platform_files",
    "platform_views",
    "platform_favorites",
    "platform_preferences",
    "platform_policy",
    "platform_preference_revision",
    "platform_follows",
  ] as const;
  return {
    contextId: "platform",
    version: 1,
    describe: () => ({ ownedSets, after: [] }),
    async runBatch(ctx, input) {
      const row = (
        await ctx.c.query(
          "SELECT public.platform_teardown_batch($1,$2,$3,$4,$5,$6,$7) AS result",
          [
            ctx.organizationId,
            ctx.jobId,
            ctx.lifecycleFence,
            ctx.leaseToken,
            input.phase,
            input.cursor,
            input.limit,
          ],
        )
      ).rows[0];
      if (
        !row?.result ||
        typeof row.result.done !== "boolean" ||
        !Array.isArray(row.result.blobReferences)
      )
        throw Error("INVALID_TEARDOWN_BATCH_RESULT");
      return row.result;
    },
  };
}
