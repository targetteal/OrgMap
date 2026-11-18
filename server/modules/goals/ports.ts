import { guestGoalRead } from "./guest.js";
import type { ModuleRuntime } from "../../src/runtime.js";
import type { Ctx } from "../../src/runtime.js";
import type { ResourceAccessPort, ResourceAction } from "../platform/ports.js";
import { id, fail } from "../../src/core.js";
import type { ResourceRegistry } from "../platform/ports.js";
import type { GoalLinkResolver } from "./plugin.js";
export type GoalLookupPort = ResourceAccessPort & {
  lookup?: (
    ctx: Ctx,
    id: string,
  ) => Promise<{ id: string; title: string } | null>;
};
/** Owning contexts supply lookup by ID; no first-page search is used as a lookup. */
export function createRegistryGoalLinkResolver(
  registry: ResourceRegistry,
): GoalLinkResolver {
  return async (ctx, kind, rid) => {
    const port = registry.get(kind === "TASK" ? "task" : "project") as
      GoalLookupPort | undefined;
    if (!port || !(await port.authorize(ctx, rid, "read"))) return null;
    if (port.lookup) {
      const result = await port.lookup(ctx, rid);
      // A denied or vanished resource is omitted; the link grants no access.
      if (!result) return null;
      if (typeof result.title === "string" && result.title.trim()) return result;
    }
    return {
      id: rid,
      title: kind === "TASK" ? "Tarefa vinculada" : "Projeto vinculado",
      titleSource: "FALLBACK",
    };
  };
}
/** Current ACL is evaluated inside the caller's tenant transaction. No relation grants foreign-resource access. */
export async function goalAccess(
  ctx: Ctx,
  goal: any,
  write = false,
): Promise<boolean> {
  if (ctx.member.status !== "ACTIVE") return false;
  // Nominal ACL grants no Guest authority; owning adapters apply the explicit core grant gate.
  if (ctx.member.member_type === "GUEST") return false;
  if (ctx.member.org_role === "OWNER" && goal.privacy === "PUBLIC") return true;
  if (!write && goal.privacy === "PUBLIC") return true;
  const own = goal.owner_type === "MEMBER" && goal.owner_id === ctx.member.id;
  if (
    own &&
    (!goal.owner_via_role_id ||
      (
        await ctx.c.query(
          "SELECT 1 FROM occupancies WHERE organization_id=$1 AND member_id=$2 AND role_id=$3 AND starts_at<=now() AND (ends_at IS NULL OR ends_at>now())",
          [ctx.org.id, ctx.member.id, goal.owner_via_role_id],
        )
      ).rowCount)
  )
    return true;
  return Boolean(
    (
      await ctx.c.query(
        "SELECT 1 FROM goal_assignments a WHERE a.organization_id=$1 AND a.goal_id=$2 AND a.member_id=$3 AND (NOT $4 OR a.functional_role IN ('LEAD','CONTRIBUTOR')) AND (a.via_role_id IS NULL OR EXISTS(SELECT 1 FROM occupancies o WHERE o.organization_id=a.organization_id AND o.member_id=a.member_id AND o.role_id=a.via_role_id AND o.starts_at<=now() AND (o.ends_at IS NULL OR o.ends_at>now())))",
        [ctx.org.id, goal.id, ctx.member.id, write],
      )
    ).rowCount,
  );
}
/** Explicit goal leadership, rather than tenant administration, controls private management. */
export async function goalManageAccess(ctx: Ctx, g: any): Promise<boolean> {
  if (!(await goalAccess(ctx, g, true))) return false;
  if (g.privacy === "PUBLIC" && ctx.member.org_role === "OWNER") return true;
  if (
    g.owner_type === "MEMBER" &&
    g.owner_id === ctx.member.id &&
    (!g.owner_via_role_id ||
      (
        await ctx.c.query(
          "SELECT 1 FROM occupancies WHERE organization_id=$1 AND member_id=$2 AND role_id=$3 AND starts_at<=now() AND (ends_at IS NULL OR ends_at>now())",
          [ctx.org.id, ctx.member.id, g.owner_via_role_id],
        )
      ).rowCount)
  )
    return true;
  return Boolean(
    (
      await ctx.c.query(
        "SELECT 1 FROM goal_assignments a WHERE a.organization_id=$1 AND a.goal_id=$2 AND a.member_id=$3 AND a.functional_role='LEAD' AND (a.via_role_id IS NULL OR EXISTS(SELECT 1 FROM occupancies o WHERE o.organization_id=a.organization_id AND o.member_id=a.member_id AND o.role_id=a.via_role_id AND o.starts_at<=now() AND (o.ends_at IS NULL OR o.ends_at>now())))",
        [ctx.org.id, g.id, ctx.member.id],
      )
    ).rowCount,
  );
}
export function createGoalResourceAdapters(options: {guest?: Pick<ModuleRuntime,"requireGuestResource"|"guestResourceIds">} = {}): Record<
  "goal" | "key-result",
  GoalLookupPort
> {
  function adapter(kind: "goal" | "key-result"): GoalLookupPort {
    async function resource(ctx: Ctx, rid: string) {
      const rows =
        kind === "goal"
          ? await ctx.c.query(
              "SELECT * FROM goals WHERE organization_id=$1 AND id=$2",
              [ctx.org.id, id(rid)],
            )
          : await ctx.c.query(
              "SELECT g.*, k.id AS key_result_id,k.title AS key_result_title,k.description AS key_result_description,k.result_type,k.initial_value,k.current_value,k.target_value,k.unit,k.archived AS key_result_archived,k.version AS key_result_version FROM goal_key_results k JOIN goals g ON g.organization_id=k.organization_id AND g.id=k.goal_id WHERE k.organization_id=$1 AND k.id=$2",
              [ctx.org.id, id(rid)],
            );
      return rows.rows[0];
    }
    async function authorize(ctx: Ctx, rid: string, action: ResourceAction) {
      if (
        !["read", "comment", "attach", "export", "import", "follow"].includes(
          action,
        )
      )
        return false;
      const row = await resource(ctx, rid);
      if (!row) return false;
      if(ctx.member.member_type === "GUEST") return ctx.member.status === "ACTIVE" && action === "read" && !!options.guest && guestGoalRead(options.guest,ctx,kind,rid);
      if (action === "import") return false;
      if (["comment", "attach"].includes(action))
        return (
          row.lifecycle !== "ARCHIVED" &&
          !row.key_result_archived &&
          (await goalAccess(ctx, row, true))
        );
      return goalAccess(ctx, row);
    }
    return {
      authorize,
      async lookup(ctx, rid) {
        const r = await resource(ctx, rid);
        if (!r || !(await authorize(ctx,rid,"read"))) return null;
        return {
          id: rid,
          title: kind === "goal" ? r.title : r.key_result_title,
        };
      },
      async search(ctx, query, limit) {
        if (!Number.isInteger(limit) || limit < 1 || limit > 100)
          fail(400, "INVALID_REQUEST");
        const sharedIds = ctx.member.member_type === "GUEST"
          ? options.guest ? await options.guest.guestResourceIds(ctx,{context:"goals",kind,action:"read"}) : []
          : null;
        const rows =
          kind === "goal"
            ? (
                await ctx.c.query(
                  "SELECT id,title,description FROM goals WHERE organization_id=$1 AND ($3::uuid[] IS NULL OR id=ANY($3::uuid[])) AND position(lower($2) in lower(title))>0 ORDER BY title,id",
                  [ctx.org.id, query, sharedIds],
                )
              ).rows
            : (
                await ctx.c.query(
                  "SELECT id,title,description FROM goal_key_results WHERE organization_id=$1 AND ($3::uuid[] IS NULL OR id=ANY($3::uuid[])) AND position(lower($2) in lower(title))>0 AND NOT archived ORDER BY title,id",
                  [ctx.org.id, query, sharedIds],
                )
              ).rows;
        const result = [];
        for (const row of rows) {
          if (result.length >= limit) break;
          if (await authorize(ctx, row.id, "read"))
            result.push({
              type: kind,
              id: row.id,
              title: row.title,
              description: row.description,
            });
        }
        return result;
      },
      async export(ctx, ids, exportKind) {
        if (exportKind !== "RESOURCES" || ids.length > 1000)
          fail(400, "INVALID_REQUEST");
        const records = [];
        for (const rid of [...new Set(ids)]) {
          if (!(await authorize(ctx, rid, "export")))
            fail(404, "RESOURCE_NOT_FOUND");
          const r = await resource(ctx, rid);
          records.push(
            kind === "goal"
              ? {
                  schema: "orgmap-goal-v1",
                  id: r.id,
                  title: r.title,
                  description: r.description,
                  health: r.health,
                  lifecycle: r.lifecycle,
                  version: r.version,
                }
              : {
                  schema: "orgmap-key-result-v1",
                  id: r.key_result_id,
                  goalId: r.id,
                  title: r.key_result_title,
                  description: r.key_result_description,
                  resultType: r.result_type,
                  initialValue: r.initial_value,
                  currentValue: r.current_value,
                  targetValue: r.target_value,
                  unit: r.unit,
                  version: r.key_result_version,
                },
          );
        }
        return { records, coverage: "AUTHORIZED_SELECTION", estimated: false };
      },
    };
  }
  return { goal: adapter("goal"), "key-result": adapter("key-result") };
}
