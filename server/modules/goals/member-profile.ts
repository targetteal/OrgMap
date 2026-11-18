import type { Ctx } from "../../src/runtime.js";
import { fail, id } from "../../src/core.js";
import { memberProfilePage, type MemberProfileAuthority } from "../../src/member-profile-pagination.js";
import { goalAccess } from "./ports.js";

/** Goal ownership and assignments never grant the viewer access to the goal. */
export async function memberGoals(ctx: Ctx, memberId: string, query: Record<string, unknown>, authority?: MemberProfileAuthority) {
  const target = id(memberId).toLowerCase();
  if (!authority) fail(503, "MEMBER_PROFILE_AUTHORITY_UNAVAILABLE");
  if (ctx.member.member_type === "GUEST") fail(404, "RESOURCE_NOT_FOUND");
  await authority!(ctx, target);
  const candidates = (await ctx.c.query(
    `SELECT g.*,
       (g.owner_type='MEMBER' AND g.owner_id=$2 AND (g.owner_via_role_id IS NULL OR EXISTS (
         SELECT 1 FROM occupancies o WHERE o.organization_id=g.organization_id AND o.member_id=$2 AND o.role_id=g.owner_via_role_id AND o.starts_at<=now() AND (o.ends_at IS NULL OR o.ends_at>now())
       ))) AS is_owner,
       EXISTS(SELECT 1 FROM goal_assignments a WHERE a.organization_id=g.organization_id AND a.goal_id=g.id AND a.member_id=$2 AND a.key_result_id IS NULL AND a.functional_role IN ('LEAD','CONTRIBUTOR') AND (a.via_role_id IS NULL OR EXISTS(SELECT 1 FROM occupancies o WHERE o.organization_id=a.organization_id AND o.member_id=a.member_id AND o.role_id=a.via_role_id AND o.starts_at<=now() AND (o.ends_at IS NULL OR o.ends_at>now())))) AS goal_responsible,
       EXISTS(SELECT 1 FROM goal_assignments a JOIN goal_key_results k ON k.organization_id=a.organization_id AND k.goal_id=a.goal_id AND k.id=a.key_result_id WHERE a.organization_id=g.organization_id AND a.goal_id=g.id AND a.member_id=$2 AND NOT k.archived AND a.functional_role IN ('LEAD','CONTRIBUTOR') AND (a.via_role_id IS NULL OR EXISTS(SELECT 1 FROM occupancies o WHERE o.organization_id=a.organization_id AND o.member_id=a.member_id AND o.role_id=a.via_role_id AND o.starts_at<=now() AND (o.ends_at IS NULL OR o.ends_at>now())))) AS result_responsible
       FROM goals g WHERE g.organization_id=$1 AND g.lifecycle<>'ARCHIVED' ORDER BY g.id LIMIT 5001`,
    [ctx.org.id, target],
  )).rows;
  if (candidates.length > 5000) fail(503, "MEMBER_PROFILE_SELECTION_LIMIT");
  const items: Array<{ id: string; title: string; href: string; status: string; reasons: string[] }> = [];
  for (const goal of candidates) {
    if (!(goal.is_owner || goal.goal_responsible || goal.result_responsible)) continue;
    if (!(await goalAccess(ctx, goal))) continue;
    const reasons = [];
    if (goal.is_owner || goal.goal_responsible) reasons.push("GOAL_RESPONSIBLE");
    if (goal.result_responsible) reasons.push("RESULT_RESPONSIBLE");
    items.push({ id: goal.id, title: goal.title, href: `/goals/${goal.id}`, status: goal.lifecycle, reasons });
  }
  return memberProfilePage(ctx, target, "GOAL", query, items, {
    scope: "CURRENT_VIEWER_AUTHORIZED_RELATIONS", completeness: "COMPLETE", limitations: [],
  });
}
