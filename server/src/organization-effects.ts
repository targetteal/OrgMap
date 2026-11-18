import type { PoolClient } from "pg";
import { fail, id, uuid } from "./core.js";
import { lockActiveOrganization, requireLifecycleReadCommitted } from "./organization-lifecycle.js";

export type EffectOwner = "IAM" | "PLATFORM" | "INTEROP";
export type EffectAuthorization = Readonly<{
  organizationId: string; id: string; fence: string; token: string;
}>;
/** Must authenticate and lock the owner's actual, unexpired source lease.
 * A callback is trusted application code, never constructed from request JSON.
 */
export type ValidateSourceLease = (c: PoolClient, sourceLeaseToken: string, lifecycleFence: string) => Promise<boolean>;

/** In the producer's transaction. Commit must precede network I/O. A duplicate
 * key with an unresolved/confirmed attempt fails; only a proven NOT_SENT or
 * REJECTED outcome allows a new source lease. No payload is stored.
 */
export async function authorizeOrganizationEffect(c: PoolClient, input: {
  organizationId: string; owner: EffectOwner; effectKey: string;
  sourceLeaseToken: string; validateSourceLease: ValidateSourceLease;
}): Promise<EffectAuthorization> {
  const organizationId = id(input.organizationId);
  if (!/^[a-zA-Z0-9:_-]{1,160}$/.test(input.effectKey) ||
      !["IAM", "PLATFORM", "INTEROP"].includes(input.owner)) fail(400, "INVALID_EFFECT");
  const org = await lockActiveOrganization(c, organizationId);
  const lifecycle = (await c.query("SELECT fence::text AS fence FROM organization_lifecycle WHERE organization_id=$1", [org.id])).rows[0];
  const lease = id(input.sourceLeaseToken);
  if (!(await input.validateSourceLease(c, lease, lifecycle.fence))) fail(409, "EFFECT_LEASE_INVALID");
  const effectId = uuid(), token = uuid();
  await c.query(`INSERT INTO organization_effects(organization_id,id,owner,effect_key,lifecycle_fence,source_lease_token,effect_token)
    VALUES($1,$2,$3,$4,$5,$6,$7)`, [org.id, effectId, input.owner, input.effectKey, lifecycle.fence, lease, token]);
  return { organizationId: org.id, id: effectId, fence: lifecycle.fence, token };
}

/** Record only an observed outcome, even if cutover occurred after authorization.
 * UNKNOWN and CONFIRMED block new authorization; only proven NOT_SENT or
 * explicit REJECTED permit a later attempt with a new source lease.
 * Caller validates the sender's receipt; this is not a maintenance credential.
 */
export async function recordOrganizationEffectOutcome(c: PoolClient, authorization: EffectAuthorization,
  outcome: "CONFIRMED" | "OUTCOME_UNKNOWN" | "NOT_SENT" | "REJECTED"): Promise<{ recorded: boolean; cutoverOccurred: boolean }> {
  if (!["CONFIRMED", "OUTCOME_UNKNOWN", "NOT_SENT", "REJECTED"].includes(outcome)) fail(400, "INVALID_EFFECT");
  // Lock Org without requiring ACTIVE: an already-authorized I/O may return later.
  await requireLifecycleReadCommitted(c);
  const org = (await c.query("SELECT id FROM organizations WHERE id=$1 FOR UPDATE", [id(authorization.organizationId)])).rows[0];
  if (!org) return { recorded: false, cutoverOccurred: true };
  const lifecycle = (await c.query("SELECT state, fence::text AS fence FROM organization_lifecycle WHERE organization_id=$1", [org.id])).rows[0];
  const cutoverOccurred = !lifecycle || lifecycle.state !== "ACTIVE" || lifecycle.fence !== authorization.fence;
  const result = await c.query(`UPDATE organization_effects SET state=$5,completed_at=clock_timestamp()
    WHERE organization_id=$1 AND id=$2 AND lifecycle_fence=$3::bigint AND effect_token=$4 AND state='AUTHORIZED'`,
    [org.id, id(authorization.id), authorization.fence, id(authorization.token), outcome]);
  return { recorded: result.rowCount === 1, cutoverOccurred };
}
