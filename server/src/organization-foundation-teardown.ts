import type { OrganizationDeletionContext } from "./organization-lifecycle-contract.js";

/** Maintenance-only incremental revocation. This does not establish atomic cut
 * acceptance, account-method preflight, data minimization or quiescence. */
export async function expireOrganizationFederatedSessions(
  ctx: OrganizationDeletionContext, limit: number,
): Promise<{ expired: number; remaining: boolean }> {
  const row = (await ctx.c.query(
    "SELECT public.foundation_expire_federated_sessions($1,$2,$3,$4,$5) AS result",
    [ctx.organizationId,ctx.jobId,ctx.lifecycleFence,ctx.leaseToken,limit],
  )).rows[0]?.result;
  if (!row || !Number.isSafeInteger(row.expired) || row.expired < 0 || typeof row.remaining !== "boolean")
    throw Error("FOUNDATION_SESSION_BATCH_INVALID");
  return row;
}
