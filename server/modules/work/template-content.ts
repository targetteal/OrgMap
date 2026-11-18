import type { Ctx } from "../../src/runtime.js";
import { fail, id, text, optionalText, uuid } from "../../src/core.js";
import { richDescriptionBody, descriptionPlain, nextRichDescription } from "./content.js";
import { taskProperties } from "./task-properties.js";
import { closedRecord, projectChecklists, freshProjectChecklists, type ProjectChecklist, externalLinks, type ExternalLink, planningIntent } from "./project-content.js";

export type TemplateContent = {
  description?: string; descriptionRich?: any; tags?: string[]; checklists?: ProjectChecklist[];
  tasks?: any[]; groups?: any[]; dependencies?: any[]; links?: ExternalLink[];
};
const date = (raw: unknown) => {
  if (raw == null) return null;
  if (typeof raw !== "string" || !/^\d{4}-\d\d-\d\dT/.test(raw) || !Number.isFinite(Date.parse(raw))) fail(400, "INVALID_TEMPLATE_DATE");
  const result = new Date(raw as string).toISOString();
  if (result.slice(0, 10) !== (raw as string).slice(0, 10)) fail(400, "INVALID_TEMPLATE_DATE");
  return result;
};
export function templateContent(raw: Record<string, any>, sectionCount: number): TemplateContent {
  const result: TemplateContent = {};
  if (raw.description !== undefined || raw.descriptionRich !== undefined) {
    const content = richDescriptionBody({ description: raw.description, ...(raw.descriptionRich === undefined ? {} : { descriptionRich: raw.descriptionRich }) });
    result.description = descriptionPlain(content);
    if (content.descriptionRich) result.descriptionRich = content.descriptionRich;
  }
  if (raw.tags !== undefined) result.tags = taskProperties({ tags: raw.tags }).tags;
  if (raw.checklists !== undefined) result.checklists = projectChecklists(raw.checklists);
  if (raw.links !== undefined) result.links = externalLinks(raw.links);
  for (const key of ["tasks", "groups", "dependencies"] as const) if (raw[key] !== undefined && (!Array.isArray(raw[key]) || raw[key].length > 1000)) fail(400, "INVALID_TEMPLATE");
  const taskIds = new Set<string>();
  if (raw.tasks !== undefined) result.tasks = raw.tasks.map((value: unknown) => {
    const t = richDescriptionBody(closedRecord(value, ["id", "title", "description", "descriptionRich", "parentId", "sectionIndex", "groupId", "startsAt", "endsAt", "priority", "estimateMinutes", "tags", "checklist", "position", "links", "checklists", "planningIntent"]));
    const tid = id(t.id).toLowerCase();
    if (taskIds.has(tid)) fail(400, "INVALID_TEMPLATE"); taskIds.add(tid);
    const startsAt = date(t.startsAt), endsAt = date(t.endsAt), sectionIndex = t.sectionIndex ?? null, position = t.position ?? 0;
    if (startsAt && endsAt && endsAt < startsAt) fail(400, "INVALID_TEMPLATE_DATE");
    if (sectionIndex !== null && (!Number.isSafeInteger(sectionIndex) || sectionIndex < 0 || sectionIndex >= sectionCount)) fail(400, "INVALID_TEMPLATE");
    if (!Number.isSafeInteger(position) || Math.abs(position) > 2147483647 || !Array.isArray(t.checklist ?? []) || (t.checklist ?? []).length > 1000) fail(400, "INVALID_TEMPLATE");
    return { id: tid, title: text(t.title), description: descriptionPlain(t), ...(t.descriptionRich ? { descriptionRich: t.descriptionRich } : {}), parentId: t.parentId == null ? null : id(t.parentId).toLowerCase(), groupId: t.groupId == null ? null : id(t.groupId).toLowerCase(), sectionIndex, startsAt, endsAt, position, ...taskProperties(t), checklist: (t.checklist ?? []).map((c: unknown) => text(c, 1000)), links: externalLinks(t.links ?? []), checklists: projectChecklists(t.checklists ?? []), planningIntent: planningIntent(t.planningIntent ?? {}) };
  });
  const groupIds = new Set<string>();
  if (raw.groups !== undefined) result.groups = raw.groups.map((value: unknown) => {
    const g = closedRecord(value, ["id", "parentId", "name", "position"]), gid = id(g.id).toLowerCase(), parentId = id(g.parentId).toLowerCase(), position = g.position ?? 0;
    if (groupIds.has(gid) || !taskIds.has(parentId) || !Number.isSafeInteger(position) || Math.abs(position) > 2147483647) fail(400, "INVALID_TEMPLATE");
    groupIds.add(gid); return { id: gid, parentId, name: text(g.name), position };
  });
  const tasks = result.tasks ?? [], groups = result.groups ?? [];
  for (const t of tasks) {
    if (t.parentId && !taskIds.has(t.parentId) || t.groupId && !groups.some(g => g.id === t.groupId && g.parentId === t.parentId)) fail(400, "INVALID_TEMPLATE");
    const seen = new Set([t.id]); let parent = t.parentId;
    while (parent) { if (seen.has(parent)) fail(400, "INVALID_TEMPLATE_CYCLE"); seen.add(parent); parent = tasks.find(x => x.id === parent)?.parentId; }
  }
  const edges = new Set<string>();
  if (raw.dependencies !== undefined) result.dependencies = raw.dependencies.map((value: unknown) => {
    const e = closedRecord(value, ["predecessorId", "successorId", "type", "lagMinutes"]), predecessorId = id(e.predecessorId).toLowerCase(), successorId = id(e.successorId).toLowerCase(), key = predecessorId + ":" + successorId, lagMinutes = e.lagMinutes ?? 0;
    if (predecessorId === successorId || !taskIds.has(predecessorId) || !taskIds.has(successorId) || edges.has(key) || !["FS", "FF", "SS", "SF"].includes(e.type) || !Number.isSafeInteger(lagMinutes) || Math.abs(lagMinutes) > 5256000) fail(400, "INVALID_TEMPLATE");
    edges.add(key); return { predecessorId, successorId, type: e.type, lagMinutes };
  });
  const visiting = new Set<string>(), visited = new Set<string>();
  const visit = (key: string) => { if (visiting.has(key)) fail(400, "INVALID_TEMPLATE_CYCLE"); if (visited.has(key)) return; visiting.add(key); for (const e of result.dependencies ?? []) if (e.predecessorId === key) visit(e.successorId); visiting.delete(key); visited.add(key); };
  for (const tid of taskIds) visit(tid);
  return result;
}

/** The caller's transaction creates every seed or rolls back the project together. */
export async function applyTemplateContent(ctx: Ctx, projectId: string, definition: TemplateContent, sections: string[]) {
  await ctx.c.query("UPDATE work_projects SET tags=$3,project_checklists=$4::jsonb WHERE organization_id=$1 AND id=$2", [ctx.org.id, projectId, definition.tags ?? [], JSON.stringify(freshProjectChecklists(definition.checklists ?? [], true))]);
  await ctx.c.query("UPDATE work_projects SET external_links=$3::jsonb WHERE organization_id=$1 AND id=$2", [ctx.org.id,projectId,JSON.stringify((definition.links ?? []).map(l=>({...l,id:uuid()})))]);
  const taskIds = new Map((definition.tasks ?? []).map(t => [t.id, uuid()])), groupIds = new Map((definition.groups ?? []).map(g => [g.id, uuid()]));
  const pending = [...(definition.tasks ?? [])];
  const created = new Set<string>();
  while (pending.length) {
    const at = pending.findIndex(t => !t.parentId || created.has(t.parentId));
    if (at < 0) fail(400, "INVALID_TEMPLATE_CYCLE");
    const [t] = pending.splice(at, 1), tid = taskIds.get(t.id)!;
    const sid = t.sectionIndex == null || (definition as any).sections?.[t.sectionIndex]?.semantic === "DONE" ? null : sections[t.sectionIndex];
    await ctx.c.query("INSERT INTO work_tasks(organization_id,id,project_id,section_id,parent_id,creator_id,title,description,description_rich,status,starts_at,ends_at,position,priority,estimate_minutes,tags) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,'TODO',$10,$11,$12,$13,$14,$15)", [ctx.org.id, tid, projectId, sid, t.parentId ? taskIds.get(t.parentId) : null, ctx.member.id, t.title, t.description, nextRichDescription(t), t.startsAt, t.endsAt, t.position, t.priority, t.estimateMinutes, t.tags]);
    created.add(t.id);
    await ctx.c.query("UPDATE work_tasks SET external_links=$3::jsonb,task_checklists=$4::jsonb,planning_intent=$5::jsonb WHERE organization_id=$1 AND id=$2", [ctx.org.id,tid,JSON.stringify(t.links.map((l:ExternalLink)=>({...l,id:uuid()}))),JSON.stringify(freshProjectChecklists(t.checklists,true)),JSON.stringify(t.planningIntent)]);
    for (const g of definition.groups ?? []) if (g.parentId === t.id) await ctx.c.query("INSERT INTO work_subtask_groups(organization_id,id,parent_task_id,name,position) VALUES($1,$2,$3,$4,$5)", [ctx.org.id, groupIds.get(g.id), tid, g.name, g.position]);
    if (t.groupId) await ctx.c.query("UPDATE work_tasks SET subtask_group_id=$3 WHERE organization_id=$1 AND id=$2", [ctx.org.id, tid, groupIds.get(t.groupId)]);
    for (const title of t.checklist) await ctx.c.query("INSERT INTO work_checklist(organization_id,id,task_id,title,done) VALUES($1,$2,$3,$4,false)", [ctx.org.id, uuid(), tid, title]);
  }
  for (const e of definition.dependencies ?? []) await ctx.c.query("INSERT INTO work_dependencies(organization_id,predecessor_id,successor_id,type,lag_minutes) VALUES($1,$2,$3,$4,$5)", [ctx.org.id, taskIds.get(e.predecessorId), taskIds.get(e.successorId), e.type, e.lagMinutes]);
}
