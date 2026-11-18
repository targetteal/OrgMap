import { spawnSync } from "node:child_process";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { previewSchedule, ordered } from "../../server/modules/work/domain.js";
import { createWorkApplicationPorts } from "../../server/modules/work/application.js";

// Standalone isolated database: never resets or migrates the shared development DB.
const adminUrl =
  process.env.MIGRATION_DATABASE_URL ??
  "postgres://orgmap_migrator:orgmap_local_only@127.0.0.1:55432/orgmap";
const admin = new pg.Pool({ connectionString: adminUrl });
const db = "orgmap_work_project_extensions_" + randomUUID().replaceAll("-", "");
await admin.query(`CREATE DATABASE "${db}"`);
const migrationUrl = new URL(adminUrl);
migrationUrl.pathname = "/" + db;
const migrationEnvironment: NodeJS.ProcessEnv = { ...process.env, MIGRATION_DATABASE_URL: migrationUrl.href };
delete migrationEnvironment.MIGRATION_SCOPE;
delete migrationEnvironment.MIGRATION_MAX_PREFIX;
try {
  const result = spawnSync(process.execPath, ["--import", "tsx", "server/src/migrate.ts"], {env:migrationEnvironment,encoding:"utf8"});
  if (result.status !== 0) throw Error(`WORK_OFFICIAL_MIGRATION_FAILED: ${result.stderr || result.stdout}`);
} catch (error) {
  await admin.query(`DROP DATABASE "${db}" WITH (FORCE)`);
  await admin.end();
  throw error;
}
const runtimeUrl = new URL(
  process.env.DATABASE_URL ??
    "postgres://orgmap_app:orgmap_app_local_only@127.0.0.1:55432/orgmap",
);
runtimeUrl.pathname = "/" + db;
process.env.DATABASE_URL = runtimeUrl.href;
const { buildApp } = await import("../../server/src/app.js");
const { pool, transaction } = await import("../../server/src/db.js");
assert.equal(
  (await pool.query("SELECT current_database() AS name")).rows[0].name,
  db,
  "runtime must point at this slice isolated database before any API command",
);
const { createRuntime } = await import("../../server/src/runtime.js");
const { workModule, createWorkResourceAdapters } =
  await import("../../server/modules/work/index.js");
let app: Awaited<ReturnType<typeof buildApp>>;
try {
  const { mountWorkTestHarness } =
    await import("../../server/modules/work/test-harness.js");
  app = await buildApp([
    async (app, core) => {
      const { createWorkActivityPort } = await import("../../server/integration/work-activity.js");
      await mountWorkTestHarness(app, core, { workOptions: { activity: createWorkActivityPort() } });
    },
  ]);
  if (process.env.WORK_TEST_DEBUG)
    app.addHook("onError", async (_request, _reply, error) => {
      console.error(error.message);
    });
} catch (e) {
  await pool.end();
  await admin.query(`DROP DATABASE "${db}" WITH (FORCE)`);
  await admin.end();
  throw e;
}
async function asContext(
  u: User,
  orgId: string,
  fn: (ctx: any) => Promise<any>,
) {
  return transaction(async (c) => {
    await c.query("SELECT set_config('orgmap.organization_id',$1,true)", [
      orgId,
    ]);
    const org = (
      await c.query("SELECT * FROM organizations WHERE id=$1 FOR UPDATE", [
        orgId,
      ])
    ).rows[0];
    const member = (
      await c.query(
        "SELECT * FROM members WHERE organization_id=$1 AND account_id=$2 AND status='ACTIVE'",
        [orgId, u.id],
      )
    ).rows[0];
    assert.ok(member);
    return fn({ c, org, member, account: { id: u.id } });
  });
}
after(async () => {
  await app.close();
  await pool.end();
  await admin.query(`DROP DATABASE "${db}" WITH (FORCE)`);
  await admin.end();
});
type User = { cookie: string; csrf: string; id: string };
async function call(
  method: string,
  path: string,
  b?: any,
  u?: User,
  headers: any = {},
) {
  return app.inject({
    method: method as any,
    url: "/api/v1" + path,
    payload: b,
    headers: {
      origin: "http://localhost:5173",
      "idempotency-key": randomUUID(),
      ...(u ? { cookie: u.cookie, "x-csrf-token": u.csrf } : {}),
      ...headers,
    },
  });
}
function data(r: any) {
  assert.ok(r.statusCode >= 200 && r.statusCode < 300, r.body);
  return r.json().data;
}
async function user() {
  const r = await call("POST", "/auth/register", {
    email: randomUUID() + "@example.test",
    password: "work-test-password-123",
    displayName: "Work tester",
  });
  const d = data(r);
  return {
    cookie: r.cookies[0].name + "=" + r.cookies[0].value,
    csrf: d.csrfToken,
    id: d.account.id,
  };
}
const match = (v: number) => ({ "if-match": `"${v}"` });

test("project content, typed collection fields, full copies and templates persist atomically with current tenant ACL", async () => {
  const a = await user(), b = await user(), c = await user();
  const A = data(await call("POST", "/organizations", { name: "Projetos reais A" }, a)), B = data(await call("POST", "/organizations", { name: "Projetos reais B" }, c));
  const base = "/organizations/" + A.organization.id + "/work", other = "/organizations/" + B.organization.id + "/work";
  const bm = data(await call("POST", "/organizations/" + A.organization.id + "/members", { accountId: b.id }, a)).membership;
  const cm = await asContext(c, B.organization.id, async ctx => ctx.member);
  const defs = [
    { id: randomUUID(), name: "Impacto", type: "SELECT", options: ["Pequeno", "Amplo"] },
    { id: randomUUID(), name: "Esforço", type: "NUMBER", options: [] },
    { id: randomUUID(), name: "Revisão", type: "DATE", options: [] },
    { id: randomUUID(), name: "Resumo", type: "TEXT", options: [] },
  ];
  const fields = data(await call("POST", base + "/field-definitions", { definitions: defs }, a, match(0)));
  assert.equal(fields.version, 1);
  assert.deepEqual(data(await call("GET", base + "/field-definitions", undefined, b)).definitions, defs);
  assert.deepEqual(data(await call("GET", other + "/field-definitions", undefined, c)).definitions, []);
  assert.equal((await call("POST", base + "/field-definitions", { definitions: [] }, b, match(1))).statusCode, 403);
  assert.equal((await call("POST", base + "/field-definitions", { definitions: [{ ...defs[0], type: "HTML" }] }, a, match(1))).statusCode, 400);
  const values = { [defs[0].id]: "Amplo", [defs[1].id]: 12.5, [defs[2].id]: "2026-11-03", [defs[3].id]: "Registrar contexto", "Campo anterior": "preservado" };
  const intent={recurrence:"WEEKLY",reminderLocal:"2026-11-10T14:30"};
  let p = data(await call("POST", base + "/projects", { title: "Projeto com conteúdo", visibility: "PRIVATE", leadMemberId: bm.id, customFields: values, description: "Um resultado verificável", tags: ["pesquisa"],priority:"HIGH",sectionName:"Descoberta",planningIntent:intent }, a)).project;
  const refresh = async () => (p = data(await call("GET", base + "/projects/" + p.id, undefined, a)).project);
  assert.equal(p.leadMemberId, bm.id);
  assert.equal(p.priority,"HIGH");assert.equal(p.sectionName,"Descoberta");
  assert.equal((await call("PATCH",base+"/projects/"+p.id,{priority:"CRITICAL"},a,match(p.version))).statusCode,400);
  assert.equal((await call("PATCH",base+"/projects/"+p.id,{sectionName:"linha\nnova"},a,match(p.version))).statusCode,400);
  assert.deepEqual(p.customFields, values);
  assert.deepEqual(p.planningIntent,intent);
  assert.equal((await call("PATCH", base + "/projects/" + p.id, {planningIntent:{...intent,send:true}},a,match(p.version))).statusCode,400);
  assert.equal((await call("PATCH", base + "/projects/" + p.id, {planningIntent:{...intent,reminderLocal:"2026-02-30T10:00"}},a,match(p.version))).statusCode,400);
  assert.equal((await call("GET", base + "/projects/" + p.id, undefined, b)).statusCode, 404, "responsibility never grants read");
  assert.equal((await call("PATCH", base + "/projects/" + p.id, { leadMemberId: cm.id }, a, match(p.version))).statusCode, 404);
  assert.equal((await call("PATCH", base + "/projects/" + p.id, { customFields: { [defs[1].id]: "12" } }, a, match(p.version))).statusCode, 400);
  assert.equal((await call("PATCH", base + "/projects/" + p.id, { customFields: { [defs[2].id]: "2026-02-30" } }, a, match(p.version))).statusCode, 400);
  assert.equal((await call("PATCH", base + "/projects/" + p.id, { customFields: { [defs[0].id]: "Outro" } }, a, match(p.version))).statusCode, 400);
  assert.equal((await call("PATCH", base + "/projects/" + p.id, { customFields: { "Unknown": { forged: true } } }, a, match(p.version))).statusCode, 400);
  assert.equal((await call("POST", base + "/field-definitions", { definitions: defs.slice(1) }, a, match(1))).statusCode, 409, "cannot orphan values");
  assert.equal((await call("POST", base + "/field-definitions", { definitions: defs.map(f => f.type === "SELECT" ? { ...f, options: ["Pequeno"] } : f) }, a, match(1))).statusCode, 409);
  assert.equal((await call("POST", base + "/field-definitions", { definitions: defs.map(f => f.type === "NUMBER" ? { ...f, type: "TEXT" } : f) }, a, match(1))).statusCode, 409);
  const lists = [{ id: randomUUID(), title: "Antes do encontro", items: [{ id: randomUUID(), text: "Sala confirmada", done: true }, { id: randomUUID(), text: "Convite revisado", done: false }] }];
  p = data(await call("PATCH", base + "/projects/" + p.id + "/checklists", { checklists: lists }, a, match(p.version))).project;
  assert.deepEqual(p.projectChecklists, lists);
  assert.equal((await call("PATCH", base + "/projects/" + p.id + "/checklists", { checklists: lists }, a, match(p.version - 1))).statusCode, 409);
  assert.equal((await call("PATCH", base + "/projects/" + p.id + "/checklists", { checklists: [{ ...lists[0], items: [lists[0].items[0], lists[0].items[0]] }] }, a, match(p.version))).statusCode, 400);
  assert.deepEqual(data(await call("GET", base + "/tasks?projectId=" + p.id, undefined, a)).tasks, [], "project checklist is never a task");
  const links = [{ id: randomUUID(), title: "Documento de apoio", url: "https://example.test/contexto?q=1#trecho" }];
  p = data(await call("PATCH", base + "/projects/" + p.id + "/links", { links }, a, match(p.version))).project;
  for (const url of ["javascript:alert(1)", "data:text/html,a", "file:///tmp/a", "https://user:pass@example.test/", "https://example.test/\npath"]) assert.equal((await call("PATCH", base + "/projects/" + p.id + "/links", { links: [{ ...links[0], url }] }, a, match(p.version))).statusCode, 400);
  assert.equal((await call("PATCH", other + "/projects/" + p.id + "/links", { links }, c, match(p.version))).statusCode, 404);
  const section = data(await call("POST", base + "/projects/" + p.id + "/sections", { name: "Pesquisa" }, a, match(p.version))).section;
  await refresh();
  let parent = data(await call("POST", base + "/tasks", { projectId: p.id, title: "Pergunta central", sectionId: section.id, customFields: { [defs[1].id]: 3 } }, a)).task;
  const group = data(await call("POST", base + "/tasks/" + parent.id + "/groups", { name: "Entrevistas", position: 2 }, a, match(parent.version))).group;
  parent = data(await call("GET", base + "/tasks/" + parent.id, undefined, a)).task;
  const child = data(await call("POST", base + "/tasks", { projectId: p.id, parentId: parent.id, groupId: group.id, title: "Ouvir três pessoas", tags: ["escuta"] }, a)).task;
  let successor = data(await call("POST", base + "/tasks", { projectId: p.id, title: "Consolidar o aprendizado", priority: "HIGH" }, a)).task;
  successor = data(await call("POST", base + "/tasks/" + successor.id + "/dependencies", { predecessorId: child.id, type: "FS", lagMinutes: 30 }, a, match(successor.version))).task;
  parent = data(await call("PATCH", base + "/tasks/" + parent.id + "/external-links", { links }, a, match(parent.version))).task;
  const grouped=[{id:randomUUID(),title:"Preparação da entrevista",items:[{id:randomUUID(),text:"Roteiro",done:true}]}];
  parent=data(await call("PATCH",base+"/tasks/"+parent.id+"/checklists",{checklists:grouped},a,match(parent.version))).task;
  parent=data(await call("PATCH",base+"/tasks/"+parent.id,{planningIntent:{recurrence:"MONTHLY",reminderLocal:null}},a,match(parent.version))).task;
  assert.equal(parent.status,"TODO","grouped checklist completion never completes a task");
  const check = data(await call("POST", base + "/tasks/" + parent.id + "/checklist", { title: "Roteiro revisto" }, a, match(parent.version)));
  parent = check.task;
  parent = data(await call("POST", base + "/tasks/" + parent.id + "/assignments", { memberIds: [p.creatorId] }, a, match(parent.version))).task;
  data(await call("POST", base + "/tasks/" + parent.id + "/comments", { content: "Conversa que não pode ser copiada" }, a, match(parent.version)));
  data(await call("POST", base + "/projects/" + p.id + "/access", { memberId: bm.id, role: "READER" }, a, match(p.version)));
  await refresh();
  p=data(await call("POST",base+"/projects/"+p.id+"/context",{links:[{kind:"CIRCLE",targetId:A.rootCircle.id},{kind:"PARTICIPANT",targetId:bm.id}]},a,match(p.version))).project;
  const taskState={id:randomUUID(),name:"Em pesquisa",semantic:"IN_PROGRESS"};
  p=data(await call("POST",base+"/projects/"+p.id+"/states",{states:[taskState]},a,match(p.version))).project;
  parent=data(await call("GET",base+"/tasks/"+parent.id,undefined,a)).task;
  parent=data(await call("PATCH",base+"/tasks/"+parent.id,{customStatusId:taskState.id},a,match(parent.version))).task;
  assert.equal((await call("PATCH", base + "/projects/" + p.id + "/checklists", { checklists: [] }, b, match(p.version))).statusCode, 403);
  assert.equal((await call("POST", base + "/projects/" + p.id + "/duplicate", {}, b, match(p.version))).statusCode, 403);
  assert.equal((await call("POST", other + "/projects/" + p.id + "/duplicate", {}, c, match(p.version))).statusCode, 404);
  const copyKey = randomUUID(), copyHeaders = { ...match(p.version), "idempotency-key": copyKey };
  const copied = data(await call("POST", base + "/projects/" + p.id + "/duplicate", { title: "Cópia completa" }, a, copyHeaders));
  const copy = copied.project;
  assert.equal(data(await call("POST", base + "/projects/" + p.id + "/duplicate", { title: "Cópia completa" }, a, copyHeaders)).project.id, copy.id, "copy replay never makes another project");
  assert.ok(copied.copyPolicy.excluded.includes("ACCESS_GRANTS"));
  assert.notEqual(copy.id, p.id); assert.equal(copy.leadMemberId, bm.id); assert.deepEqual(copy.customFields, values);
  assert.deepEqual(copy.planningIntent,intent);
  assert.equal(copy.priority,"HIGH");assert.equal(copy.sectionName,"Descoberta");
  assert.deepEqual(copy.contextLinks,p.contextLinks);
  assert.notEqual(copy.taskStates[0].id,taskState.id);
  assert.notEqual(copy.projectChecklists[0].id, lists[0].id); assert.equal(copy.projectChecklists[0].items[0].done, true);
  assert.equal(copy.externalLinks[0].url, links[0].url); assert.notEqual(copy.externalLinks[0].id, links[0].id);
  assert.equal((await call("GET", base + "/projects/" + copy.id, undefined, b)).statusCode, 404, "source reader grant is not copied");
  const copyDetail = data(await call("GET", base + "/projects/" + copy.id, undefined, a));
  assert.equal(copyDetail.access.length, 1); assert.equal(copyDetail.access[0].memberId, p.creatorId);
  const copiedTasks = data(await call("GET", base + "/tasks?projectId=" + copy.id, undefined, a)).tasks;
  assert.equal(copiedTasks.length, 3);
  const cp = copiedTasks.find((t: any) => t.title === parent.title), cc = copiedTasks.find((t: any) => t.title === child.title), cs = copiedTasks.find((t: any) => t.title === successor.title);
  assert.equal(cp.status,"IN_PROGRESS");assert.equal(cp.customStatusId,copy.taskStates[0].id);
  assert.equal(cc.parentId, cp.id); assert.notEqual(cc.subtaskGroupId, group.id); assert.notEqual(cp.sectionId, section.id);
  assert.equal(data(await call("GET", base + "/tasks/" + cp.id, undefined, a)).groups[0].id, cc.subtaskGroupId);
  assert.deepEqual(data(await call("GET", base + "/tasks/" + cp.id, undefined, a)).assignments, []);
  assert.equal(cp.taskChecklists[0].title,grouped[0].title);assert.notEqual(cp.taskChecklists[0].id,grouped[0].id);assert.equal(cp.taskChecklists[0].items[0].done,true);
  assert.deepEqual(cp.planningIntent,{recurrence:"MONTHLY",reminderLocal:null});
  assert.equal(data(await call("GET", base + "/tasks/" + cp.id, undefined, a)).checklist.length, 1);
  assert.equal(data(await call("GET", base + "/tasks/" + cp.id, undefined, a)).comments.length, 0);
  const edges = data(await call("GET", base + "/tasks/" + cs.id, undefined, a)).dependencies;
  assert.ok(edges.some((e: any) => e.predecessorId === cc.id && e.successorId === cs.id && e.lagMinutes === 30));
  const copyHistory=data(await call("GET",base+"/projects/"+copy.id+"/activity",undefined,a));
  assert.deepEqual(copyHistory.entries.map((entry:any)=>entry.action),["ProjectDuplicated"],"history is new canonical evidence, never copied");
  const templateHeaders = { ...match(p.version), "idempotency-key": randomUUID() };
  const template = data(await call("POST", base + "/projects/" + p.id + "/template", { name: "Modelo compartilhado" }, a, templateHeaders)).template;
  assert.equal(data(await call("POST", base + "/projects/" + p.id + "/template", { name: "Modelo compartilhado" }, a, templateHeaders)).template.id, template.id);
  assert.equal(template.definition.tasks.length, 3); assert.equal(template.definition.groups.length, 1); assert.equal(template.definition.dependencies.length, 1);
  assert.equal(template.definition.checklists[0].items[0].done, false);
  assert.equal(data(await call("GET", base + "/templates", undefined, b)).templates.find((t: any) => t.id === template.id).name, template.name);
  const fromTemplate = data(await call("POST", base + "/projects", { title: "Do modelo", visibility: "PRIVATE", templateId: template.id }, a)).project;
  assert.equal(fromTemplate.description, p.description); assert.deepEqual(fromTemplate.tags, ["pesquisa"]); assert.equal(fromTemplate.projectChecklists[0].items[0].done, false);
  const seededTasks = data(await call("GET", base + "/tasks?projectId=" + fromTemplate.id, undefined, a)).tasks;
  assert.equal(seededTasks.length, 3); assert.ok(seededTasks.every((t: any) => t.status === "TODO")); assert.ok(seededTasks.every((t: any) => Object.keys(t.customFields).length === 0));
  const seededParent = seededTasks.find((t: any) => t.title === parent.title), seededChild = seededTasks.find((t: any) => t.title === child.title);
  assert.equal(seededChild.parentId, seededParent.id); assert.ok(seededChild.subtaskGroupId); assert.equal(seededParent.externalLinks.length, 1);
  assert.equal(seededParent.taskChecklists[0].items[0].done,false);
  assert.notEqual(seededParent.taskChecklists[0].id,grouped[0].id);
  assert.deepEqual(seededParent.planningIntent,{recurrence:"MONTHLY",reminderLocal:null});
  assert.equal((await call("POST", other + "/projects", { title: "Foreign template", templateId: template.id }, c)).statusCode, 404);
  const beforeBad = data(await call("GET", base + "/projects", undefined, a)).projects.length;
  assert.equal((await call("POST", base + "/projects", { title: "Invalid typed rollback", templateId: template.id, customFields: { [defs[1].id]: "wrong" } }, a)).statusCode, 400);
  assert.equal(data(await call("GET", base + "/projects", undefined, a)).projects.length, beforeBad, "invalid metadata rolls back all template seeds");
  const seedParent=template.definition.tasks.find((t:any)=>t.title===parent.title),seedChild=template.definition.tasks.find((t:any)=>t.title===child.title);
  const invalidTemplate = { ...template.definition, dependencies: [{ predecessorId: seedParent.id, successorId: seedChild.id, type: "FS", lagMinutes: 0 }, { predecessorId: seedChild.id, successorId: seedParent.id, type: "FS", lagMinutes: 0 }] };
  assert.equal((await call("POST", base + "/templates", { name: "Invalid DAG", definition: invalidTemplate }, a)).statusCode, 400);
  const importedIds=await asContext(a,A.organization.id,async ctx=>{
    const adapters=createWorkResourceAdapters({});
    const projectExport=await adapters.project.export!(ctx,[p.id],"project-definitions-v1");
    const projectImport=await adapters.project.applyImport!(ctx,projectExport.records,"project-definitions-v1");
    const taskExport=await adapters.task.export!(ctx,[parent.id],"TASKS");
    const taskImport=await adapters.task.applyImport!(ctx,taskExport.records,"TASKS");
    return {projectId:projectImport.idMap[p.id],taskId:taskImport.idMap[parent.id]};
  });
  const importedProject=data(await call("GET",base+"/projects/"+importedIds.projectId,undefined,a)).project;
  assert.deepEqual(importedProject.customFields,values);assert.equal(importedProject.priority,"HIGH");assert.equal(importedProject.sectionName,"Descoberta");assert.equal(importedProject.leadMemberId,bm.id);assert.deepEqual(importedProject.planningIntent,intent);assert.equal(importedProject.projectChecklists[0].items[0].done,true);assert.equal(importedProject.externalLinks[0].url,links[0].url);
  assert.equal((await call("GET",base+"/projects/"+importedIds.projectId,undefined,b)).statusCode,404);
  const importedTask=data(await call("GET",base+"/tasks/"+importedIds.taskId,undefined,a)).task;
  assert.equal(importedTask.projectId,null);assert.equal(importedTask.customFields[defs[1].id],3);assert.equal(importedTask.taskChecklists[0].items[0].done,true);assert.equal(importedTask.externalLinks[0].url,links[0].url);assert.deepEqual(importedTask.planningIntent,{recurrence:"MONTHLY",reminderLocal:null});
  const projectView={id:randomUUID(),name:"Prioridade por seção",view:"GALLERY",relevance:"ALL",sort:"PRIORITY",grouping:"SECTION"};
  const savedProjectView=data(await call("POST",base+"/project-views",{views:[projectView]},a,match(0)));
  assert.equal(savedProjectView.views[0].sort,"PRIORITY");assert.equal(savedProjectView.views[0].grouping,"SECTION");
  // A personal saved task view belongs to this exact project and member, separate from catalog views.
  const view = { id: randomUUID(), name: "Escuta em galeria", view: "GALLERY", query: "Ouvir", sort: "PRIORITY", grouping: "NONE", personFilter: bm.id, roleFilter: "", circleFilter: "", statusFilter: "TODO", tagFilter: "escuta", visibleProperties: ["state", "due"], archived: false, archiveMode:"ACTIVE", orderIds: [child.id] };
  const saved = data(await call("POST", base + "/task-views", { projectId: p.id, views: [view] }, b, match(0)));
  assert.equal(saved.version, 1); assert.deepEqual(saved.views, [view]);
  assert.deepEqual(data(await call("GET", base + "/task-views?projectId=" + p.id, undefined, b)).views, [view]);
  assert.deepEqual(data(await call("GET", base + "/task-views?projectId=" + p.id, undefined, a)).views, []);
  assert.deepEqual(data(await call("GET", base + "/project-views", undefined, b)).views, []);
  assert.equal((await call("POST", base + "/task-views", { projectId: p.id, views: [{ ...view, orderIds: [cp.id] }] }, b, match(1))).statusCode, 404);
  assert.equal((await call("POST", base + "/task-views", { projectId: p.id, views: [{ ...view, statusFilter: "custom:" + randomUUID() }] }, b, match(1))).statusCode, 422);
  assert.equal((await call("POST", base + "/task-views", { projectId: p.id, views: [] }, b, match(0))).statusCode, 409);
  const archivedSeed=data(await call("PATCH",base+"/tasks/"+seededParent.id,{archived:true},a,match(seededParent.version))).task;
  const archivedDetail=data(await call("GET",base+"/tasks/"+archivedSeed.id+"/archived",undefined,a));
  assert.equal(archivedDetail.task.title,parent.title);assert.equal(archivedDetail.commentsComplete,false);assert.equal(archivedDetail.capabilities.edit,false);assert.equal(archivedDetail.task.taskChecklists[0].items[0].done,false);
  assert.equal((await call("GET",base+"/tasks/"+archivedSeed.id+"/archived",undefined,b)).statusCode,404);
  assert.equal((await call("GET",base+"/tasks/"+seededChild.id+"/archived",undefined,a)).statusCode,200,"ancestor archive is readable without mutating child");
  assert.equal((await call("PATCH",base+"/tasks/"+archivedSeed.id+"/checklists",{checklists:[]},a,match(archivedSeed.version))).statusCode,404);
  const history = data(await call("GET", base + "/projects/" + p.id + "/activity", undefined, b));
  assert.equal(history.coverage, "CANONICAL_AUDIT"); assert.ok(history.entries.some((entry: any) => entry.action === "ProjectChecklistsChanged"));
  const allowedIds = new Set([p.id, parent.id, child.id, successor.id]);
  assert.ok(history.entries.every((entry: any) => allowedIds.has(entry.resourceId)));
  assert.ok(history.entries.every((entry: any) => !Object.hasOwn(entry, "actorId") && !Object.hasOwn(entry, "email")));
  assert.equal((await call("GET", other + "/projects/" + p.id + "/activity", undefined, c)).statusCode, 404);
  await refresh();
  data(await call("POST", base + "/projects/" + p.id + "/access", { memberId: bm.id, role: null }, a, match(p.version)));
  assert.equal((await call("GET", base + "/task-views?projectId=" + p.id, undefined, b)).statusCode, 404);
  assert.equal((await call("GET", base + "/projects/" + p.id + "/activity", undefined, b)).statusCode, 404, "activity revalidates revoked ACL");
  assert.equal((await call("GET", base + "/tasks/" + parent.id + "/activity", undefined, b)).statusCode, 404);
  assert.equal(data(await call("GET", base + "/projects/" + p.id, undefined, a)).project.projectChecklists[0].items[0].done, true);
  await refresh();
  p=data(await call("PATCH",base+"/projects/"+p.id,{views:["BOARD"]},a,match(p.version))).project;
  assert.equal((await call("POST",base+"/task-views",{projectId:p.id,views:[view]},a,match(0))).statusCode,422,"named views honor project-disabled views too");
});
