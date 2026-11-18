import type { Ctx } from "../../src/runtime.js";
import { fail, id } from "../../src/core.js";
import type { RoleFunction } from "./contract.js";

type OccupancyInterval = {
  roleId: string;
  memberId: string;
  startsAt?: string;
  endsAt?: string | null;
};

/** Validate the proposed interval, including scheduled links, in the caller's tenant transaction. */
export async function validateOccupancyCompatibility(
  ctx: Ctx,
  input: OccupancyInterval,
  functionCode: RoleFunction,
): Promise<void> {
  const role = (
    await ctx.c.query(
      `SELECT r.parent_id,clock_timestamp() AS now
       FROM entities r
       JOIN entities c ON c.organization_id=r.organization_id AND c.id=r.parent_id
       JOIN members m ON m.organization_id=r.organization_id AND m.id=$3
       WHERE r.organization_id=$1 AND r.id=$2 AND r.kind='ROLE' AND NOT r.archived
         AND c.kind='CIRCLE' AND NOT c.archived AND m.status='ACTIVE'
         AND coalesce(to_jsonb(m)->>'member_type','MEMBER')='MEMBER'`,
      [ctx.org.id, id(input.roleId), id(input.memberId)],
    )
  ).rows[0];
  if (!role) fail(404, "RESOURCE_NOT_FOUND");

  if (
    (input.startsAt !== undefined && typeof input.startsAt !== "string") ||
    (input.endsAt !== undefined &&
      input.endsAt !== null &&
      typeof input.endsAt !== "string")
  )
    fail(422, "DOMAIN_INVARIANT");
  const start = new Date(input.startsAt ?? role.now);
  const end =
    input.endsAt === undefined || input.endsAt === null
      ? null
      : new Date(input.endsAt);
  if (
    !Number.isFinite(+start) ||
    (end && (!Number.isFinite(+end) || end <= start))
  )
    fail(422, "DOMAIN_INVARIANT");

  const incompatible =
    functionCode === "GUIDE"
      ? ["FACILITATOR", "REPRESENTATIVE"]
      : functionCode === "FACILITATOR" || functionCode === "REPRESENTATIVE"
        ? ["GUIDE"]
        : [];
  if (!incompatible.length) return;

  const conflict = await ctx.c.query(
    `SELECT 1
     FROM (
       SELECT organization_id,role_id,member_id,starts_at,ends_at,NULL::timestamptz AS ended_at
       FROM occupancies
       UNION ALL
       SELECT organization_id,role_id,member_id,starts_at,ends_at,ended_at
       FROM structure_mandates
     ) o
     JOIN entities r ON r.organization_id=o.organization_id AND r.id=o.role_id
     JOIN entities c ON c.organization_id=r.organization_id AND c.id=r.parent_id
     JOIN members m ON m.organization_id=o.organization_id AND m.id=o.member_id
     JOIN structure_model_functions f ON f.organization_id=r.organization_id AND f.role_id=r.id
     WHERE o.organization_id=$1 AND o.member_id=$2 AND r.parent_id=$3
       AND r.kind='ROLE' AND NOT r.archived AND c.kind='CIRCLE' AND NOT c.archived
       AND m.status='ACTIVE' AND coalesce(to_jsonb(m)->>'member_type','MEMBER')='MEMBER'
       AND f.function_code=ANY($6::text[])
       AND o.starts_at < coalesce($5::timestamptz,'infinity'::timestamptz)
       AND least(coalesce(o.ends_at,'infinity'::timestamptz),coalesce(o.ended_at,'infinity'::timestamptz)) > $4::timestamptz
       AND o.starts_at < least(coalesce(o.ends_at,'infinity'::timestamptz),coalesce(o.ended_at,'infinity'::timestamptz))
     LIMIT 1`,
    [
      ctx.org.id,
      id(input.memberId),
      role.parent_id,
      start.toISOString(),
      end?.toISOString() ?? null,
      incompatible,
    ],
  );
  if (conflict.rowCount) fail(422, "ROLE_INCOMPATIBILITY");
}

/** A proposal's circle cannot govern a document owned inside another circle. */
export async function validateGovernanceDocumentScope(
  ctx: Ctx,
  input: { circleId: string; documentId: string },
): Promise<void> {
  const circleId = id(input.circleId).toLowerCase();
  const owner = (
    await ctx.c.query(
      `SELECT e.id,e.kind,e.parent_id
       FROM gov_documents d
       JOIN entities e ON e.organization_id=d.organization_id AND e.id=d.owner_id
       JOIN entities c ON c.organization_id=d.organization_id AND c.id=$3
       WHERE d.organization_id=$1 AND d.id=$2 AND NOT d.archived AND NOT e.archived
         AND c.kind='CIRCLE' AND NOT c.archived`,
      [ctx.org.id, id(input.documentId), circleId],
    )
  ).rows[0];
  if (!owner) fail(404, "RESOURCE_NOT_FOUND");
  if (
    (owner.kind === "CIRCLE" && owner.id === circleId) ||
    (owner.kind === "ROLE" && owner.parent_id === circleId)
  )
    return;
  fail(422, "GOVERNANCE_CIRCLE_SCOPE");
}
