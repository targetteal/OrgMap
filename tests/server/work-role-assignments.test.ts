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
const db = "orgmap_work_roles_" + randomUUID().replaceAll("-", "");
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
let workRoleCapacity: any;
try {
  const { mountWorkTestHarness } =
    await import("../../server/modules/work/test-harness.js");
  app = await buildApp([
    async (app, core) => {
      const { createRoleCapacityPort } =
        await import("../../server/modules/structure/role-capacity.js");
      const { createWorkGuestAccessAdapter } =
        await import("../../server/modules/work/index.js");
      core.registerGuestAccessAdapter(createWorkGuestAccessAdapter(core));
      core.registerOrganizationSettings(async (ctx) => ({
        version: 1,
        settings: {
          name: ctx.org.name,
          locale: ctx.org.locale,
          timezone: ctx.org.time_zone,
          modules: { work: true, structure: true },
        },
      }));
      workRoleCapacity = createRoleCapacityPort(core);
      await mountWorkTestHarness(app, core, {
        workOptions: { roleCapacity: workRoleCapacity },
      });
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

test("real Structure capacity drives typed Work assignment with SINGLE, legacy safety and private read intersection", async () => {
  const a = await user(),
    b = await user(),
    c = await user(),
    A = data(await call("POST", "/organizations", { name: "ROLE Work" }, a)),
    org = A.organization.id,
    base = "/organizations/" + org,
    work = base + "/work";
  const bm = data(
      await call("POST", base + "/members", { accountId: b.id }, a),
    ).membership,
    cm = data(
      await call("POST", base + "/members", { accountId: c.id }, a),
    ).membership;
  const role = data(
    await call(
      "POST",
      base + "/roles",
      { name: "Nome arbitrário", circleId: A.rootCircle.id, mode: "DIRECT" },
      a,
    ),
  ).role;
  const p = data(
    await call("POST", work + "/projects", { title: "Público" }, a),
  ).project;
  data(
    await call(
      "PATCH",
      work + "/projects/" + p.id,
      { assignmentMode: "SINGLE" },
      a,
      match(1),
    ),
  );
  const t = data(
      await call(
        "POST",
        work + "/tasks",
        { title: "Papel dinâmico", projectId: p.id },
        a,
      ),
    ).task,
    principals = [{ kind: "ROLE", roleId: role.id }],
    occupancy = randomUUID();
  const fixture = new pg.Pool({ connectionString: migrationUrl.href });
  const seed = async (sql: string, args: unknown[]) => {
    const client = await fixture.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        "SELECT set_config('orgmap.organization_id',$1,true)",
        [org],
      );
      await client.query(sql, args);
      await client.query("COMMIT");
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }
  };
  try {
    await seed(
      "INSERT INTO occupancies(organization_id,id,member_id,role_id,kind,starts_at) VALUES($1,$2,$3,$4,'DIRECT',clock_timestamp()-interval '1 day'),($1,$5,$6,$4,'DIRECT',clock_timestamp()-interval '1 day')",
      [org, occupancy, bm.id, role.id, randomUUID(), cm.id],
    );
    const headers = { ...match(1), "idempotency-key": randomUUID() },
      assigned = await call(
        "POST",
        work + "/tasks/" + t.id + "/assignments",
        { principals },
        a,
        headers,
      );
    assert.equal(assigned.statusCode, 200);
    assert.equal(data(assigned).task.version, 2);
    const detail = () =>
      call("GET", work + "/tasks/" + t.id, undefined, a).then(data);
    let d = await detail();
    assert.deepEqual(d.principals, principals);
    assert.equal(d.assignments.length, 0);
    assert.deepEqual(
      new Set(d.resolvedAssignees.map((r: any) => r.memberId)),
      new Set([bm.id, cm.id]),
    );
    assert.equal(d.roleCapacities[0].state, "OCCUPIED");
    assert.equal(d.capabilities.roleAssignment, true);
    for (const legacy of [{ memberIds: [] }, { assigneeIds: [] }])
      assert.equal(
        (
          await call(
            "POST",
            work + "/tasks/" + t.id + "/assignments",
            legacy,
            a,
            match(2),
          )
        ).statusCode,
        409,
      );
    assert.equal(
      (
        await call(
          "POST",
          work + "/tasks/" + t.id + "/assignments",
          {
            principals: [
              ...principals,
              { kind: "MEMBER", memberId: A.membership.id },
            ],
          },
          a,
          match(2),
        )
      ).statusCode,
      422,
    );
    assert.equal(
      (
        await call(
          "POST",
          work + "/tasks/" + t.id + "/assignments",
          { principals: [...principals, ...principals] },
          a,
          match(2),
        )
      ).statusCode,
      400,
    );
    await seed(
      "UPDATE occupancies SET ends_at=clock_timestamp()-interval '1 microsecond' WHERE organization_id=$1 AND id=$2",
      [org, occupancy],
    );
    d = await detail();
    assert.deepEqual(
      d.resolvedAssignees.map((r: any) => r.memberId),
      [cm.id],
    );
    assert.equal(d.task.version, 2);
    assert.deepEqual(d.principals, principals);
    assert.deepEqual(
      data(
        await call(
          "POST",
          work + "/tasks/" + t.id + "/assignments",
          { principals },
          a,
          headers,
        ),
      ),
      data(assigned),
    );
    const clone = data(
      await call(
        "POST",
        work + "/tasks/" + t.id + "/duplicate",
        { title: "Cópia ROLE" },
        a,
        match(2),
      ),
    ).task;
    assert.deepEqual(
      data(await call("GET", work + "/tasks/" + clone.id, undefined, a))
        .principals,
      principals,
    );
    const q = data(
        await call(
          "POST",
          work + "/projects",
          { title: "Privado", visibility: "PRIVATE" },
          a,
        ),
      ).project,
      qt = data(
        await call(
          "POST",
          work + "/tasks",
          { title: "Sem grant", projectId: q.id },
          a,
        ),
      ).task;
    data(
      await call(
        "POST",
        work + "/tasks/" + qt.id + "/assignments",
        { principals },
        a,
        match(1),
      ),
    );
    assert.deepEqual(
      data(await call("GET", work + "/tasks/" + qt.id, undefined, a))
        .resolvedAssignees,
      [],
    );
    assert.equal(
      (await call("GET", work + "/tasks/" + qt.id, undefined, c)).statusCode,
      404,
    );
    data(
      await call(
        "POST",
        work + "/projects/" + q.id + "/access",
        { memberId: cm.id, role: "READER" },
        a,
        match(1),
      ),
    );
    assert.deepEqual(
      data(
        await call("GET", work + "/tasks/" + qt.id, undefined, a),
      ).resolvedAssignees.map((r: any) => r.memberId),
      [cm.id],
    );
    const personal = data(
      await call("POST", work + "/tasks", { title: "Segredo pessoal" }, a),
    ).task;
    data(
      await call(
        "POST",
        work + "/tasks/" + personal.id + "/assignments",
        { principals },
        a,
        match(1),
      ),
    );
    assert.deepEqual(
      data(await call("GET", work + "/tasks/" + personal.id, undefined, a))
        .resolvedAssignees,
      [],
    );
    assert.ok(
      !JSON.stringify(
        data(await call("GET", work + "/tasks", undefined, c)),
      ).includes("Segredo pessoal"),
    );
    const multi = data(
        await call(
          "POST",
          work + "/projects",
          { title: "Razões múltiplas" },
          a,
        ),
      ).project,
      multiTask = data(
        await call(
          "POST",
          work + "/tasks",
          { title: "Pessoa direta e via papel", projectId: multi.id },
          a,
        ),
      ).task;
    data(
      await call(
        "POST",
        work + "/tasks/" + multiTask.id + "/assignments",
        { principals: [{ kind: "MEMBER", memberId: cm.id }, ...principals] },
        a,
        match(1),
      ),
    );
    const reasons = data(
      await call("GET", work + "/tasks/" + multiTask.id, undefined, a),
    ).resolvedAssignees;
    assert.equal(reasons.length, 1);
    assert.deepEqual(
      reasons[0].reasons.map((reason: any) => reason.kind),
      ["DIRECT", "ROLE_CAPACITY"],
    );
    assert.equal(
      (
        await call(
          "PATCH",
          work + "/projects/" + multi.id,
          { assignmentMode: "SINGLE" },
          a,
          match(1),
        )
      ).statusCode,
      422,
      "two principal reasons still count as two even for one person",
    );
    await asContext(a, org, async (ctx) => {
      const disabled = createWorkResourceAdapters({ roleCapacity: workRoleCapacity }).task;
      assert.ok(!disabled.exportKinds!.includes("task-definitions-v2"));
      await assert.rejects(() => disabled.export(ctx, [t.id], "task-definitions-v2"), (e: any) => e.code === "INVALID_EXPORT_KIND");
      await assert.rejects(() => disabled.validateImport!(ctx, [], "task-definitions-v2"), (e: any) => e.code === "INVALID_EXPORT_KIND");
      const adapter = createWorkResourceAdapters({
          roleCapacity: workRoleCapacity,
          principalTransfers: true,
        }).task,
        exported = await adapter.export(ctx, [t.id], "task-definitions-v2");
      assert.equal((exported.records[0] as any).schemaVersion, 2);
      assert.deepEqual((exported.records[0] as any).principals, principals);
      const imported = await adapter.applyImport!(
        ctx,
        exported.records,
        "task-definitions-v2",
      );
      const rows = (
        await ctx.c.query(
          "SELECT role_id FROM work_role_assignments WHERE organization_id=$1 AND task_id=$2",
          [org, imported.idMap[t.id]],
        )
      ).rows;
      assert.deepEqual(
        rows.map((row: any) => row.role_id),
        [role.id],
      );
      await assert.rejects(() =>
        adapter.validateImport!(
          ctx,
          [
            {
              ...(exported.records[0] as object),
              sourceOrganizationId: randomUUID(),
            },
          ],
          "task-definitions-v2",
        ),
      );
      const { projectPeriodStatistics } =
        await import("../../server/modules/work/statistics.js");
      const stats = await projectPeriodStatistics(
        ctx,
        [p.id],
        undefined,
        workRoleCapacity,
      );
      assert.equal(
        stats.participants,
        2,
        "creator plus one currently eligible role occupant, without duplicate task reasons",
      );
      assert.equal(stats.participantCoverage, "CURRENT_AUTHORIZED_CAPACITY");
      const unavailable = await projectPeriodStatistics(ctx, [p.id], undefined);
      assert.equal(unavailable.participants, null);
      assert.equal(unavailable.activeUserRate, null);
      assert.equal(
        unavailable.participantCoverage,
        "ROLE_CAPACITY_UNAVAILABLE",
      );
      const legacy = await adapter.export(ctx, [t.id], "TASKS");
      assert.equal((legacy.records[0] as any).schemaVersion, 1);
      assert.equal((legacy.records[0] as any).principals, undefined);
    });
    data(
      await call(
        "POST",
        work + "/settings",
        { showAllUnassigned: false },
        a,
        match(0),
      ),
    );
    const discovered = data(
      await call("GET", work + "/projects", undefined, c),
    ).projects;
    assert.ok(discovered.some((project: any) => project.id === p.id));
    assert.ok(
      discovered.some((project: any) => project.id === q.id),
      "explicit private grant remains discoverable",
    );
    const vacant = data(
      await call(
        "POST",
        base + "/roles",
        { name: "Vago", circleId: A.rootCircle.id, mode: "DIRECT" },
        a,
      ),
    ).role;
    data(
      await call(
        "POST",
        work + "/tasks/" + t.id + "/assignments",
        { principals: [{ kind: "ROLE", roleId: vacant.id }] },
        a,
        match(2),
      ),
    );
    d = await detail();
    assert.equal(d.roleCapacities[0].state, "VACANT");
    assert.deepEqual(d.resolvedAssignees, []);
    const { mountWorkTestHarness } =
      await import("../../server/modules/work/test-harness.js");
    const missing = await buildApp([
      async (api, core) => {
        await mountWorkTestHarness(api, core);
      },
    ]);
    try {
      const read = await missing.inject({
        method: "GET",
        url: "/api/v1" + work + "/tasks/" + t.id,
        headers: { cookie: a.cookie },
      });
      assert.equal(read.statusCode, 200);
      assert.equal(read.json().data.roleCapacities[0].state, "UNAVAILABLE");
      assert.equal(read.json().data.capabilities.roleAssignment, false);
      const write = await missing.inject({
        method: "POST",
        url: "/api/v1" + work + "/tasks/" + t.id + "/assignments",
        headers: {
          origin: "http://localhost:5173",
          cookie: a.cookie,
          "x-csrf-token": a.csrf,
          "idempotency-key": randomUUID(),
          ...match(3),
        },
        payload: { principals },
      });
      assert.equal(write.statusCode, 503);
    } finally {
      await missing.close();
    }
    await asContext(a, org, async (ctx) =>
      assert.equal(
        (
          await ctx.c.query(
            "SELECT count(*)::int n FROM work_assignments WHERE organization_id=$1 AND task_id=$2",
            [org, t.id],
          )
        ).rows[0].n,
        0,
      ),
    );
  } finally {
    await fixture.end();
  }
});

test('ROLE write failure rolls back principal storage and task version before safe retry/replay',async()=>{
 const a=await user(),A=data(await call('POST','/organizations',{name:'ROLE rollback'},a)),org=A.organization.id,base='/organizations/'+org,work=base+'/work',role=data(await call('POST',base+'/roles',{name:'Vago para rollback',circleId:A.rootCircle.id,mode:'DIRECT'},a)).role,t=data(await call('POST',work+'/tasks',{title:'Transação role'},a)).task,principals=[{kind:'ROLE',roleId:role.id}],headers={...match(1),'idempotency-key':randomUUID()},fixture=new pg.Pool({connectionString:migrationUrl.href});
 try{
  await fixture.query(`CREATE FUNCTION work_role_rollback_probe() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic ROLE rollback'; END $$`);await fixture.query('CREATE TRIGGER work_role_rollback_probe BEFORE UPDATE ON work_tasks FOR EACH ROW EXECUTE FUNCTION work_role_rollback_probe()');
  assert.equal((await call('POST',work+'/tasks/'+t.id+'/assignments',{principals},a,headers)).statusCode,500);
  const before=data(await call('GET',work+'/tasks/'+t.id,undefined,a));assert.equal(before.task.version,1);assert.deepEqual(before.principals,[]);
  await fixture.query('DROP TRIGGER work_role_rollback_probe ON work_tasks');
  const saved=await call('POST',work+'/tasks/'+t.id+'/assignments',{principals},a,headers),replay=await call('POST',work+'/tasks/'+t.id+'/assignments',{principals},a,headers);assert.equal(saved.statusCode,200);assert.equal(data(saved).task.version,2);assert.deepEqual(data(replay),data(saved));assert.deepEqual(data(await call('GET',work+'/tasks/'+t.id,undefined,a)).principals,principals);
 }finally{await fixture.query('DROP TRIGGER IF EXISTS work_role_rollback_probe ON work_tasks');await fixture.query('DROP FUNCTION IF EXISTS work_role_rollback_probe()');await fixture.end();}
});
