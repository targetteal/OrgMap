import { customFields, collectionCustomFields, collectionFieldDefinitions } from "./custom-fields.js";
import { createWorkNotifications } from "./notifications.js";
import { workProjectExtensions } from "./project-extensions.js";
import { workTaskViews } from "./task-views.js";
import type { WorkActivityPort } from "./activity-contract.js";
import { planningIntent, projectChecklists, freshProjectChecklists, externalLinks, projectSectionName } from "./project-content.js";
export type { WorkActivityPort } from "./activity-contract.js";
import type { RoleCapacityPort } from "../structure/profile-capacity-contract.js";
import { memberProjects } from "./member-profile.js";
import type { MemberProfileAuthority } from "../../src/member-profile-pagination.js";
import {
  taskPrincipals,
  resolveTaskAssignments,
  parseTaskPrincipals,
  validateTaskPrincipals,
  storeTaskPrincipals,
} from "./assignments.js";
import { taskProperties } from "./task-properties.js";
import type { CommentThreadPort } from "../platform/comments-contract.js";
import { listWorkTaskComments, requireWorkComments } from "./comment-thread.js";
import {
  guestProjectRow,
  workGuestTasks,
  workGuestTaskDetail,
  type WorkGuestPort,
} from "./guest.js";
import {
  richDescriptionBody,
  nextRichDescription,
  descriptionPlain,
} from "./content.js";
import {
  organizationExportModule,
  createOrganizationExportAdapter,
  type WorkExportComposition,
} from "./organization-export.js";
import { workActor, workStatisticsModule } from "./statistics.js";
import { workProjectImportModule } from "./project-import.js";
import type { OrgMapModule, ModuleRuntime, Ctx } from "../../src/runtime.js";
import type { FastifyRequest } from "fastify";
import {
  body,
  id,
  text,
  optionalText,
  uuid,
  fail,
  version,
  camel,
  event,
  Failure,
  key,
} from "../../src/core.js";
import type { ResourceAccessPort, ResourceAction } from "../platform/ports.js";
import { workTemplatesModule, createProjectDefinition } from "./templates.js";
import { ordered, previewSchedule } from "./domain.js";
import {
  workPolicyModule,
  workSettings,
  requireProjectConfigurationMutable,
  requireCircleProjectCapacity,
  canAssignProject,
} from "./policy.js";
const statuses = ["TODO", "IN_PROGRESS", "BLOCKED", "DONE"];
const projectViewProperties = ["state", "participants", "due", "progress"];
const enumValue = (v: unknown, values: string[]) => {
  if (typeof v !== "string" || !values.includes(v))
    fail(400, "INVALID_REQUEST");
  return v as string;
};
const nullableId = (v: unknown) => (v == null ? null : id(v));
/** Initial Work policy: active organization members may create a project or their own personal task. */
export function mayCreateWork(ctx: Ctx) {
  return (
    ctx.member.status === "ACTIVE" &&
    ctx.member.member_type !== "GUEST" &&
    ctx.member.organization_id === ctx.org.id &&
    ctx.member.account_id === ctx.account.id &&
    ["OWNER", "MEMBER"].includes(ctx.member.org_role)
  );
}
const date = (v: unknown) => {
  if (v == null || v === "") return null;
  if (
    typeof v !== "string" ||
    !/^\d{4}-\d\d-\d\dT/.test(v) ||
    !Number.isFinite(Date.parse(v))
  )
    fail(400, "INVALID_DATE");
  const day = (v as string).slice(0, 10);
  if (new Date(day + "T00:00:00.000Z").toISOString().slice(0, 10) !== day)
    fail(400, "INVALID_DATE");
  return new Date(v as string).toISOString();
};
const integer = (v: unknown, defaultValue = 0) => {
  if (v === undefined) return defaultValue;
  if (!Number.isSafeInteger(v) || Math.abs(v as number) > 5256000)
    fail(400, "INVALID_REQUEST");
  return v as number;
};
const boolean = (v: unknown) => {
  if (typeof v !== "boolean") fail(400, "INVALID_REQUEST");
  return v as boolean;
};
async function rows(ctx: Ctx, sql: string, args: any[] = []) {
  return (await ctx.c.query(sql, [ctx.org.id, ...args])).rows;
}
async function activeMember(ctx: Ctx, member: string) {
  if (
    !(
      await rows(
        ctx,
        "SELECT id FROM members WHERE organization_id=$1 AND id=$2 AND status='ACTIVE'",
        [id(member)],
      )
    ).length
  )
    fail(404, "RESOURCE_NOT_FOUND");
}
export type ProjectContextLink = { kind: 'CIRCLE' | 'ROLE' | 'PARTICIPANT' | 'FOLLOWER'; targetId: string };
export async function validateProjectContextLinks(ctx: Ctx, core: Pick<ModuleRuntime,'get'>, links: ProjectContextLink[]) {
  for (const link of links) {
    if (link.kind === 'CIRCLE' || link.kind === 'ROLE') await core.get(ctx.c, ctx.org.id, link.targetId, link.kind);
    else await activeMember(ctx, link.targetId);
  }
}
async function projectLead(ctx: Ctx, value: unknown) {
  if (value == null) return null;
  const memberId = id(value);
  if (!(await rows(ctx, "SELECT id FROM members WHERE organization_id=$1 AND id=$2 AND status='ACTIVE' AND member_type<>'GUEST'", [memberId])).length) fail(404, "RESOURCE_NOT_FOUND");
  return memberId;
}
async function project(
  ctx: Ctx,
  pid: string,
  write = false,
  manage = false,
  guest?: WorkGuestPort,
) {
  const p = (
    await rows(
      ctx,
      `SELECT p.*,a.role AS access_role FROM work_projects p LEFT JOIN work_access a ON a.organization_id=p.organization_id AND a.project_id=p.id AND a.member_id=$3 WHERE p.organization_id=$1 AND p.id=$2 AND NOT p.archived`,
      [id(pid), ctx.member.id],
    )
  )[0];
  if (ctx.member.member_type === "GUEST") {
    if (!p || write || manage || !guest) fail(404, "RESOURCE_NOT_FOUND");
    await guest!.requireGuestResource(
      ctx,
      { context: "work", kind: "project", id: p.id },
      "read",
    );
    return { ...p, access_role: null };
  }
  if (!p || (p.visibility === "PRIVATE" && !p.access_role))
    fail(404, "RESOURCE_NOT_FOUND");
  if (
    (manage && p.access_role !== "MANAGER") ||
    (write && !["MANAGER", "EDITOR"].includes(p.access_role))
  )
    fail(403, "ACTION_DENIED");
  if (write && p.frozen && !manage) fail(409, "PROJECT_FROZEN");
  if (write && manage) await requireProjectConfigurationMutable(ctx);
  return p;
}
async function task(
  ctx: Ctx,
  tid: string,
  write = false,
  guest?: WorkGuestPort,
) {
  const t = (
    await rows(
      ctx,
      "SELECT * FROM work_tasks WHERE organization_id=$1 AND id=$2 AND NOT archived",
      [id(tid)],
    )
  )[0];
  if (!t) fail(404, "RESOURCE_NOT_FOUND");
  if (t.parent_id && (await rows(ctx, `WITH RECURSIVE ancestors AS (SELECT id,parent_id,archived FROM work_tasks WHERE organization_id=$1 AND id=$2 UNION SELECT p.id,p.parent_id,p.archived FROM work_tasks p JOIN ancestors a ON p.id=a.parent_id WHERE p.organization_id=$1) SELECT 1 FROM ancestors WHERE archived LIMIT 1`, [t.parent_id])).length) fail(404, "RESOURCE_NOT_FOUND");
  if (ctx.member.member_type === "GUEST") {
    if (write || !guest) fail(404, "RESOURCE_NOT_FOUND");
    await guest!.requireGuestResource(
      ctx,
      { context: "work", kind: "task", id: t.id },
      "read",
    );
    return t;
  }
  if (t.project_id) await project(ctx, t.project_id, write);
  else if (t.creator_id !== ctx.member.id) fail(404, "RESOURCE_NOT_FOUND");
  return t;
}
async function accessibleTasks(ctx: Ctx, pid?: string, guest?: WorkGuestPort) {
  if (ctx.member.member_type === "GUEST") {
    if (!guest) fail(404, "RESOURCE_NOT_FOUND");
    if (pid) await project(ctx, pid, false, false, guest);
    return workGuestTasks(ctx, guest!, pid);
  }
  if (pid) await project(ctx, pid);
  const ts = await rows(
    ctx,
    `SELECT t.*,p.title AS project_title,s.name AS section_name,COALESCE(t.circle_id,p.circle_id) AS effective_circle_id FROM work_tasks t LEFT JOIN work_projects p ON p.organization_id=t.organization_id AND p.id=t.project_id LEFT JOIN work_sections s ON s.organization_id=t.organization_id AND s.id=t.section_id LEFT JOIN work_access a ON a.organization_id=p.organization_id AND a.project_id=p.id AND a.member_id=$2 WHERE t.organization_id=$1 AND NOT t.archived AND NOT EXISTS (WITH RECURSIVE ancestors AS (SELECT id,parent_id,archived FROM work_tasks WHERE organization_id=$1 AND id=t.parent_id UNION SELECT x.id,x.parent_id,x.archived FROM work_tasks x JOIN ancestors a ON x.id=a.parent_id WHERE x.organization_id=$1) SELECT 1 FROM ancestors WHERE archived) AND ((t.project_id IS NULL AND t.creator_id=$2) OR (NOT p.archived AND (p.visibility='PUBLIC' OR a.role IS NOT NULL))) ${pid ? "AND t.project_id=$3" : ""} ORDER BY t.position,t.title,t.id`,
    [ctx.member.id, ...(pid ? [pid] : [])],
  );
  const ids = new Set(ts.map((t) => t.id));
  return ts.map((t) => ({
    ...t,
    duplicate_of: ids.has(t.duplicate_of) ? t.duplicate_of : null,
  }));
}
async function accessibleProjects(ctx: Ctx, roleCapacity?: RoleCapacityPort) {
  const candidates = await rows(
    ctx,
    `SELECT p.*,a.role AS access_role FROM work_projects p LEFT JOIN work_access a ON a.organization_id=p.organization_id AND a.project_id=p.id AND a.member_id=$2 WHERE p.organization_id=$1 AND NOT p.archived AND (p.visibility='PUBLIC' OR a.role IS NOT NULL) ORDER BY p.title,p.id`,
    [ctx.member.id],
  );
  if ((await workSettings(ctx)).showAllUnassigned) return candidates;
  const result = [];
  for (const candidate of candidates) {
    if (candidate.access_role) {
      result.push(candidate);
      continue;
    }
    const tasks = await rows(
      ctx,
      "SELECT * FROM work_tasks WHERE organization_id=$1 AND project_id=$2 AND NOT archived",
      [candidate.id],
    );
    for (const t of tasks) {
      if (
        (
          await resolveTaskAssignments(ctx, t, roleCapacity)
        ).resolvedAssignees.some((person) => person.memberId === ctx.member.id)
      ) {
        result.push(candidate);
        break;
      }
    }
  }
  return result;
}
async function subtaskGroup(
  ctx: Ctx,
  parentId: string | null,
  groupId: unknown,
) {
  const gid = nullableId(groupId);
  if (!gid) return null;
  if (!parentId) fail(422, "SUBTASK_PARENT_REQUIRED");
  await task(ctx, id(parentId), true);
  if (
    !(
      await rows(
        ctx,
        "SELECT id FROM work_subtask_groups WHERE organization_id=$1 AND parent_task_id=$2 AND id=$3",
        [parentId, gid],
      )
    ).length
  )
    fail(404, "RESOURCE_NOT_FOUND");
  return gid;
}
async function sectionStatus(
  ctx: Ctx,
  p: any,
  sectionId: string | null,
  status: string,
  explicitStatus: boolean,
  old?: any,
) {
  let section = sectionId
    ? (
        await rows(
          ctx,
          "SELECT * FROM work_sections WHERE organization_id=$1 AND id=$2 AND project_id=$3",
          [sectionId, p.id],
        )
      )[0]
    : null;
  if (sectionId && !section) fail(404, "RESOURCE_NOT_FOUND");
  if (explicitStatus && status === "DONE" && section?.semantic !== "DONE") {
    const done = await rows(
      ctx,
      "SELECT * FROM work_sections WHERE organization_id=$1 AND project_id=$2 AND semantic='DONE' ORDER BY position",
      [p.id],
    );
    if (p.default_done_section_id)
      section = done.find((s) => s.id === p.default_done_section_id);
    else if (done.length === 1) section = done[0];
    else if (done.length > 1) fail(422, "DONE_SECTION_REQUIRED");
  } else if (section?.semantic === "DONE") status = "DONE";
  else if (
    old?.status === "DONE" &&
    old.section_id !== sectionId &&
    !explicitStatus
  )
    status = "TODO";
  return { sectionId: section?.id ?? null, status };
}
const nominalProject = project,
  nominalTask = task,
  nominalAccessibleTasks = accessibleTasks;
export type WorkOptions = WorkExportComposition & {
  publishNotification?: ModuleRuntime["publishNotification"];
  trace?: import('../../src/traceability.js').TraceabilityPort;
  requireMemberProfileRead?: MemberProfileAuthority;
  roleCapacity?: RoleCapacityPort;
  principalTransfers?: boolean;
  comments?: CommentThreadPort;
  guest?: WorkGuestPort;
  activity?: WorkActivityPort;
};
export function createWorkModule(options: WorkOptions = {}): OrgMapModule {
  return async (app, baseCore) => {
    options.publishNotification ??= baseCore.publishNotification;
    const notices=createWorkNotifications(baseCore);
    const core={...baseCore,changed:async(...args:Parameters<ModuleRuntime["changed"]>)=>{await baseCore.changed(...args);await notices.changed(args[0],args[2]);}};
    const guest = options.guest ?? core;
    const project = async (ctx: Ctx, pid: string, write = false, manage = false) => {
        const row=await nominalProject(ctx, pid, write, manage, guest);await notices.captureProject(ctx,row);return row;
      },
      task = (ctx: Ctx, tid: string, write = false) =>
        nominalTask(ctx, tid, write, guest),
      accessibleTasks = (ctx: Ctx, pid?: string) =>
        nominalAccessibleTasks(ctx, pid, guest);
    await organizationExportModule(options, {
      project,
      mayCreate: mayCreateWork,
    })(app, core);
    await workStatisticsModule(
      async (ctx) =>
        rows(
          ctx,
          "SELECT p.id FROM work_projects p LEFT JOIN work_access a ON a.organization_id=p.organization_id AND a.project_id=p.id AND a.member_id=$2 WHERE p.organization_id=$1 AND NOT p.archived AND (p.visibility='PUBLIC' OR a.role IS NOT NULL)",
          [ctx.member.id],
        ),
      options.roleCapacity,
    )(app, core);
    await workPolicyModule(app, core);
    await workTemplatesModule(app, core);
    await workProjectExtensions({ project, task, tasks: accessibleTasks, mayCreate: mayCreateWork, activity: options.activity })(app, core);
    await workTaskViews({ project, mayCreate: mayCreateWork, tasks: accessibleTasks })(app, core);
    await workProjectImportModule({
      mayCreate: mayCreateWork,
      authorizeProject: project,
    })(app, core);
    const base = "/api/v1/organizations/:organizationId/work";
    function route(
      method: "GET" | "POST" | "PATCH" | "DELETE",
      path: string,
      fn: (ctx: Ctx, r: FastifyRequest) => Promise<any>,
      authorize?: (ctx: Ctx, r: FastifyRequest) => Promise<boolean>,
    ) {
      app.route({
        method,
        url: base + path,
        handler: async (r, reply) => {
          const result = await core.tenant(
            r,
            method === "GET"
              ? { mode: "read" }
              : {
                  mode: "write",
                  authorize: (ctx) => (authorize ? authorize(ctx, r) : false),
                },
            async (ctx) => {
              if (method !== "GET") await workActor(ctx);
              return fn(ctx, r);
            },
          );
          if(typeof result.data?.task?.sourceTensionId==='string') {
            const sourceId=result.data.task.sourceTensionId;
            const visible=await core.tenant(r,{mode:'read'},async ctx=>ctx.member.member_type!=='GUEST' && !!options.trace && !!await options.trace.tension(ctx,sourceId));
            if(!visible.data)result.data.task.sourceTensionId=null;
          }
          // Old command results predate the Work-owned creation index. Revalidate their
          // resource ACL before returning a cached private representation. This second
          // guarded transaction is read-only and starts only after the command commits.
          if (
            method === "POST" &&
            path === "/projects" &&
            result.data?.project?.id
          )
            await core.tenant(r, { mode: "read" }, async (ctx) => {
              await project(ctx, result.data.project.id);
              return null;
            });
          const fixedCreate =
            method === "POST" &&
            [
              "/projects",
              "/tasks",
              "/projects/:projectId/sections",
              "/tasks/:taskId/groups",
              "/tasks/:taskId/comments",
              "/tasks/:taskId/duplicate",
            ].includes(path);
          const checklistCreate =
            method === "POST" &&
            path === "/tasks/:taskId/checklist" &&
            !(r.body as any)?.itemId;
          const status =
            result.data?.__workHttpStatus ??
            (fixedCreate || checklistCreate ? 201 : 200);
          if (result.data?.__workHttpStatus !== undefined) {
            const { __workHttpStatus, ...data } = result.data;
            return reply.code(status).send({ ...result, data });
          }
          return reply.code(status).send(result);
        },
      });
    }
    const params = (r: FastifyRequest) => r.params as Record<string, string>;
    const projectAuth =
      (manage = false) =>
      async (ctx: Ctx, r: FastifyRequest) => {
        await project(ctx, params(r).projectId, true, manage);
        return true;
      };
    const taskAuth = async (ctx: Ctx, r: FastifyRequest) => {
      await task(ctx, params(r).taskId, true);
      return true;
    };
    route("GET", "/members/:memberId/projects", (ctx, r) =>
      memberProjects(ctx, params(r).memberId, r.query as Record<string, unknown>, options.requireMemberProfileRead, options.roleCapacity));
    route("GET", "/layout", async (ctx, r) => {
      const q = r.query as Record<string, unknown>;
      if (Object.keys(q).some((k) => k !== "projectId"))
        fail(400, "INVALID_REQUEST");
      const pid = q.projectId ? id(q.projectId) : null,
        p = pid ? await project(ctx, pid) : null,
        scope = pid ? "PROJECT:" + pid : "PERSONAL";
      const saved = (
        await rows(
          ctx,
          "SELECT view,sort,grouping,version FROM work_layouts WHERE organization_id=$1 AND member_id=$2 AND scope=$3",
          [ctx.member.id, scope],
        )
      )[0];
      return {
        layout: saved
          ? {
              ...saved,
              view:
                p && !p.views.includes(saved.view) ? p.views[0] : saved.view,
            }
          : {
              view: p?.views[0] ?? "LIST",
              sort: "POSITION",
              grouping: "SECTION",
              version: 0,
            },
      };
    });
    route(
      "POST",
      "/layout",
      async (ctx, r) => {
        const b = body(r, ["projectId", "view", "sort", "grouping"]),
          pid = nullableId(b.projectId),
          p = pid ? await project(ctx, pid) : null,
          scope = pid ? "PROJECT:" + pid : "PERSONAL";
        const current = (
          await rows(
            ctx,
            "SELECT version FROM work_layouts WHERE organization_id=$1 AND member_id=$2 AND scope=$3",
            [ctx.member.id, scope],
          )
        )[0];
        version(r, current?.version ?? 0);
        const view = enumValue(b.view, [
          "LIST",
          "BOARD",
          "TIMELINE",
          "CALENDAR",
          "GALLERY",
        ]);
        if (p && !p.views.includes(view === "GALLERY" ? "LIST" : view)) fail(422, "VIEW_DISABLED");
        const sort = enumValue(b.sort, ["POSITION", "TITLE", "DUE"]),
          grouping = enumValue(b.grouping, ["SECTION", "STATUS", "PROJECT"]);
        const result = await ctx.c.query(
          "INSERT INTO work_layouts(organization_id,member_id,scope,project_id,view,sort,grouping,version) VALUES($1,$2,$3,$4,$5,$6,$7,1) ON CONFLICT(organization_id,member_id,scope) DO UPDATE SET view=excluded.view,sort=excluded.sort,grouping=excluded.grouping,version=work_layouts.version+1 RETURNING view,sort,grouping,version",
          [ctx.org.id, ctx.member.id, scope, pid, view, sort, grouping],
        );
        await core.changed(ctx, r, pid ?? ctx.member.id, "WorkLayoutSaved");
        return { layout: result.rows[0] };
      },
      async (ctx, r) => {
        const b = body(r, ["projectId", "view", "sort", "grouping"]);
        if (b.projectId) await project(ctx, id(b.projectId));
        if (b.projectId) await requireProjectConfigurationMutable(ctx);
        return mayCreateWork(ctx);
      },
    );
    async function bump(
      ctx: Ctx,
      r: FastifyRequest,
      tid: string,
      action: string,
    ) {
      await ctx.c.query(
        "UPDATE work_tasks SET version=version+1 WHERE organization_id=$1 AND id=$2",
        [ctx.org.id, tid],
      );
      await core.changed(ctx, r, tid, action);
      return camel(
        (
          await rows(
            ctx,
            "SELECT * FROM work_tasks WHERE organization_id=$1 AND id=$2",
            [tid],
          )
        )[0],
      );
    }
    route("GET", "/project-views", async (ctx) => {
      if (ctx.member.member_type === "GUEST") fail(404,"RESOURCE_NOT_FOUND");
      const saved=(await rows(ctx,"SELECT project_views,project_views_version FROM work_layouts WHERE organization_id=$1 AND member_id=$2 AND scope='PERSONAL'",[ctx.member.id]))[0];
      const views=saved?.project_views ?? [];
      const visible=views.some((view:any)=>view.orderIds?.length) ? new Set((await accessibleProjects(ctx,options.roleCapacity)).map((project:any)=>project.id)) : new Set<string>();
      return {views:views.map((view:any)=>({...view,visibleProperties:view.visibleProperties ?? projectViewProperties,archived:view.archived ?? false,...(Array.isArray(view.orderIds) ? {orderIds:view.orderIds.filter((id:string)=>visible.has(id))} : {})})),version:saved?.project_views_version ?? 0};
    });
    route("POST", "/project-views", async (ctx,r) => {
      if (!mayCreateWork(ctx)) fail(403,"ACTION_DENIED");
      await ctx.c.query("SELECT pg_advisory_xact_lock(hashtext($1),hashtext($2))",["work-project-views",ctx.member.id]);
      const current=(await rows(ctx,"SELECT project_views_version FROM work_layouts WHERE organization_id=$1 AND member_id=$2 AND scope='PERSONAL'",[ctx.member.id]))[0];
      version(r,current?.project_views_version ?? 0);
      const b=body(r,["views"]);
      if (!Array.isArray(b.views) || b.views.length > 20) fail(400,"INVALID_REQUEST");
      const views=b.views.map((item:any) => {
        if (!item || typeof item !== "object" || Object.keys(item).some((k)=>!["id","name","view","relevance","query","sort","stateFilter","tagFilter","grouping","personFilter","circleFilter","roleFilter","orderIds","visibleProperties","archived"].includes(k))) fail(400,"INVALID_REQUEST");
        if(item.archived !== undefined && typeof item.archived !== "boolean") fail(400,"INVALID_REQUEST");
        if (!Array.isArray(item.orderIds ?? []) || (item.orderIds ?? []).length>5000) fail(400,"INVALID_REQUEST");
        const orderIds=(item.orderIds ?? []).map(id);
        if(new Set(orderIds).size!==orderIds.length) fail(400,"INVALID_REQUEST");
        if(item.visibleProperties !== undefined && (!Array.isArray(item.visibleProperties) || item.visibleProperties.length>projectViewProperties.length)) fail(400,"INVALID_REQUEST");
        const visibleProperties=(item.visibleProperties ?? projectViewProperties).map((property:unknown)=>enumValue(property,projectViewProperties));
        if(new Set(visibleProperties).size!==visibleProperties.length) fail(400,"INVALID_REQUEST");
        return {id:id(item.id),name:text(item.name,100),view:enumValue(item.view,["LIST","BOARD","GALLERY"]),relevance:enumValue(item.relevance,["ALL","MINE","CIRCLES"]),query:optionalText(item.query,200) ?? "",sort:enumValue(item.sort,["TITLE","DUE","PROGRESS","MANUAL","PRIORITY"]),stateFilter:optionalText(item.stateFilter,80) ?? "",tagFilter:optionalText(item.tagFilter,50) ?? "",grouping:enumValue(item.grouping ?? "NONE",["NONE","STATE","CIRCLE","PERSON","ROLE","TAG","SECTION"]),personFilter:optionalText(item.personFilter,80) ?? "",circleFilter:optionalText(item.circleFilter,80) ?? "",roleFilter:optionalText(item.roleFilter,80) ?? "",orderIds,visibleProperties,archived:item.archived ?? false};
      });
      if (new Set(views.map((item:any)=>item.id)).size!==views.length) fail(400,"INVALID_REQUEST");
      // Descriptive references refine a personal view; they never confer Work access.
      // Resolve every supplied identity in this tenant before writing the JSON document.
      for (const view of views) {
        if (view.personFilter) await activeMember(ctx, id(view.personFilter));
        if (view.circleFilter) await core.get(ctx.c,ctx.org.id,id(view.circleFilter),"CIRCLE");
        if (view.roleFilter) await core.get(ctx.c,ctx.org.id,id(view.roleFilter),"ROLE");
      }
      const visible=views.some((view:any)=>view.orderIds.length) ? new Set((await accessibleProjects(ctx,options.roleCapacity)).map((project:any)=>project.id)) : new Set<string>();
      if(views.some((view:any)=>view.orderIds.some((id:string)=>!visible.has(id)))) fail(404,"RESOURCE_NOT_FOUND");
      const saved=(await rows(ctx,`INSERT INTO work_layouts(organization_id,member_id,scope,project_id,view,sort,grouping,version,project_views,project_views_version) VALUES($1,$2,'PERSONAL',NULL,'LIST','POSITION','SECTION',0,$3::jsonb,1) ON CONFLICT(organization_id,member_id,scope) DO UPDATE SET project_views=EXCLUDED.project_views,project_views_version=work_layouts.project_views_version+1 RETURNING project_views,project_views_version`,[ctx.member.id,JSON.stringify(views)]))[0];
      await core.changed(ctx,r,ctx.member.id,"ProjectViewsSaved");
      return {views:saved.project_views,version:saved.project_views_version};
    }, async (ctx) => mayCreateWork(ctx));
    route("GET", "/project-states", async (ctx) => {
      if (ctx.member.member_type === "GUEST") fail(404, "RESOURCE_NOT_FOUND");
      const row = (await rows(ctx, "SELECT project_states,version FROM work_settings WHERE organization_id=$1"))[0];
      return { states: row?.project_states ?? [], version: row?.version ?? 0, canManage: ctx.member.org_role === "OWNER" };
    });
    route("POST", "/project-states", async (ctx, r) => {
      if (ctx.member.org_role !== "OWNER" || ctx.member.member_type === "GUEST") fail(403, "ACTION_DENIED");
      await ctx.c.query("SELECT pg_advisory_xact_lock(hashtext($1),hashtext($2))", ["work-project-states", ctx.org.id]);
      const current = await workSettings(ctx); version(r, current.version);
      await requireProjectConfigurationMutable(ctx);
      const b = body(r, ["states"]);
      if (!Array.isArray(b.states) || b.states.length > 50) fail(400, "INVALID_REQUEST");
      const definitions = b.states.map((item: any) => {
        if (!item || typeof item !== "object" || Object.keys(item).some((k) => !["id","name","semantic"].includes(k))) fail(400, "INVALID_REQUEST");
        return {id: id(item.id), name: text(item.name,100), semantic: enumValue(item.semantic,statuses)};
      });
      if (new Set(definitions.map((item: any) => item.id)).size !== definitions.length) fail(400,"INVALID_REQUEST");
      const used = await rows(ctx,"SELECT DISTINCT project_state_id FROM work_projects WHERE organization_id=$1 AND project_state_id IS NOT NULL");
      if (used.some((item: any) => !definitions.some((state: any) => state.id === item.project_state_id))) fail(409,"STATE_IN_USE");
      const updated = (await rows(ctx, "INSERT INTO work_settings(organization_id,project_states,version) VALUES($1,$2::jsonb,1) ON CONFLICT(organization_id) DO UPDATE SET project_states=EXCLUDED.project_states,version=work_settings.version+1 RETURNING project_states,version", [JSON.stringify(definitions)]))[0];
      await core.changed(ctx,r,ctx.org.id,"ProjectStatesConfigured");
      return {states:updated.project_states,version:updated.version};
    }, async (ctx) => ctx.member.org_role === "OWNER" && ctx.member.member_type !== "GUEST");
    const projectBulkInput = (r: FastifyRequest) => {
      const b=body(r,["items","projectStateId","archive"]);
      if (!Array.isArray(b.items) || !b.items.length || b.items.length>100 || (b.projectStateId === undefined) === (b.archive === undefined)) fail(400,"INVALID_REQUEST");
      const items=b.items.map((item:any) => {
        if (!item || typeof item!=="object" || Object.keys(item).some((k)=>!["id","version"].includes(k)) || !Number.isSafeInteger(item.version) || item.version<1) fail(400,"INVALID_REQUEST");
        return {id:id(item.id),version:item.version as number};
      });
      if (new Set(items.map((item:any)=>item.id)).size!==items.length) fail(400,"INVALID_REQUEST");
      return {items, stateId:b.projectStateId === undefined ? undefined : nullableId(b.projectStateId), archive:b.archive === undefined ? undefined : boolean(b.archive)};
    };
    route("POST", "/projects/bulk", async (ctx,r) => {
      const input=projectBulkInput(r);
      await ctx.c.query("SELECT pg_advisory_xact_lock(hashtext($1),hashtext($2))",["work-project-states",ctx.org.id]);
      if (input.stateId) {
        const stateRow=(await rows(ctx,"SELECT project_states FROM work_settings WHERE organization_id=$1"))[0];
        if (!stateRow?.project_states.some((state:any)=>state.id===input.stateId)) fail(422,"INVALID_PROJECT_STATE");
      }
      const selected=[];
      for (const item of [...input.items].sort((a:any,b:any)=>a.id.localeCompare(b.id))) {
        const p=await project(ctx,item.id,true,true);
        if (p.version!==item.version) fail(409,"VERSION_CONFLICT");
        selected.push(p);
      }
      const updated=[];
      for (const p of selected) {
        const row=(await rows(ctx,"UPDATE work_projects SET project_state_id=$3,archived=$4,version=version+1 WHERE organization_id=$1 AND id=$2 AND version=$5 RETURNING *",[p.id,input.stateId === undefined ? p.project_state_id : input.stateId,input.archive ?? p.archived,p.version]))[0];
        if (!row) fail(409,"VERSION_CONFLICT");
        await core.changed(ctx,r,p.id,"ProjectBulkUpdated"); updated.push(camel(row));
      }
      return {projects:updated};
    }, async(ctx,r) => {for (const item of projectBulkInput(r).items) await project(ctx,item.id,true,true); return true;});
    // Archived records retain their original ACL; restoration never creates grants.
    const archivedProject = async (ctx: Ctx, projectId: string, write = false) => {
      if (ctx.member.member_type === "GUEST") fail(404, "RESOURCE_NOT_FOUND");
      const p = (await rows(ctx, `SELECT p.*, a.role AS access_role FROM work_projects p LEFT JOIN work_access a ON a.organization_id=p.organization_id AND a.project_id=p.id AND a.member_id=$3 WHERE p.organization_id=$1 AND p.id=$2 AND p.archived`, [id(projectId), ctx.member.id]))[0];
      if (!p || (p.visibility === "PRIVATE" && !p.access_role)) fail(404, "RESOURCE_NOT_FOUND");
      if (write && p.access_role !== "MANAGER") fail(403, "ACTION_DENIED");
      if (write) await requireProjectConfigurationMutable(ctx);
      await notices.captureProject(ctx,p);
      return p;
    };
    const archivedTask = async (ctx: Ctx, taskId: string, write = false) => {
      if (ctx.member.member_type === "GUEST") fail(404, "RESOURCE_NOT_FOUND");
      const t = (await rows(ctx, "SELECT * FROM work_tasks WHERE organization_id=$1 AND id=$2 AND archived", [id(taskId)]))[0];
      if (!t) fail(404, "RESOURCE_NOT_FOUND");
      if (t.project_id) await project(ctx, t.project_id, write);
      else if (t.creator_id !== ctx.member.id) fail(404, "RESOURCE_NOT_FOUND");
      return t;
    };
    route("GET", "/projects/archived", async (ctx) => {
      if (ctx.member.member_type === "GUEST") fail(404, "RESOURCE_NOT_FOUND");
      const records = await rows(ctx, `SELECT p.*,a.role AS access_role FROM work_projects p JOIN work_access a ON a.organization_id=p.organization_id AND a.project_id=p.id AND a.member_id=$2 WHERE p.organization_id=$1 AND p.archived ORDER BY p.title,p.id`, [ctx.member.id]);
      return { projects: records.map(camel) };
    });
    route("POST", "/projects/:projectId/restore", async (ctx, r) => {
      const p = await archivedProject(ctx, params(r).projectId, true);
      version(r, p.version);
      await requireCircleProjectCapacity(ctx, p.circle_id, p.id);
      const restored = (await rows(ctx, "UPDATE work_projects SET archived=false, version=version+1 WHERE organization_id=$1 AND id=$2 RETURNING *", [p.id]))[0];
      await core.changed(ctx, r, p.id, "ProjectRestored");
      return { project: camel(restored) };
    }, async (ctx, r) => { await archivedProject(ctx, params(r).projectId, true); return true; });
    const bulkInput = (r: FastifyRequest) => {
      const b=body(r,["items","status","archive"]);
      if (!Array.isArray(b.items) || !b.items.length || b.items.length>100 || (b.status === undefined) === (b.archive === undefined)) fail(400,"INVALID_REQUEST");
      const items=b.items.map((item:any) => {
        if (!item || typeof item!=="object" || Object.keys(item).some((k)=>!["id","version"].includes(k)) || !Number.isSafeInteger(item.version) || item.version<1) fail(400,"INVALID_REQUEST");
        return {id:id(item.id),version:item.version as number};
      });
      if (new Set(items.map((item:any)=>item.id)).size!==items.length) fail(400,"INVALID_REQUEST");
      return {items,status:b.status === undefined ? undefined : enumValue(b.status,statuses),archive:b.archive === undefined ? undefined : boolean(b.archive)};
    };
    route("POST", "/tasks/bulk", async (ctx,r) => {
      const input=bulkInput(r);
      const items=[];
      const selected=[];
      for (const item of [...input.items].sort((a:any,b:any)=>a.id.localeCompare(b.id))) {
        const t=await task(ctx,item.id,true);
        if (t.version!==item.version) fail(409,"VERSION_CONFLICT");
        selected.push(t);
      }
      if (input.status !== undefined) for (const projectId of [...new Set(selected.map((t:any)=>t.project_id).filter(Boolean))].sort() as string[]) await ctx.c.query("SELECT pg_advisory_xact_lock(hashtext($1),hashtext($2))",["work-task-states",projectId]);
      for (const t of selected) {
        let status=input.status ?? t.status, sid=t.section_id;
        if (t.project_id && input.status !== undefined) {
          const resolved=await sectionStatus(ctx,await project(ctx,t.project_id,true),sid,status,true,t); sid=resolved.sectionId; status=resolved.status;
        }
        const updated=(await rows(ctx,"UPDATE work_tasks SET status=$3,section_id=$4,archived=$5,custom_status_id=CASE WHEN $6::boolean THEN NULL ELSE custom_status_id END,version=version+1 WHERE organization_id=$1 AND id=$2 AND version=$7 RETURNING *",[t.id,status,sid,input.archive ?? t.archived,input.status !== undefined,t.version]))[0];
        if (!updated) fail(409,"VERSION_CONFLICT");
        await core.changed(ctx,r,t.id,"TaskBulkUpdated"); items.push(camel(updated));
      }
      return {tasks:items};
    }, async(ctx,r) => {for (const item of bulkInput(r).items) await task(ctx,item.id,true); return true;});
    route("GET", "/tasks/archived", async (ctx, r) => {
      if (ctx.member.member_type === "GUEST") fail(404, "RESOURCE_NOT_FOUND");
      const q = r.query as Record<string, unknown>;
      if (Object.keys(q).some((k) => k !== "projectId")) fail(400, "INVALID_REQUEST");
      const pid = q.projectId ? id(q.projectId) : null;
      if (pid) await project(ctx, pid);
      const records = await rows(ctx, `SELECT t.*, NOT t.archived AS archived_by_ancestor FROM work_tasks t LEFT JOIN work_projects p ON p.organization_id=t.organization_id AND p.id=t.project_id LEFT JOIN work_access a ON a.organization_id=p.organization_id AND a.project_id=p.id AND a.member_id=$2 WHERE t.organization_id=$1 AND (t.archived OR EXISTS (WITH RECURSIVE ancestors AS (SELECT id,parent_id,archived FROM work_tasks WHERE organization_id=$1 AND id=t.parent_id UNION SELECT x.id,x.parent_id,x.archived FROM work_tasks x JOIN ancestors a ON x.id=a.parent_id WHERE x.organization_id=$1) SELECT 1 FROM ancestors WHERE archived)) AND (($3::uuid IS NULL) OR t.project_id=$3) AND ((t.project_id IS NULL AND t.creator_id=$2) OR (NOT p.archived AND (p.visibility='PUBLIC' OR a.role IS NOT NULL))) ORDER BY t.title,t.id`, [ctx.member.id, pid]);
      return { tasks: records.map(camel) };
    });
    route("POST", "/tasks/:taskId/restore", async (ctx, r) => {
      const t = await archivedTask(ctx, params(r).taskId, true);
      version(r, t.version);
      const restored = (await rows(ctx, "UPDATE work_tasks SET archived=false, version=version+1 WHERE organization_id=$1 AND id=$2 RETURNING *", [t.id]))[0];
      await core.changed(ctx, r, t.id, "TaskRestored");
      return { task: camel(restored) };
    }, async (ctx, r) => { await archivedTask(ctx, params(r).taskId, true); return true; });
    route("GET", "/projects", async (ctx) => ({
      projects:
        ctx.member.member_type === "GUEST"
          ? (
              await ctx.c.query(
                "SELECT * FROM work_projects WHERE organization_id=$1 AND id=ANY($2::uuid[]) AND NOT archived ORDER BY title,id",
                [
                  ctx.org.id,
                  await guest.guestResourceIds(ctx, {
                    context: "work",
                    kind: "project",
                    action: "read",
                  }),
                ],
              )
            ).rows.map((p) => camel(guestProjectRow(p)))
          : (await accessibleProjects(ctx, options.roleCapacity)).map(camel),
      canCreate: mayCreateWork(ctx),
    }));
    route(
      "POST",
      "/projects",
      async (ctx, r) => {
        const b = richDescriptionBody(
          body(r, [
            "title",
            "description",
            "descriptionRich",
            "visibility",
            "circleId",
            "templateId",
            "startsAt", "endsAt", "tags", "customFields", "leadMemberId", "planningIntent", "priority", "sectionName",
          ]),
        );
        const circleId = b.circleId
          ? (await core.get(ctx.c, ctx.org.id, id(b.circleId), "CIRCLE")).id
          : null;
        const created = await createProjectDefinition(ctx, {
          ...b,
          title: b.title,
          circleId,
        });
        const pid = created.id;
        const startsAt = date(b.startsAt), endsAt = date(b.endsAt);
        if (startsAt && endsAt && endsAt < startsAt) fail(422, "INVALID_DATE_RANGE");
        const tags = taskProperties({ tags: b.tags ?? created.tags }).tags;
        await ctx.c.query("UPDATE work_projects SET starts_at=$3, ends_at=$4, tags=$5, custom_fields=$6::jsonb WHERE organization_id=$1 AND id=$2", [ctx.org.id, pid, startsAt, endsAt, tags, JSON.stringify(await collectionCustomFields(ctx,b.customFields ?? {}))]);
        await ctx.c.query("UPDATE work_projects SET lead_member_id=$3 WHERE organization_id=$1 AND id=$2", [ctx.org.id,pid,await projectLead(ctx,b.leadMemberId === undefined ? ctx.member.id : b.leadMemberId)]);
        if(b.planningIntent !== undefined) await ctx.c.query("UPDATE work_projects SET planning_intent=$3::jsonb WHERE organization_id=$1 AND id=$2",[ctx.org.id,pid,JSON.stringify(planningIntent(b.planningIntent))]);
        await ctx.c.query("UPDATE work_projects SET priority=$3,section_name=$4 WHERE organization_id=$1 AND id=$2",[ctx.org.id,pid,taskProperties({priority:b.priority}).priority,projectSectionName(b.sectionName === undefined ? "" : b.sectionName)]);
        await core.changed(ctx, r, pid, "ProjectCreated");
        await ctx.c.query(
          "INSERT INTO work_created_projects VALUES($1,$2,$3,$4)",
          [ctx.org.id, ctx.account.id, key(r), pid],
        );
        return { project: camel(await project(ctx, pid)) };
      },
      async (ctx, r) => {
        if (!mayCreateWork(ctx)) return false;
        const prior = (
          await rows(
            ctx,
            "SELECT project_id FROM work_created_projects WHERE organization_id=$1 AND account_id=$2 AND command_key=$3",
            [ctx.account.id, key(r)],
          )
        )[0];
        if (prior) await project(ctx, prior.project_id);
        return true;
      },
    );
    route("GET", "/projects/:projectId", async (ctx, r) => {
      const p = await project(ctx, params(r).projectId);
      if (ctx.member.member_type === "GUEST")
        return {
          project: camel(guestProjectRow(p)),
          sections: (
            await rows(
              ctx,
              "SELECT id,name,semantic,position FROM work_sections WHERE organization_id=$1 AND project_id=$2 ORDER BY position,id",
              [p.id],
            )
          ).map(camel),
          access: [],
          capabilities: {
            edit: false,
            manage: false,
            assign: false,
            configurationLocked: false,
          },
        };
      const configurationLocked = (await workSettings(ctx))
        .lockProjectConfiguration;
      return {
        project: camel(p),
        sections: (
          await rows(
            ctx,
            "SELECT * FROM work_sections WHERE organization_id=$1 AND project_id=$2 ORDER BY position,id",
            [p.id],
          )
        ).map(camel),
        access:
          p.access_role === "MANAGER"
            ? (
                await rows(
                  ctx,
                  "SELECT * FROM work_access WHERE organization_id=$1 AND project_id=$2",
                  [p.id],
                )
              ).map(camel)
            : [],
        capabilities: {
          edit: ["EDITOR", "MANAGER"].includes(p.access_role) && !p.frozen,
          manage: p.access_role === "MANAGER" && !configurationLocked,
          assign: canAssignProject(ctx, p),
          configurationLocked,
        },
      };
    });
    route(
      "PATCH",
      "/projects/:projectId",
      async (ctx, r) => {
        await ctx.c.query("SELECT pg_advisory_xact_lock(hashtext($1),hashtext($2))", ["work-project-states", ctx.org.id]);
        const p = await project(ctx, params(r).projectId, true, true);
        version(r, p.version);
        const b = richDescriptionBody(
          body(r, [
            "title",
            "description",
            "descriptionRich",
            "visibility",
            "frozen",
            "archived",
            "views",
            "defaultDoneSectionId",
            "circleId",
            "assignmentMode",
            "assignmentPermission",
            "startsAt", "endsAt", "tags", "projectStateId", "customFields", "leadMemberId", "planningIntent", "priority", "sectionName",
          ]),
        );
        let views = p.views;
        if (b.views !== undefined) {
          if (!Array.isArray(b.views) || !b.views.length)
            fail(400, "VIEW_REQUIRED");
          views = [
            ...new Set(
              b.views.map((x: any) =>
                enumValue(x, ["LIST", "BOARD", "TIMELINE", "CALENDAR"]),
              ),
            ),
          ];
        }
        const done =
          b.defaultDoneSectionId === undefined
            ? p.default_done_section_id
            : nullableId(b.defaultDoneSectionId);
        if (
          done &&
          !(
            await rows(
              ctx,
              "SELECT id FROM work_sections WHERE organization_id=$1 AND project_id=$2 AND id=$3 AND semantic='DONE'",
              [p.id, done],
            )
          ).length
        )
          fail(422, "INVALID_DONE_SECTION");
        const circleId =
          b.circleId === undefined
            ? p.circle_id
            : b.circleId
              ? (await core.get(ctx.c, ctx.org.id, id(b.circleId), "CIRCLE")).id
              : null;
        if (b.archived !== true)
          await requireCircleProjectCapacity(ctx, circleId, p.id);
        const assignmentMode =
          b.assignmentMode === undefined
            ? p.assignment_mode
            : enumValue(b.assignmentMode, ["SINGLE", "MULTIPLE"]);
        const assignmentPermission =
          b.assignmentPermission === undefined
            ? p.assignment_permission
            : enumValue(b.assignmentPermission, ["EDITORS", "MANAGERS"]);
        if (
          assignmentMode === "SINGLE" &&
          p.assignment_mode !== "SINGLE" &&
          (
            await rows(
              ctx,
              "SELECT 1 FROM (SELECT organization_id,task_id FROM work_assignments UNION ALL SELECT organization_id,task_id FROM work_role_assignments) a JOIN work_tasks t ON t.organization_id=a.organization_id AND t.id=a.task_id WHERE a.organization_id=$1 AND t.project_id=$2 AND NOT t.archived GROUP BY a.task_id HAVING count(*)>1 LIMIT 1",
              [p.id],
            )
          ).length
        )
          fail(422, "MULTIPLE_ASSIGNEES_EXIST");
        const stateId = b.projectStateId === undefined ? p.project_state_id : nullableId(b.projectStateId);
        if (stateId) {
          const stateRow = (await rows(ctx,"SELECT project_states FROM work_settings WHERE organization_id=$1"))[0];
          if (!stateRow?.project_states.some((state: any) => state.id === stateId)) fail(422,"INVALID_PROJECT_STATE");
        }
        const startsAt = b.startsAt === undefined ? p.starts_at : date(b.startsAt);
        const endsAt = b.endsAt === undefined ? p.ends_at : date(b.endsAt);
        if (startsAt && endsAt && new Date(endsAt) < new Date(startsAt)) fail(422, "INVALID_DATE_RANGE");
        const tags = taskProperties({ tags: b.tags === undefined ? p.tags : b.tags }).tags;
        await ctx.c.query("UPDATE work_projects SET starts_at=$3, ends_at=$4, tags=$5, project_state_id=$6,custom_fields=$7::jsonb WHERE organization_id=$1 AND id=$2", [ctx.org.id, p.id, startsAt, endsAt, tags, stateId, JSON.stringify(await collectionCustomFields(ctx,b.customFields ?? p.custom_fields))]);
        if (b.leadMemberId !== undefined) await ctx.c.query("UPDATE work_projects SET lead_member_id=$3 WHERE organization_id=$1 AND id=$2", [ctx.org.id,p.id,await projectLead(ctx,b.leadMemberId)]);
        await ctx.c.query(
          "UPDATE work_projects SET title=$3,description=$4,description_rich=$13,visibility=$5,frozen=$6,archived=$7,views=$8,default_done_section_id=$9,circle_id=$10,assignment_mode=$11,assignment_permission=$12,version=version+1 WHERE organization_id=$1 AND id=$2",
          [
            ctx.org.id,
            p.id,
            b.title === undefined ? p.title : text(b.title),
            b.description === undefined ? p.description : descriptionPlain(b),
            b.visibility === undefined
              ? p.visibility
              : enumValue(b.visibility, ["PUBLIC", "PRIVATE"]),
            b.frozen === undefined ? p.frozen : boolean(b.frozen),
            b.archived === undefined ? p.archived : boolean(b.archived),
            views,
            done,
            circleId,
            assignmentMode,
            assignmentPermission,
            nextRichDescription(b, p),
          ],
        );
        if(b.planningIntent !== undefined) await ctx.c.query("UPDATE work_projects SET planning_intent=$3::jsonb WHERE organization_id=$1 AND id=$2",[ctx.org.id,p.id,JSON.stringify(planningIntent(b.planningIntent))]);
        await ctx.c.query("UPDATE work_projects SET priority=$3,section_name=$4 WHERE organization_id=$1 AND id=$2",[ctx.org.id,p.id,taskProperties({priority:b.priority === undefined ? p.priority : b.priority}).priority,projectSectionName(b.sectionName === undefined ? p.section_name : b.sectionName)]);
        await core.changed(ctx, r, p.id, "ProjectConfigured");
        return {
          project: camel(
            (
              await rows(
                ctx,
                "SELECT * FROM work_projects WHERE organization_id=$1 AND id=$2",
                [p.id],
              )
            )[0],
          ),
        };
      },
      projectAuth(true),
    );
    route("POST", "/projects/:projectId/states", async (ctx, r) => {
      await ctx.c.query("SELECT pg_advisory_xact_lock(hashtext($1),hashtext($2))", ["work-task-states", params(r).projectId]);
      const p = await project(ctx, params(r).projectId, true, true);
      version(r, p.version);
      const b = body(r, ["states"]);
      if (!Array.isArray(b.states) || b.states.length > 50) fail(400, "INVALID_REQUEST");
      const definitions = b.states.map((item: any) => {
        if (!item || typeof item !== "object" || Object.keys(item).some((k) => !["id","name","semantic"].includes(k))) fail(400, "INVALID_REQUEST");
        return {id: id(item.id), name: text(item.name, 100), semantic: enumValue(item.semantic, statuses)};
      });
      if (new Set(definitions.map((item: any) => item.id)).size !== definitions.length) fail(400, "INVALID_REQUEST");
      const used = await rows(ctx, "SELECT DISTINCT custom_status_id,status FROM work_tasks WHERE organization_id=$1 AND project_id=$2 AND custom_status_id IS NOT NULL", [p.id]);
      for (const taskState of used) {
        const definition = definitions.find((item: any) => item.id === taskState.custom_status_id);
        if (!definition || definition.semantic !== taskState.status) fail(409, "STATE_IN_USE");
      }
      const updated = (await rows(ctx, "UPDATE work_projects SET task_states=$3::jsonb,version=version+1 WHERE organization_id=$1 AND id=$2 RETURNING *", [p.id,JSON.stringify(definitions)]))[0];
      await core.changed(ctx,r,p.id,"ProjectStatesChanged");
      return {project:camel(updated)};
    }, projectAuth(true));
    route("GET", "/projects/:projectId/context", async (ctx, r) => {
      const p = await project(ctx, params(r).projectId);
      if (ctx.member.member_type === "GUEST") return { links: [] };
      return { links: p.context_links };
    });
    route("POST", "/projects/:projectId/context", async (ctx, r) => {
      const p = await project(ctx, params(r).projectId, true, true);
      version(r, p.version);
      const b = body(r, ["links"]);
      if (!Array.isArray(b.links) || b.links.length > 200) fail(400, "INVALID_REQUEST");
      const links = b.links.map((item: any) => {
        if (!item || typeof item !== "object" || Object.keys(item).some((k) => !["kind", "targetId"].includes(k))) fail(400, "INVALID_REQUEST");
        return { kind: enumValue(item.kind, ["CIRCLE", "ROLE", "PARTICIPANT", "FOLLOWER"]), targetId: id(item.targetId) };
      });
      if (new Set(links.map((link: any) => link.kind + ":" + link.targetId)).size !== links.length) fail(400, "INVALID_REQUEST");
      await validateProjectContextLinks(ctx, core, links);
      const updated = (await rows(ctx,"UPDATE work_projects SET context_links=$3::jsonb,version=version+1 WHERE organization_id=$1 AND id=$2 RETURNING *", [p.id, JSON.stringify(links)]))[0];
      await core.changed(ctx,r,p.id,"ProjectContextChanged");
      return { project: camel(updated), links };
    }, projectAuth(true));
    route(
      "POST",
      "/projects/:projectId/access",
      async (ctx, r) => {
        const p = await project(ctx, params(r).projectId, true, true);
        version(r, p.version);
        const b = body(r, ["memberId", "role"]);
        await activeMember(ctx, b.memberId);
        const prior = (
          await rows(
            ctx,
            "SELECT role FROM work_access WHERE organization_id=$1 AND project_id=$2 AND member_id=$3",
            [p.id, id(b.memberId)],
          )
        )[0];
        if (
          prior?.role === "MANAGER" &&
          b.role !== "MANAGER" &&
          (
            await rows(
              ctx,
              "SELECT a.member_id FROM work_access a JOIN members m ON m.organization_id=a.organization_id AND m.id=a.member_id WHERE a.organization_id=$1 AND a.project_id=$2 AND a.role='MANAGER' AND m.status='ACTIVE'",
              [p.id],
            )
          ).length <= 1
        )
          fail(422, "LAST_PROJECT_MANAGER");
        if (b.role === null) {
          if (b.memberId === ctx.member.id)
            fail(422, "SELF_ACCESS_REMOVAL_DENIED");
          await ctx.c.query(
            "DELETE FROM work_access WHERE organization_id=$1 AND project_id=$2 AND member_id=$3",
            [ctx.org.id, p.id, b.memberId],
          );
        } else
          await ctx.c.query(
            "INSERT INTO work_access VALUES($1,$2,$3,$4) ON CONFLICT(organization_id,project_id,member_id) DO UPDATE SET role=excluded.role",
            [
              ctx.org.id,
              p.id,
              b.memberId,
              enumValue(b.role, ["MANAGER", "EDITOR", "READER"]),
            ],
          );
        await ctx.c.query(
          "UPDATE work_projects SET version=version+1 WHERE organization_id=$1 AND id=$2",
          [ctx.org.id, p.id],
        );
        await core.changed(ctx, r, p.id, "ProjectAccessChanged");
        return {
          version: p.version + 1,
          __workHttpStatus: b.role !== null && !prior ? 201 : 200,
        };
      },
      projectAuth(true),
    );
    route(
      "POST",
      "/projects/:projectId/sections",
      async (ctx, r) => {
        const p = await project(ctx, params(r).projectId, true, true);
        version(r, p.version);
        const b = body(r, ["name", "semantic", "position"]);
        const sid = uuid();
        await ctx.c.query(
          "INSERT INTO work_sections VALUES($1,$2,$3,$4,$5,$6)",
          [
            ctx.org.id,
            sid,
            p.id,
            text(b.name),
            enumValue(b.semantic ?? "NONE", ["NONE", "DONE"]),
            integer(b.position),
          ],
        );
        await ctx.c.query(
          "UPDATE work_projects SET version=version+1 WHERE organization_id=$1 AND id=$2",
          [ctx.org.id, p.id],
        );
        await core.changed(ctx, r, p.id, "ProjectSectionAdded");
        return {
          section: camel(
            (
              await rows(
                ctx,
                "SELECT * FROM work_sections WHERE organization_id=$1 AND id=$2",
                [sid],
              )
            )[0],
          ),
          projectVersion: p.version + 1,
        };
      },
      projectAuth(true),
    );
    route("GET", "/tasks", async (ctx, r) => {
      const q = r.query as any;
      const ts = await accessibleTasks(
        ctx,
        q.projectId ? id(q.projectId) : undefined,
      );
      const tasks = [];
      for (const t of ts) {
        const assignment = await resolveTaskAssignments(
          ctx,
          t,
          options.roleCapacity,
        );
        tasks.push({
          ...camel(t),
          sourceTensionId:t.source_tension_id && ctx.member.member_type!=='GUEST' && await options.trace?.tension(ctx,t.source_tension_id) ? t.source_tension_id : null,
          assigneeIds: assignment.principals.flatMap((p) =>
            p.kind === "MEMBER" ? [p.memberId] : [],
          ),
          ...assignment,
        });
      }
      return { tasks };
    });
    route(
      "PATCH",
      "/projects/:projectId/sections/:sectionId",
      async (ctx, r) => {
        const p = await project(ctx, params(r).projectId, true, true);
        version(r, p.version);
        const sid = id(params(r).sectionId),
          s = (
            await rows(
              ctx,
              "SELECT * FROM work_sections WHERE organization_id=$1 AND id=$2 AND project_id=$3",
              [sid, p.id],
            )
          )[0];
        if (!s) fail(404, "RESOURCE_NOT_FOUND");
        const b = body(r, ["name", "semantic", "position"]);
        const semantic =
          b.semantic === undefined
            ? s.semantic
            : enumValue(b.semantic, ["NONE", "DONE"]);
        if (p.default_done_section_id === sid && semantic !== "DONE")
          fail(422, "DEFAULT_DONE_SECTION_IN_USE");
        await ctx.c.query(
          "UPDATE work_sections SET name=$4,semantic=$5,position=$6 WHERE organization_id=$1 AND project_id=$2 AND id=$3",
          [
            ctx.org.id,
            p.id,
            sid,
            b.name === undefined ? s.name : text(b.name),
            semantic,
            b.position === undefined ? s.position : integer(b.position),
          ],
        );
        if (semantic !== s.semantic)
          await ctx.c.query(
            "UPDATE work_tasks SET custom_status_id=NULL,status=CASE WHEN $4='DONE' THEN 'DONE' WHEN status='DONE' THEN 'TODO' ELSE status END,version=version+1 WHERE organization_id=$1 AND project_id=$2 AND section_id=$3 AND NOT archived",
            [ctx.org.id, p.id, sid, semantic],
          );
        await ctx.c.query(
          "UPDATE work_projects SET version=version+1 WHERE organization_id=$1 AND id=$2",
          [ctx.org.id, p.id],
        );
        await core.changed(ctx, r, p.id, "ProjectSectionChanged");
        return { projectVersion: p.version + 1 };
      },
      projectAuth(true),
    );
    route(
      "DELETE",
      "/projects/:projectId/sections/:sectionId",
      async (ctx, r) => {
        const p = await project(ctx, params(r).projectId, true, true);
        version(r, p.version);
        const sid = id(params(r).sectionId);
        if (
          p.default_done_section_id === sid ||
          (
            await rows(
              ctx,
              "SELECT id FROM work_tasks WHERE organization_id=$1 AND section_id=$2",
              [sid],
            )
          ).length
        )
          fail(422, "SECTION_IN_USE");
        if (
          !(
            await rows(
              ctx,
              "DELETE FROM work_sections WHERE organization_id=$1 AND project_id=$2 AND id=$3 RETURNING id",
              [p.id, sid],
            )
          ).length
        )
          fail(404, "RESOURCE_NOT_FOUND");
        await ctx.c.query(
          "UPDATE work_projects SET version=version+1 WHERE organization_id=$1 AND id=$2",
          [ctx.org.id, p.id],
        );
        await core.changed(ctx, r, p.id, "ProjectSectionRemoved");
        return { projectVersion: p.version + 1 };
      },
      projectAuth(true),
    );
    route(
      "POST",
      "/tasks",
      async (ctx, r) => {
        const b = richDescriptionBody(
          body(r, [
            "title",
            "description",
            "descriptionRich",
            "projectId",
            "sectionId",
            "parentId",
            "startsAt",
            "endsAt",
            "dateProvenance",
            "priority",
            "estimateMinutes",
            "tags",
            "customFields",
            "planningIntent",
            "groupId",
          ]),
        );
        const pid = nullableId(b.projectId);
        const p = pid ? await project(ctx, pid, true) : null;
        const parent = b.parentId
          ? await task(ctx, id(b.parentId), true)
          : null;
        if (parent && parent.project_id !== pid)
          fail(422, "PARENT_PROJECT_MISMATCH");
        const groupId = await subtaskGroup(ctx, parent?.id ?? null, b.groupId);
        let sid = nullableId(b.sectionId),
          status = "TODO";
        if (p) {
          const s = await sectionStatus(ctx, p, sid, status, false);
          sid = s.sectionId;
          status = s.status;
        } else if (sid) fail(422, "PROJECT_REQUIRED");
        const properties = taskProperties(b);
        const tid = uuid();
        const start = date(b.startsAt),
          end = date(b.endsAt);
        if (start && end && end < start) fail(422, "INVALID_DATE_RANGE");
        await ctx.c.query(
          "INSERT INTO work_tasks(organization_id,id,project_id,section_id,parent_id,creator_id,title,description,status,starts_at,ends_at,date_provenance,subtask_group_id,description_rich,priority,estimate_minutes,tags) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)",
          [
            ctx.org.id,
            tid,
            pid,
            sid,
            parent?.id ?? null,
            ctx.member.id,
            text(b.title),
            descriptionPlain(b),
            status,
            start,
            end,
            enumValue(b.dateProvenance ?? "USER_ENTERED", [
              "USER_ENTERED",
              "SYNTHETIC_TEST",
            ]),
            groupId,
            nextRichDescription(b),
            properties.priority,
            properties.estimateMinutes,
            properties.tags,
          ],
        );
        await ctx.c.query("UPDATE work_tasks SET custom_fields=$3::jsonb WHERE organization_id=$1 AND id=$2", [ctx.org.id,tid,JSON.stringify(await collectionCustomFields(ctx,b.customFields ?? {}))]);
        if(b.planningIntent !== undefined) await ctx.c.query("UPDATE work_tasks SET planning_intent=$3::jsonb WHERE organization_id=$1 AND id=$2",[ctx.org.id,tid,JSON.stringify(planningIntent(b.planningIntent))]);
        await core.changed(ctx, r, tid, "TaskCreated");
        return { task: camel(await task(ctx, tid)) };
      },
      async (ctx, r) => {
        const b = richDescriptionBody(
          body(r, [
            "title",
            "description",
            "descriptionRich",
            "projectId",
            "sectionId",
            "parentId",
            "startsAt",
            "endsAt",
            "dateProvenance",
            "priority",
            "estimateMinutes",
            "tags",
            "customFields",
            "planningIntent",
            "groupId",
          ]),
        );
        if (b.projectId) {
          await project(ctx, id(b.projectId), true);
          return true;
        }
        return mayCreateWork(ctx);
      },
    );
    route('GET','/tasks/:taskId/origin',async(ctx,r)=>{
      const t=await task(ctx,params(r).taskId);
      return {origin:ctx.member.member_type==='GUEST'||!options.trace ? null : t.source_tension_id ? await options.trace.tension(ctx,t.source_tension_id) : await options.trace.meetingOrigin?.(ctx,'TASK',t.id)??null};
    });
    route('GET','/projects/:projectId/origin',async(ctx,r)=>{
      const p=await project(ctx,params(r).projectId);
      return {origin:ctx.member.member_type==='GUEST' ? null : await options.trace?.meetingOrigin?.(ctx,'PROJECT',p.id)??null};
    });
    route("GET", "/tasks/:taskId", async (ctx, r) => {
      const t = await task(ctx, params(r).taskId);
      if (ctx.member.member_type === "GUEST")
        return {
          ...(await workGuestTaskDetail(ctx, t, guest)),
          comments: await listWorkTaskComments(ctx, t.id, options.comments),
          commentsComplete: true,
          commentsSource: "PLATFORM_THREAD",
        };
      const deps = await rows(
        ctx,
        "SELECT * FROM work_dependencies WHERE organization_id=$1 AND (predecessor_id=$2 OR successor_id=$2)",
        [t.id],
      );
      const safeDeps = [];
      for (const d of deps) {
        try {
          await task(ctx, d.predecessor_id);
          await task(ctx, d.successor_id);
          safeDeps.push(camel(d));
        } catch {}
      }
      const links = [];
      for (const l of await rows(
        ctx,
        "SELECT * FROM work_links WHERE organization_id=$1 AND task_id=$2",
        [t.id],
      )) {
        try {
          await task(ctx, l.target_task_id);
          links.push(camel(l));
        } catch {}
      }
      let duplicateOf = t.duplicate_of;
      if (duplicateOf) {
        try {
          await task(ctx, duplicateOf);
        } catch {
          duplicateOf = null;
        }
      }
      const editable = t.project_id ? await project(ctx, t.project_id) : null;
      return {
        task: { ...camel(t), duplicateOf,sourceTensionId:t.source_tension_id && await options.trace?.tension(ctx,t.source_tension_id) ? t.source_tension_id : null },
        ...(await resolveTaskAssignments(ctx, t, options.roleCapacity)),
        assignments: (
          await rows(
            ctx,
            "SELECT member_id FROM work_assignments WHERE organization_id=$1 AND task_id=$2",
            [t.id],
          )
        ).map(camel),
        checklist: (
          await rows(
            ctx,
            "SELECT * FROM work_checklist WHERE organization_id=$1 AND task_id=$2 ORDER BY id",
            [t.id],
          )
        ).map(camel),
        comments: await listWorkTaskComments(ctx, t.id, options.comments),
        commentsComplete: true,
        commentsSource: "PLATFORM_THREAD",
        dependencies: safeDeps,
        links,
        groups: (
          await rows(
            ctx,
            "SELECT * FROM work_subtask_groups WHERE organization_id=$1 AND parent_task_id=$2 ORDER BY position,id",
            [t.id],
          )
        ).map(camel),
        subtasks: await Promise.all((await accessibleTasks(ctx))
          .filter((x) => x.parent_id === t.id)
          .map(async x=>({...camel(x),sourceTensionId:x.source_tension_id && await options.trace?.tension(ctx,x.source_tension_id) ? x.source_tension_id : null}))),
        capabilities: {
          edit:
            !editable ||
            (["EDITOR", "MANAGER"].includes(editable.access_role) &&
              !editable.frozen),
          assign: !editable || canAssignProject(ctx, editable),
          roleAssignment: !!options.roleCapacity,
        },
      };
    });
    route(
      "PATCH",
      "/tasks/:taskId",
      async (ctx, r) => {
        const t = await task(ctx, params(r).taskId, true);
        version(r, t.version);
        const b = richDescriptionBody(
          body(r, [
            "title",
            "description",
            "descriptionRich",
            "status",
            "customStatusId",
            "customFields",
            "planningIntent",
            "sectionId",
            "startsAt",
            "endsAt",
            "position",
            "archived",
            "priority",
            "estimateMinutes",
            "tags",
            "groupId",
          ]),
        );
        const properties = taskProperties(b, t);
        const groupId =
          b.groupId === undefined
            ? t.subtask_group_id
            : await subtaskGroup(ctx, t.parent_id, b.groupId);
        let sid =
            b.sectionId === undefined ? t.section_id : nullableId(b.sectionId),
          status =
            b.status === undefined ? t.status : enumValue(b.status, statuses);
        let customStatusId = b.customStatusId === undefined ? (b.status === undefined ? t.custom_status_id : null) : nullableId(b.customStatusId);
        if (t.project_id) {
          await ctx.c.query("SELECT pg_advisory_xact_lock(hashtext($1),hashtext($2))", ["work-task-states", t.project_id]);
          const currentProject = await project(ctx, t.project_id, true);
          const definition = customStatusId ? (currentProject.task_states as any[]).find((item: any) => item.id === customStatusId) : null;
          if (customStatusId && !definition) fail(422, "INVALID_TASK_STATE");
          if (b.customStatusId !== undefined && definition) status = definition.semantic;
          const s = await sectionStatus(ctx, currentProject, sid, status, b.status !== undefined || b.customStatusId !== undefined, t);
          sid = s.sectionId;
          status = s.status;
          if (definition && definition.semantic !== status) {
            if (b.customStatusId !== undefined) fail(422, "STATE_SECTION_CONFLICT");
            customStatusId = null;
          }
        } else if (sid || customStatusId) fail(422, "PROJECT_REQUIRED");
        const start = b.startsAt === undefined ? t.starts_at : date(b.startsAt),
          end = b.endsAt === undefined ? t.ends_at : date(b.endsAt);
        if (start && end && +new Date(end) < +new Date(start))
          fail(422, "INVALID_DATE_RANGE");
        await ctx.c.query(
          "UPDATE work_tasks SET title=$3,description=$4,description_rich=$12,status=$5,section_id=$6,starts_at=$7,ends_at=$8,position=$9,archived=$10,subtask_group_id=$11,priority=$13,estimate_minutes=$14,tags=$15,custom_status_id=$16,custom_fields=$17::jsonb WHERE organization_id=$1 AND id=$2",
          [
            ctx.org.id,
            t.id,
            b.title === undefined ? t.title : text(b.title),
            b.description === undefined ? t.description : descriptionPlain(b),
            status,
            sid,
            start,
            end,
            b.position === undefined ? t.position : integer(b.position),
            b.archived === undefined ? t.archived : boolean(b.archived),
            groupId,
            nextRichDescription(b, t),
            properties.priority,
            properties.estimateMinutes,
            properties.tags,
            customStatusId,
            JSON.stringify(await collectionCustomFields(ctx,b.customFields ?? t.custom_fields)),
          ],
        );
        if(b.planningIntent !== undefined) await ctx.c.query("UPDATE work_tasks SET planning_intent=$3::jsonb WHERE organization_id=$1 AND id=$2",[ctx.org.id,t.id,JSON.stringify(planningIntent(b.planningIntent))]);
        return { task: await bump(ctx, r, t.id, "TaskUpdated") };
      },
      taskAuth,
    );
    route(
      "POST",
      "/tasks/:taskId/groups",
      async (ctx, r) => {
        const parent = await task(ctx, params(r).taskId, true);
        version(r, parent.version);
        const b = body(r, ["name", "position"]);
        const gid = uuid();
        await ctx.c.query(
          "INSERT INTO work_subtask_groups VALUES($1,$2,$3,$4,$5)",
          [ctx.org.id, gid, parent.id, text(b.name), integer(b.position)],
        );
        return {
          group: camel(
            (
              await rows(
                ctx,
                "SELECT * FROM work_subtask_groups WHERE organization_id=$1 AND id=$2",
                [gid],
              )
            )[0],
          ),
          task: await bump(ctx, r, parent.id, "SubtaskGroupCreated"),
        };
      },
      taskAuth,
    );
    route(
      "PATCH",
      "/tasks/:taskId/groups/:groupId",
      async (ctx, r) => {
        const parent = await task(ctx, params(r).taskId, true);
        version(r, parent.version);
        const gid = await subtaskGroup(ctx, parent.id, params(r).groupId);
        const b = body(r, ["name", "position"]);
        const g = (
          await rows(
            ctx,
            "SELECT * FROM work_subtask_groups WHERE organization_id=$1 AND id=$2",
            [gid],
          )
        )[0];
        await ctx.c.query(
          "UPDATE work_subtask_groups SET name=$3,position=$4 WHERE organization_id=$1 AND id=$2",
          [
            ctx.org.id,
            gid,
            b.name === undefined ? g.name : text(b.name),
            b.position === undefined ? g.position : integer(b.position),
          ],
        );
        return { task: await bump(ctx, r, parent.id, "SubtaskGroupUpdated") };
      },
      taskAuth,
    );
    route(
      "DELETE",
      "/tasks/:taskId/groups/:groupId",
      async (ctx, r) => {
        const parent = await task(ctx, params(r).taskId, true);
        version(r, parent.version);
        const gid = await subtaskGroup(ctx, parent.id, params(r).groupId);
        if (
          (
            await rows(
              ctx,
              "SELECT id FROM work_tasks WHERE organization_id=$1 AND subtask_group_id=$2",
              [gid],
            )
          ).length
        )
          fail(422, "SUBTASK_GROUP_IN_USE");
        await ctx.c.query(
          "DELETE FROM work_subtask_groups WHERE organization_id=$1 AND id=$2",
          [ctx.org.id, gid],
        );
        return { task: await bump(ctx, r, parent.id, "SubtaskGroupRemoved") };
      },
      taskAuth,
    );
    route(
      "POST",
      "/tasks/:taskId/assignments",
      async (ctx, r) => {
        const t = await task(ctx, params(r).taskId, true);
        version(r, t.version);
        const parsed = parseTaskPrincipals(
          body(r, ["principals", "memberIds", "assigneeIds"]),
        );
        if (
          parsed.legacy &&
          (await taskPrincipals(ctx, t.id)).some((p) => p.kind === "ROLE")
        )
          fail(409, "LEGACY_ASSIGNMENT_VIEW_INCOMPLETE");
        if (
          t.project_id &&
          (await project(ctx, t.project_id, true)).assignment_mode ===
            "SINGLE" &&
          parsed.principals.length > 1
        )
          fail(422, "ASSIGNMENT_LIMIT");
        await validateTaskPrincipals(
          ctx,
          t,
          parsed.principals,
          options.roleCapacity,
        );
        await storeTaskPrincipals(ctx, t.id, parsed.principals, options.publishNotification, options.roleCapacity);
        return { task: await bump(ctx, r, t.id, "TaskAssigned") };
      },
      async (ctx, r) => {
        const t = await task(ctx, params(r).taskId, true);
        if (
          t.project_id &&
          !canAssignProject(ctx, await project(ctx, t.project_id, true))
        )
          fail(403, "ASSIGNMENT_DENIED");
        const parsed = parseTaskPrincipals(
          body(r, ["principals", "memberIds", "assigneeIds"]),
        );
        if (
          parsed.legacy &&
          (await taskPrincipals(ctx, t.id)).some((p) => p.kind === "ROLE")
        )
          fail(409, "LEGACY_ASSIGNMENT_VIEW_INCOMPLETE");
        if (
          t.project_id &&
          (await project(ctx, t.project_id, true)).assignment_mode ===
            "SINGLE" &&
          parsed.principals.length > 1
        )
          fail(422, "ASSIGNMENT_LIMIT");
        await validateTaskPrincipals(
          ctx,
          t,
          parsed.principals,
          options.roleCapacity,
        );
        return true;
      },
    );
    route(
      "POST",
      "/tasks/:taskId/dependencies",
      async (ctx, r) => {
        const t = await task(ctx, params(r).taskId, true);
        version(r, t.version);
        const b = body(r, ["predecessorId", "type", "lagMinutes"]);
        const pred = await task(ctx, id(b.predecessorId), true);
        if (
          pred.project_id !== t.project_id ||
          (!t.project_id && pred.creator_id !== t.creator_id)
        )
          fail(422, "DEPENDENCY_SCOPE_MISMATCH");
        const edge = {
          predecessor_id: pred.id,
          successor_id: t.id,
          type: enumValue(b.type, ["FS", "FF", "SS", "SF"]),
          lag_minutes: integer(b.lagMinutes),
        };
        const edges = await rows(
          ctx,
          "SELECT * FROM work_dependencies WHERE organization_id=$1",
        );
        const replaced = edges.filter(
          (e) => !(e.predecessor_id === pred.id && e.successor_id === t.id),
        );
        ordered(
          [
            ...new Set(
              [...replaced, edge].flatMap((e) => [
                e.predecessor_id,
                e.successor_id,
              ]),
            ),
          ],
          [...replaced, edge],
        );
        await ctx.c.query(
          "INSERT INTO work_dependencies VALUES($1,$2,$3,$4,$5) ON CONFLICT(organization_id,predecessor_id,successor_id) DO UPDATE SET type=excluded.type,lag_minutes=excluded.lag_minutes",
          [ctx.org.id, pred.id, t.id, edge.type, edge.lag_minutes],
        );
        return {
          task: await bump(ctx, r, t.id, "TaskDependencyAdded"),
          __workHttpStatus: edges.some(
            (e) => e.predecessor_id === pred.id && e.successor_id === t.id,
          )
            ? 200
            : 201,
        };
      },
      taskAuth,
    );
    route(
      "DELETE",
      "/tasks/:taskId/dependencies/:predecessorId",
      async (ctx, r) => {
        const t = await task(ctx, params(r).taskId, true);
        version(r, t.version);
        await task(ctx, params(r).predecessorId, true);
        await ctx.c.query(
          "DELETE FROM work_dependencies WHERE organization_id=$1 AND successor_id=$2 AND predecessor_id=$3",
          [ctx.org.id, t.id, id(params(r).predecessorId)],
        );
        return { task: await bump(ctx, r, t.id, "TaskDependencyRemoved") };
      },
      taskAuth,
    );
    route(
      "POST",
      "/tasks/:taskId/duplicate",
      async (ctx, r) => {
        const t = await task(ctx, params(r).taskId, true);
        version(r, t.version);
        const b = body(r, ["title", "includeSubtasks"]);
        const includeSubtasks = b.includeSubtasks === undefined ? false : boolean(b.includeSubtasks);
        const principals = await taskPrincipals(ctx, t.id);
        await validateTaskPrincipals(ctx, t, principals, options.roleCapacity);
        const tid = uuid();
        await ctx.c.query(
          "INSERT INTO work_tasks(organization_id,id,project_id,section_id,parent_id,creator_id,title,description,status,starts_at,ends_at,date_provenance,position,subtask_group_id,description_rich,priority,estimate_minutes,tags,custom_status_id,custom_fields) SELECT organization_id,$3,project_id,section_id,parent_id,$4,$5,description,status,starts_at,ends_at,date_provenance,position+1,subtask_group_id,description_rich,priority,estimate_minutes,tags,custom_status_id,custom_fields FROM work_tasks WHERE organization_id=$1 AND id=$2",
          [ctx.org.id, t.id, tid, ctx.member.id, text(b.title)],
        );
        await ctx.c.query("UPDATE work_tasks SET task_checklists=$3::jsonb,external_links=$4::jsonb,planning_intent=$5::jsonb WHERE organization_id=$1 AND id=$2",[ctx.org.id,tid,JSON.stringify(freshProjectChecklists(projectChecklists(t.task_checklists),false)),JSON.stringify(t.external_links),JSON.stringify(t.planning_intent)]);
        await ctx.c.query(
          "INSERT INTO work_assignments SELECT organization_id,$3,member_id FROM work_assignments WHERE organization_id=$1 AND task_id=$2",
          [ctx.org.id, t.id, tid],
        );
        await ctx.c.query(
          "INSERT INTO work_checklist SELECT organization_id,gen_random_uuid(),$3,title,false FROM work_checklist WHERE organization_id=$1 AND task_id=$2",
          [ctx.org.id, t.id, tid],
        );
        for (const principal of principals)
          if (principal.kind === "ROLE")
            await ctx.c.query(
              "INSERT INTO work_role_assignments(organization_id,task_id,role_id) VALUES($1,$2,$3)",
              [ctx.org.id, tid, principal.roleId],
            );
        if (includeSubtasks) {
          const copies = new Map<string, string>([[t.id, tid]]);
          const queue = [t.id];
          while (queue.length) {
            const sourceParentId = queue.shift()!;
            const copiedParentId = copies.get(sourceParentId)!;
            const groups = await rows(ctx, "SELECT * FROM work_subtask_groups WHERE organization_id=$1 AND parent_task_id=$2 ORDER BY position,id", [sourceParentId]);
            const groupCopies = new Map<string, string>();
            for (const group of groups) {
              const newGroupId = uuid(); groupCopies.set(group.id, newGroupId);
              await ctx.c.query("INSERT INTO work_subtask_groups(organization_id,id,parent_task_id,name,position) VALUES($1,$2,$3,$4,$5)", [ctx.org.id,newGroupId,copiedParentId,group.name,group.position]);
            }
            const children = await rows(ctx, "SELECT * FROM work_tasks WHERE organization_id=$1 AND parent_id=$2 AND NOT archived ORDER BY position,id", [sourceParentId]);
            for (const child of children) {
              if (copies.has(child.id) || copies.size >= 1000) fail(422, "TASK_TREE_INVALID_OR_TOO_LARGE");
              const childPrincipals = await taskPrincipals(ctx, child.id);
              await validateTaskPrincipals(ctx, child, childPrincipals, options.roleCapacity);
              const childId = uuid(); copies.set(child.id, childId); queue.push(child.id);
              await ctx.c.query("INSERT INTO work_tasks(organization_id,id,project_id,section_id,parent_id,creator_id,title,description,status,starts_at,ends_at,date_provenance,position,subtask_group_id,description_rich,priority,estimate_minutes,tags,custom_status_id,custom_fields) SELECT organization_id,$3,project_id,section_id,$4,$5,title,description,status,starts_at,ends_at,date_provenance,position,$6,description_rich,priority,estimate_minutes,tags,custom_status_id,custom_fields FROM work_tasks WHERE organization_id=$1 AND id=$2", [ctx.org.id,child.id,childId,copiedParentId,ctx.member.id,child.subtask_group_id ? groupCopies.get(child.subtask_group_id) : null]);
              await ctx.c.query("UPDATE work_tasks SET task_checklists=$3::jsonb,external_links=$4::jsonb,planning_intent=$5::jsonb WHERE organization_id=$1 AND id=$2",[ctx.org.id,childId,JSON.stringify(freshProjectChecklists(projectChecklists(child.task_checklists),false)),JSON.stringify(child.external_links),JSON.stringify(child.planning_intent)]);
              await ctx.c.query("INSERT INTO work_assignments SELECT organization_id,$3,member_id FROM work_assignments WHERE organization_id=$1 AND task_id=$2", [ctx.org.id,child.id,childId]);
              await ctx.c.query("INSERT INTO work_checklist SELECT organization_id,gen_random_uuid(),$3,title,false FROM work_checklist WHERE organization_id=$1 AND task_id=$2", [ctx.org.id,child.id,childId]);
              for (const principal of childPrincipals) if (principal.kind === "ROLE") await ctx.c.query("INSERT INTO work_role_assignments(organization_id,task_id,role_id) VALUES($1,$2,$3)", [ctx.org.id,childId,principal.roleId]);
            }
          }
          const originalIds = [...copies.keys()];
          for (const edge of await rows(ctx, "SELECT * FROM work_dependencies WHERE organization_id=$1 AND predecessor_id=ANY($2::uuid[]) AND successor_id=ANY($2::uuid[])", [originalIds]))
            await ctx.c.query("INSERT INTO work_dependencies(organization_id,predecessor_id,successor_id,type,lag_minutes) VALUES($1,$2,$3,$4,$5)", [ctx.org.id,copies.get(edge.predecessor_id),copies.get(edge.successor_id),edge.type,edge.lag_minutes]);
          for (const link of await rows(ctx, "SELECT * FROM work_links WHERE organization_id=$1 AND task_id=ANY($2::uuid[]) AND target_task_id=ANY($2::uuid[])", [originalIds]))
            await ctx.c.query("INSERT INTO work_links(organization_id,id,task_id,target_task_id) VALUES($1,$2,$3,$4)", [ctx.org.id,uuid(),copies.get(link.task_id),copies.get(link.target_task_id)]);
        }
        await core.changed(ctx, r, tid, "TaskDuplicated");
        return { task: camel(await task(ctx, tid)) };
      },
      async (ctx, r) => {
        const source = await task(ctx, params(r).taskId, true);
        await validateTaskPrincipals(
          ctx,
          source,
          await taskPrincipals(ctx, source.id),
          options.roleCapacity,
        );
        return true;
      },
    );
    route(
      "POST",
      "/tasks/:taskId/mark-duplicate",
      async (ctx, r) => {
        const t = await task(ctx, params(r).taskId, true);
        version(r, t.version);
        const b = body(r, ["primaryId"]);
        let primary = b.primaryId
          ? await task(ctx, id(b.primaryId), true)
          : null;
        const seen = new Set([t.id]);
        while (primary) {
          if (seen.has(primary.id)) fail(422, "DUPLICATE_CYCLE");
          seen.add(primary.id);
          if (!primary.duplicate_of) break;
          primary = await task(ctx, primary.duplicate_of, true);
        }
        await ctx.c.query(
          "UPDATE work_tasks SET duplicate_of=$3 WHERE organization_id=$1 AND id=$2",
          [ctx.org.id, t.id, primary?.id ?? null],
        );
        return { task: await bump(ctx, r, t.id, "TaskMarkedDuplicate") };
      },
      taskAuth,
    );
    route(
      "POST",
      "/tasks/:taskId/checklist",
      async (ctx, r) => {
        const t = await task(ctx, params(r).taskId, true);
        version(r, t.version);
        const b = body(r, ["title", "itemId", "done"]);
        if (b.itemId) {
          if (
            !(
              await rows(
                ctx,
                "UPDATE work_checklist SET done=$4 WHERE organization_id=$1 AND task_id=$2 AND id=$3 RETURNING id",
                [t.id, id(b.itemId), boolean(b.done)],
              )
            ).length
          )
            fail(404, "RESOURCE_NOT_FOUND");
        } else
          await ctx.c.query(
            "INSERT INTO work_checklist VALUES($1,$2,$3,$4,false)",
            [ctx.org.id, uuid(), t.id, text(b.title)],
          );
        return { task: await bump(ctx, r, t.id, "TaskChecklistChanged") };
      },
      taskAuth,
    );
    route(
      "POST",
      "/tasks/:taskId/comments",
      async (ctx, r) => {
        const t = await task(ctx, params(r).taskId, true);
        version(r, t.version);
        const b = body(r, ["content"]);
        await requireWorkComments(options.comments).append(ctx, {
          ref: { type: "task", id: t.id },
          body: { content: text(b.content, 10000) },
        });
        return { task: await bump(ctx, r, t.id, "TaskCommentAdded") };
      },
      taskAuth,
    );
    route(
      "POST",
      "/tasks/:taskId/links",
      async (ctx, r) => {
        const t = await task(ctx, params(r).taskId, true);
        version(r, t.version);
        const b = body(r, ["targetTaskId"]);
        const target = await task(ctx, id(b.targetTaskId));
        if (t.id === target.id) fail(422, "SELF_LINK");
        const inserted = await ctx.c.query(
          "INSERT INTO work_links VALUES($1,$2,$3,$4) ON CONFLICT(organization_id,task_id,target_task_id) DO NOTHING RETURNING id",
          [ctx.org.id, uuid(), t.id, target.id],
        );
        return {
          task: await bump(ctx, r, t.id, "TaskLinked"),
          __workHttpStatus: inserted.rowCount ? 201 : 200,
        };
      },
      taskAuth,
    );
    async function plan(ctx: Ctx, pid: string) {
      await project(ctx, pid, true);
      const ts = await accessibleTasks(ctx, pid);
      const edges = await rows(
        ctx,
        "SELECT d.* FROM work_dependencies d JOIN work_tasks t ON t.organization_id=d.organization_id AND t.id=d.successor_id JOIN work_tasks p ON p.organization_id=d.organization_id AND p.id=d.predecessor_id WHERE d.organization_id=$1 AND t.project_id=$2 AND NOT t.archived AND NOT p.archived",
        [pid],
      );
      return previewSchedule(ts, edges);
    }
    route("GET", "/projects/:projectId/schedule", async (ctx, r) =>
      plan(ctx, params(r).projectId),
    );
    route(
      "POST",
      "/projects/:projectId/schedule/apply",
      async (ctx, r) => {
        const b = body(r, ["planHash"]);
        const p = await project(ctx, params(r).projectId, true);
        version(r, p.version);
        const current = await plan(ctx, p.id);
        if (b.planHash !== current.planHash) fail(409, "SCHEDULE_PLAN_STALE");
        for (const c of current.changes) {
          await ctx.c.query(
            "UPDATE work_tasks SET starts_at=$3,ends_at=$4,version=version+1 WHERE organization_id=$1 AND id=$2",
            [ctx.org.id, c.id, c.startsAt, c.endsAt],
          );
        }
        await ctx.c.query(
          "UPDATE work_projects SET version=version+1 WHERE organization_id=$1 AND id=$2",
          [ctx.org.id, p.id],
        );
        await core.changed(ctx, r, p.id, "ScheduleApplied");
        return {
          applied: true,
          planHash: current.planHash,
          unknown: current.unknown,
        };
      },
      projectAuth(),
    );
    route("GET", "/stats", async (ctx) => {
      const ts = await accessibleTasks(ctx);
      return {
        total: ts.length,
        byStatus: Object.fromEntries(
          statuses.map((s) => [s, ts.filter((t) => t.status === s).length]),
        ),
        undated: ts.filter((t) => !t.starts_at || !t.ends_at).length,
        completedPercent: ts.length
          ? (100 * ts.filter((t) => t.status === "DONE").length) / ts.length
          : null,
        asOf: new Date().toISOString(),
      };
    });
  };
}
export const workModule = createWorkModule();
export default workModule;

/** Ports expose authorized definitions, never table names or an unrestricted SQL writer. */
export type WorkExportOptions = { includePrivate?: boolean };
export type WorkResourceAdapterOptions = {
  publishNotification?: ModuleRuntime["publishNotification"];
  roleCapacity?: RoleCapacityPort;
  /** Enable after Platform supports task-definitions-v2 in its central transfer allowlists. */
  principalTransfers?: boolean;
  guest?: WorkGuestPort;
  privateOperationalExport?: (ctx: Ctx) => Promise<boolean> | boolean;
};
export interface WorkResourceAccessPort extends Omit<
  ResourceAccessPort,
  "authorize" | "export"
> {
  authorize(
    ctx: Ctx,
    resourceId: string,
    action: ResourceAction | "export-private",
  ): Promise<boolean>;
  export(
    ctx: Ctx,
    ids: string[],
    kind: string,
    options?: WorkExportOptions,
  ): Promise<{ records: unknown[]; coverage: string; estimated: boolean }>;
}
export function createWorkResourceAdapters(
  options: WorkResourceAdapterOptions = {},
): Record<"project" | "task", WorkResourceAccessPort> & {
  "work-export": ResourceAccessPort;
} {
  const project = (ctx: Ctx, pid: string, write = false, manage = false) =>
      nominalProject(ctx, pid, write, manage, options.guest),
    task = (ctx: Ctx, tid: string, write = false) =>
      nominalTask(ctx, tid, write, options.guest),
    accessibleTasks = (ctx: Ctx, pid?: string) =>
      nominalAccessibleTasks(ctx, pid, options.guest);
  const privateAllowed = async (ctx: Ctx) =>
    ctx.member.org_role === "OWNER" &&
    ctx.member.status === "ACTIVE" &&
    (await options.privateOperationalExport?.(ctx)) === true;
  const exportProject = async (
    ctx: Ctx,
    rid: string,
    request: WorkExportOptions = {},
  ) => {
    if (ctx.member.member_type === "GUEST") fail(403, "ACTION_DENIED");
    if (request.includePrivate !== true) return project(ctx, id(rid));
    if (!(await privateAllowed(ctx))) fail(404, "RESOURCE_NOT_FOUND");
    const p = (
      await rows(
        ctx,
        "SELECT * FROM work_projects WHERE organization_id=$1 AND id=$2 AND NOT archived",
        [id(rid)],
      )
    )[0];
    if (!p) fail(404, "RESOURCE_NOT_FOUND");
    return p;
  };
  const exportTask = async (
    ctx: Ctx,
    rid: string,
    request: WorkExportOptions = {},
  ) => {
    const t =
      request.includePrivate === true
        ? (
            await rows(
              ctx,
              "SELECT * FROM work_tasks WHERE organization_id=$1 AND id=$2 AND NOT archived",
              [id(rid)],
            )
          )[0]
        : await task(ctx, id(rid));
    if (!t || !t.project_id) fail(404, "RESOURCE_NOT_FOUND");
    await exportProject(ctx, t.project_id, request);
    return t;
  };
  const allowed = async (
    ctx: Ctx,
    rid: string,
    action: ResourceAction | "export-private",
    type: "project" | "task",
  ) => {
    if (
      ![
        "read",
        "comment",
        "attach",
        "export",
        "export-private",
        "import",
        "follow",
      ].includes(action)
    )
      return false;
    try {
      if (ctx.member.member_type === "GUEST" && action !== "read") return false;
      if (action === "export-private") {
        if (type === "project")
          await exportProject(ctx, rid, { includePrivate: true });
        else await exportTask(ctx, rid, { includePrivate: true });
        return true;
      }
      const write = ["comment", "attach", "import"].includes(action);
      if (type === "project")
        await project(ctx, rid, write, action === "import");
      else {
        const t = await task(ctx, rid, write);
        if (action === "export" && !t.project_id) return false;
      }
      return true;
    } catch (e) {
      if (e instanceof Failure && [403, 404, 409].includes(e.status))
        return false;
      throw e;
    }
  };
  // Resolve display data through the same tenant-scoped read path as authorize.
  // Inaccessible, archived and cross-organization resources remain absent.
  const lookup = async (ctx: Ctx, rid: string, type: "project" | "task") => {
    try {
      const row = type === "project" ? await project(ctx, rid) : await task(ctx, rid);
      return { id: row.id, title: row.title };
    } catch (error) {
      if (error instanceof Failure && [403, 404, 409].includes(error.status)) return null;
      throw error;
    }
  };
  const projects = async (ctx: Ctx) =>
    ctx.member.member_type === "GUEST"
      ? options.guest
        ? (
            await ctx.c.query(
              "SELECT * FROM work_projects WHERE organization_id=$1 AND id=ANY($2::uuid[]) AND NOT archived ORDER BY title,id",
              [
                ctx.org.id,
                await options.guest.guestResourceIds(ctx, {
                  context: "work",
                  kind: "project",
                  action: "read",
                }),
              ],
            )
          ).rows.map(guestProjectRow)
        : []
      : accessibleProjects(ctx, options.roleCapacity);
  const record = (value: unknown, keys: string[]) => {
    if (
      !value ||
      typeof value !== "object" ||
      Array.isArray(value) ||
      Object.keys(value).some((k) => !keys.includes(k))
    )
      fail(400, "INVALID_IMPORT_SCHEMA");
    return value as Record<string, any>;
  };
  const assertKind = (kind: string, type: string) => {
    if (
      type === "task"
        ? !["TASKS", ...(options.principalTransfers ? ["task-definitions-v2"] : [])].includes(kind)
        : kind !== type + "-definitions-v1"
    )
      fail(400, "INVALID_EXPORT_KIND");
  };
  async function logged(ctx: Ctx, rid: string, action: string) {
    await ctx.c.query(
      "UPDATE organizations SET authorization_revision=authorization_revision+1 WHERE id=$1",
      [ctx.org.id],
    );
    await event(ctx.c, ctx.org.id, ctx.account.id, rid, action, uuid());
  }
  const projectSearchText = (p: any) =>
    [
      p.title,
      p.description,
      p.section_name,
      ...(Array.isArray(p.tags) ? p.tags : []),
      ...(Array.isArray(p.project_checklists) ? p.project_checklists : [])
        .flatMap((checklist: any) => [
          checklist?.title,
          ...(Array.isArray(checklist?.items) ? checklist.items : []).map(
            (item: any) => item?.text,
          ),
        ]),
      ...(Array.isArray(p.external_links) ? p.external_links : []).map(
        (link: any) => link?.title,
      ),
      ...Object.values(
        p.custom_fields && typeof p.custom_fields === "object"
          ? p.custom_fields
          : {},
      ).flat(),
    ]
      .join(" ")
      .toLocaleLowerCase();
  const projectAdapter: WorkResourceAccessPort = {
    supportsPrivateExport:
      typeof options.privateOperationalExport === "function",
    exportKinds: ["project-definitions-v1"],
    authorize: (ctx, rid, action) => allowed(ctx, rid, action, "project"),
    lookup: (ctx, rid) => lookup(ctx, rid, "project"),
    search: async (ctx, query, limit) =>
      (await projects(ctx))
        .filter((p) =>
          projectSearchText(p).includes(query.toLocaleLowerCase()),
        )
        .slice(0, Math.min(100, Math.max(0, limit)))
        .map((p) => ({
          type: "project",
          id: p.id,
          title: p.title,
          description: p.description,
        })),
    export: async (ctx, ids, kind, request) => {
      assertKind(kind, "project");
      const records = [];
      for (const rid of ids) {
        const p = await exportProject(ctx, id(rid), request);
        records.push({
          schemaVersion: 1,
          sourceId: p.id,
          title: p.title,
          description: p.description,
          ...(p.description_rich
            ? { descriptionRich: p.description_rich }
            : {}),
          visibility: p.visibility,
          sourceOrganizationId:ctx.org.id, circleId:p.circle_id,
          startsAt:p.starts_at ? new Date(p.starts_at).toISOString() : null, endsAt:p.ends_at ? new Date(p.ends_at).toISOString() : null,
          tags:p.tags, customFields:p.custom_fields, contextLinks:p.context_links, taskStates:p.task_states, projectStateId:p.project_state_id,
          projectChecklists:p.project_checklists,externalLinks:p.external_links,leadMemberId:p.lead_member_id,planningIntent:p.planning_intent,priority:p.priority,sectionName:p.section_name,
          views: p.views,
        });
      }
      return {
        records,
        coverage:
          "Project definitions include dates, priority, section labels, tags, typed collection values, checklists, external references, planning intentions and validated context. Access grants, sections and task contents are excluded and must be configured explicitly.",
        estimated: false,
      };
    },
    validateImport: async (ctx, records, kind) => {
      assertKind(kind, "project");
      if (!Array.isArray(records) || records.length > 500)
        fail(400, "INVALID_IMPORT_SCHEMA");
      const seen = new Set<string>();
      const definitions = await collectionFieldDefinitions(ctx);
      const plan = records.map((value) => {
        const r = richDescriptionBody(
          record(value, [
            "schemaVersion",
            "sourceId",
            "title",
            "description",
            "descriptionRich",
            "visibility",
            "views", "sourceOrganizationId", "circleId", "startsAt", "endsAt", "tags", "customFields", "contextLinks", "taskStates", "projectStateId", "projectChecklists", "externalLinks", "leadMemberId", "planningIntent", "priority", "sectionName",
          ]),
        );
        if (r.schemaVersion !== 1) fail(400, "INVALID_IMPORT_SCHEMA");
        const sourceId = text(r.sourceId, 200);
        if (seen.has(sourceId)) fail(422, "DUPLICATE_IMPORT_SOURCE");
        seen.add(sourceId);
        if (!Array.isArray(r.views) || !r.views.length)
          fail(400, "VIEW_REQUIRED");
        const startsAt=date(r.startsAt),endsAt=date(r.endsAt);
        if(startsAt && endsAt && endsAt<startsAt) fail(422,"INVALID_DATE_RANGE");
        if(!Array.isArray(r.contextLinks ?? []) || (r.contextLinks ?? []).length>200 || !Array.isArray(r.taskStates ?? []) || (r.taskStates ?? []).length>50) fail(400,"INVALID_IMPORT_SCHEMA");
        const contextLinks=(r.contextLinks ?? []).map((v:any)=>{const link=record(v,["kind","targetId"]);return {kind:enumValue(link.kind,["CIRCLE","ROLE","PARTICIPANT","FOLLOWER"]),targetId:id(link.targetId)};});
        const taskStates=(r.taskStates ?? []).map((v:any)=>{const state=record(v,["id","name","semantic"]);return {id:id(state.id),name:text(state.name,100),semantic:enumValue(state.semantic,statuses)};});
        if(new Set(contextLinks.map((x:any)=>x.kind+":"+x.targetId)).size!==contextLinks.length || new Set(taskStates.map((x:any)=>x.id)).size!==taskStates.length) fail(400,"INVALID_IMPORT_SCHEMA");
        return {
          schemaVersion: 1,
          sourceOrganizationId:r.sourceOrganizationId == null ? null : id(r.sourceOrganizationId), circleId:nullableId(r.circleId), startsAt,endsAt,tags:taskProperties({tags:r.tags ?? []}).tags,customFields:customFields(r.customFields ?? {}, definitions),contextLinks,taskStates,projectStateId:nullableId(r.projectStateId),
          projectChecklists:projectChecklists(r.projectChecklists ?? []),externalLinks:externalLinks(r.externalLinks ?? []),leadMemberId:nullableId(r.leadMemberId),planningIntent:planningIntent(r.planningIntent ?? {}),priority:taskProperties({priority:r.priority}).priority,sectionName:projectSectionName(r.sectionName ?? ""),
          sourceId,
          title: text(r.title),
          description: descriptionPlain(r),
          ...(r.descriptionRich ? { descriptionRich: r.descriptionRich } : {}),
          visibility: enumValue(r.visibility, ["PUBLIC", "PRIVATE"]),
          views: [
            ...new Set(
              r.views.map((v: any) =>
                enumValue(v, ["LIST", "BOARD", "TIMELINE", "CALENDAR"]),
              ),
            ),
          ],
        };
      });
      for (const p of plan) {
        if(p.leadMemberId) await projectLead(ctx,p.leadMemberId);
        if ((p.circleId || p.contextLinks.length || p.projectStateId || p.leadMemberId) && p.sourceOrganizationId !== ctx.org.id) fail(422,"IMPORT_CONTEXT_ORGANIZATION_MISMATCH");
        for (const link of [...p.contextLinks,...(p.circleId ? [{kind:"CIRCLE",targetId:p.circleId}] : [])]) {
          if(link.kind === "CIRCLE" || link.kind === "ROLE") {if(!(await rows(ctx,"SELECT 1 FROM entities WHERE organization_id=$1 AND id=$2 AND kind=$3 AND NOT archived",[link.targetId,link.kind])).length) fail(404,"RESOURCE_NOT_FOUND");}
          else await activeMember(ctx,link.targetId);
        }
        if(p.projectStateId) {const cfg=await workSettings(ctx);if(!(cfg as any).projectStates?.some((state:any)=>state.id===p.projectStateId)) fail(422,"INVALID_PROJECT_STATE");}
      }
      return {
        plan,
        warnings: [
          "Imports create new project definitions. The importing member becomes manager; no access grant, section or task is copied.",
        ],
      };
    },
    applyImport: async (ctx, raw, kind) => {
      await workActor(ctx);
      const validated = await projectAdapter.validateImport!(
        ctx,
        raw as unknown[],
        kind,
      );
      const idMap: Record<string, string> = Object.create(null);
      for (const p of validated.plan as any[]) {
        const created = await createProjectDefinition(ctx, {
          title: p.title,
          description: p.description,
          circleId:p.circleId,
          ...(p.descriptionRich ? { descriptionRich: p.descriptionRich } : {}),
          visibility: p.visibility,
          definition: {
            views: p.views,
            sections: [],
            defaultDoneSection: null,
          },
        });
        const pid = created.id;
        await ctx.c.query("UPDATE work_projects SET starts_at=$3,ends_at=$4,tags=$5,custom_fields=$6::jsonb,context_links=$7::jsonb,task_states=$8::jsonb,project_state_id=$9 WHERE organization_id=$1 AND id=$2",[ctx.org.id,pid,p.startsAt,p.endsAt,p.tags,JSON.stringify(p.customFields),JSON.stringify(p.contextLinks),JSON.stringify(p.taskStates),p.projectStateId]);
        await ctx.c.query("UPDATE work_projects SET project_checklists=$3::jsonb,external_links=$4::jsonb,lead_member_id=$5,planning_intent=$6::jsonb WHERE organization_id=$1 AND id=$2",[ctx.org.id,pid,JSON.stringify(freshProjectChecklists(p.projectChecklists,false)),JSON.stringify(p.externalLinks.map((l:any)=>({...l,id:uuid()}))),p.leadMemberId,JSON.stringify(p.planningIntent)]);
        await ctx.c.query("UPDATE work_projects SET priority=$3,section_name=$4 WHERE organization_id=$1 AND id=$2",[ctx.org.id,pid,p.priority,p.sectionName]);
        await logged(ctx, pid, "ProjectDefinitionImported");
        idMap[p.sourceId] = pid;
      }
      return { idMap };
    },
  };
  const taskAdapter: WorkResourceAccessPort = {
    supportsPrivateExport:
      typeof options.privateOperationalExport === "function",
    exportKinds: options.principalTransfers
      ? ["TASKS", "STATISTICS", "task-definitions-v2"]
      : ["TASKS", "STATISTICS"],
    authorize: (ctx, rid, action) => allowed(ctx, rid, action, "task"),
    lookup: (ctx, rid) => lookup(ctx, rid, "task"),
    search: async (ctx, query, limit) =>
      (await accessibleTasks(ctx))
        .filter((t) =>
          (t.title + " " + t.description)
            .toLocaleLowerCase()
            .includes(query.toLocaleLowerCase()),
        )
        .slice(0, Math.min(100, Math.max(0, limit)))
        .map((t) => ({
          type: "task",
          id: t.id,
          title: t.title,
          description: t.description,
        })),
    export: async (ctx, ids, kind, request) => {
      if (kind === "STATISTICS") {
        const ts: {
          status: string;
          starts_at: Date | string | null;
          ends_at: Date | string | null;
        }[] = [];
        for (const rid of [...new Set(ids)])
          ts.push(await exportTask(ctx, id(rid), request));
        return {
          records: [
            {
              schemaVersion: 1,
              total: ts.length,
              byStatus: Object.fromEntries(
                statuses.map((s) => [
                  s,
                  ts.filter((t) => t.status === s).length,
                ]),
              ),
              undated: ts.filter((t) => !t.starts_at || !t.ends_at).length,
              completedPercent: ts.length
                ? (100 * ts.filter((t) => t.status === "DONE").length) /
                  ts.length
                : null,
              asOf: new Date().toISOString(),
            },
          ],
          coverage:
            "Aggregated statistics of exactly the selected authorized task IDs; task definitions, titles and contents are omitted. Empty selection has unknown completion rate.",
          estimated: false,
        };
      }
      assertKind(kind, "task");
      const records = [];
      for (const rid of ids) {
        const t = await exportTask(ctx, id(rid), request);
        records.push({
          schemaVersion: kind === "task-definitions-v2" ? 2 : 1,
          ...(kind === "task-definitions-v2"
            ? {
                sourceOrganizationId: ctx.org.id,
                projectId: t.project_id,
                principals: await taskPrincipals(ctx, t.id),
              }
            : {}),
          sourceId: t.id,
          title: t.title,
          description: t.description,
          ...(t.description_rich
            ? { descriptionRich: t.description_rich }
            : {}),
          status: t.status,
          ...taskProperties({}, t),
          customFields:t.custom_fields,
          taskChecklists:t.task_checklists,externalLinks:t.external_links,planningIntent:t.planning_intent,
          startsAt: t.starts_at ? new Date(t.starts_at).toISOString() : null,
          endsAt: t.ends_at ? new Date(t.ends_at).toISOString() : null,
          dateProvenance: t.date_provenance,
        });
      }
      return {
        records,
        coverage:
          kind === "task-definitions-v2"
            ? "Task definitions v2 with typed MEMBER/ROLE references in this organization. Current role occupants and their authority are not persisted or granted by transfer. Same-organization destination ACL and assignment policy are revalidated on import."
            : "Task definitions include intrinsic content, typed collection values, grouped checklists, external references and planning intentions. Import creates personal tasks unless an authorized local projectId is supplied; assignments, legacy checklist rows, comments, task-to-task links, subtasks and dependencies are excluded.",
        estimated: false,
      };
    },
    validateImport: async (ctx, records, kind) => {
      if (kind === "STATISTICS") fail(422, "STATISTICS_IMPORT_NOT_SUPPORTED");
      assertKind(kind, "task");
      if (!Array.isArray(records) || records.length > 500)
        fail(400, "INVALID_IMPORT_SCHEMA");
      const seen = new Set<string>();
      const plan = [];
      for (const value of records) {
        const r = richDescriptionBody(
          record(value, [
            "schemaVersion",
            ...(kind === "task-definitions-v2"
              ? ["sourceOrganizationId", "principals"]
              : []),
            "sourceId",
            "title",
            "description",
            "descriptionRich",
            "status",
            "startsAt",
            "endsAt",
            "dateProvenance",
            "projectId",
            "priority",
            "estimateMinutes",
            "tags", "customFields", "taskChecklists", "externalLinks", "planningIntent",
          ]),
        );
        if (r.schemaVersion !== (kind === "task-definitions-v2" ? 2 : 1))
          fail(400, "INVALID_IMPORT_SCHEMA");
        if (
          kind === "task-definitions-v2" &&
          r.sourceOrganizationId !== ctx.org.id
        )
          fail(422, "ASSIGNMENT_IMPORT_ORG_MISMATCH");
        const sourceId = text(r.sourceId, 200);
        if (seen.has(sourceId)) fail(422, "DUPLICATE_IMPORT_SOURCE");
        seen.add(sourceId);
        const pid = nullableId(r.projectId);
        if (pid) await project(ctx, pid, true);
        const principals =
          kind === "task-definitions-v2"
            ? parseTaskPrincipals({ principals: r.principals }).principals
            : undefined;
        if (principals) {
          if (pid) {
            const target = await project(ctx, pid, true);
            if (!canAssignProject(ctx, target)) fail(403, "ASSIGNMENT_DENIED");
            if (target.assignment_mode === "SINGLE" && principals.length > 1)
              fail(422, "ASSIGNMENT_LIMIT");
          }
          await validateTaskPrincipals(
            ctx,
            { project_id: pid, creator_id: ctx.member.id },
            principals,
            options.roleCapacity,
          );
        }
        const start = date(r.startsAt),
          end = date(r.endsAt);
        if (start && end && end < start) fail(422, "INVALID_DATE_RANGE");
        plan.push({
          schemaVersion: kind === "task-definitions-v2" ? 2 : 1,
          ...(principals
            ? { sourceOrganizationId: ctx.org.id, principals }
            : {}),
          sourceId,
          title: text(r.title),
          description: descriptionPlain(r),
          ...(r.descriptionRich ? { descriptionRich: r.descriptionRich } : {}),
          status: enumValue(r.status, statuses),
          ...taskProperties(r),
          customFields:await collectionCustomFields(ctx,r.customFields ?? {}),
          taskChecklists:projectChecklists(r.taskChecklists ?? []),externalLinks:externalLinks(r.externalLinks ?? []),planningIntent:planningIntent(r.planningIntent ?? {}),
          startsAt: start,
          endsAt: end,
          dateProvenance: enumValue(r.dateProvenance ?? "USER_ENTERED", [
            "USER_ENTERED",
            "SYNTHETIC_TEST",
          ]),
          projectId: pid,
        });
      }
      return {
        plan,
        warnings: [
          kind === "task-definitions-v2"
            ? "Definitions v2 preserve typed principal references within the same organization. Task/project ACL and role capacity are revalidated; this does not copy grants or frozen occupants."
            : "Definitions with intrinsic content, typed values, grouped checklists, external references and planning intentions. Dependencies, subtasks, grants, comments, legacy checklist and assignments are excluded. Unspecified destination creates private personal tasks.",
        ],
      };
    },
    applyImport: async (ctx, raw, kind) => {
      await workActor(ctx);
      const validated = await taskAdapter.validateImport!(
        ctx,
        raw as unknown[],
        kind,
      );
      const idMap: Record<string, string> = Object.create(null);
      for (const t of validated.plan as any[]) {
        const tid = uuid();
        const p = t.projectId ? await project(ctx, t.projectId, true) : null;
        const placement = p
          ? await sectionStatus(ctx, p, null, t.status, true)
          : { sectionId: null, status: t.status };
        await ctx.c.query(
          "INSERT INTO work_tasks(organization_id,id,creator_id,project_id,section_id,title,description,status,starts_at,ends_at,date_provenance,description_rich,priority,estimate_minutes,tags,custom_fields) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16::jsonb)",
          [
            ctx.org.id,
            tid,
            ctx.member.id,
            t.projectId,
            placement.sectionId,
            t.title,
            t.description,
            placement.status,
            t.startsAt,
            t.endsAt,
            t.dateProvenance,
            nextRichDescription(t),
            t.priority,
            t.estimateMinutes,
            t.tags,
            JSON.stringify(t.customFields),
          ],
        );
        if (t.principals) await storeTaskPrincipals(ctx, tid, t.principals, options.publishNotification, options.roleCapacity);
        await ctx.c.query("UPDATE work_tasks SET task_checklists=$3::jsonb,external_links=$4::jsonb,planning_intent=$5::jsonb WHERE organization_id=$1 AND id=$2",[ctx.org.id,tid,JSON.stringify(freshProjectChecklists(t.taskChecklists,false)),JSON.stringify(t.externalLinks.map((l:any)=>({...l,id:uuid()}))),JSON.stringify(t.planningIntent)]);
        await logged(ctx, tid, "TaskDefinitionImported");
        idMap[t.sourceId] = tid;
      }
      return { idMap };
    },
  };
  return {
    project: projectAdapter,
    task: taskAdapter,
    "work-export": createOrganizationExportAdapter(options, {
      project,
      mayCreate: mayCreateWork,
    }),
  };
}

export {
  project as authorizedProject,
  task as authorizedTask,
  accessibleTasks as listAccessibleTasks,
};

export { createWorkGuestAccessAdapter } from "./guest.js";
export type { WorkGuestPort } from "./guest.js";

export { createWorkLegacyCommentSource } from "./comments-legacy.js";

/** Work-owned trace lookup; this does not grant access through another resource. */
export function createWorkTraceReader(core: import('../../src/runtime.js').ModuleRuntime) {
 return async (ctx:Ctx,rid:string):Promise<import('../../src/traceability.js').TraceReference|null>=>{
  if(ctx.member.member_type==='GUEST')return null;
  try {await core.assertModuleAvailable(ctx,'work');const row=await nominalTask(ctx,rid);return {kind:'TASK',id:row.id,title:row.title};}
  catch(e){if(e instanceof Failure && [403,404].includes(e.status))return null;throw e;}
 };
}
