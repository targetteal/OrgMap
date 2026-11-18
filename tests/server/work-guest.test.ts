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
const db = "orgmap_work_guest_" + randomUUID().replaceAll("-", "");
await admin.query(`CREATE DATABASE "${db}"`);
const migrationUrl = new URL(adminUrl);
migrationUrl.pathname = "/" + db;
const migrationEnvironment: NodeJS.ProcessEnv = { ...process.env, MIGRATION_DATABASE_URL: migrationUrl.href };
delete migrationEnvironment.MIGRATION_SCOPE;
delete migrationEnvironment.MIGRATION_MAX_PREFIX;
try {
  const result = spawnSync(process.execPath, ["--import", "tsx", "server/src/migrate.ts"], {env:migrationEnvironment,encoding:"utf8"});
  if (result.status !== 0) throw Error(`WORK_GUEST_OFFICIAL_MIGRATION_FAILED: ${result.stderr || result.stdout}`);
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
const { workModule, createWorkModule, createWorkResourceAdapters } =
  await import("../../server/modules/work/index.js");
const { createWorkGuestAccessAdapter } =
  await import("../../server/modules/work/guest.js");
let workEnabled = true;
let httpCore: any;
function bind(core: any) {
  core.registerOrganizationSettings(async (ctx: any) => ({
    version: 1,
    settings: {
      name: ctx.org.name,
      locale: ctx.org.locale,
      timezone: ctx.org.time_zone,
      modules: { structure: true, work: workEnabled },
    },
  }));
  core.registerGuestAccessAdapter(createWorkGuestAccessAdapter(core));
  return core;
}
let app: Awaited<ReturnType<typeof buildApp>>;
try {
  app = await buildApp([
    async (app, core) => {
      httpCore = bind(core);
      const { mountWorkTestHarness } =
        await import("../../server/modules/work/test-harness.js");
      await mountWorkTestHarness(app, core, { workOptions: { guest: core } });
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

const ref = (kind: string, id: string) => ({ context: "work", kind, id });
test("Work Guest uses exact read grants before collections/search and never inherits project/parent/dependency identities", async () => {
  const a = await user(),
    g = await user(),
    b = await user(),
    A = data(await call("POST", "/organizations", { name: "Guest Work A" }, a)),
    B = data(await call("POST", "/organizations", { name: "Guest Work B" }, b)),
    org = A.organization.id,
    base = "/organizations/" + org,
    wb = base + "/work";
  const p = data(
      await call(
        "POST",
        wb + "/projects",
        { title: "Projeto compartilhado", visibility: "PRIVATE" },
        a,
      ),
    ).project,
    q = data(
      await call(
        "POST",
        wb + "/projects",
        { title: "Projeto invisível sentinel", visibility: "PRIVATE" },
        a,
      ),
    ).project,
    u = data(
      await call(
        "POST",
        wb + "/projects",
        { title: "AAA Público invisível sentinel" },
        a,
      ),
    ).project;
  const parent = data(
      await call(
        "POST",
        wb + "/tasks",
        { title: "Pai invisível sentinel", projectId: q.id },
        a,
      ),
    ).task,
    t = data(
      await call(
        "POST",
        wb + "/tasks",
        {
          title: "Tarefa explicitamente compartilhada",
          projectId: q.id,
          parentId: parent.id,
          priority: "HIGH",
          estimateMinutes: 45,
          tags: ["Visível", "<script>literal</script>"],
        },
        a,
      ),
    ).task,
    child = data(
      await call(
        "POST",
        wb + "/tasks",
        { title: "Filha invisível sentinel", projectId: q.id, parentId: t.id },
        a,
      ),
    ).task,
    projectOnlyChild = data(
      await call(
        "POST",
        wb + "/tasks",
        { title: "Tarefa de projeto sem grant sentinel", projectId: p.id },
        a,
      ),
    ).task;
  data(
    await call(
      "POST",
      wb + "/tasks/" + t.id + "/dependencies",
      { predecessorId: parent.id, type: "FS", lagMinutes: 0 },
      a,
      match(1),
    ),
  );
  data(
    await call(
      "POST",
      wb + "/tasks/" + t.id + "/links",
      { targetTaskId: child.id },
      a,
      match(2),
    ),
  );
  const plan = [
    { resource: ref("project", p.id), actions: ["read"] },
    { resource: ref("task", t.id), actions: ["read"] },
  ];
  assert.equal(
    (
      await call(
        "POST",
        base + "/members",
        {
          accountId: g.id,
          memberType: "GUEST",
          accessPlan: [{ resource: ref("project", p.id), actions: ["edit"] }],
        },
        a,
      )
    ).statusCode,
    403,
  );
  const gm = data(
    await call(
      "POST",
      base + "/members",
      { accountId: g.id, memberType: "GUEST", accessPlan: plan },
      a,
    ),
  ).membership;
  const projects = data(await call("GET", wb + "/projects", undefined, g));
  assert.deepEqual(
    projects.projects.map((x: any) => x.id),
    [p.id],
  );
  assert.equal(projects.canCreate, false);
  const tasks = data(await call("GET", wb + "/tasks", undefined, g));
  assert.deepEqual(
    tasks.tasks.map((x: any) => x.id),
    [t.id],
  );
  assert.deepEqual(tasks.tasks[0].assigneeIds, []);
  const detail = data(await call("GET", wb + "/tasks/" + t.id, undefined, g));
  for (const item of [tasks.tasks[0], detail.task])
    assert.deepEqual(
      {
        priority: item.priority,
        estimateMinutes: item.estimateMinutes,
        tags: item.tags,
      },
      {
        priority: "HIGH",
        estimateMinutes: 45,
        tags: ["Visível", "<script>literal</script>"],
      },
    );
  assert.equal(detail.task.projectId, null);
  assert.equal(detail.task.parentId, null);
  assert.deepEqual(detail.dependencies, []);
  assert.deepEqual(detail.links, []);
  assert.deepEqual(detail.subtasks, []);
  assert.deepEqual(detail.assignments, []);
  assert.equal(detail.capabilities.edit, false);
  assert.equal(detail.coverage, "EXPLICIT_TASK_GRANTS_ONLY");
  const projectDetail = data(
    await call("GET", wb + "/projects/" + p.id, undefined, g),
  );
  assert.equal(projectDetail.project.creatorId, undefined);
  assert.equal(projectDetail.project.circleId, undefined);
  assert.deepEqual(projectDetail.access, []);
  assert.equal(projectDetail.capabilities.manage, false);
  const serialized = JSON.stringify({ projects, tasks, detail, projectDetail });
  for (const sentinel of [
    q.id,
    parent.id,
    child.id,
    projectOnlyChild.id,
    u.id,
    "Projeto invisível sentinel",
    "Pai invisível sentinel",
    "Filha invisível sentinel",
    "Tarefa de projeto sem grant sentinel",
    A.membership.id,
  ])
    assert.ok(!serialized.includes(sentinel), sentinel);
  for (const path of [
    "/projects/" + u.id,
    "/projects/" + q.id,
    "/tasks/" + parent.id,
    "/settings",
    "/layout",
    "/stats",
    "/statistics",
    "/exports/capabilities",
  ])
    assert.equal(
      (await call("GET", wb + path, undefined, g)).statusCode,
      404,
      path,
    );
  assert.equal(
    (
      await call(
        "PATCH",
        wb + "/tasks/" + t.id,
        { title: "Mutação negada" },
        g,
        match(3),
      )
    ).statusCode,
    404,
  );
  assert.equal(
    (
      await call(
        "GET",
        "/organizations/" + B.organization.id + "/work/tasks/" + t.id,
        undefined,
        g,
      )
    ).statusCode,
    404,
  );
  const worker = bind(createRuntime()),
    adapters = createWorkResourceAdapters({ guest: worker });
  await worker.withResourceWorkerContext(
    org,
    gm.id,
    [{ resource: ref("task", t.id), action: "read" }],
    async (ctx: any) => {
      assert.equal(await adapters.task.authorize(ctx, t.id, "read"), true);
      assert.equal(await adapters.task.authorize(ctx, t.id, "export"), false);
      assert.equal(await adapters.project.authorize(ctx, q.id, "read"), false);
      assert.deepEqual(
        (await adapters.project.search!(ctx, "", 1)).map((x) => x.id),
        [p.id],
      );
      assert.deepEqual(
        (await adapters.task.search!(ctx, "", 1)).map((x) => x.id),
        [t.id],
      );
      assert.deepEqual(await adapters.task.search!(ctx, "sentinel", 1), []);
      await assert.rejects(() => adapters.task.export(ctx, [t.id], "TASKS"));
    },
  );
  await assert.rejects(() =>
    worker.withWorkerContext(org, gm.id, async () => true),
  );
  await assert.rejects(() =>
    worker.withResourceWorkerContext(
      org,
      gm.id,
      [{ resource: ref("task", parent.id), action: "read" }],
      async () => true,
    ),
  );
  workEnabled = false;
  assert.equal(
    (await call("GET", wb + "/tasks/" + t.id, undefined, g)).statusCode,
    404,
  );
  await assert.rejects(() =>
    worker.withResourceWorkerContext(
      org,
      gm.id,
      [{ resource: ref("task", t.id), action: "read" }],
      async () => true,
    ),
  );
  workEnabled = true;
  const grants = data(
      await call(
        "GET",
        base + "/members/" + gm.id + "/access-grants",
        undefined,
        a,
      ),
    ).items,
    taskGrant = grants.find((x: any) => x.resourceId === t.id);
  data(
    await call(
      "POST",
      base + "/members/" + gm.id + "/access-grants/" + taskGrant.id + "/revoke",
      {},
      a,
      match(taskGrant.version),
    ),
  );
  assert.equal(
    (await call("GET", wb + "/tasks/" + t.id, undefined, g)).statusCode,
    404,
  );
  assert.deepEqual(
    data(await call("GET", wb + "/tasks", undefined, g)).tasks,
    [],
  );
  await assert.rejects(() =>
    worker.withResourceWorkerContext(
      org,
      gm.id,
      [{ resource: ref("task", t.id), action: "read" }],
      async () => true,
    ),
  );
  // A downgrade must reject an earlier successful command before idempotency replay.
  const former = await user(),
    fm = data(
      await call("POST", base + "/members", { accountId: former.id }, a),
    ).membership,
    k = randomUUID(),
    payload = { title: "Tarefa pessoal antes de downgrade" };
  data(
    await call("POST", wb + "/tasks", payload, former, {
      "idempotency-key": k,
    }),
  );
  data(
    await call(
      "POST",
      base + "/members/" + fm.id + "/actions/change-type",
      { memberType: "GUEST", confirmVisibilityChange: true },
      a,
      match(fm.version),
    ),
  );
  assert.equal(
    (
      await call("POST", wb + "/tasks", payload, former, {
        "idempotency-key": k,
      })
    ).statusCode,
    404,
  );
  // Keeping the grantor active is insufficient when their private manager grant is removed.
  const bm = data(
    await call("POST", base + "/members", { accountId: b.id }, a),
  ).membership;
  data(
    await call(
      "POST",
      wb + "/projects/" + p.id + "/access",
      { memberId: bm.id, role: "MANAGER" },
      a,
      match(1),
    ),
  );
  data(
    await call(
      "POST",
      wb + "/projects/" + p.id + "/access",
      { memberId: A.membership.id, role: null },
      b,
      match(2),
    ),
  );
  assert.equal(
    (await call("GET", wb + "/projects/" + p.id, undefined, g)).statusCode,
    404,
  );
  assert.deepEqual(
    data(await call("GET", wb + "/projects", undefined, g)).projects,
    [],
  );
  await assert.rejects(() =>
    worker.withResourceWorkerContext(
      org,
      gm.id,
      [{ resource: ref("project", p.id), action: "read" }],
      async () => true,
    ),
  );
});
