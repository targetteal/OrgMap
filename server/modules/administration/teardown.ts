import type { OrganizationTeardownParticipant } from "../../src/organization-lifecycle-contract.js";
/** SQL owns authorization, cursor/phase checks and row deletion; ctx is never an HTTP credential. */
export function createAdministrationTeardownParticipant(): OrganizationTeardownParticipant {
  const ownedSets = [
    "administration_assistant_commands",
    "administration_assistant_personal",
    "administration_assistant_workspace",
    "administration_feed_versions",
    "administration_feed_selections",
    "administration_feed_posts",
    "administration_indicator_consent_history",
    "administration_indicator_consents",
    "administration_indicator_consent_books",
    "administration_entry_acknowledgements",
    "administration_grants",
    "administration_schema_plans",
    "administration_group_members",
    "administration_group_relations",
    "administration_profile_relations",
    "administration_publications",
    "administration_revisions",
    "administration_records",
    "administration_settings_revisions",
    "administration_settings",
    "administration_credential_policy_revisions",
    "administration_credential_policies",
    "administration_admission_policy_revisions",
    "administration_admission_policies",
    "administration_upload_policy_revisions",
    "administration_upload_policies",
    "administration_branding_stages",
    "administration_branding_history",
    "administration_branding_commands",
    "administration_branding_gc",
    "administration_branding_assets",
  ] as const;
  return {
    contextId: "administration",
    version: 1,
    describe: () => ({ ownedSets, after: [] }),
    async runBatch(ctx, input) {
      const row = (
        await ctx.c.query(
          "SELECT public.administration_teardown_batch($1,$2,$3,$4,$5,$6,$7) AS result",
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
