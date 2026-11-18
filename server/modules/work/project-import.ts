import { customFields, collectionFieldDefinitions, type CustomFieldValues } from "./custom-fields.js";
import { externalLinks, projectChecklists, freshProjectChecklists, type FieldDefinition, type ExternalLink, type ProjectChecklist, planningIntent, type PlanningIntent, projectSectionName } from "./project-content.js";
import { taskProperties, type TaskProperties } from "./task-properties.js";
import {
  richDescriptionBody,
  descriptionPlain,
  nextRichDescription,
} from "./content.js";
import type { RichDocument } from "../../../packages/content/index.js";
import type { Ctx, OrgMapModule } from "../../src/runtime.js";
import {
  body,
  text,
  optionalText,
  fail,
  Failure,
  uuid,
  id,
  key,
  digest,
} from "../../src/core.js";
import {
  createProjectDefinition,
  validateProjectDefinition,
  type ProjectDefinition,
} from "./templates.js";
import { workSettings } from "./policy.js";
import { ordered } from "./domain.js";
type Task = TaskProperties & {
  sourceId: string;
  title: string;
  description: string;
  descriptionRich?: RichDocument;
  status: string;
  parentSourceId: string | null;
  sectionIndex: number | null;
  startsAt: string | null;
  endsAt: string | null;
  checklist: {title:string;done:boolean}[];
  customFields: CustomFieldValues;
  customStatusId: string | null;
  taskChecklists: ProjectChecklist[];
  externalLinks: ExternalLink[];
  planningIntent: PlanningIntent;
};
type Project = {
  sourceId: string;
  title: string;
  description: string;
  descriptionRich?: RichDocument;
  visibility?: string;
  definition: ProjectDefinition;
  sourceOrganizationId: string | null;
  circleId: string | null;
  startsAt: string | null;
  endsAt: string | null;
  tags: string[];
  customFields: CustomFieldValues;
  contextLinks: {kind:string;targetId:string}[];
  taskStates: {id:string;name:string;semantic:string}[];
  projectStateId: string | null;
  projectChecklists: ProjectChecklist[];
  externalLinks: ExternalLink[];
  planningIntent: PlanningIntent;
  leadMemberId: string | null;
  priority: string;sectionName:string;
  tasks: Task[];
  dependencies: {
    predecessor_id: string;
    successor_id: string;
    type: string;
    lag_minutes: number;
  }[];
};
function object(raw: unknown, keys: string[]) {
  if (
    !raw ||
    typeof raw !== "object" ||
    Array.isArray(raw) ||
    Object.keys(raw).some((k) => !keys.includes(k))
  )
    fail(400, "INVALID_IMPORT_SCHEMA");
  return raw as Record<string, any>;
}
function timestamp(raw: unknown) {
  if (raw == null) return null;
  if (
    typeof raw !== "string" ||
    !/^\d{4}-\d\d-\d\dT/.test(raw) ||
    !Number.isFinite(Date.parse(raw))
  )
    fail(400, "INVALID_DATE");
  return new Date(raw as string).toISOString();
}
function parseProject(raw: unknown, prefix: string, fieldSchema: FieldDefinition[]): Project {
  const p = richDescriptionBody(
      object(raw, [
        "sourceId",
        "title",
        "description",
        "descriptionRich",
        "visibility",
        "definition",
        "tasks",
        "dependencies", "schemaVersion", "sourceOrganizationId", "circleId", "startsAt", "endsAt", "tags", "customFields", "contextLinks", "taskStates", "projectStateId", "projectChecklists", "externalLinks", "leadMemberId", "planningIntent", "priority", "sectionName",
      ]),
    ),
    sourceId = text(p.sourceId),
    title = text((prefix ? prefix + " " : "") + text(p.title)),
    definition = validateProjectDefinition(
      p.definition ?? {
        views: ["LIST", "BOARD", "TIMELINE", "CALENDAR"],
        sections: [],
        defaultDoneSection: null,
      },
    );
  if (
    p.visibility !== undefined &&
    !["PUBLIC", "PRIVATE"].includes(p.visibility)
  )
    fail(400, "INVALID_IMPORT_SCHEMA");
  if (
    !Array.isArray(p.tasks ?? []) ||
    (p.tasks ?? []).length > 500 ||
    !Array.isArray(p.dependencies ?? []) ||
    (p.dependencies ?? []).length > 2000
  )
    fail(400, "INVALID_IMPORT_SCHEMA");
  const tasks: Task[] = (p.tasks ?? []).map((raw: unknown) => {
    const t = richDescriptionBody(
        object(raw, [
          "sourceId",
          "title",
          "description",
          "descriptionRich",
          "status",
          "parentSourceId",
          "sectionIndex",
          "startsAt",
          "endsAt",
          "checklist",
          "priority",
          "estimateMinutes",
          "tags", "customFields", "customStatusId", "assigneeMemberIds", "principals", "externalLinks", "taskChecklists", "planningIntent",
        ]),
      ),
      startsAt = timestamp(t.startsAt),
      endsAt = timestamp(t.endsAt),
      status = t.status ?? "TODO",
      sectionIndex = t.sectionIndex ?? null;
    if (
      !["TODO", "IN_PROGRESS", "BLOCKED", "DONE"].includes(status) ||
      (startsAt && endsAt && endsAt < startsAt) ||
      (sectionIndex !== null &&
        (!Number.isInteger(sectionIndex) ||
          !definition.sections[sectionIndex])) ||
      !Array.isArray(t.checklist ?? []) ||
      (t.checklist ?? []).length > 100
    )
      fail(400, "INVALID_IMPORT_SCHEMA");
    if (
      sectionIndex !== null &&
      (definition.sections[sectionIndex].semantic === "DONE") !==
        (status === "DONE")
    )
      fail(422, "SECTION_STATUS_MISMATCH");
    return {
      ...taskProperties(t),
      sourceId: text(t.sourceId),
      title: text(t.title),
      description: descriptionPlain(t),
      ...(t.descriptionRich ? { descriptionRich: t.descriptionRich } : {}),
      status,
      parentSourceId: t.parentSourceId == null ? null : text(t.parentSourceId),
      sectionIndex,
      startsAt,
      endsAt,
      checklist: (t.checklist ?? []).map((x: any) => typeof x === "string" ? {title:text(x),done:false} : {title:text(object(x,["title","done"]).title),done:x.done === true}),
      customFields: customFields(t.customFields ?? {}, fieldSchema),
      externalLinks: externalLinks(t.externalLinks ?? []),
      taskChecklists:projectChecklists(t.taskChecklists ?? []),planningIntent:planningIntent(t.planningIntent ?? {}),
      customStatusId: t.customStatusId == null ? null : id(t.customStatusId),
    };
  });
  const ids = tasks.map((t) => t.sourceId),
    seen = new Set(ids);
  if (seen.size !== ids.length) fail(422, "DUPLICATE_IMPORT_SOURCE");
  const parentEdges = tasks
    .filter((t) => t.parentSourceId !== null)
    .map((t) => {
      if (!seen.has(t.parentSourceId!)) fail(422, "IMPORT_PARENT_MISSING");
      return {
        predecessor_id: t.parentSourceId!,
        successor_id: t.sourceId,
        type: "FS",
        lag_minutes: 0,
      };
    });
  ordered(ids, parentEdges);
  const dependencies = (p.dependencies ?? []).map((raw: unknown) => {
    const d = object(raw, [
        "predecessorSourceId",
        "successorSourceId",
        "type",
        "lagMinutes",
      ]),
      predecessor_id = text(d.predecessorSourceId),
      successor_id = text(d.successorSourceId),
      type = d.type ?? "FS",
      lag_minutes = d.lagMinutes ?? 0;
    if (
      !seen.has(predecessor_id) ||
      !seen.has(successor_id) ||
      predecessor_id === successor_id ||
      !["FS", "FF", "SS", "SF"].includes(type) ||
      !Number.isSafeInteger(lag_minutes) ||
      Math.abs(lag_minutes) > 5256000
    )
      fail(400, "INVALID_IMPORT_SCHEMA");
    return { predecessor_id, successor_id, type, lag_minutes };
  });
  if (
    new Set(
      dependencies.map((d: any) => d.predecessor_id + "\0" + d.successor_id),
    ).size !== dependencies.length
  )
    fail(422, "DUPLICATE_IMPORT_SOURCE");
  ordered(ids, dependencies);
  const startsAt=timestamp(p.startsAt), endsAt=timestamp(p.endsAt);
  if (startsAt && endsAt && endsAt < startsAt) fail(422,"INVALID_DATE_RANGE");
  if (!Array.isArray(p.taskStates ?? []) || (p.taskStates ?? []).length>50 || !Array.isArray(p.contextLinks ?? []) || (p.contextLinks ?? []).length>200) fail(400,"INVALID_IMPORT_SCHEMA");
  const taskStates=(p.taskStates ?? []).map((raw:unknown)=>{const state=object(raw,["id","name","semantic"]);if(!["TODO","IN_PROGRESS","BLOCKED","DONE"].includes(state.semantic)) fail(400,"INVALID_IMPORT_SCHEMA");return {id:id(state.id),name:text(state.name,100),semantic:state.semantic as string};});
  if(new Set(taskStates.map((state:any)=>state.id)).size!==taskStates.length) fail(400,"INVALID_IMPORT_SCHEMA");
  for(const task of tasks) if(task.customStatusId && !taskStates.some((state:any)=>state.id===task.customStatusId && state.semantic===task.status)) fail(422,"INVALID_TASK_STATE");
  const contextLinks=(p.contextLinks ?? []).map((raw:unknown)=>{const link=object(raw,["kind","targetId"]);if(!["CIRCLE","ROLE","PARTICIPANT","FOLLOWER"].includes(link.kind)) fail(400,"INVALID_IMPORT_SCHEMA");return {kind:link.kind as string,targetId:id(link.targetId)};});
  if (new Set(contextLinks.map((link:any)=>link.kind+":"+link.targetId)).size !== contextLinks.length) fail(400,"INVALID_IMPORT_SCHEMA");
  return {
    sourceOrganizationId: p.sourceOrganizationId == null ? null : id(p.sourceOrganizationId),
    circleId:p.circleId == null ? null : id(p.circleId), startsAt,endsAt,tags:taskProperties({tags:p.tags ?? []}).tags,
    customFields:customFields(p.customFields ?? {}, fieldSchema),contextLinks,taskStates,projectStateId:p.projectStateId == null ? null : id(p.projectStateId),
    priority:taskProperties({priority:p.priority}).priority,sectionName:projectSectionName(p.sectionName ?? ""),planningIntent:planningIntent(p.planningIntent ?? {}),projectChecklists:projectChecklists(p.projectChecklists ?? []),externalLinks:externalLinks(p.externalLinks ?? []),leadMemberId:p.leadMemberId == null ? null : id(p.leadMemberId),
    sourceId,
    title,
    description: descriptionPlain(p),
    ...(p.descriptionRich ? { descriptionRich: p.descriptionRich } : {}),
    visibility: p.visibility,
    definition,
    tasks,
    dependencies,
  };
}
async function preview(ctx: Ctx, raw: unknown, prefixRaw: unknown) {
  const fieldSchema = await collectionFieldDefinitions(ctx);
  const input=raw as any;
  const file = input?.schemaVersion === "orgmap-transfer-v1" && input?.resourceType === "work-export" && input?.kind === "TASKS" && Array.isArray(input.records)
    ? {schemaVersion:1,projects:input.records}
    : object(raw, ["schemaVersion", "projects"]);
  if (
    file.schemaVersion !== 1 ||
    !Array.isArray(file.projects) ||
    !file.projects.length ||
    file.projects.length > 100
  )
    fail(400, "INVALID_IMPORT_SCHEMA");
  const prefix =
      prefixRaw == null || prefixRaw === "" ? "" : text(prefixRaw, 100),
    seen = new Set<string>();
  const items: (
    | {
        index: number;
        sourceId: string;
        title: string;
        status: "READY";
        project: Project;
      }
    | {
        index: number;
        sourceId: string | null;
        title: string | null;
        status: "INVALID";
        code: string;
      }
  )[] = (file.projects as unknown[]).map((raw: unknown, index: number) => {
    try {
      const project = parseProject(raw, prefix, fieldSchema);
      if (seen.has(project.sourceId)) fail(422, "DUPLICATE_IMPORT_SOURCE");
      seen.add(project.sourceId);
      return {
        index,
        sourceId: project.sourceId,
        title: project.title,
        status: "READY" as const,
        project,
      };
    } catch (e) {
      if (!(e instanceof Failure)) throw e;
      return {
        index,
        sourceId:
          typeof (raw as any)?.sourceId === "string"
            ? (raw as any).sourceId
            : null,
        title:
          typeof (raw as any)?.title === "string" ? (raw as any).title : null,
        status: "INVALID" as const,
        code: e.code,
      };
    }
  });
  for (let index=0; index<items.length; index++) {
    const item=items[index];
    if(item.status === "READY" && (item.project.circleId || item.project.contextLinks.length || item.project.projectStateId || item.project.leadMemberId) && item.project.sourceOrganizationId !== ctx.org.id)
      items[index]={index:item.index,sourceId:item.sourceId,title:item.title,status:"INVALID",code:"IMPORT_CONTEXT_ORGANIZATION_MISMATCH"};
  }
  const policyVersion = (await workSettings(ctx)).version;
  return {
    items,
    planHash: digest(JSON.stringify({ items, policyVersion })),
    coverage:
      "Projetos, seções, tarefas/subtarefas, checklist, dependências e campos de trabalho. Vínculos organizacionais exigem a organização de origem e são validados; acessos e atribuições não são concedidos. Comentários, anexos, grupos e histórico não são importados.",
  };
}
export function workProjectImportModule(access: {
  mayCreate: (ctx: Ctx) => boolean;
  authorizeProject: (ctx: Ctx, id: string) => Promise<unknown>;
}): OrgMapModule {
  return async (app, core) => {
    const base = "/api/v1/organizations/:organizationId/work/project-import";
    app.post(base + "/preview", {bodyLimit: 6 * 1024 * 1024}, (r) =>
      core.tenant(r, { mode: "read" }, async (ctx) => {
        if (!access.mayCreate(ctx)) fail(403, "ACTION_DENIED");
        const b = body(r, ["document", "prefix"]);
        return preview(ctx, b.document, b.prefix);
      }),
    );
    app.post(base + "/apply", {bodyLimit: 6 * 1024 * 1024}, (r) =>
      core.tenant(
        r,
        {
          mode: "write",
          authorize: async (ctx) => {
            if (!access.mayCreate(ctx)) return false;
            for (const row of (
              await ctx.c.query(
                "SELECT project_id FROM work_project_import_items WHERE organization_id=$1 AND account_id=$2 AND command_key=$3",
                [ctx.org.id, ctx.account.id, key(r)],
              )
            ).rows)
              await access.authorizeProject(ctx, row.project_id);
            return true;
          },
        },
        async (ctx) => {
          const b = body(r, ["document", "prefix", "planHash"]),
            plan = await preview(ctx, b.document, b.prefix);
          if (b.planHash !== plan.planHash) fail(409, "IMPORT_PREVIEW_STALE");
          const report = [];
          for (const item of plan.items) {
            if (item.status === "INVALID") {
              report.push(item);
              continue;
            }
            const p = item.project;
            await ctx.c.query("SAVEPOINT work_import_item");
            try {
              if ((p.circleId || p.contextLinks.length || p.projectStateId || p.leadMemberId) && p.sourceOrganizationId !== ctx.org.id) fail(422,"IMPORT_CONTEXT_ORGANIZATION_MISMATCH");
              const validUuid=(v:string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
              for(const reference of [...p.contextLinks, ...(p.circleId ? [{kind:"CIRCLE",targetId:p.circleId}] : [])]) {
                if (!validUuid(reference.targetId)) fail(400,"INVALID_IMPORT_SCHEMA");
                const result=reference.kind === "CIRCLE" || reference.kind === "ROLE"
                  ? await ctx.c.query("SELECT 1 FROM entities WHERE organization_id=$1 AND id=$2 AND kind=$3 AND NOT archived",[ctx.org.id,reference.targetId,reference.kind])
                  : await ctx.c.query("SELECT 1 FROM members WHERE organization_id=$1 AND id=$2 AND status='ACTIVE'",[ctx.org.id,reference.targetId]);
                if(!result.rowCount) fail(404,"RESOURCE_NOT_FOUND");
              }
              if(p.projectStateId) {if(!validUuid(p.projectStateId)) fail(400,"INVALID_IMPORT_SCHEMA");const settings=await workSettings(ctx);if(!(settings as any).projectStates?.some((state:any)=>state.id===p.projectStateId)) fail(422,"INVALID_PROJECT_STATE");}
              for(const state of p.taskStates) if(!validUuid(state.id)) fail(400,"INVALID_IMPORT_SCHEMA");
              const created = await createProjectDefinition(ctx, {...p,circleId:p.circleId}),
                pid = created.id,
                sections = (
                  await ctx.c.query(
                    "SELECT id FROM work_sections WHERE organization_id=$1 AND project_id=$2 ORDER BY position,id",
                    [ctx.org.id, pid],
                  )
                ).rows;
              await ctx.c.query("UPDATE work_projects SET starts_at=$3,ends_at=$4,tags=$5,custom_fields=$6::jsonb,context_links=$7::jsonb,task_states=$8::jsonb,project_state_id=$9 WHERE organization_id=$1 AND id=$2",[ctx.org.id,pid,p.startsAt,p.endsAt,p.tags,JSON.stringify(p.customFields),JSON.stringify(p.contextLinks),JSON.stringify(p.taskStates),p.projectStateId]);
              if(p.leadMemberId && !(await ctx.c.query("SELECT 1 FROM members WHERE organization_id=$1 AND id=$2 AND status='ACTIVE' AND member_type<>'GUEST'",[ctx.org.id,p.leadMemberId])).rowCount) fail(404,"RESOURCE_NOT_FOUND");
              await ctx.c.query("UPDATE work_projects SET project_checklists=$3::jsonb,external_links=$4::jsonb,lead_member_id=$5,planning_intent=$6::jsonb WHERE organization_id=$1 AND id=$2",[ctx.org.id,pid,JSON.stringify(freshProjectChecklists(p.projectChecklists,false)),JSON.stringify(p.externalLinks.map(l=>({...l,id:uuid()}))),p.leadMemberId,JSON.stringify(p.planningIntent)]);
              await ctx.c.query("UPDATE work_projects SET priority=$3,section_name=$4 WHERE organization_id=$1 AND id=$2",[ctx.org.id,pid,p.priority,p.sectionName]);
              const ids = new Map(p.tasks.map((t) => [t.sourceId, uuid()])),
                parents = p.tasks
                  .filter((t) => t.parentSourceId)
                  .map((t) => ({
                    predecessor_id: t.parentSourceId!,
                    successor_id: t.sourceId,
                    type: "FS",
                    lag_minutes: 0,
                  }));
              for (const sourceId of ordered([...ids.keys()], parents)) {
                const t = p.tasks.find((t) => t.sourceId === sourceId)!;
                const section =
                  t.sectionIndex === null
                    ? t.status === "DONE"
                      ? created.default_done_section_id
                      : null
                    : sections[t.sectionIndex].id;
                await ctx.c.query(
                  "INSERT INTO work_tasks(organization_id,id,project_id,section_id,parent_id,creator_id,title,description,status,starts_at,ends_at,description_rich,priority,estimate_minutes,tags,custom_fields,custom_status_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16::jsonb,$17)",
                  [
                    ctx.org.id,
                    ids.get(sourceId),
                    pid,
                    section,
                    t.parentSourceId ? ids.get(t.parentSourceId) : null,
                    ctx.member.id,
                    t.title,
                    t.description,
                    t.status,
                    t.startsAt,
                    t.endsAt,
                    nextRichDescription(t),
                    t.priority,
                    t.estimateMinutes,
                    t.tags,
                    JSON.stringify(t.customFields), t.customStatusId,
                  ],
                );
                await ctx.c.query("UPDATE work_tasks SET external_links=$3::jsonb,task_checklists=$4::jsonb,planning_intent=$5::jsonb WHERE organization_id=$1 AND id=$2",[ctx.org.id,ids.get(sourceId),JSON.stringify(t.externalLinks.map(l=>({...l,id:uuid()}))),JSON.stringify(freshProjectChecklists(t.taskChecklists,false)),JSON.stringify(t.planningIntent)]);
                for (const entry of t.checklist)
                  await ctx.c.query(
                    "INSERT INTO work_checklist(organization_id,id,task_id,title,done) VALUES($1,$2,$3,$4,$5)",
                    [ctx.org.id, uuid(), ids.get(sourceId), entry.title,entry.done],
                  );
              }
              for (const d of p.dependencies)
                await ctx.c.query(
                  "INSERT INTO work_dependencies VALUES($1,$2,$3,$4,$5)",
                  [
                    ctx.org.id,
                    ids.get(d.predecessor_id),
                    ids.get(d.successor_id),
                    d.type,
                    d.lag_minutes,
                  ],
                );
              await ctx.c.query(
                "INSERT INTO work_project_import_items VALUES($1,$2,$3,$4)",
                [ctx.org.id, ctx.account.id, key(r), pid],
              );
              await core.changed(ctx, r, pid, "ProjectJSONImported");
              await ctx.c.query("RELEASE SAVEPOINT work_import_item");
              report.push({
                index: item.index,
                sourceId: p.sourceId,
                title: p.title,
                status: "IMPORTED",
                projectId: pid,
                tasks: p.tasks.length,
              });
            } catch (e) {
              await ctx.c.query("ROLLBACK TO SAVEPOINT work_import_item");
              await ctx.c.query("RELEASE SAVEPOINT work_import_item");
              if (!(e instanceof Failure)) throw e;
              report.push({
                index: item.index,
                sourceId: p.sourceId,
                title: p.title,
                status: "FAILED",
                code: e.code,
              });
            }
          }
          return { report, coverage: plan.coverage };
        },
      ),
    );
  };
}
