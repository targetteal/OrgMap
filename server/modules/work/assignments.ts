import type { Ctx, NotificationPublisher } from "../../src/runtime.js";
import { fail, id, Failure, uuid } from "../../src/core.js";
import type {
  RoleCapacityPort,
  CurrentRoleCapacity,
  RoleCapacityOrigin,
} from "../structure/profile-capacity-contract.js";
export type TaskPrincipal =
  { kind: "MEMBER"; memberId: string } | { kind: "ROLE"; roleId: string };
type TaskRow = {
  id: string;
  project_id: string | null;
  creator_id: string;
  archived?: boolean;
};
type TaskAssignmentScope = Omit<TaskRow, 'id'>;
export type AssigneeReason =
  | { kind: "DIRECT" }
  | {
      kind: "ROLE_CAPACITY";
      roleId: string;
      origins: readonly RoleCapacityOrigin[];
    };
export type AssignmentProjection = {
  principals: TaskPrincipal[];
  resolvedAssignees: { memberId: string; reasons: AssigneeReason[] }[];
  roleCapacities: (
    | { roleId: string; state: "UNAVAILABLE" }
    | {
        roleId: string;
        circleId: string;
        roleVersion: number;
        authorizationRevision: number;
        asOf: string;
        state: "VACANT" | "OCCUPIED";
        occupantCount: number;
        eligibleCount: number;
      }
  )[];
  coverage:
    | "CURRENT_WORK_AUTHORIZED_CAPACITY"
    | "ROLE_CAPACITY_UNAVAILABLE"
    | "REDACTED";
};
export function parseTaskPrincipals(body: Record<string, unknown>): {
  principals: TaskPrincipal[];
  legacy: boolean;
} {
  const fields = ["principals", "memberIds", "assigneeIds"].filter(
    (key) => body[key] !== undefined,
  );
  if (fields.length !== 1) fail(400, "INVALID_ASSIGNMENT_PRINCIPALS");
  const raw = body[fields[0]],
    legacy = fields[0] !== "principals";
  if (!Array.isArray(raw) || raw.length > 100)
    fail(400, "INVALID_ASSIGNMENT_PRINCIPALS");
  const principals: TaskPrincipal[] = (raw as unknown[]).map((value) => {
    if (legacy) return { kind: "MEMBER", memberId: id(value).toLowerCase() };
    if (!value || typeof value !== "object" || Array.isArray(value))
      return fail(400, "INVALID_ASSIGNMENT_PRINCIPALS");
    const principal = value as Record<string, unknown>;
    if (
      principal.kind === "MEMBER" &&
      Object.keys(principal).every((k) => ["kind", "memberId"].includes(k))
    )
      return { kind: "MEMBER", memberId: id(principal.memberId).toLowerCase() };
    if (
      principal.kind === "ROLE" &&
      Object.keys(principal).every((k) => ["kind", "roleId"].includes(k))
    )
      return { kind: "ROLE", roleId: id(principal.roleId).toLowerCase() };
    return fail(400, "INVALID_ASSIGNMENT_PRINCIPALS");
  });
  const seen = new Set<string>();
  return {
    principals: principals.filter((principal) => {
      const key =
        principal.kind +
        ":" +
        (principal.kind === "MEMBER" ? principal.memberId : principal.roleId);
      if (seen.has(key)) {
        if (!legacy) fail(400, "DUPLICATE_ASSIGNMENT_PRINCIPAL");
        return false;
      }
      seen.add(key);
      return true;
    }),
    legacy,
  };
}
export async function taskPrincipals(
  ctx: Ctx,
  taskId: string,
): Promise<TaskPrincipal[]> {
  const members = (
    await ctx.c.query(
      "SELECT member_id FROM work_assignments WHERE organization_id=$1 AND task_id=$2 ORDER BY member_id",
      [ctx.org.id, id(taskId)],
    )
  ).rows;
  const roles = (
    await ctx.c.query(
      "SELECT role_id FROM work_role_assignments WHERE organization_id=$1 AND task_id=$2 ORDER BY role_id",
      [ctx.org.id, taskId],
    )
  ).rows;
  return [
    ...members.map((row) => ({
      kind: "MEMBER" as const,
      memberId: row.member_id,
    })),
    ...roles.map((row) => ({ kind: "ROLE" as const, roleId: row.role_id })),
  ];
}
/** Target-person read intersection, entirely in Work/Foundation; assignment is never a grant. */
export async function readableMembers(
  ctx: Ctx,
  t: TaskAssignmentScope,
  members: readonly string[],
) {
  if (!members.length) return new Set<string>();
  if (t.archived) return new Set<string>();
  const rows = (
    await ctx.c.query(
      `SELECT m.id FROM members m LEFT JOIN work_projects p ON p.organization_id=m.organization_id AND p.id=$3 WHERE m.organization_id=$1 AND m.id=ANY($2::uuid[]) AND m.status='ACTIVE' AND m.member_type='MEMBER' AND (($3::uuid IS NULL AND m.id=$4) OR (NOT p.archived AND (p.visibility='PUBLIC' OR EXISTS(SELECT 1 FROM work_access a WHERE a.organization_id=$1 AND a.project_id=p.id AND a.member_id=m.id))))`,
      [ctx.org.id, [...new Set(members)], t.project_id, t.creator_id],
    )
  ).rows;
  return new Set<string>(rows.map((row) => row.id));
}
export async function requireRoleCapacity(
  ctx: Ctx,
  roleId: string,
  port?: RoleCapacityPort,
): Promise<CurrentRoleCapacity> {
  if (!port) fail(503, "ROLE_CAPACITY_UNAVAILABLE");
  const canonical = id(roleId).toLowerCase(),
    result = await port!.resolveRoleCapacity(ctx, { roleId: canonical });
  if (result.roleId !== canonical || !Array.isArray(result.occupants))
    fail(503, "ROLE_CAPACITY_INVALID_RESULT");
  return result;
}
/** Caller must authorize the exact current task before reading its principals. No cross-request snapshot cache. */
export async function resolveTaskAssignments(
  ctx: Ctx,
  t: TaskRow,
  port?: RoleCapacityPort,
): Promise<AssignmentProjection> {
  if (ctx.member.member_type === "GUEST")
    return {
      principals: [],
      resolvedAssignees: [],
      roleCapacities: [],
      coverage: "REDACTED",
    };
  const principals = await taskPrincipals(ctx, t.id),
    people = new Map<string, AssigneeReason[]>(),
    roleCapacities: AssignmentProjection["roleCapacities"] = [];
  const add = (memberId: string, reason: AssigneeReason) =>
    people.set(memberId, [...(people.get(memberId) ?? []), reason]);
  const direct = principals.flatMap((p) =>
      p.kind === "MEMBER" ? [p.memberId] : [],
    ),
    directReadable = await readableMembers(ctx, t, direct);
  for (const memberId of directReadable) add(memberId, { kind: "DIRECT" });
  for (const principal of principals) {
    if (principal.kind !== "ROLE") continue;
    let capacity: CurrentRoleCapacity;
    try {
      capacity = await requireRoleCapacity(ctx, principal.roleId, port);
    } catch (error) {
      if (
        (error instanceof Failure &&
          [403, 404, 409, 503].includes(error.status)) ||
        !port
      ) {
        roleCapacities.push({ roleId: principal.roleId, state: "UNAVAILABLE" });
        continue;
      }
      throw error;
    }
    const readable = await readableMembers(
      ctx,
      t,
      capacity.occupants.map((person) => id(person.memberId)),
    );
    for (const person of capacity.occupants)
      if (readable.has(person.memberId))
        add(person.memberId, {
          kind: "ROLE_CAPACITY",
          roleId: principal.roleId,
          origins: person.origins,
        });
    roleCapacities.push({
      roleId: principal.roleId,
      circleId: capacity.circleId,
      roleVersion: capacity.roleVersion,
      authorizationRevision: capacity.authorizationRevision,
      asOf: capacity.asOf,
      state: capacity.occupants.length ? "OCCUPIED" : "VACANT",
      occupantCount: capacity.occupants.length,
      eligibleCount: readable.size,
    });
  }
  return {
    principals,
    resolvedAssignees: [...people]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([memberId, reasons]) => ({ memberId, reasons })),
    roleCapacities,
    coverage: roleCapacities.some((role) => role.state === "UNAVAILABLE")
      ? "ROLE_CAPACITY_UNAVAILABLE"
      : "CURRENT_WORK_AUTHORIZED_CAPACITY",
  };
}
export async function validateTaskPrincipals(
  ctx: Ctx,
  t: TaskAssignmentScope,
  principals: TaskPrincipal[],
  port?: RoleCapacityPort,
) {
  for (const principal of principals) {
    if (principal.kind === "ROLE") {
      await requireRoleCapacity(ctx, principal.roleId, port);
      continue;
    }
    const member = (
      await ctx.c.query(
        "SELECT id FROM members WHERE organization_id=$1 AND id=$2 AND status='ACTIVE' AND member_type='MEMBER'",
        [ctx.org.id, principal.memberId],
      )
    ).rows[0];
    if (!member) fail(404, "RESOURCE_NOT_FOUND");
    if (
      !(await readableMembers(ctx, t, [principal.memberId])).has(
        principal.memberId,
      )
    )
      fail(
        422,
        t.project_id ? "ASSIGNEE_REQUIRES_ACCESS" : "PERSONAL_TASK_PRIVATE",
      );
  }
}
export async function storeTaskPrincipals(
  ctx: Ctx,
  taskId: string,
  principals: TaskPrincipal[],
  notify?: NotificationPublisher,
  roleCapacity?: RoleCapacityPort,
) {
  const task=notify?(await ctx.c.query("SELECT * FROM work_tasks WHERE organization_id=$1 AND id=$2",[ctx.org.id,taskId])).rows[0]:null;
  const previous=task?new Set((await resolveTaskAssignments(ctx,task,roleCapacity)).resolvedAssignees.map(person=>person.memberId)):new Set<string>();
  await ctx.c.query(
    "DELETE FROM work_assignments WHERE organization_id=$1 AND task_id=$2",
    [ctx.org.id, taskId],
  );
  await ctx.c.query(
    "DELETE FROM work_role_assignments WHERE organization_id=$1 AND task_id=$2",
    [ctx.org.id, taskId],
  );
  for (const principal of principals)
    await ctx.c.query(
      principal.kind === "MEMBER"
        ? "INSERT INTO work_assignments(organization_id,task_id,member_id) VALUES($1,$2,$3)"
        : "INSERT INTO work_role_assignments(organization_id,task_id,role_id) VALUES($1,$2,$3)",
      [
        ctx.org.id,
        taskId,
        principal.kind === "MEMBER" ? principal.memberId : principal.roleId,
      ],
    );
  if(task && notify){
    const assigned=(await resolveTaskAssignments(ctx,task,roleCapacity)).resolvedAssignees.filter(person=>!previous.has(person.memberId));
    if(assigned.length){
      const project=task.project_id?(await ctx.c.query("SELECT title FROM work_projects WHERE organization_id=$1 AND id=$2",[ctx.org.id,task.project_id])).rows[0]:null;
      await notify(ctx,{eventId:uuid(),event:"TaskAssigned",ref:{type:"task",id:taskId},recipients:assigned.map(person=>({memberId:person.memberId,nominal:true})),context:{resourceTitle:task.title,excerpt:task.description?.slice(0,500),details:[...(project?[{key:"project" as const,value:project.title}]:[]),...(task.ends_at?[{key:"dueAt" as const,value:new Date(task.ends_at).toISOString()}]:[]),{key:"status",value:task.status}]}});
    }
  }
}
