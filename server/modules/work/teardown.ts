import type { OrganizationTeardownParticipant } from "../../src/organization-lifecycle-contract.js";

/** Database grants and 510 verify authority; creation of this object does not. */
export function createWorkTeardownParticipant(): OrganizationTeardownParticipant {
  const ownedSets = ["work_assignments","work_dependencies","work_checklist","work_comments","work_links","work_role_assignments","work_task_observations","work_subtask_groups","work_tasks","work_access","work_layouts","work_created_projects","work_circle_provisioning","work_project_import_items","work_sections","work_projects","work_settings","work_templates","work_export_selections"] as const;
  return {
    contextId: "work", version: 1,
    describe: () => ({ ownedSets, after: [] }),
    async runBatch(ctx, input) {
      const { rows } = await ctx.c.query(
        "SELECT public.work_teardown_batch($1,$2,$3,$4,$5,$6,$7) AS result",
        [ctx.organizationId,ctx.jobId,ctx.lifecycleFence,ctx.leaseToken,input.phase,input.cursor,input.limit],
      );
      const result = rows[0]?.result;
      if (!result || typeof result.done !== "boolean" || !Array.isArray(result.blobReferences))
        throw Error("INVALID_TEARDOWN_BATCH_RESULT");
      return result;
    },
  };
}
