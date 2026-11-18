import { isFoundationMigration } from "../../server/src/migration-selection.js";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { readFile, readdir } from "node:fs/promises";
import { previewSchedule, ordered } from "../../server/modules/work/domain.js";
import { createWorkApplicationPorts } from "../../server/modules/work/application.js";

// Standalone isolated database: never resets or migrates the shared development DB.
const adminUrl =
  process.env.MIGRATION_DATABASE_URL ??
  "postgres://orgmap_migrator:orgmap_local_only@127.0.0.1:55432/orgmap";
const admin = new pg.Pool({ connectionString: adminUrl });
const db = "orgmap_work_statmig_" + randomUUID().replaceAll("-", "");
await admin.query(`CREATE DATABASE "${db}"`);
const migrationUrl = new URL(adminUrl);
migrationUrl.pathname = "/" + db;
const migrator = new pg.Pool({ connectionString: migrationUrl.href });
try {
  for (const name of (await readdir("server/migrations"))
    .filter(
      (n) =>
        (isFoundationMigration(n) ||
          /^(2[0-4]\d|42[5-9]|43\d|44\d)_.*\.sql$/.test(n)) &&
        !n.startsWith("208_"),
    )
    .sort())
    await migrator.query(await readFile("server/migrations/" + name, "utf8"));
} catch (e) {
  await migrator.end();
  await admin.query(`DROP DATABASE "${db}" WITH (FORCE)`);
  await admin.end();
  throw e;
}
await migrator.end();
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

test("statistics migration observes legacy rows across forced tenant RLS without inventing creation dates", async () => {
  const a = await user(),
    b = await user();
  const fixtures = [];
  for (const u of [a, b]) {
    const A = data(await call("POST", "/organizations", { name: "Migração de observação" }, u));
    const base = "/organizations/" + A.organization.id + "/work";
    const projectId = randomUUID(), taskId = randomUUID();
    // Seed the pre-208 schema directly; current Work commands require later migrations.
    await asContext(u, A.organization.id, async (ctx) => {
      await ctx.c.query("INSERT INTO work_projects(organization_id,id,title,visibility,creator_id) VALUES($1,$2,$3,'PUBLIC',$4)", [A.organization.id,projectId,"Projeto legado sintético",ctx.member.id]);
      await ctx.c.query("INSERT INTO work_access(organization_id,project_id,member_id,role) VALUES($1,$2,$3,'MANAGER')", [A.organization.id,projectId,ctx.member.id]);
      await ctx.c.query("INSERT INTO work_tasks(organization_id,id,project_id,creator_id,title) VALUES($1,$2,$3,$4,$5)", [A.organization.id,taskId,projectId,ctx.member.id,"Tarefa existente antes da migração"]);
    });
    fixtures.push({ u, org: A.organization.id, task: taskId, base });
  }
  const migrationPool = new pg.Pool({ connectionString: migrationUrl.href });
  try {
    assert.equal(
      (await migrationPool.query("SELECT current_database() AS name")).rows[0]
        .name,
      db,
    );
    await migrationPool.query(
      await readFile(
        "server/migrations/208_work_statistics_history.sql",
        "utf8",
      ),
    );
  } finally {
    await migrationPool.end();
  }
  for (const f of fixtures)
    await asContext(f.u, f.org, async (ctx) => {
      const tasks = (
        await ctx.c.query(
          "SELECT created_at FROM work_tasks WHERE organization_id=$1 AND id=$2",
          [f.org, f.task],
        )
      ).rows;
      assert.equal(tasks[0].created_at, null);
      const observations = (
        await ctx.c.query(
          "SELECT * FROM work_task_observations WHERE organization_id=$1",
          [f.org],
        )
      ).rows;
      assert.equal(observations.length, 1);
      assert.equal(observations[0].task_id, f.task);
      assert.equal(observations[0].kind, "BASELINE");
      assert.equal(observations[0].actor_member_id, null);
    });
  assert.equal(
    (await pool.query("SELECT * FROM work_task_observations")).rowCount,
    0,
    "RLS denies unscoped reads",
  );
  const current = data(
    await call("GET", fixtures[0].base + "/statistics", undefined, a),
  );
  assert.equal(current.total, 1);
  assert.equal(current.created, 0);
  assert.equal(current.changes, 0);
  assert.equal(current.coverage.unknownCreationDates, 1);
});
