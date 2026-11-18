import type { Ctx, ModuleRuntime } from "../../src/runtime.js";
import type { GuestAccessAdapter } from "../../src/guest-contract.js";
import { id, camel, Failure } from "../../src/core.js";
import { authorizedProject, authorizedTask } from "./index.js";
export type WorkGuestPort = Pick<
  ModuleRuntime,
  "requireGuestResource" | "guestResourceIds" | "assertModuleAvailable"
>;
export function createWorkGuestAccessAdapter(
  core: Pick<ModuleRuntime, "assertModuleAvailable">,
): GuestAccessAdapter {
  const base = "/api/v1/organizations/:organizationId/work";
  return {
    context: "work",
    routes: [
      {
        method: "GET",
        path: base + "/projects",
        action: "read",
        collection: true,
      },
      {
        method: "GET",
        path: base + "/tasks",
        action: "read",
        collection: true,
      },
      ...(["project", "task"] as const).map((kind) => ({
        method: "GET" as const,
        path:
          base +
          (kind === "project" ? "/projects/:projectId" : "/tasks/:taskId"),
        action: "read",
        resolve: async (_ctx: Ctx, r: any) => ({
          context: "work",
          kind,
          id: id(r.params[kind === "project" ? "projectId" : "taskId"]),
        }),
      })),
    ],
    async validateSharePlan(ctx, plan) {
      await core.assertModuleAvailable(ctx, "work");
      if (ctx.member.member_type === "GUEST" || ctx.member.status !== "ACTIVE")
        return false;
      try {
        for (const item of plan) {
          if (
            item.resource.context !== "work" ||
            !["project", "task"].includes(item.resource.kind) ||
            item.actions.some((a) => a !== "read")
          )
            return false;
          const p =
            item.resource.kind === "project"
              ? await authorizedProject(ctx, item.resource.id)
              : null;
          if (p) {
            if (p.access_role !== "MANAGER") return false;
          } else {
            const t = await authorizedTask(ctx, item.resource.id);
            if (t.project_id) {
              if (
                (await authorizedProject(ctx, t.project_id)).access_role !==
                "MANAGER"
              )
                return false;
            } else if (t.creator_id !== ctx.member.id) return false;
          }
        }
        return true;
      } catch (e) {
        if (e instanceof Failure && [403, 404].includes(e.status)) return false;
        throw e;
      }
    },
  };
}
export async function workGuestScope(ctx: Ctx, guest: WorkGuestPort) {
  return {
    projects: new Set(
      await guest.guestResourceIds(ctx, {
        context: "work",
        kind: "project",
        action: "read",
      }),
    ),
    tasks: new Set(
      await guest.guestResourceIds(ctx, {
        context: "work",
        kind: "task",
        action: "read",
      }),
    ),
  };
}
export function guestProjectRow(p: any) {
  return {
    id: p.id,
    title: p.title,
    description: p.description,
    description_rich: p.description_rich,
    visibility: p.visibility,
    views: p.views,
    version: p.version,
    frozen: p.frozen,
    default_done_section_id: p.default_done_section_id,
    access_role: null,
  };
}
export function guestTaskRow(
  t: any,
  scope: { projects: Set<string>; tasks: Set<string> },
) {
  const projectShared = scope.projects.has(t.project_id),
    parentShared = scope.tasks.has(t.parent_id);
  return {
    id: t.id,
    title: t.title,
    description: t.description,
    description_rich: t.description_rich,
    priority: t.priority,
    estimate_minutes: t.estimate_minutes,
    tags: t.tags,
    status: t.status,
    starts_at: t.starts_at,
    ends_at: t.ends_at,
    date_provenance: t.date_provenance,
    position: t.position,
    version: t.version,
    project_id: projectShared ? t.project_id : null,
    project_title: projectShared ? t.project_title : null,
    section_id: projectShared ? t.section_id : null,
    section_name: projectShared ? t.section_name : null,
    parent_id: parentShared ? t.parent_id : null,
    subtask_group_id: parentShared ? t.subtask_group_id : null,
    duplicate_of: scope.tasks.has(t.duplicate_of) ? t.duplicate_of : null,
    shared_read_only: true,
  };
}
export async function workGuestTasks(
  ctx: Ctx,
  guest: WorkGuestPort,
  pid?: string,
) {
  const scope = await workGuestScope(ctx, guest),
    rows = (
      await ctx.c.query(
        `SELECT t.*,p.title AS project_title,s.name AS section_name FROM work_tasks t LEFT JOIN work_projects p ON p.organization_id=t.organization_id AND p.id=t.project_id AND p.id=ANY($3::uuid[]) LEFT JOIN work_sections s ON s.organization_id=t.organization_id AND s.id=t.section_id AND s.project_id=p.id WHERE t.organization_id=$1 AND t.id=ANY($2::uuid[]) AND NOT t.archived AND NOT EXISTS (WITH RECURSIVE ancestors AS (SELECT id,parent_id,archived FROM work_tasks WHERE organization_id=$1 AND id=t.parent_id UNION SELECT x.id,x.parent_id,x.archived FROM work_tasks x JOIN ancestors a ON x.id=a.parent_id WHERE x.organization_id=$1) SELECT 1 FROM ancestors WHERE archived) AND ($4::uuid IS NULL OR t.project_id=$4) ORDER BY t.position,t.title,t.id`,
        [ctx.org.id, [...scope.tasks], [...scope.projects], pid ?? null],
      )
    ).rows;
  return rows.map((t) => guestTaskRow(t, scope));
}
export async function workGuestTaskDetail(
  ctx: Ctx,
  t: any,
  guest: WorkGuestPort,
) {
  const scope = await workGuestScope(ctx, guest),
    ids = [...scope.tasks],
    subtasks = (await workGuestTasks(ctx, guest)).filter(
      (x) => x.parent_id === t.id,
    ),
    deps = (
      await ctx.c.query(
        "SELECT * FROM work_dependencies WHERE organization_id=$1 AND (predecessor_id=$2 OR successor_id=$2) AND predecessor_id=ANY($3::uuid[]) AND successor_id=ANY($3::uuid[])",
        [ctx.org.id, t.id, ids],
      )
    ).rows,
    links = (
      await ctx.c.query(
        "SELECT * FROM work_links WHERE organization_id=$1 AND task_id=$2 AND target_task_id=ANY($3::uuid[])",
        [ctx.org.id, t.id, ids],
      )
    ).rows;
  return {
    task: camel(guestTaskRow(t, scope)),
    assignments: [],
    checklist: (
      await ctx.c.query(
        "SELECT id,title,done FROM work_checklist WHERE organization_id=$1 AND task_id=$2 ORDER BY id",
        [ctx.org.id, t.id],
      )
    ).rows.map(camel),
    dependencies: deps.map(camel),
    links: links.map(camel),
    groups: (
      await ctx.c.query(
        "SELECT id,name,position FROM work_subtask_groups WHERE organization_id=$1 AND parent_task_id=$2 ORDER BY position,id",
        [ctx.org.id, t.id],
      )
    ).rows.map(camel),
    subtasks: subtasks.map(camel),
    coverage: "EXPLICIT_TASK_GRANTS_ONLY",
    capabilities: { edit: false, assign: false },
  };
}
