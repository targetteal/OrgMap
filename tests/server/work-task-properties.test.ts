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
const db = "orgmap_work_properties_" + randomUUID().replaceAll("-", "");
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
      await mountWorkTestHarness(app, core);
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

test("task properties persist, version, copy and transfer with current tenant/ACL and atomic rollback", async () => {
  const a = await user(),
    b = await user(),
    c = await user(),
    A = data(
      await call("POST", "/organizations", { name: "Propriedades A" }, a),
    ),
    B = data(
      await call("POST", "/organizations", { name: "Propriedades B" }, c),
    ),
    org = A.organization.id,
    base = "/organizations/" + org + "/work";
  const bm = data(
      await call(
        "POST",
        "/organizations/" + org + "/members",
        { accountId: b.id },
        a,
      ),
    ).membership,
    p = data(
      await call(
        "POST",
        base + "/projects",
        { title: "Privado", visibility: "PRIVATE" },
        a,
      ),
    ).project;
  const raw = {
      priority: "HIGH",
      estimateMinutes: 90,
      tags: ["  oficina  ", "cafe\u0301", "<script>literal</script>"],
    },
    expected = {
      priority: "HIGH",
      estimateMinutes: 90,
      tags: ["oficina", "café", "<script>literal</script>"],
    };
  const properties = (t: any) => ({
    priority: t.priority,
    estimateMinutes: t.estimateMinutes,
    tags: t.tags,
  });
  const t = data(
    await call(
      "POST",
      base + "/tasks",
      { title: "Metadados", projectId: p.id, ...raw },
      a,
    ),
  ).task;
  assert.deepEqual(properties(t), expected);
  assert.equal(t.version, 1);
  assert.deepEqual(
    properties(
      data(await call("GET", base + "/tasks/" + t.id, undefined, a)).task,
    ),
    expected,
  );
  assert.equal(
    (
      await call(
        "GET",
        "/organizations/" + B.organization.id + "/work/tasks/" + t.id,
        undefined,
        c,
      )
    ).statusCode,
    404,
  );
  data(
    await call(
      "POST",
      base + "/projects/" + p.id + "/access",
      { memberId: bm.id, role: "READER" },
      a,
      match(1),
    ),
  );
  assert.deepEqual(
    properties(
      data(await call("GET", base + "/tasks/" + t.id, undefined, b)).task,
    ),
    expected,
  );
  assert.equal(
    (
      await call(
        "PATCH",
        base + "/tasks/" + t.id,
        { priority: "LOW" },
        b,
        match(1),
      )
    ).statusCode,
    403,
  );
  assert.equal(
    (await call("PATCH", base + "/tasks/" + t.id, { priority: "LOW" }, a))
      .statusCode,
    428,
  );
  const patched = data(
    await call(
      "PATCH",
      base + "/tasks/" + t.id,
      { title: "Preserva omitidos" },
      a,
      match(1),
    ),
  ).task;
  assert.equal(patched.version, 2);
  assert.deepEqual(properties(patched), expected);
  assert.equal(
    (
      await call(
        "PATCH",
        base + "/tasks/" + t.id,
        { priority: "LOW" },
        a,
        match(1),
      )
    ).statusCode,
    409,
  );
  for (const invalid of [
    { priority: "MAX" },
    { priority: null },
    { estimateMinutes: -1 },
    { estimateMinutes: 1.5 },
    { estimateMinutes: 525601 },
    { estimateMinutes: "90" },
    { tags: null },
    { tags: ["a", " a "] },
    { tags: ["café", "cafe\u0301"] },
    { tags: ["x\ny"] },
    { tags: [""] },
    { tags: ["😀".repeat(51)] },
    { tags: Array.from({ length: 21 }, (_, i) => String(i)) },
  ])
    assert.equal(
      (await call("PATCH", base + "/tasks/" + t.id, invalid, a, match(2)))
        .statusCode,
      400,
      JSON.stringify(invalid),
    );
  const copied = data(
    await call(
      "POST",
      base + "/tasks/" + t.id + "/duplicate",
      { title: "Cópia" },
      a,
      match(2),
    ),
  ).task;
  assert.deepEqual(properties(copied), expected);
  await asContext(a, org, async (ctx) => {
    const adapters = createWorkResourceAdapters(),
      exported = await adapters.task.export(ctx, [t.id], "TASKS");
    assert.deepEqual(properties(exported.records[0]), expected);
    const imported = await adapters.task.applyImport!(
        ctx,
        exported.records,
        "TASKS",
      ),
      stored = (
        await ctx.c.query(
          "SELECT priority,estimate_minutes,tags FROM work_tasks WHERE organization_id=$1 AND id=$2",
          [org, imported.idMap[t.id]],
        )
      ).rows[0];
    assert.deepEqual(
      {
        priority: stored.priority,
        estimateMinutes: stored.estimate_minutes,
        tags: stored.tags,
      },
      expected,
    );
  });
  const document = {
      schemaVersion: 1,
      projects: [
        {
          sourceId: "properties",
          title: "Import properties",
          tasks: [{ sourceId: "p", title: "Task imported", ...expected }],
        },
      ],
    },
    preview = data(
      await call("POST", base + "/project-import/preview", { document }, a),
    ),
    report = data(
      await call(
        "POST",
        base + "/project-import/apply",
        { document, planHash: preview.planHash },
        a,
      ),
    );
  assert.equal(report.report[0].status, "IMPORTED");
  const importedTasks = data(
    await call(
      "GET",
      base + "/tasks?projectId=" + report.report[0].projectId,
      undefined,
      a,
    ),
  ).tasks;
  assert.deepEqual(properties(importedTasks[0]), expected);
  const cleared = data(
    await call(
      "PATCH",
      base + "/tasks/" + t.id,
      { priority: "NONE", estimateMinutes: null, tags: [] },
      a,
      match(2),
    ),
  ).task;
  assert.deepEqual(properties(cleared), {
    priority: "NONE",
    estimateMinutes: null,
    tags: [],
  });
  assert.equal(cleared.version, 3);
  const zero = data(
    await call(
      "POST",
      base + "/tasks",
      { title: "Zero explícito", estimateMinutes: 0, tags: ["😀".repeat(50)] },
      a,
    ),
  ).task;
  assert.equal(zero.estimateMinutes, 0);
  assert.equal(zero.tags[0].length, 100);
  const empty = data(
    await call("POST", base + "/tasks", { title: "Desconhecido" }, a),
  ).task;
  assert.deepEqual(properties(empty), {
    priority: "NONE",
    estimateMinutes: null,
    tags: [],
  });
  const createKey = { "idempotency-key": randomUUID() },
    createBody = { title: "Replay metadata", projectId: p.id, ...expected },
    create = await call("POST", base + "/tasks", createBody, a, createKey),
    createReplay = await call(
      "POST",
      base + "/tasks",
      createBody,
      a,
      createKey,
    );
  assert.equal(createReplay.statusCode, 201);
  assert.deepEqual(data(createReplay), data(create));
  const fixture = new pg.Pool({ connectionString: migrationUrl.href }),
    key = randomUUID(),
    headers = { ...match(3), "idempotency-key": key },
    payload = { title: "rollback metadata", ...expected };
  try {
    await fixture.query(
      `CREATE FUNCTION work_test_properties_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.title='rollback metadata' THEN RAISE EXCEPTION 'synthetic properties rollback'; END IF; RETURN NEW; END $$`,
    );
    await fixture.query(
      "CREATE TRIGGER work_test_properties_failure BEFORE UPDATE ON work_tasks FOR EACH ROW EXECUTE FUNCTION work_test_properties_failure()",
    );
    assert.equal(
      (await call("PATCH", base + "/tasks/" + t.id, payload, a, headers))
        .statusCode,
      500,
    );
    assert.deepEqual(
      properties(
        data(await call("GET", base + "/tasks/" + t.id, undefined, a)).task,
      ),
      { priority: "NONE", estimateMinutes: null, tags: [] },
    );
    await fixture.query(
      "DROP TRIGGER work_test_properties_failure ON work_tasks",
    );
    const saved = await call(
        "PATCH",
        base + "/tasks/" + t.id,
        payload,
        a,
        headers,
      ),
      replay = await call(
        "PATCH",
        base + "/tasks/" + t.id,
        payload,
        a,
        headers,
      );
    assert.equal(saved.statusCode, 200);
    assert.equal(data(saved).task.version, 4);
    assert.equal(
      replay.statusCode,
      409,
      "PATCH is versioned, not a cached POST command",
    );
    assert.equal(
      data(await call("GET", base + "/tasks/" + t.id, undefined, a)).task
        .version,
      4,
    );
  } finally {
    await fixture.query(
      "DROP TRIGGER IF EXISTS work_test_properties_failure ON work_tasks",
    );
    await fixture.query(
      "DROP FUNCTION IF EXISTS work_test_properties_failure()",
    );
    await fixture.end();
  }
  const current = data(
    await call("GET", base + "/projects/" + p.id, undefined, a),
  ).project;
  data(
    await call(
      "PATCH",
      base + "/projects/" + p.id,
      { frozen: true },
      a,
      match(current.version),
    ),
  );
  assert.equal(
    (
      await call(
        "PATCH",
        base + "/tasks/" + t.id,
        { tags: ["frozen"] },
        a,
        match(4),
      )
    ).statusCode,
    409,
  );
});
