import type { OrganizationTeardownParticipant } from "../../src/organization-lifecycle-contract.js";

/** Database grants and 510 verify authority; creation of this object does not. */
export function createMeetingsTeardownParticipant(): OrganizationTeardownParticipant {
  const ownedSets = ["meeting_first_close_snapshots","meeting_statistics_observation","meeting_actions","meeting_participants","meeting_report_access","meeting_report_versions","meeting_reports","meeting_updates","meeting_tickets","meeting_document_epochs","meeting_documents","meeting_agenda","meeting_agenda_items","meeting_occurrences","meeting_series","meeting_templates","meeting_export_selections",
    "meeting_o2_panels","meeting_o2_processes","meeting_o2_treatments","meeting_o2_circle_templates","meeting_o2_reviews"] as const;
  return {
    contextId: "meetings", version: 1,
    describe: () => ({ ownedSets, after: [] }),
    async runBatch(ctx, input) {
      const { rows } = await ctx.c.query(
        "SELECT public.meetings_teardown_batch($1,$2,$3,$4,$5,$6,$7) AS result",
        [ctx.organizationId,ctx.jobId,ctx.lifecycleFence,ctx.leaseToken,input.phase,input.cursor,input.limit],
      );
      const result = rows[0]?.result;
      if (!result || typeof result.done !== "boolean" || !Array.isArray(result.blobReferences))
        throw Error("INVALID_TEARDOWN_BATCH_RESULT");
      return result;
    },
  };
}
