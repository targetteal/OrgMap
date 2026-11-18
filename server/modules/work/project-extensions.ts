import type { Ctx, OrgMapModule } from "../../src/runtime.js";
import { body, camel, fail, id, text, uuid, version } from "../../src/core.js";
import { projectChecklists, fieldDefinitions, validFieldValue, freshProjectChecklists, externalLinks } from "./project-content.js";
import type { WorkActivityPort } from "./activity-contract.js";
import { collectionFieldDefinitions } from "./custom-fields.js";
import { workActor } from "./statistics.js";
import { requireCircleProjectCapacity, requireProjectConfigurationMutable } from "./policy.js";
import { validateProjectDefinition } from "./templates.js";

type ProjectAuthorization = (ctx: Ctx, id: string, write?: boolean, manage?: boolean) => Promise<any>;
export const duplicateProjectPolicy = {
  copied: ["CONTENT", "DATES", "TAGS", "DESCRIPTIVE_CONTEXT", "SECTIONS", "TASKS", "SUBTASK_GROUPS", "INTERNAL_DEPENDENCIES", "CHECKLISTS", "CUSTOM_VALUES"],
  excluded: ["ACCESS_GRANTS", "ASSIGNMENTS", "COMMENTS", "ATTACHMENTS", "HISTORY", "EXTERNAL_DEPENDENCIES", "ORIGIN_TRACES"],
  access: "CREATOR_MANAGER_WITH_SOURCE_VISIBILITY",
};

async function snapshot(ctx: Ctx, p: any) {
  const query = async (sql: string) => (await ctx.c.query(sql, [ctx.org.id, p.id])).rows;
  const sections = await query("SELECT * FROM work_sections WHERE organization_id=$1 AND project_id=$2 ORDER BY position,id");
  const tasks = await query(`SELECT t.* FROM work_tasks t WHERE t.organization_id=$1 AND t.project_id=$2 AND NOT t.archived AND NOT EXISTS (WITH RECURSIVE ancestors AS (SELECT id,parent_id,archived FROM work_tasks WHERE organization_id=$1 AND id=t.parent_id UNION SELECT a.id,a.parent_id,a.archived FROM work_tasks a JOIN ancestors b ON a.id=b.parent_id WHERE a.organization_id=$1) SELECT 1 FROM ancestors WHERE archived) ORDER BY position,id`);
  if (tasks.length > 1000) fail(422, "PROJECT_COPY_TOO_LARGE");
  const ids = tasks.map(t => t.id), lookup = async (sql: string) => (await ctx.c.query(sql, [ctx.org.id, ids])).rows;
  const groups = await lookup("SELECT * FROM work_subtask_groups WHERE organization_id=$1 AND parent_task_id=ANY($2::uuid[]) ORDER BY position,id");
  const dependencies = await lookup("SELECT * FROM work_dependencies WHERE organization_id=$1 AND predecessor_id=ANY($2::uuid[]) AND successor_id=ANY($2::uuid[])");
  const checklist = await lookup("SELECT * FROM work_checklist WHERE organization_id=$1 AND task_id=ANY($2::uuid[]) ORDER BY id");
  return { sections, tasks, groups, dependencies, checklist };
}

export function workProjectExtensions(options: { project: ProjectAuthorization; task: (ctx: Ctx, id: string, write?: boolean) => Promise<any>; mayCreate: (ctx: Ctx) => boolean; tasks: (ctx: Ctx, id: string) => Promise<any[]>; activity?: WorkActivityPort }): OrgMapModule {
  return async (app, core) => {
    const base = "/api/v1/organizations/:organizationId/work", projectId = (r: any) => id(r.params.projectId);
    app.get(base + "/tasks/:taskId/archived", r => core.tenant(r, { mode: "read" }, async ctx => {
      if (ctx.member.member_type === "GUEST") fail(404,"RESOURCE_NOT_FOUND");
      const tid=id((r.params as any).taskId), t=(await ctx.c.query("SELECT * FROM work_tasks WHERE organization_id=$1 AND id=$2",[ctx.org.id,tid])).rows[0];
      if(!t)fail(404,"RESOURCE_NOT_FOUND");
      if(t.project_id)await options.project(ctx,t.project_id); else if(t.creator_id!==ctx.member.id)fail(404,"RESOURCE_NOT_FOUND");
      const ancestorArchived=t.parent_id && (await ctx.c.query("WITH RECURSIVE ancestors AS (SELECT id,parent_id,archived FROM work_tasks WHERE organization_id=$1 AND id=$2 UNION SELECT p.id,p.parent_id,p.archived FROM work_tasks p JOIN ancestors a ON p.id=a.parent_id WHERE p.organization_id=$1) SELECT 1 FROM ancestors WHERE archived LIMIT 1",[ctx.org.id,t.parent_id])).rowCount;
      if(!t.archived && !ancestorArchived)fail(404,"RESOURCE_NOT_FOUND");
      const query=async(sql:string)=>(await ctx.c.query(sql,[ctx.org.id,t.id])).rows.map(camel);
      return {task:{...camel(t),sourceTensionId:null,duplicateOf:null,archivedByAncestor:!!ancestorArchived},checklist:await query("SELECT * FROM work_checklist WHERE organization_id=$1 AND task_id=$2 ORDER BY id"),groups:await query("SELECT * FROM work_subtask_groups WHERE organization_id=$1 AND parent_task_id=$2 ORDER BY position,id"),assignments:[],principals:[],resolvedAssignees:[],roleCapacities:[],dependencies:[],links:[],comments:[],commentsComplete:false,commentsSource:"RESTORE_REQUIRED",capabilities:{edit:false,assign:false,roleAssignment:false},coverage:"ARCHIVED_WORK_CONTENT_ONLY"};
    }));
    app.get(base + "/field-definitions", r => core.tenant(r, { mode: "read" }, async ctx => {
      if (ctx.member.member_type === "GUEST") fail(404, "RESOURCE_NOT_FOUND");
      const row = (await ctx.c.query("SELECT custom_field_definitions,version FROM work_settings WHERE organization_id=$1", [ctx.org.id])).rows[0];
      return { definitions: row?.custom_field_definitions ?? [], version: row?.version ?? 0, canManage: ctx.member.org_role === "OWNER" };
    }));
    app.post(base + "/field-definitions", r => core.tenant(r, { mode: "write", authorize: ctx => options.mayCreate(ctx) && ctx.member.org_role === "OWNER" }, async ctx => {
      await workActor(ctx); await requireProjectConfigurationMutable(ctx);
      const definitions = fieldDefinitions(body(r, ["definitions"]).definitions);
      const row = (await ctx.c.query("SELECT version FROM work_settings WHERE organization_id=$1", [ctx.org.id])).rows[0];
      version(r, row?.version ?? 0);
      const old = await collectionFieldDefinitions(ctx);
      // Never turn stored values into invalid, orphaned or silently retyped content.
      for (const field of old) {
        const next = definitions.find(f => f.id === field.id);
        const values = (await ctx.c.query("SELECT custom_fields->$2 AS value FROM work_projects WHERE organization_id=$1 AND custom_fields ? $2 UNION ALL SELECT custom_fields->$2 AS value FROM work_tasks WHERE organization_id=$1 AND custom_fields ? $2", [ctx.org.id, field.id])).rows;
        if (values.length && (!next || next.type !== field.type || values.some(v => !validFieldValue(next, v.value)))) fail(409, "CUSTOM_FIELD_IN_USE");
      }
      const saved = (await ctx.c.query("INSERT INTO work_settings(organization_id,custom_field_definitions,version) VALUES($1,$2::jsonb,1) ON CONFLICT(organization_id) DO UPDATE SET custom_field_definitions=EXCLUDED.custom_field_definitions,version=work_settings.version+1 RETURNING custom_field_definitions,version", [ctx.org.id, JSON.stringify(definitions)])).rows[0];
      await core.changed(ctx, r, ctx.org.id, "CustomFieldDefinitionsConfigured");
      return { definitions: saved.custom_field_definitions, version: saved.version };
    }));
    app.patch(base + "/projects/:projectId/checklists", r => core.tenant(r, { mode: "write", authorize: async ctx => { await options.project(ctx, projectId(r), true); return true; } }, async ctx => {
      await workActor(ctx); const p = await options.project(ctx, projectId(r), true); version(r, p.version);
      const checklists = projectChecklists(body(r, ["checklists"]).checklists);
      const saved = (await ctx.c.query("UPDATE work_projects SET project_checklists=$3::jsonb,version=version+1 WHERE organization_id=$1 AND id=$2 RETURNING *", [ctx.org.id, p.id, JSON.stringify(checklists)])).rows[0];
      await core.changed(ctx, r, p.id, "ProjectChecklistsChanged"); return { project: camel(saved) };
    }));
    app.patch(base + "/tasks/:taskId/checklists", r => core.tenant(r, { mode: "write", authorize: async ctx => { await options.task(ctx, id((r.params as any).taskId), true); return true; } }, async ctx => {
      await workActor(ctx); const t = await options.task(ctx, id((r.params as any).taskId), true); version(r, t.version);
      const checklists = projectChecklists(body(r, ["checklists"]).checklists);
      const saved = (await ctx.c.query("UPDATE work_tasks SET task_checklists=$3::jsonb,version=version+1 WHERE organization_id=$1 AND id=$2 RETURNING *", [ctx.org.id,t.id,JSON.stringify(checklists)])).rows[0];
      await core.changed(ctx, r, t.id, "TaskGroupedChecklistsChanged"); return { task: { ...camel(saved), sourceTensionId: null, duplicateOf:null } };
    }));
    for (const kind of ["project", "task"] as const) {
      const path = kind === "project" ? "/projects/:projectId" : "/tasks/:taskId";
      const resourceId = (r: any) => kind === "project" ? projectId(r) : id(r.params.taskId);
      const authorize = (ctx: Ctx, r: any, write = false) => kind === "project" ? options.project(ctx, resourceId(r), write) : options.task(ctx, resourceId(r), write);
      app.patch(base + path + (kind === "project" ? "/links" : "/external-links"), r => core.tenant(r, { mode: "write", authorize: async ctx => { await authorize(ctx, r, true); return true; } }, async ctx => {
        await workActor(ctx); const resource = await authorize(ctx, r, true); version(r, resource.version);
        const links = externalLinks(body(r, ["links"]).links);
        const table = kind === "project" ? "work_projects" : "work_tasks";
        const saved = (await ctx.c.query(`UPDATE ${table} SET external_links=$3::jsonb,version=version+1 WHERE organization_id=$1 AND id=$2 RETURNING *`, [ctx.org.id, resource.id, JSON.stringify(links)])).rows[0];
        await core.changed(ctx, r, resource.id, kind === "project" ? "ProjectExternalLinksChanged" : "TaskExternalLinksChanged");
        return { [kind]: { ...camel(saved), ...(kind === "task" ? { sourceTensionId: null, duplicateOf:null } : {}) } };
      }));
      app.get(base + path + "/activity", r => core.tenant(r, { mode: "read" }, async ctx => {
        if (ctx.member.member_type === "GUEST") fail(404, "RESOURCE_NOT_FOUND");
        const resource = await authorize(ctx, r);
        if (!options.activity) fail(503, "WORK_ACTIVITY_UNAVAILABLE");
        const ids = kind === "project" ? [resource.id, ...(await options.tasks(ctx, resource.id)).map(t => t.id)] : [resource.id];
        if (ids.length > 5001) fail(422, "ACTIVITY_SCOPE_TOO_LARGE");
        return options.activity!.read(ctx, { resourceIds: ids, limit: 100 });
      }));
    }
    app.post(base + "/projects/:projectId/duplicate", async (r, reply) => {
      const result = await core.tenant(r, { mode: "write", authorize: async ctx => { if (!options.mayCreate(ctx)) return false; await options.project(ctx, projectId(r), true, true); return true; } }, async ctx => {
        await workActor(ctx); const p = await options.project(ctx, projectId(r), true, true); version(r, p.version);
        const input = body(r, ["title"]); await requireCircleProjectCapacity(ctx, p.circle_id);
        const content = await snapshot(ctx, p), pid = uuid(), title = text(input.title ?? (p.title.slice(0, 190) + " · cópia"));
        const taskStates = (p.task_states ?? []).map((state: any) => ({ ...state, id: uuid() }));
        const stateIds = new Map<string, string>((p.task_states ?? []).map((state: any, index: number) => [state.id, taskStates[index].id]));
        await ctx.c.query("INSERT INTO work_projects(organization_id,id,title,description,description_rich,visibility,creator_id,views,circle_id,assignment_mode,assignment_permission,starts_at,ends_at,tags,context_links,task_states,project_state_id,custom_fields,project_checklists) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15::jsonb,$16::jsonb,$17,$18::jsonb,$19::jsonb)", [ctx.org.id, pid, title, p.description, p.description_rich, p.visibility, ctx.member.id, p.views, p.circle_id, p.assignment_mode, p.assignment_permission, p.starts_at, p.ends_at, p.tags, JSON.stringify(p.context_links), JSON.stringify(taskStates), p.project_state_id, JSON.stringify(p.custom_fields), JSON.stringify(freshProjectChecklists(projectChecklists(p.project_checklists), false))]);
        await ctx.c.query("INSERT INTO work_access(organization_id,project_id,member_id,role) VALUES($1,$2,$3,'MANAGER')", [ctx.org.id, pid, ctx.member.id]);
        const lead = p.lead_member_id && (await ctx.c.query("SELECT 1 FROM members WHERE organization_id=$1 AND id=$2 AND status='ACTIVE' AND member_type<>'GUEST'", [ctx.org.id,p.lead_member_id])).rowCount ? p.lead_member_id : null;
        await ctx.c.query("UPDATE work_projects SET lead_member_id=$3,external_links=$4::jsonb,planning_intent=$5::jsonb WHERE organization_id=$1 AND id=$2", [ctx.org.id,pid,lead,JSON.stringify(externalLinks(p.external_links).map(l=>({...l,id:uuid()}))),JSON.stringify(p.planning_intent)]);
        await ctx.c.query("UPDATE work_projects SET priority=$3,section_name=$4 WHERE organization_id=$1 AND id=$2",[ctx.org.id,pid,p.priority,p.section_name]);
        const sectionIds = new Map<string, string>(), taskIds = new Map<string, string>(content.tasks.map(t => [t.id, uuid()])), groupIds = new Map<string, string>(content.groups.map(g => [g.id, uuid()]));
        for (const s of content.sections) { const sid = uuid(); sectionIds.set(s.id, sid); await ctx.c.query("INSERT INTO work_sections(organization_id,id,project_id,name,semantic,position) VALUES($1,$2,$3,$4,$5,$6)", [ctx.org.id, sid, pid, s.name, s.semantic, s.position]); }
        if (p.default_done_section_id) await ctx.c.query("UPDATE work_projects SET default_done_section_id=$3 WHERE organization_id=$1 AND id=$2", [ctx.org.id, pid, sectionIds.get(p.default_done_section_id)]);
        const pending = [...content.tasks], copied = new Set<string>();
        while (pending.length) {
          const at = pending.findIndex(t => !t.parent_id || copied.has(t.parent_id));
          if (at < 0) fail(422, "TASK_TREE_INVALID_OR_TOO_LARGE");
          const [t] = pending.splice(at, 1), tid = taskIds.get(t.id)!;
          await ctx.c.query("INSERT INTO work_tasks(organization_id,id,project_id,section_id,parent_id,creator_id,title,description,description_rich,status,starts_at,ends_at,date_provenance,position,priority,estimate_minutes,tags,custom_status_id,custom_fields) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19::jsonb)", [ctx.org.id, tid, pid, sectionIds.get(t.section_id) ?? null, taskIds.get(t.parent_id) ?? null, ctx.member.id, t.title, t.description, t.description_rich, t.status, t.starts_at, t.ends_at, t.date_provenance, t.position, t.priority, t.estimate_minutes, t.tags, stateIds.get(t.custom_status_id) ?? null, JSON.stringify(t.custom_fields)]);
          copied.add(t.id);
          await ctx.c.query("UPDATE work_tasks SET external_links=$3::jsonb,task_checklists=$4::jsonb,planning_intent=$5::jsonb WHERE organization_id=$1 AND id=$2", [ctx.org.id,tid,JSON.stringify(externalLinks(t.external_links).map(l=>({...l,id:uuid()}))),JSON.stringify(freshProjectChecklists(projectChecklists(t.task_checklists),false)),JSON.stringify(t.planning_intent)]);
          for (const g of content.groups) if (g.parent_task_id === t.id) await ctx.c.query("INSERT INTO work_subtask_groups(organization_id,id,parent_task_id,name,position) VALUES($1,$2,$3,$4,$5)", [ctx.org.id, groupIds.get(g.id), tid, g.name, g.position]);
          if (t.subtask_group_id) await ctx.c.query("UPDATE work_tasks SET subtask_group_id=$3 WHERE organization_id=$1 AND id=$2", [ctx.org.id, tid, groupIds.get(t.subtask_group_id)]);
          for (const c of content.checklist) if (c.task_id === t.id) await ctx.c.query("INSERT INTO work_checklist(organization_id,id,task_id,title,done) VALUES($1,$2,$3,$4,$5)", [ctx.org.id, uuid(), tid, c.title, c.done]);
        }
        for (const e of content.dependencies) await ctx.c.query("INSERT INTO work_dependencies(organization_id,predecessor_id,successor_id,type,lag_minutes) VALUES($1,$2,$3,$4,$5)", [ctx.org.id, taskIds.get(e.predecessor_id), taskIds.get(e.successor_id), e.type, e.lag_minutes]);
        await core.changed(ctx, r, pid, "ProjectDuplicated");
        return { project: camel(await options.project(ctx, pid)), copyPolicy: duplicateProjectPolicy };
      });
      // An old command result must still satisfy the destination's current ACL.
      await core.tenant(r, { mode: "read" }, async ctx => { await options.project(ctx, result.data.project.id); return null; });
      return reply.code(201).send(result);
    });
    app.post(base + "/projects/:projectId/template", async (r, reply) => reply.code(201).send(await core.tenant(r, { mode: "write", authorize: async ctx => { if (!options.mayCreate(ctx) || ctx.member.org_role !== "OWNER") return false; await options.project(ctx, projectId(r), true, true); return true; } }, async ctx => {
      await workActor(ctx); const p = await options.project(ctx, projectId(r), true, true); version(r, p.version);
      const name = text(body(r, ["name"]).name), content = await snapshot(ctx, p);
      const definition = validateProjectDefinition({ views: p.views, sections: content.sections.map(s => ({ name: s.name, semantic: s.semantic })), defaultDoneSection: p.default_done_section_id ? content.sections.findIndex(s => s.id === p.default_done_section_id) : null, description: p.description, ...(p.description_rich ? { descriptionRich: p.description_rich } : {}), tags: p.tags, checklists: freshProjectChecklists(projectChecklists(p.project_checklists), true), links: externalLinks(p.external_links), tasks: content.tasks.map(t => ({ id: t.id, title: t.title, description: t.description, ...(t.description_rich ? { descriptionRich: t.description_rich } : {}), parentId: t.parent_id, groupId: t.subtask_group_id, sectionIndex: t.section_id ? content.sections.findIndex(s => s.id === t.section_id) : null, startsAt: t.starts_at ? new Date(t.starts_at).toISOString() : null, endsAt: t.ends_at ? new Date(t.ends_at).toISOString() : null, priority: t.priority, estimateMinutes: t.estimate_minutes, tags: t.tags, position: t.position, links: externalLinks(t.external_links), checklists: freshProjectChecklists(projectChecklists(t.task_checklists),true),planningIntent:t.planning_intent, checklist: content.checklist.filter(c => c.task_id === t.id).map(c => c.title) })), groups: content.groups.map(g => ({ id: g.id, parentId: g.parent_task_id, name: g.name, position: g.position })), dependencies: content.dependencies.map(e => ({ predecessorId: e.predecessor_id, successorId: e.successor_id, type: e.type, lagMinutes: e.lag_minutes })) });
      // Templates carry detached local identities, never identities of private source tasks.
      const taskIds = new Map<string,string>((definition.tasks ?? []).map(t => [t.id,uuid()]));
      const groupIds = new Map<string,string>((definition.groups ?? []).map(g => [g.id,uuid()]));
      definition.tasks = (definition.tasks ?? []).map(t => ({...t,id:taskIds.get(t.id),parentId:taskIds.get(t.parentId) ?? null,groupId:groupIds.get(t.groupId) ?? null,links:t.links.map((l:any)=>({...l,id:uuid()}))}));
      definition.groups = (definition.groups ?? []).map(g => ({...g,id:groupIds.get(g.id),parentId:taskIds.get(g.parentId)}));
      definition.dependencies = (definition.dependencies ?? []).map(e => ({...e,predecessorId:taskIds.get(e.predecessorId),successorId:taskIds.get(e.successorId)}));
      const tid = uuid(), saved = (await ctx.c.query("INSERT INTO work_templates(organization_id,id,name,definition,is_default) VALUES($1,$2,$3,$4::jsonb,false) RETURNING *", [ctx.org.id, tid, name, JSON.stringify(definition)])).rows[0];
      await core.changed(ctx, r, tid, "WorkTemplateSavedFromProject");
      return { template: camel(saved), copyPolicy: { visibility: "ORGANIZATION_TEMPLATE", excluded: ["ACCESS_GRANTS", "ASSIGNMENTS", "CONTEXT_LINKS", "COMMENTS", "ATTACHMENTS", "HISTORY", "CUSTOM_VALUES"], reset: ["TASK_STATUS", "CHECKLIST_COMPLETION"] } };
    })));
  };
}
