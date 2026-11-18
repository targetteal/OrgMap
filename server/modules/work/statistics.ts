import type { Ctx, OrgMapModule } from "../../src/runtime.js";
import { fail } from "../../src/core.js";
import type { RoleCapacityPort } from "../structure/profile-capacity-contract.js";
import { resolveTaskAssignments } from "./assignments.js";
const states = ["TODO", "IN_PROGRESS", "BLOCKED", "DONE"];
export async function workActor(ctx: Ctx) {
  await ctx.c.query(
    "SELECT set_config('orgmap.work_actor_member_id',$1,true)",
    [ctx.member.id],
  );
}
export function workMonth(value: unknown, now = new Date()) {
  const month = value ?? now.toISOString().slice(0, 7);
  if (
    typeof month !== "string" ||
    !/^\d{4}-(0[1-9]|1[0-2])$/.test(month) ||
    +month.slice(0, 4) < 1900 ||
    +month.slice(0, 4) > 2100
  )
    fail(400, "INVALID_STATISTICS_PERIOD");
  const start = new Date(month + "-01T00:00:00.000Z"),
    end = new Date(start);
  end.setUTCMonth(end.getUTCMonth() + 1);
  if (start > now) fail(400, "FUTURE_STATISTICS_PERIOD");
  return {
    month,
    start: start.toISOString(),
    end: end.toISOString(),
    asOf: new Date(Math.min(+end, +now)).toISOString(),
    timezone: "UTC",
  };
}
export async function projectPeriodStatistics(
  ctx: Ctx,
  projectIds: string[],
  period: unknown,
  roleCapacity?: RoleCapacityPort,
) {
  const dbNow = (
    await ctx.c.query(
      "SELECT to_char(clock_timestamp() AT TIME ZONE 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS.US\"Z\"') AS instant",
    )
  ).rows[0].instant;
  const window = workMonth(period, new Date(dbNow));
  if (window.month === dbNow.slice(0, 7)) window.asOf = dbNow;
  const args = [ctx.org.id, projectIds, window.asOf];
  const tasks = (
    await ctx.c.query(
      `SELECT t.id,t.created_at,t.project_id,p.circle_id,o.status,o.archived,o.observed_at FROM work_tasks t JOIN work_projects p ON p.organization_id=t.organization_id AND p.id=t.project_id LEFT JOIN LATERAL (SELECT status,archived,observed_at FROM work_task_observations h WHERE h.organization_id=t.organization_id AND h.task_id=t.id AND h.observed_at<$3::timestamptz ORDER BY observed_at DESC,sequence DESC LIMIT 1)o ON true WHERE t.organization_id=$1 AND t.project_id=ANY($2::uuid[])`,
      args,
    )
  ).rows;
  const history = (
    await ctx.c.query(
      `SELECT h.task_id,h.kind,h.observed_at,h.actor_member_id,t.project_id,p.circle_id,h.observed_at<$3::timestamptz AS before_cutoff,(h.observed_at>=$4::timestamptz AND h.observed_at<$3::timestamptz) AS in_period FROM work_task_observations h JOIN work_tasks t ON t.organization_id=h.organization_id AND t.id=h.task_id JOIN work_projects p ON p.organization_id=t.organization_id AND p.id=t.project_id WHERE h.organization_id=$1 AND t.project_id=ANY($2::uuid[]) ORDER BY h.observed_at,h.sequence`,
      [...args, window.start],
    )
  ).rows;
  const firstObserved = history[0]?.observed_at
      ? new Date(history[0].observed_at).toISOString()
      : null,
    available =
      history.some((h) => h.before_cutoff) ||
      (tasks.length === 0 && window.month === dbNow.slice(0, 7)),
    snapshot = tasks.filter((t) => t.observed_at && !t.archived),
    activity = history.filter((h) => h.kind !== "BASELINE" && h.in_period),
    done = snapshot.filter((t) => t.status === "DONE").length;
  const projects = (
    await ctx.c.query(
      "SELECT circle_id FROM work_projects WHERE organization_id=$1 AND id=ANY($2::uuid[])",
      args.slice(0, 2),
    )
  ).rows;
  const circles = new Set(projects.map((t) => t.circle_id).filter(Boolean)),
    activeCircles = new Set(activity.map((h) => h.circle_id).filter(Boolean)),
    participants = (
      await ctx.c.query(
        `SELECT DISTINCT s.member_id FROM (SELECT creator_id AS member_id FROM work_projects WHERE organization_id=$1 AND id=ANY($2::uuid[]) UNION SELECT member_id FROM work_access WHERE organization_id=$1 AND project_id=ANY($2::uuid[]) UNION SELECT a.member_id FROM work_assignments a JOIN work_tasks t ON t.organization_id=a.organization_id AND t.id=a.task_id WHERE a.organization_id=$1 AND t.project_id=ANY($2::uuid[]))s JOIN members m ON m.organization_id=$1 AND m.id=s.member_id AND m.status='ACTIVE'`,
        args.slice(0, 2),
      )
    ).rows.map((r) => r.member_id),
    actors = new Set(activity.map((h) => h.actor_member_id).filter(Boolean)),
    knownParticipants = new Set(participants);
  let unknownRoleAssignments = 0;
  const roleTasks = (
    await ctx.c.query(
      "SELECT t.* FROM work_tasks t WHERE t.organization_id=$1 AND t.project_id=ANY($2::uuid[]) AND NOT t.archived AND EXISTS(SELECT 1 FROM work_role_assignments r WHERE r.organization_id=t.organization_id AND r.task_id=t.id)",
      args.slice(0, 2),
    )
  ).rows;
  for (const task of roleTasks) {
    const assignment = await resolveTaskAssignments(ctx, task, roleCapacity);
    for (const person of assignment.resolvedAssignees)
      knownParticipants.add(person.memberId);
    unknownRoleAssignments += assignment.roleCapacities.filter(
      (capacity) => capacity.state === "UNAVAILABLE",
    ).length;
  }
  const activeParticipants = [...actors].filter((actor) =>
    knownParticipants.has(actor),
  );
  return {
    period: window,
    totalProjects: projectIds.length,
    total: available ? snapshot.length : null,
    byStatus: Object.fromEntries(
      states.map((s) => [
        s,
        available ? snapshot.filter((t) => t.status === s).length : null,
      ]),
    ),
    completed: available ? done : null,
    completedPercent:
      available && snapshot.length ? (100 * done) / snapshot.length : null,
    created: available
      ? activity.filter((h) => h.kind === "CREATED").length
      : null,
    changes: available
      ? new Set(
          activity.filter((h) => h.kind === "CHANGED").map((h) => h.task_id),
        ).size
      : null,
    activeCircleRate:
      available && circles.size
        ? (100 * activeCircles.size) / circles.size
        : null,
    activeCircles: available ? activeCircles.size : null,
    circlesWithProjects: circles.size,
    activeUserRate:
      available && !unknownRoleAssignments && knownParticipants.size
        ? (100 * activeParticipants.length) / knownParticipants.size
        : null,
    activeParticipants:
      available && !unknownRoleAssignments ? activeParticipants.length : null,
    participants: unknownRoleAssignments ? null : knownParticipants.size,
    participantCoverage: unknownRoleAssignments
      ? "ROLE_CAPACITY_UNAVAILABLE"
      : "CURRENT_AUTHORIZED_CAPACITY",
    unknownRoleAssignments,
    coverage: {
      state: !available
        ? "UNAVAILABLE"
        : firstObserved && firstObserved >= window.start
          ? "PARTIAL"
          : "OBSERVED",
      firstObserved,
      unknownCreationDates: tasks.filter((t) => !t.created_at).length,
      unknownActivityActors: activity.filter((h) => !h.actor_member_id).length,
      scope: "CURRENT_AUTHORIZED_PROJECTS",
      personalTasksExcluded: true,
      notes:
        "Estado reconstruído até asOf a partir de observações reais; projetos e vínculos atuais delimitam o escopo. OBSERVED não prova histórico anterior à primeira observação. Atividade = criação/alteração de tarefa; migração BASELINE não conta. Taxa por círculo usa círculos dos projetos selecionados; taxa por usuário usa participantes atuais desses projetos, não todos os membros da organização.",
    },
  };
}
export function workStatisticsModule(
  listProjects: (ctx: Ctx) => Promise<{ id: string }[]>,
  roleCapacity?: RoleCapacityPort,
): OrgMapModule {
  return async (app, core) => {
    app.get("/api/v1/organizations/:organizationId/work/statistics", (r) =>
      core.tenant(r, { mode: "read" }, async (ctx) => {
        const q = r.query as Record<string, unknown>;
        if (Object.keys(q).some((k) => k !== "month"))
          fail(400, "INVALID_REQUEST");
        return projectPeriodStatistics(
          ctx,
          (await listProjects(ctx)).map((p) => p.id),
          q.month,
          roleCapacity,
        );
      }),
    );
  };
}
