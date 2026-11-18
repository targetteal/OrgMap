import type { Ctx } from "../../src/runtime.js";
import { fail, id } from "../../src/core.js";
import { memberProfilePage, type ProfileCoverage, type MemberProfileAuthority } from "../../src/member-profile-pagination.js";
import type { RoleCapacityPort } from "../structure/profile-capacity-contract.js";
import { resolveTaskAssignments } from "./assignments.js";

/** Relations are assembled only from Work resources readable by the viewer. */
export async function memberProjects(
  ctx: Ctx, memberId: string, query: Record<string, unknown>,
  authority?: MemberProfileAuthority, roleCapacity?: RoleCapacityPort,
) {
  const target = id(memberId).toLowerCase();
  if (!authority) fail(503, "MEMBER_PROFILE_AUTHORITY_UNAVAILABLE");
  if (ctx.member.member_type === "GUEST") fail(404, "RESOURCE_NOT_FOUND");
  await authority!(ctx, target);
  const projects = (await ctx.c.query(
    `SELECT p.id,p.title,p.frozen,p.creator_id, a.member_id AS participant
       FROM work_projects p
       LEFT JOIN work_access viewer ON viewer.organization_id=p.organization_id AND viewer.project_id=p.id AND viewer.member_id=$2
       LEFT JOIN work_access a ON a.organization_id=p.organization_id AND a.project_id=p.id AND a.member_id=$3
      WHERE p.organization_id=$1 AND NOT p.archived AND (p.visibility='PUBLIC' OR viewer.member_id IS NOT NULL)
      ORDER BY p.id LIMIT 5001`, [ctx.org.id, ctx.member.id, target],
  )).rows;
  if (projects.length > 5000) fail(503, "MEMBER_PROFILE_SELECTION_LIMIT");
  const visible = new Map(projects.map((project) => [project.id, project]));
  const reasons = new Map<string, Set<"PROJECT_PARTICIPANT" | "TASK_ASSIGNEE">>();
  const add = (projectId: string, reason: "PROJECT_PARTICIPANT" | "TASK_ASSIGNEE") => {
    const set = reasons.get(projectId) ?? new Set(); set.add(reason); reasons.set(projectId, set);
  };
  for (const project of projects) if (project.creator_id === target || project.participant) add(project.id, "PROJECT_PARTICIPANT");
  const tasks = (await ctx.c.query(
    `SELECT t.id,t.project_id,t.creator_id,t.archived FROM work_tasks t
       JOIN work_projects p ON p.organization_id=t.organization_id AND p.id=t.project_id
       LEFT JOIN work_access viewer ON viewer.organization_id=p.organization_id AND viewer.project_id=p.id AND viewer.member_id=$2
      WHERE t.organization_id=$1 AND NOT t.archived AND NOT p.archived
        AND (p.visibility='PUBLIC' OR viewer.member_id IS NOT NULL)
        AND (EXISTS (SELECT 1 FROM work_assignments a WHERE a.organization_id=t.organization_id AND a.task_id=t.id AND a.member_id=$3)
          OR EXISTS (SELECT 1 FROM work_role_assignments a WHERE a.organization_id=t.organization_id AND a.task_id=t.id))
      ORDER BY t.id LIMIT 5001`, [ctx.org.id, ctx.member.id, target],
  )).rows;
  if (tasks.length > 5000) fail(503, "MEMBER_PROFILE_SELECTION_LIMIT");
  let partial = false;
  for (const task of tasks) {
    const assignments = await resolveTaskAssignments(ctx, task, roleCapacity);
    if (assignments.coverage === "ROLE_CAPACITY_UNAVAILABLE") partial = true;
    if (assignments.resolvedAssignees.some((person) => person.memberId === target)) add(task.project_id, "TASK_ASSIGNEE");
  }
  const items = [...reasons.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([projectId, found]) => {
    const project = visible.get(projectId)!;
    return { id: project.id as string, title: project.title as string, href: `/projects/${project.id}`,
      status: project.frozen ? "FROZEN" : "ACTIVE", reasons: [...found].sort() };
  });
  const coverage: ProfileCoverage = { scope: "CURRENT_VIEWER_AUTHORIZED_RELATIONS",
    completeness: partial ? "PARTIAL" : "COMPLETE", limitations: partial ? ["ROLE_CAPACITY_UNAVAILABLE"] : [] };
  return memberProfilePage(ctx, target, "PROJECT", query, items, coverage);
}
