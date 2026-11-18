import type { Ctx, ModuleRuntime } from "../../src/runtime.js";
import { fail, id } from "../../src/core.js";
import type {
  CurrentRoleCapacity,
  RoleCapacityOrigin,
  RoleCapacityPort,
} from "./profile-capacity-contract.js";

/** Server-only resolver. Work owns task ACL; this snapshot confers no grant. */
export function createRoleCapacityPort(core: ModuleRuntime): RoleCapacityPort {
  return {
    async resolveRoleCapacity(
      ctx: Ctx,
      input: { roleId: string },
    ): Promise<CurrentRoleCapacity> {
      // Re-read membership: ctx.member may predate an earlier change in this UoW.
      const actor = (
        await ctx.c.query(
          "SELECT status,member_type FROM members WHERE organization_id=$1 AND id=$2 AND account_id=$3",
          [ctx.org.id, ctx.member.id, ctx.account.id],
        )
      ).rows[0];
      if (!actor || actor.status !== "ACTIVE" || actor.member_type !== "MEMBER")
        fail(403, "ACTION_DENIED");
      const role = await core.get(ctx.c, ctx.org.id, id(input.roleId), "ROLE");
      await core.get(ctx.c, ctx.org.id, role.parent_id, "CIRCLE");
      const snapshot = (
        await ctx.c.query(
          "SELECT authorization_revision,to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD\"T\"HH24:MI:SS.US\"Z\"') AS as_of FROM organizations WHERE id=$1",
          [ctx.org.id],
        )
      ).rows[0];
      const rows = (
        await ctx.c.query(
          `SELECT o.member_id,o.source,o.id,o.kind,
          to_char(o.starts_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS starts_at,
          to_char(o.ends_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS ends_at
        FROM (
          SELECT organization_id,id,member_id,role_id,kind,starts_at,ends_at,NULL::timestamptz ended_at,'OCCUPANCY'::text source FROM occupancies
          UNION ALL
          SELECT organization_id,id,member_id,role_id,kind,starts_at,ends_at,ended_at,'MANDATE'::text source FROM structure_mandates
        ) o JOIN members m ON m.organization_id=o.organization_id AND m.id=o.member_id
        WHERE o.organization_id=$1 AND o.role_id=$2 AND m.status='ACTIVE' AND m.member_type='MEMBER'
          AND o.starts_at<=$3::timestamptz AND (o.ends_at IS NULL OR o.ends_at>$3::timestamptz)
          AND (o.ended_at IS NULL OR o.ended_at>$3::timestamptz)
        ORDER BY o.member_id,o.source,o.id`,
          [ctx.org.id, role.id, snapshot.as_of],
        )
      ).rows;
      const occupants = new Map<string, RoleCapacityOrigin[]>();
      for (const row of rows) {
        const origins = occupants.get(row.member_id) ?? [];
        origins.push({
          source: row.source,
          sourceId: row.id,
          kind: row.kind,
          startsAt: row.starts_at,
          endsAt: row.ends_at,
        });
        occupants.set(row.member_id, origins);
      }
      return {
        roleId: role.id,
        circleId: role.parent_id,
        roleVersion: role.version,
        authorizationRevision: Number(snapshot.authorization_revision),
        asOf: snapshot.as_of,
        occupants: [...occupants].map(([memberId, origins]) => ({
          memberId,
          origins,
        })),
      };
    },
  };
}
