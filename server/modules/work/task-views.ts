import type { Ctx, OrgMapModule } from "../../src/runtime.js";
import { body, fail, id, optionalText, text, version } from "../../src/core.js";
import { closedRecord } from "./project-content.js";
import { workActor } from "./statistics.js";

export function workTaskViews(options: { project: (ctx: Ctx, id: string) => Promise<any>; mayCreate: (ctx: Ctx) => boolean; tasks: (ctx: Ctx, id: string) => Promise<any[]> }): OrgMapModule {
  return async (app, core) => {
    const base = "/api/v1/organizations/:organizationId/work/task-views";
    const pick = (value: unknown, allowed: string[]) => typeof value === "string" && allowed.includes(value) ? value : fail(400, "INVALID_TASK_VIEW");
    const filterVisible = async (ctx: Ctx, projectId: string, views: any[]) => {
      const visible = views.some(v => v.orderIds.length) ? new Set((await ctx.c.query("SELECT id FROM work_tasks WHERE organization_id=$1 AND project_id=$2",[ctx.org.id,projectId])).rows.map(t=>t.id)) : new Set<string>();
      return views.map(v => ({ ...v, orderIds: v.orderIds.filter((tid: string) => visible.has(tid)) }));
    };
    app.get(base, r => core.tenant(r, { mode: "read" }, async ctx => {
      if (ctx.member.member_type === "GUEST") fail(404, "RESOURCE_NOT_FOUND");
      const q = closedRecord(r.query, ["projectId"]), pid = id(q.projectId);
      await options.project(ctx, pid);
      const saved = (await ctx.c.query("SELECT task_views,task_views_version FROM work_layouts WHERE organization_id=$1 AND member_id=$2 AND scope=$3", [ctx.org.id, ctx.member.id, "PROJECT:" + pid])).rows[0];
      return { views: await filterVisible(ctx, pid, saved?.task_views ?? []), version: saved?.task_views_version ?? 0 };
    }));
    app.post(base, r => core.tenant(r, { mode: "write", authorize: async ctx => { if (!options.mayCreate(ctx)) return false; const b = body(r, ["projectId", "views"]); await options.project(ctx, id(b.projectId)); return true; } }, async ctx => {
      await workActor(ctx); const b = body(r, ["projectId", "views"]), pid = id(b.projectId), project = await options.project(ctx, pid), scope = "PROJECT:" + pid;
      const saved = (await ctx.c.query("SELECT task_views_version FROM work_layouts WHERE organization_id=$1 AND member_id=$2 AND scope=$3", [ctx.org.id, ctx.member.id, scope])).rows[0];
      version(r, saved?.task_views_version ?? 0);
      if (!Array.isArray(b.views) || b.views.length > 20) fail(400, "INVALID_TASK_VIEW");
      const views = b.views.map((raw: unknown) => {
        const v = closedRecord(raw, ["id", "name", "view", "query", "sort", "grouping", "personFilter", "roleFilter", "circleFilter", "statusFilter", "tagFilter", "visibleProperties", "archived", "archiveMode", "orderIds"]);
        if (!Array.isArray(v.visibleProperties ?? []) || !Array.isArray(v.orderIds ?? []) || (v.orderIds ?? []).length > 5000 || v.archived !== undefined && typeof v.archived !== "boolean") fail(400, "INVALID_TASK_VIEW");
        const properties = (v.visibleProperties ?? ["state", "participants", "due"]).map((x: unknown) => pick(x, ["state", "participants", "due"])), orderIds = (v.orderIds ?? []).map(id);
        if (new Set(properties).size !== properties.length || new Set(orderIds).size !== orderIds.length) fail(400, "INVALID_TASK_VIEW");
        const status = optionalText(v.statusFilter, 80);
        if (status && !["TODO", "IN_PROGRESS", "BLOCKED", "DONE"].includes(status) && !(status.startsWith("custom:") && (project.task_states ?? []).some((s: any) => s.id === status.slice(7)))) fail(422, "INVALID_TASK_STATE");
        return { id: id(v.id), name: text(v.name, 100), view: pick(v.view, ["LIST", "BOARD", "GALLERY", "TIMELINE", "CALENDAR"]), query: optionalText(v.query, 200), sort: pick(v.sort ?? "POSITION", ["POSITION", "TITLE", "DUE", "PRIORITY"]), grouping: pick(v.grouping ?? "SECTION", ["SECTION", "STATUS", "PROJECT", "NONE", "CIRCLE"]), personFilter: v.personFilter ? id(v.personFilter) : "", roleFilter: v.roleFilter ? id(v.roleFilter) : "", circleFilter: v.circleFilter ? id(v.circleFilter) : "", statusFilter: status, tagFilter: optionalText(v.tagFilter, 50), visibleProperties: properties, archived: v.archived ?? false,archiveMode:pick(v.archiveMode ?? (v.archived ? "ARCHIVED" : "ACTIVE"),["ACTIVE","ARCHIVED","ALL"]), orderIds };
      });
      if (new Set(views.map((v: any) => v.id)).size !== views.length) fail(400, "INVALID_TASK_VIEW");
      const visibleTasks = new Set((await ctx.c.query("SELECT id FROM work_tasks WHERE organization_id=$1 AND project_id=$2",[ctx.org.id,pid])).rows.map(t=>t.id));
      for (const view of views) {
        if (!project.views.includes(view.view === "GALLERY" ? "LIST" : view.view)) fail(422,"VIEW_DISABLED");
        if (view.orderIds.some((tid: string) => !visibleTasks.has(tid))) fail(404, "RESOURCE_NOT_FOUND");
        if (view.personFilter && !(await ctx.c.query("SELECT id FROM members WHERE organization_id=$1 AND id=$2 AND status='ACTIVE'", [ctx.org.id, view.personFilter])).rowCount) fail(404, "RESOURCE_NOT_FOUND");
        if (view.roleFilter) await core.get(ctx.c, ctx.org.id, view.roleFilter, "ROLE");
        if (view.circleFilter) await core.get(ctx.c, ctx.org.id, view.circleFilter, "CIRCLE");
      }
      const row = (await ctx.c.query("INSERT INTO work_layouts(organization_id,member_id,scope,project_id,view,sort,grouping,version,task_views,task_views_version) VALUES($1,$2,$3,$4,'LIST','POSITION','SECTION',0,$5::jsonb,1) ON CONFLICT(organization_id,member_id,scope) DO UPDATE SET task_views=EXCLUDED.task_views,task_views_version=work_layouts.task_views_version+1 RETURNING task_views,task_views_version", [ctx.org.id, ctx.member.id, scope, pid, JSON.stringify(views)])).rows[0];
      await core.changed(ctx, r, pid, "TaskViewsSaved"); return { views: row.task_views, version: row.task_views_version };
    }));
  };
}
