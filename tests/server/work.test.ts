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
const db = "orgmap_work_" + randomUUID().replaceAll("-", "");
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
let registrationAddress = 1;
async function call(
  method: string,
  path: string,
  b?: any,
  u?: User,
  headers: any = {},
) {
  return app.inject({
    method: method as any,
    ...(path === "/auth/register" ? { remoteAddress: `127.1.0.${registrationAddress++}` } : {}),
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
test("work PostgreSQL: organization isolation, ACL revocation, atomic moves, DAG concurrency, plan/apply and rollback", async () => {
  const a = await user(),
    b = await user(),
    c = await user();
  const A = data(
      await call("POST", "/organizations", { name: "Oficina Neblina" }, a),
    ),
    B = data(
      await call("POST", "/organizations", { name: "Oficina Neblina" }, b),
    );
  const root = "/organizations/" + A.organization.id,
    base = root + "/work",
    other = "/organizations/" + B.organization.id + "/work";
  const member = data(
    await call("POST", root + "/members", { accountId: c.id }, a),
  ).membership;
  assert.deepEqual(
    data(await call("GET", base + "/projects", undefined, a)).projects,
    [],
  );
  assert.equal(
    data(await call("GET", base + "/stats", undefined, a)).completedPercent,
    null,
  );
  const key = randomUUID(),
    payload = {
      title: "Projeto inéditο com título longo",
      visibility: "PRIVATE",
      circleId: A.rootCircle.id,
    };
  const p = data(
    await call("POST", base + "/projects", payload, c, {
      "idempotency-key": key,
    }),
  ).project;
  assert.equal(
    (
      await call(
        "POST",
        base + "/projects/" + p.id + "/access",
        { memberId: member.id, role: "READER" },
        c,
        match(1),
      )
    ).statusCode,
    422,
    "cannot demote last manager",
  );
  assert.equal(
    data(
      await call("POST", base + "/projects", payload, c, {
        "idempotency-key": key,
      }),
    ).project.id,
    p.id,
  );
  assert.equal(
    (
      await call(
        "POST",
        base + "/projects",
        { ...payload, title: "Changed" },
        c,
        { "idempotency-key": key },
      )
    ).statusCode,
    409,
  );
  assert.equal(
    (await call("GET", base + "/projects/" + p.id, undefined, a)).statusCode,
    404,
    "Owner has no private-project override",
  );
  assert.equal(
    (await call("GET", other + "/projects/" + p.id, undefined, c)).statusCode,
    404,
  );
  const bad = data(
    await call("POST", other + "/projects", { title: "Other" }, b),
  ).project;
  const foreignTask = data(
    await call(
      "POST",
      other + "/tasks",
      { title: "Segredo Beta", projectId: bad.id },
      b,
    ),
  ).task;
  assert.equal(
    (await call("GET", base + "/tasks/" + foreignTask.id, undefined, c))
      .statusCode,
    404,
  );
  assert.equal(
    (
      await call(
        "PATCH",
        base + "/tasks/" + foreignTask.id,
        { title: "Forbidden" },
        c,
        match(1),
      )
    ).statusCode,
    404,
  );
  assert.equal(
    (
      await call(
        "POST",
        base + "/tasks",
        { title: "Cross-org", projectId: bad.id },
        c,
      )
    ).statusCode,
    404,
  );
  const s1 = data(
    await call(
      "POST",
      base + "/projects/" + p.id + "/sections",
      { name: "Fazendo" },
      c,
      match(1),
    ),
  ).section;
  const s2 = data(
    await call(
      "POST",
      base + "/projects/" + p.id + "/sections",
      { name: "Feito", semantic: "DONE", position: 1 },
      c,
      match(2),
    ),
  ).section;
  const s3 = data(
    await call(
      "POST",
      base + "/projects/" + p.id + "/sections",
      { name: "Outro fim", semantic: "DONE", position: 2 },
      c,
      match(3),
    ),
  ).section;
  const create = async (title: string, extra: any = {}) =>
    data(
      await call(
        "POST",
        base + "/tasks",
        { title, projectId: p.id, sectionId: s1.id, ...extra },
        c,
      ),
    ).task;
  const t = await create("Planejar", {
      startsAt: "2026-10-18T10:00:00.000Z",
      endsAt: "2026-10-18T11:00:00.000Z",
      dateProvenance: "SYNTHETIC_TEST",
    }),
    u = await create("Construir", {
      startsAt: "2026-10-18T10:00:00.000Z",
      endsAt: "2026-10-18T12:00:00.000Z",
      dateProvenance: "SYNTHETIC_TEST",
    });
  assert.equal(
    (
      await call(
        "PATCH",
        base + "/tasks/" + t.id,
        { status: "DONE" },
        c,
        match(1),
      )
    ).statusCode,
    422,
  );
  assert.equal(
    data(await call("GET", base + "/tasks/" + t.id, undefined, c)).task.version,
    1,
    "invalid command rolled back",
  );
  let moved = data(
    await call(
      "PATCH",
      base + "/tasks/" + t.id,
      { sectionId: s2.id },
      c,
      match(1),
    ),
  ).task;
  assert.equal(moved.status, "DONE");
  moved = data(
    await call(
      "PATCH",
      base + "/tasks/" + t.id,
      { sectionId: s1.id },
      c,
      match(2),
    ),
  ).task;
  assert.equal(moved.status, "TODO");
  const races = await Promise.all([
    call("PATCH", base + "/tasks/" + t.id, { title: "Um" }, c, match(3)),
    call("PATCH", base + "/tasks/" + t.id, { title: "Dois" }, c, match(3)),
  ]);
  assert.deepEqual(races.map((r) => r.statusCode).sort(), [200, 409]);
  let successor = data(
    await call(
      "POST",
      base + "/tasks/" + u.id + "/dependencies",
      { predecessorId: t.id, type: "FS", lagMinutes: 30 },
      c,
      match(1),
    ),
  ).task;
  assert.equal(
    (
      await call(
        "POST",
        base + "/tasks/" + t.id + "/dependencies",
        { predecessorId: u.id, type: "SS" },
        c,
        match(4),
      )
    ).statusCode,
    422,
  );
  const x = await create("DAG concorrente A"),
    y = await create("DAG concorrente B");
  const opposite = await Promise.all([
    call(
      "POST",
      base + "/tasks/" + x.id + "/dependencies",
      { predecessorId: y.id, type: "SF", lagMinutes: -5 },
      c,
      match(1),
    ),
    call(
      "POST",
      base + "/tasks/" + y.id + "/dependencies",
      { predecessorId: x.id, type: "FF", lagMinutes: 2 },
      c,
      match(1),
    ),
  ]);
  assert.deepEqual(
    opposite.map((r) => r.statusCode).sort(),
    [201, 422],
    "organization lock prevents concurrent opposite-edge cycle",
  );
  const planned = data(
    await call("GET", base + "/projects/" + p.id + "/schedule", undefined, c),
  );
  assert.equal(
    planned.changes.find((x: any) => x.id === u.id).startsAt,
    "2026-10-18T11:30:00.000Z",
  );
  assert.equal(
    data(await call("GET", base + "/tasks/" + u.id, undefined, c)).task
      .startsAt,
    "2026-10-18T10:00:00.000Z",
    "preview has no side effects",
  );
  data(
    await call(
      "POST",
      base + "/projects/" + p.id + "/schedule/apply",
      { planHash: planned.planHash },
      c,
      match(4),
    ),
  );
  assert.equal(
    (
      await call(
        "POST",
        base + "/projects/" + p.id + "/schedule/apply",
        { planHash: planned.planHash },
        c,
        match(5),
      )
    ).statusCode,
    409,
  );
  assert.equal(
    data(await call("GET", base + "/tasks/" + u.id, undefined, c)).task
      .startsAt,
    "2026-10-18T11:30:00.000Z",
  );
  let current = data(
    await call("GET", base + "/tasks/" + u.id, undefined, c),
  ).task;
  current = data(
    await call(
      "POST",
      base + "/tasks/" + u.id + "/checklist",
      { title: "Validar" },
      c,
      match(current.version),
    ),
  ).task;
  let detail = data(await call("GET", base + "/tasks/" + u.id, undefined, c));
  current = data(
    await call(
      "POST",
      base + "/tasks/" + u.id + "/checklist",
      { itemId: detail.checklist[0].id, done: true },
      c,
      match(current.version),
    ),
  ).task;
  current = data(
    await call(
      "POST",
      base + "/tasks/" + u.id + "/comments",
      { content: "Confirmação persistida" },
      c,
      match(current.version),
    ),
  ).task;
  const child = await create("Subtarefa", { parentId: u.id });
  assert.equal(child.parentId, u.id);
  const copy = data(
    await call(
      "POST",
      base + "/tasks/" + u.id + "/duplicate",
      { title: "Cópia deliberada" },
      c,
      match(current.version),
    ),
  ).task;
  assert.equal(
    data(await call("GET", base + "/tasks/" + copy.id, undefined, c))
      .checklist[0].done,
    false,
  );
  current = data(
    await call(
      "POST",
      base + "/tasks/" + u.id + "/mark-duplicate",
      { primaryId: copy.id },
      c,
      match(current.version),
    ),
  ).task;
  assert.equal(
    (
      await call(
        "POST",
        base + "/tasks/" + copy.id + "/mark-duplicate",
        { primaryId: u.id },
        c,
        match(1),
      )
    ).statusCode,
    422,
  );
  current = data(
    await call(
      "POST",
      base + "/tasks/" + u.id + "/links",
      { targetTaskId: t.id },
      c,
      match(current.version),
    ),
  ).task;
  const adapters = createWorkResourceAdapters();
  const application = createWorkApplicationPorts(createRuntime());
  await asContext(a, A.organization.id, async (ctx) => {
    assert.deepEqual(
      await application.listMeetingItems(ctx, { circleIds: [A.rootCircle.id] }),
      [],
    );
  });
  await asContext(c, A.organization.id, async (ctx) => {
    const items = await application.listMeetingItems(ctx, {
      circleIds: [A.rootCircle.id],
    });
    assert.ok(items.some((i) => i.id === p.id && i.kind === "PROJECT"));
    assert.ok(items.some((i) => i.id === u.id && i.kind === "TASK"));
    await assert.rejects(() =>
      application.createTaskFromTension(ctx, {
        title: "Cross organization",
        circleId: B.rootCircle.id,
        tensionId: randomUUID(),
      }),
    );
  });
  await assert.rejects(() =>
    asContext(c, A.organization.id, async (ctx) => {
      await application.createTaskFromTension(ctx, {
        title: "Port rollback marker",
        circleId: A.rootCircle.id,
        tensionId: randomUUID(),
      });
      throw Error("source link failed; whole UoW must roll back");
    }),
  );
  await asContext(c, A.organization.id, async (ctx) => {
    assert.equal(
      (await adapters.task.search!(ctx, "Port rollback marker", 100)).length,
      0,
    );
    const created = await application.createTaskFromTension(ctx, {
      title: "Tensão convertida explicitamente",
      circleId: A.rootCircle.id,
      tensionId: randomUUID(),
    });
    assert.ok(
      (
        await application.listMeetingItems(ctx, {
          circleIds: [A.rootCircle.id],
        })
      ).some((i) => i.id === created.id),
    );
  });
  await asContext(a, A.organization.id, async (ctx) => {
    assert.deepEqual(await adapters.task.search!(ctx, "", 100), []);
    assert.equal(await adapters.project.authorize(ctx, p.id, "read"), false);
    assert.equal(await adapters.task.authorize(ctx, u.id, "export"), false);
  });
  await asContext(c, A.organization.id, async (ctx) => {
    assert.ok(
      (await adapters.task.search!(ctx, "Construir", 100)).some(
        (i: any) => i.id === u.id,
      ),
    );
    const exported = await adapters.task.export!(ctx, [u.id], "TASKS");
    assert.equal(exported.estimated, false);
    assert.equal((exported.records[0] as any).schemaVersion, 1);
    await assert.rejects(() => adapters.task.export!(ctx, [u.id], "stats"));
    await assert.rejects(() =>
      adapters.task.validateImport!(
        ctx,
        [{ ...(exported.records[0] as any), projectId: bad.id }],
        "TASKS",
      ),
    );
    const validated = await adapters.task.validateImport!(
      ctx,
      exported.records,
      "TASKS",
    );
    const imported = await adapters.task.applyImport!(
      ctx,
      validated.plan,
      "TASKS",
    );
    assert.ok(imported.idMap[u.id]);
  });
  const inspector = new pg.Pool({ connectionString: migrationUrl.href });
  try {
    await inspector.query(
      "CREATE FUNCTION work_rollback_probe() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic rollback probe'; END $$; CREATE TRIGGER work_rollback_probe BEFORE INSERT ON outbox FOR EACH ROW EXECUTE FUNCTION work_rollback_probe()",
    );
    const before = data(
      await call("GET", base + "/tasks/" + u.id, undefined, c),
    );
    assert.equal(
      (
        await call(
          "POST",
          base + "/tasks/" + u.id + "/comments",
          { content: "Must roll back" },
          c,
          match(current.version),
        )
      ).statusCode,
      500,
    );
    const after = data(
      await call("GET", base + "/tasks/" + u.id, undefined, c),
    );
    assert.equal(after.task.version, before.task.version);
    assert.equal(after.comments.length, before.comments.length);
  } finally {
    await inspector.query(
      "DROP TRIGGER IF EXISTS work_rollback_probe ON outbox; DROP FUNCTION IF EXISTS work_rollback_probe()",
    );
    await inspector.end();
  }
  const owner = data(
    await call("GET", root + "/members", undefined, a),
  ).items.find((x: any) => x.accountId === a.id);
  assert.ok(owner);
  data(
    await call(
      "POST",
      base + "/projects/" + p.id + "/access",
      { memberId: owner.id, role: "READER" },
      c,
      match(5),
    ),
  );
  assert.equal(
    (await call("GET", base + "/tasks/" + u.id, undefined, a)).statusCode,
    200,
  );
  assert.equal(
    (
      await call(
        "PATCH",
        base + "/tasks/" + u.id,
        { title: "Denied" },
        a,
        match(current.version),
      )
    ).statusCode,
    403,
  );
  data(
    await call(
      "POST",
      base + "/projects/" + p.id + "/access",
      { memberId: owner.id, role: null },
      c,
      match(6),
    ),
  );
  assert.equal(
    (await call("GET", base + "/tasks/" + u.id, undefined, a)).statusCode,
    404,
  );
  assert.equal(data(await call("GET", base + "/stats", undefined, a)).total, 0);
  data(
    await call(
      "POST",
      base + "/projects/" + p.id + "/access",
      { memberId: owner.id, role: "EDITOR" },
      c,
      match(7),
    ),
  );
  const revokedKey = randomUUID(),
    revokedPayload = {
      title: "Editor autorizado antes da revogação",
      projectId: p.id,
    };
  data(
    await call("POST", base + "/tasks", revokedPayload, a, {
      "idempotency-key": revokedKey,
    }),
  );
  data(
    await call(
      "POST",
      base + "/projects/" + p.id + "/access",
      { memberId: owner.id, role: null },
      c,
      match(8),
    ),
  );
  assert.equal(
    (
      await call("POST", base + "/tasks", revokedPayload, a, {
        "idempotency-key": revokedKey,
      })
    ).statusCode,
    404,
    "revocation checked before idempotent replay",
  );
  data(
    await call(
      "PATCH",
      base + "/projects/" + p.id,
      { frozen: true },
      c,
      match(9),
    ),
  );
  assert.equal(
    (
      await call(
        "POST",
        base + "/tasks/" + u.id + "/comments",
        { content: "Frozen write" },
        c,
        match(current.version),
      )
    ).statusCode,
    409,
  );
  data(
    await call(
      "PATCH",
      base + "/projects/" + p.id,
      { frozen: false },
      c,
      match(10),
    ),
  );
  assert.equal(
    (
      await call(
        "POST",
        base + "/tasks/" + u.id + "/dependencies",
        { predecessorId: foreignTask.id, type: "FS" },
        c,
        match(current.version),
      )
    ).statusCode,
    404,
  );
  assert.equal(
    (
      await call(
        "POST",
        base + "/tasks/" + u.id + "/links",
        { targetTaskId: foreignTask.id },
        c,
        match(current.version),
      )
    ).statusCode,
    404,
  );
  assert.equal(
    (
      await call(
        "POST",
        base + "/tasks/" + u.id + "/mark-duplicate",
        { primaryId: foreignTask.id },
        c,
        match(current.version),
      )
    ).statusCode,
    404,
  );
  const personal = data(
    await call("POST", base + "/tasks", { title: "Pessoal privativa" }, a),
  ).task;
  assert.equal(
    (await call("GET", base + "/tasks/" + personal.id, undefined, c))
      .statusCode,
    404,
  );
  data(
    await call(
      "PATCH",
      base + "/projects/" + p.id + "/sections/" + s3.id,
      { name: "Feito explicitamente", semantic: "NONE", position: 3 },
      c,
      match(11),
    ),
  );
  data(
    await call(
      "DELETE",
      base + "/projects/" + p.id + "/sections/" + s3.id,
      undefined,
      c,
      match(12),
    ),
  );
  assert.equal(
    (
      await call(
        "DELETE",
        base + "/projects/" + p.id + "/sections/" + s1.id,
        undefined,
        c,
        match(13),
      )
    ).statusCode,
    422,
  );
  assert.equal(
    (
      await call(
        "POST",
        base + "/tasks/" + u.id + "/assignments",
        { memberIds: [B.ownerMember?.id ?? randomUUID()] },
        c,
        match(current.version),
      )
    ).statusCode,
    404,
  );
  current = data(
    await call(
      "POST",
      base + "/tasks/" + u.id + "/assignments",
      { memberIds: [member.id] },
      c,
      match(current.version),
    ),
  ).task;
  data(
    await call(
      "PATCH",
      root + "/members/" + member.id,
      { status: "SUSPENDED" },
      a,
      match(member.version),
    ),
  );
  assert.equal(
    (await call("GET", base + "/tasks/" + u.id, undefined, c)).statusCode,
    404,
  );
  assert.equal(
    (await pool.query("SELECT * FROM work_tasks")).rowCount,
    0,
    "RLS denies unscoped runtime reads",
  );
});
test("subtask groups persist ordering, reject foreign parents/tenants, preserve copies, and never complete the parent", async () => {
  const a = await user(),
    b = await user();
  const A = data(
      await call(
        "POST",
        "/organizations",
        { name: "Grupos sintéticos Aurora" },
        a,
      ),
    ),
    B = data(
      await call(
        "POST",
        "/organizations",
        { name: "Grupos sintéticos Boreal" },
        b,
      ),
    );
  const base = "/organizations/" + A.organization.id + "/work",
    other = "/organizations/" + B.organization.id + "/work";
  const p = data(
      await call("POST", base + "/tasks", { title: "Entrega em grupos" }, a),
    ).task,
    sibling = data(
      await call("POST", base + "/tasks", { title: "Outro pai" }, a),
    ).task;
  const g1 = data(
    await call(
      "POST",
      base + "/tasks/" + p.id + "/groups",
      { name: "Pesquisa", position: 1 },
      a,
      match(1),
    ),
  ).group;
  const g2 = data(
    await call(
      "POST",
      base + "/tasks/" + p.id + "/groups",
      { name: "Execução", position: 0 },
      a,
      match(2),
    ),
  ).group;
  data(
    await call(
      "PATCH",
      base + "/tasks/" + p.id + "/groups/" + g1.id,
      { name: "Pesquisa validada", position: 2 },
      a,
      match(3),
    ),
  );
  assert.equal(
    (
      await call(
        "PATCH",
        base + "/tasks/" + p.id + "/groups/" + g1.id,
        { name: "Stale" },
        a,
        match(3),
      )
    ).statusCode,
    409,
  );
  assert.deepEqual(
    data(await call("GET", base + "/tasks/" + p.id, undefined, a)).groups.map(
      (g: any) => g.id,
    ),
    [g2.id, g1.id],
  );
  assert.equal(
    (
      await call(
        "POST",
        base + "/tasks",
        { title: "Pai errado", parentId: sibling.id, groupId: g1.id },
        a,
      )
    ).statusCode,
    404,
  );
  assert.equal(
    (
      await call(
        "POST",
        base + "/tasks",
        { title: "Sem pai", groupId: g1.id },
        a,
      )
    ).statusCode,
    422,
  );
  let child = data(
    await call(
      "POST",
      base + "/tasks",
      { title: "Subtarefa agrupada", parentId: p.id, groupId: g1.id },
      a,
    ),
  ).task;
  assert.equal(child.subtaskGroupId, g1.id);
  assert.equal(
    (
      await call(
        "DELETE",
        base + "/tasks/" + p.id + "/groups/" + g1.id,
        undefined,
        a,
        match(4),
      )
    ).statusCode,
    422,
  );
  child = data(
    await call(
      "PATCH",
      base + "/tasks/" + child.id,
      { groupId: g2.id },
      a,
      match(1),
    ),
  ).task;
  const copied = data(
    await call(
      "POST",
      base + "/tasks/" + child.id + "/duplicate",
      { title: "Cópia no mesmo grupo" },
      a,
      match(child.version),
    ),
  ).task;
  assert.equal(copied.subtaskGroupId, g2.id);
  child = data(
    await call(
      "PATCH",
      base + "/tasks/" + child.id,
      { status: "DONE" },
      a,
      match(child.version),
    ),
  ).task;
  assert.equal(
    data(await call("GET", base + "/tasks/" + p.id, undefined, a)).task.status,
    "TODO",
  );
  child = data(
    await call(
      "PATCH",
      base + "/tasks/" + child.id,
      { groupId: null },
      a,
      match(child.version),
    ),
  ).task;
  data(
    await call(
      "DELETE",
      base + "/tasks/" + p.id + "/groups/" + g1.id,
      undefined,
      a,
      match(4),
    ),
  );
  assert.equal(
    (
      await call(
        "DELETE",
        base + "/tasks/" + p.id + "/groups/" + g2.id,
        undefined,
        a,
        match(5),
      )
    ).statusCode,
    422,
    "duplicate preserves the group relation",
  );
  data(
    await call(
      "PATCH",
      base + "/tasks/" + copied.id,
      { groupId: null },
      a,
      match(copied.version),
    ),
  );
  data(
    await call(
      "DELETE",
      base + "/tasks/" + p.id + "/groups/" + g2.id,
      undefined,
      a,
      match(5),
    ),
  );
  assert.deepEqual(
    data(await call("GET", base + "/tasks/" + p.id, undefined, a)).groups,
    [],
  );
  const bp = data(
      await call("POST", other + "/tasks", { title: "Pai organização B" }, b),
    ).task,
    bg = data(
      await call(
        "POST",
        other + "/tasks/" + bp.id + "/groups",
        { name: "Segredo B" },
        b,
        match(1),
      ),
    ).group;
  assert.equal(
    (
      await call(
        "POST",
        base + "/tasks",
        { title: "ID conhecido B", parentId: p.id, groupId: bg.id },
        a,
      )
    ).statusCode,
    404,
  );
  assert.equal(
    (
      await call(
        "PATCH",
        base + "/tasks/" + p.id + "/groups/" + bg.id,
        { name: "IDOR" },
        a,
        match(6),
      )
    ).statusCode,
    404,
  );
  assert.equal(
    (await pool.query("SELECT * FROM work_subtask_groups")).rowCount,
    0,
  );
});
test("member layout persistence is scoped per project/organization/person, versioned, and revoked with private access", async () => {
  const a = await user(),
    b = await user();
  const A = data(
      await call("POST", "/organizations", { name: "Layouts Aurora" }, a),
    ),
    B = data(
      await call("POST", "/organizations", { name: "Layouts Boreal" }, b),
    );
  const base = "/organizations/" + A.organization.id + "/work",
    other = "/organizations/" + B.organization.id + "/work";
  const bm = data(
    await call(
      "POST",
      "/organizations/" + A.organization.id + "/members",
      { accountId: b.id },
      a,
    ),
  ).membership;
  const p = data(
    await call(
      "POST",
      base + "/projects",
      { title: "Layout privado", visibility: "PRIVATE" },
      a,
    ),
  ).project;
  const initial = data(
    await call("GET", base + "/layout?projectId=" + p.id, undefined, a),
  ).layout;
  assert.equal(initial.version, 0);
  const settings = {
    projectId: p.id,
    view: "BOARD",
    sort: "DUE",
    grouping: "STATUS",
  };
  let layout = data(
    await call("POST", base + "/layout", settings, a, match(0)),
  ).layout;
  assert.equal(layout.version, 1);
  assert.deepEqual(
    data(await call("GET", base + "/layout?projectId=" + p.id, undefined, a))
      .layout,
    layout,
  );
  assert.equal(
    (await call("POST", base + "/layout", settings, a, match(0))).statusCode,
    409,
  );
  assert.equal(
    data(await call("GET", base + "/layout", undefined, a)).layout.view,
    "LIST",
  );
  assert.equal(
    (await call("GET", base + "/layout?projectId=" + p.id, undefined, b))
      .statusCode,
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
  assert.equal(
    data(await call("GET", base + "/layout?projectId=" + p.id, undefined, b))
      .layout.version,
    0,
    "other member does not inherit saved personal layout",
  );
  const key = randomUUID();
  data(
    await call("POST", base + "/layout", { ...settings, view: "CALENDAR" }, b, {
      ...match(0),
      "idempotency-key": key,
    }),
  );
  assert.equal(
    data(await call("GET", other + "/layout", undefined, b)).layout.version,
    0,
  );
  data(
    await call(
      "PATCH",
      base + "/projects/" + p.id,
      { frozen: true },
      a,
      match(2),
    ),
  );
  data(
    await call(
      "POST",
      base + "/layout",
      { ...settings, sort: "TITLE" },
      a,
      match(1),
    ),
  ); // Own view config is permitted while domain data are frozen.
  assert.equal(
    (
      await call(
        "POST",
        base + "/tasks",
        { title: "Frozen domain", projectId: p.id },
        a,
      )
    ).statusCode,
    409,
  );
  data(
    await call(
      "POST",
      base + "/projects/" + p.id + "/access",
      { memberId: bm.id, role: null },
      a,
      match(3),
    ),
  );
  assert.equal(
    (await call("GET", base + "/layout?projectId=" + p.id, undefined, b))
      .statusCode,
    404,
  );
  assert.equal(
    (
      await call(
        "POST",
        base + "/layout",
        { ...settings, view: "CALENDAR" },
        b,
        { ...match(0), "idempotency-key": key },
      )
    ).statusCode,
    404,
    "revocation precedes layout replay",
  );
  data(
    await call(
      "PATCH",
      base + "/projects/" + p.id,
      { frozen: false, views: ["LIST"] },
      a,
      match(4),
    ),
  );
  const normalized = data(
    await call("GET", base + "/layout?projectId=" + p.id, undefined, a),
  ).layout;
  assert.equal(normalized.view, "LIST");
  assert.equal(normalized.version, 2);
  assert.equal(
    (await call("POST", base + "/layout", settings, a, match(2))).statusCode,
    422,
  );
  assert.equal((await pool.query("SELECT * FROM work_layouts")).rowCount, 0);
});
test("global defaults, discovery, circle limits, configuration lock and assignment policy are tenant-scoped and enforced before replay", async () => {
  const a = await user(),
    b = await user();
  const A = data(
      await call(
        "POST",
        "/organizations",
        { name: "Políticas globais Aurora" },
        a,
      ),
    ),
    B = data(
      await call(
        "POST",
        "/organizations",
        { name: "Políticas globais Boreal" },
        b,
      ),
    );
  const root = "/organizations/" + A.organization.id,
    base = root + "/work",
    other = "/organizations/" + B.organization.id + "/work";
  const bm = data(
    await call("POST", root + "/members", { accountId: b.id }, a),
  ).membership;
  assert.equal(
    data(await call("GET", base + "/settings", undefined, a)).settings.version,
    0,
  );
  assert.equal(
    (
      await call(
        "POST",
        base + "/settings",
        { defaultPrivacy: "PRIVATE" },
        b,
        match(0),
      )
    ).statusCode,
    403,
  );
  let settings = data(
    await call(
      "POST",
      base + "/settings",
      {
        defaultPrivacy: "PRIVATE",
        defaultAssignmentMode: "SINGLE",
        defaultAssignmentPermission: "MANAGERS",
        showAllUnassigned: false,
        allowMultipleProjectsPerCircle: false,
      },
      a,
      match(0),
    ),
  ).settings;
  assert.equal(settings.version, 1);
  const privateKey = randomUUID(),
    privateBody = {
      title: "Privado por configuração",
      circleId: A.rootCircle.id,
    };
  const p0 = data(
    await call("POST", base + "/projects", privateBody, a, {
      "idempotency-key": privateKey,
    }),
  ).project;
  assert.equal(p0.visibility, "PRIVATE");
  assert.equal(p0.assignmentMode, "SINGLE");
  const p1 = data(
    await call(
      "POST",
      base + "/projects",
      {
        title: "Privacidade inicial alterada explicitamente",
        visibility: "PUBLIC",
      },
      a,
    ),
  ).project;
  assert.equal(p1.visibility, "PUBLIC");
  assert.deepEqual(
    data(await call("GET", base + "/projects", undefined, b)).projects,
    [],
  );
  settings = data(
    await call(
      "POST",
      base + "/settings",
      { showAllUnassigned: true },
      a,
      match(1),
    ),
  ).settings;
  assert.deepEqual(
    data(await call("GET", base + "/projects", undefined, b)).projects.map(
      (p: any) => p.id,
    ),
    [p1.id],
  );
  assert.equal(
    (await call("GET", base + "/projects/" + p0.id, undefined, b)).statusCode,
    404,
  );
  settings = data(
    await call(
      "POST",
      base + "/settings",
      { showAllUnassigned: false },
      a,
      match(2),
    ),
  ).settings;
  assert.equal(
    data(await call("GET", base + "/settings", undefined, a)).settings
      .defaultPrivacy,
    "PRIVATE",
  );
  assert.equal(
    data(await call("GET", other + "/settings", undefined, b)).settings
      .defaultPrivacy,
    "PUBLIC",
  );
  assert.equal(
    (await call("GET", other + "/settings", undefined, a)).statusCode,
    404,
  );
  assert.equal(
    (
      await call(
        "POST",
        base + "/projects",
        { title: "Segundo no círculo", circleId: A.rootCircle.id },
        a,
      )
    ).statusCode,
    409,
  );
  data(
    await call(
      "POST",
      base + "/projects/" + p1.id + "/access",
      { memberId: bm.id, role: "EDITOR" },
      a,
      match(1),
    ),
  );
  const t = data(
    await call(
      "POST",
      base + "/tasks",
      { title: "Criar não atribui", projectId: p1.id },
      b,
    ),
  ).task;
  assert.deepEqual(
    data(await call("GET", base + "/tasks/" + t.id, undefined, b)).assignments,
    [],
  );
  assert.equal(
    data(await call("GET", base + "/tasks/" + t.id, undefined, b)).capabilities
      .assign,
    false,
  );
  assert.equal(
    (
      await call(
        "POST",
        base + "/tasks/" + t.id + "/assignments",
        { memberIds: [bm.id] },
        b,
        match(1),
      )
    ).statusCode,
    403,
  );
  assert.equal(
    (
      await call(
        "POST",
        base + "/tasks/" + t.id + "/assignments",
        { memberIds: [A.membership.id, bm.id] },
        a,
        match(1),
      )
    ).statusCode,
    422,
  );
  let assigned = data(
    await call(
      "POST",
      base + "/tasks/" + t.id + "/assignments",
      { memberIds: [bm.id] },
      a,
      match(1),
    ),
  ).task;
  data(
    await call(
      "PATCH",
      base + "/projects/" + p1.id,
      { assignmentPermission: "EDITORS" },
      a,
      match(2),
    ),
  );
  const assignKey = randomUUID(),
    assignBody = { memberIds: [bm.id] };
  assigned = data(
    await call(
      "POST",
      base + "/tasks/" + t.id + "/assignments",
      assignBody,
      b,
      { ...match(assigned.version), "idempotency-key": assignKey },
    ),
  ).task;
  data(
    await call(
      "PATCH",
      base + "/projects/" + p1.id,
      { assignmentPermission: "MANAGERS" },
      a,
      match(3),
    ),
  );
  assert.equal(
    (
      await call(
        "POST",
        base + "/tasks/" + t.id + "/assignments",
        assignBody,
        b,
        { ...match(2), "idempotency-key": assignKey },
      )
    ).statusCode,
    403,
  );
  settings = data(
    await call(
      "POST",
      base + "/settings",
      { lockProjectConfiguration: true },
      a,
      match(3),
    ),
  ).settings;
  assert.equal(
    data(await call("GET", base + "/projects/" + p1.id, undefined, a))
      .capabilities.manage,
    false,
  );
  assert.equal(
    (
      await call(
        "PATCH",
        base + "/projects/" + p1.id,
        { title: "Owner também bloqueado" },
        a,
        match(4),
      )
    ).statusCode,
    403,
  );
  assert.equal(
    (
      await call(
        "POST",
        base + "/projects/" + p1.id + "/sections",
        { name: "Seção bloqueada" },
        a,
        match(4),
      )
    ).statusCode,
    403,
  );
  assert.equal(
    (
      await call(
        "POST",
        base + "/layout",
        { projectId: p1.id, view: "BOARD", sort: "TITLE", grouping: "STATUS" },
        a,
        match(0),
      )
    ).statusCode,
    403,
  );
  assert.equal(
    (
      await call(
        "POST",
        base + "/layout",
        { projectId: p1.id, view: "BOARD", sort: "TITLE", grouping: "STATUS" },
        b,
        match(0),
      )
    ).statusCode,
    403,
  );
  assigned = data(
    await call(
      "PATCH",
      base + "/tasks/" + t.id,
      { title: "Tarefa editável, configuração bloqueada" },
      b,
      match(assigned.version),
    ),
  ).task;
  assert.equal(
    data(await call("GET", base + "/projects/" + p1.id, undefined, a)).project
      .title,
    p1.title,
  );
  settings = data(
    await call(
      "POST",
      base + "/settings",
      { lockProjectConfiguration: false },
      a,
      match(4),
    ),
  ).settings;
  data(
    await call(
      "PATCH",
      base + "/projects/" + p1.id,
      { frozen: true },
      a,
      match(4),
    ),
  );
  assert.equal(
    (
      await call(
        "PATCH",
        base + "/tasks/" + t.id,
        { title: "Task freeze inclui Owner" },
        a,
        match(assigned.version),
      )
    ).statusCode,
    409,
  );
  data(
    await call(
      "POST",
      base + "/layout",
      { projectId: p1.id, view: "BOARD", sort: "TITLE", grouping: "STATUS" },
      a,
      match(0),
    ),
  );
  settings = data(
    await call(
      "POST",
      base + "/settings",
      { allowMultipleProjectsPerCircle: true },
      a,
      match(5),
    ),
  ).settings;
  const extra = data(
    await call(
      "POST",
      base + "/projects",
      { title: "Múltiplo permitido", circleId: A.rootCircle.id },
      a,
    ),
  ).project;
  assert.equal(
    (
      await call(
        "POST",
        base + "/settings",
        { allowMultipleProjectsPerCircle: false },
        a,
        match(6),
      )
    ).statusCode,
    422,
  );
  data(
    await call(
      "PATCH",
      base + "/projects/" + extra.id,
      { archived: true },
      a,
      match(1),
    ),
  );
  data(
    await call(
      "POST",
      base + "/settings",
      { allowMultipleProjectsPerCircle: false },
      a,
      match(6),
    ),
  );
  data(
    await call(
      "POST",
      base + "/projects/" + p0.id + "/access",
      { memberId: bm.id, role: "MANAGER" },
      a,
      match(1),
    ),
  );
  data(
    await call(
      "POST",
      base + "/projects/" + p0.id + "/access",
      { memberId: A.membership.id, role: null },
      b,
      match(2),
    ),
  );
  assert.equal(
    (
      await call("POST", base + "/projects", privateBody, a, {
        "idempotency-key": privateKey,
      })
    ).statusCode,
    404,
    "creation replay cannot disclose private project after grant removal",
  );
  await asContext(a, A.organization.id, async (ctx) => {
    await ctx.c.query(
      "DELETE FROM work_created_projects WHERE organization_id=$1 AND account_id=$2 AND command_key=$3",
      [ctx.org.id, a.id, privateKey],
    );
  });
  assert.equal(
    (
      await call("POST", base + "/projects", privateBody, a, {
        "idempotency-key": privateKey,
      })
    ).statusCode,
    404,
    "legacy command results without creation index are also reauthorized",
  );
  const application = createWorkApplicationPorts(createRuntime());
  const circle = async (name: string) => {
    const response = await call(
      "POST",
      root + "/circles",
      { name, parentCircleId: A.rootCircle.id, mode: "DIRECT" },
      a,
    );
    return {
      circle: data(response).circle,
      // Synthetic source event clock captured in PostgreSQL, like Structure's canonical port.
      // Response meta.asOf is a JS host clock and cannot order against a DB microsecond clock.
      occurredAt: await asContext(
        a,
        A.organization.id,
        async (ctx) =>
          (
            await ctx.c.query(
              "SELECT to_char(clock_timestamp() AT TIME ZONE 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS.US\"Z\"') AS occurred_at",
            )
          ).rows[0].occurred_at,
      ),
    };
  };
  const oldCircle = await circle("Antes da ativação de projetos");
  await asContext(a, A.organization.id, async (ctx) => {
    assert.equal(
      (
        await application.onCircleCreated(ctx, {
          circleId: oldCircle.circle.id,
          occurredAt: oldCircle.occurredAt,
        })
      ).created,
      false,
    );
  });
  const enabled = data(
    await call(
      "POST",
      base + "/settings",
      { autoCreateForNewCircles: true },
      a,
      match(7),
    ),
  ).settings;
  assert.ok(enabled.autoCreateEnabledAt);
  await asContext(a, A.organization.id, async (ctx) => {
    assert.equal(
      (
        await application.onCircleCreated(ctx, {
          circleId: oldCircle.circle.id,
          occurredAt: oldCircle.occurredAt,
        })
      ).reason,
      "NOT_ENABLED_AT_CREATION",
    );
    await assert.rejects(() =>
      application.onCircleCreated(ctx, {
        circleId: B.rootCircle.id,
        occurredAt: new Date().toISOString(),
      }),
    );
  });
  const fresh = await circle("Círculo inédito com projeto automático"),
    eventId = randomUUID();
  const generated = await Promise.all([
    asContext(a, A.organization.id, (ctx) =>
      application.onCircleCreated(ctx, {
        circleId: fresh.circle.id,
        occurredAt: fresh.occurredAt,
        eventId,
      }),
    ),
    asContext(a, A.organization.id, (ctx) =>
      application.onCircleCreated(ctx, {
        circleId: fresh.circle.id,
        occurredAt: fresh.occurredAt,
        eventId,
      }),
    ),
  ]);
  assert.deepEqual(generated.map((x) => x.created).sort(), [false, true]);
  const generatedId = generated.find((x) => x.created).projectId;
  const autoProject = data(
    await call("GET", base + "/projects/" + generatedId, undefined, a),
  ).project;
  assert.equal(autoProject.visibility, "PRIVATE");
  assert.equal(autoProject.assignmentMode, "SINGLE");
  assert.equal(autoProject.circleId, fresh.circle.id);
  assert.equal(
    (await call("GET", base + "/projects/" + generatedId, undefined, b))
      .statusCode,
    404,
  );
  data(
    await call(
      "POST",
      base + "/settings",
      { autoCreateForNewCircles: false },
      a,
      match(8),
    ),
  );
  const disabledCircle = await circle("Criado enquanto desativado");
  data(
    await call(
      "POST",
      base + "/settings",
      { autoCreateForNewCircles: true },
      a,
      match(9),
    ),
  );
  await asContext(a, A.organization.id, async (ctx) => {
    assert.equal(
      (
        await application.onCircleCreated(ctx, {
          circleId: disabledCircle.circle.id,
          occurredAt: disabledCircle.occurredAt,
        })
      ).created,
      false,
    );
    assert.equal(
      (
        await application.onCircleCreated(ctx, {
          circleId: fresh.circle.id,
          occurredAt: fresh.occurredAt,
          eventId,
        })
      ).created,
      false,
    );
  });
  const rollbackCircle = await circle("Rollback do alvo de provisionamento");
  await assert.rejects(() =>
    asContext(a, A.organization.id, async (ctx) => {
      await application.onCircleCreated(ctx, {
        circleId: rollbackCircle.circle.id,
        occurredAt: rollbackCircle.occurredAt,
      });
      throw Error("caller UoW failed after Work creation");
    }),
  );
  await asContext(a, A.organization.id, async (ctx) => {
    assert.equal(
      (
        await ctx.c.query(
          "SELECT id FROM work_projects WHERE organization_id=$1 AND circle_id=$2",
          [ctx.org.id, rollbackCircle.circle.id],
        )
      ).rowCount,
      0,
    );
    assert.equal(
      (
        await ctx.c.query(
          "SELECT circle_id FROM work_circle_provisioning WHERE organization_id=$1 AND circle_id=$2",
          [ctx.org.id, rollbackCircle.circle.id],
        )
      ).rowCount,
      0,
    );
  });
  const microCircle = await circle("Precisão de microssegundos");
  await asContext(a, A.organization.id, async (ctx) => {
    const second = new Date(Date.now() - 2000).toISOString().slice(0, 19);
    await ctx.c.query(
      "UPDATE work_settings SET auto_create_enabled_at=$2::timestamptz WHERE organization_id=$1",
      [ctx.org.id, second + ".123500Z"],
    );
    assert.equal(
      (
        await application.onCircleCreated(ctx, {
          circleId: microCircle.circle.id,
          occurredAt: second + ".123400Z",
        })
      ).created,
      false,
      "earlier event within the same JavaScript millisecond stays ineligible",
    );
    assert.equal(
      (
        await application.onCircleCreated(ctx, {
          circleId: microCircle.circle.id,
          occurredAt: second + ".123600Z",
        })
      ).created,
      true,
    );
    const stored = (
      await ctx.c.query(
        "SELECT to_char(source_occurred_at AT TIME ZONE 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS.US\"Z\"') AS occurred_at FROM work_circle_provisioning WHERE organization_id=$1 AND circle_id=$2",
        [ctx.org.id, microCircle.circle.id],
      )
    ).rows[0];
    assert.equal(stored.occurred_at, second + ".123600Z");
  });
  assert.equal((await pool.query("SELECT * FROM work_settings")).rowCount, 0);
});
test("HTTP creates return 201, transitions return 200, and replays preserve the original creation/update status without internal fields", async () => {
  const a = await user(),
    b = await user(),
    A = data(
      await call(
        "POST",
        "/organizations",
        { name: "Contrato HTTP Trabalho" },
        a,
      ),
    ),
    root = "/organizations/" + A.organization.id,
    base = root + "/work";
  const bm = data(
    await call("POST", root + "/members", { accountId: b.id }, a),
  ).membership;
  const created = (r: any) => {
    assert.equal(r.statusCode, 201, r.body);
    assert.equal(r.json().data.__workHttpStatus, undefined);
    return r.json().data;
  };
  const pk = randomUUID(),
    pb = { title: "Criação HTTP201", visibility: "PUBLIC" },
    p = created(
      await call("POST", base + "/projects", pb, a, { "idempotency-key": pk }),
    ).project;
  assert.equal(
    created(
      await call("POST", base + "/projects", pb, a, { "idempotency-key": pk }),
    ).project.id,
    p.id,
  );
  const sk = randomUUID(),
    sb = { name: "Seção HTTP201" };
  created(
    await call("POST", base + "/projects/" + p.id + "/sections", sb, a, {
      ...match(1),
      "idempotency-key": sk,
    }),
  );
  created(
    await call("POST", base + "/projects/" + p.id + "/sections", sb, a, {
      ...match(1),
      "idempotency-key": sk,
    }),
  );
  const tk = randomUUID(),
    tb = { title: "Tarefa HTTP201", projectId: p.id },
    t = created(
      await call("POST", base + "/tasks", tb, a, { "idempotency-key": tk }),
    ).task;
  created(
    await call("POST", base + "/tasks", tb, a, { "idempotency-key": tk }),
  );
  const gk = randomUUID(),
    gb = { name: "Grupo HTTP201" };
  created(
    await call("POST", base + "/tasks/" + t.id + "/groups", gb, a, {
      ...match(1),
      "idempotency-key": gk,
    }),
  );
  created(
    await call("POST", base + "/tasks/" + t.id + "/groups", gb, a, {
      ...match(1),
      "idempotency-key": gk,
    }),
  );
  created(
    await call(
      "POST",
      base + "/tasks/" + t.id + "/comments",
      { content: "Comentário HTTP201" },
      a,
      match(2),
    ),
  );
  created(
    await call(
      "POST",
      base + "/tasks/" + t.id + "/checklist",
      { title: "Item HTTP201" },
      a,
      match(3),
    ),
  );
  const checklist = data(
    await call("GET", base + "/tasks/" + t.id, undefined, a),
  ).checklist[0];
  assert.equal(
    (
      await call(
        "POST",
        base + "/tasks/" + t.id + "/checklist",
        { itemId: checklist.id, done: true },
        a,
        match(4),
      )
    ).statusCode,
    200,
  );
  const predecessor = created(
    await call(
      "POST",
      base + "/tasks",
      { title: "Predecessora HTTP201", projectId: p.id },
      a,
    ),
  ).task;
  const lk = randomUUID(),
    lb = { targetTaskId: predecessor.id };
  created(
    await call("POST", base + "/tasks/" + t.id + "/links", lb, a, {
      ...match(5),
      "idempotency-key": lk,
    }),
  );
  created(
    await call("POST", base + "/tasks/" + t.id + "/links", lb, a, {
      ...match(5),
      "idempotency-key": lk,
    }),
  );
  assert.equal(
    (await call("POST", base + "/tasks/" + t.id + "/links", lb, a, match(6)))
      .statusCode,
    200,
  );
  const dk = randomUUID(),
    db = { predecessorId: predecessor.id, type: "FS", lagMinutes: 0 };
  created(
    await call("POST", base + "/tasks/" + t.id + "/dependencies", db, a, {
      ...match(7),
      "idempotency-key": dk,
    }),
  );
  created(
    await call("POST", base + "/tasks/" + t.id + "/dependencies", db, a, {
      ...match(7),
      "idempotency-key": dk,
    }),
  );
  assert.equal(
    (
      await call(
        "POST",
        base + "/tasks/" + t.id + "/dependencies",
        { ...db, type: "SS" },
        a,
        match(8),
      )
    ).statusCode,
    200,
  );
  assert.equal(
    (
      await call(
        "DELETE",
        base + "/tasks/" + t.id + "/dependencies/" + predecessor.id,
        undefined,
        a,
        match(9),
      )
    ).statusCode,
    200,
  );
  const copyKey = randomUUID(),
    copyBody = { title: "Cópia HTTP201" };
  created(
    await call("POST", base + "/tasks/" + t.id + "/duplicate", copyBody, a, {
      ...match(10),
      "idempotency-key": copyKey,
    }),
  );
  created(
    await call("POST", base + "/tasks/" + t.id + "/duplicate", copyBody, a, {
      ...match(10),
      "idempotency-key": copyKey,
    }),
  );
  created(
    await call(
      "POST",
      base + "/projects/" + p.id + "/access",
      { memberId: bm.id, role: "READER" },
      a,
      match(2),
    ),
  );
  assert.equal(
    (
      await call(
        "POST",
        base + "/projects/" + p.id + "/access",
        { memberId: bm.id, role: "EDITOR" },
        a,
        match(3),
      )
    ).statusCode,
    200,
  );
  assert.equal(
    (
      await call(
        "POST",
        base + "/projects/" + p.id + "/access",
        { memberId: bm.id, role: null },
        a,
        match(4),
      )
    ).statusCode,
    200,
  );
  assert.equal(
    (
      await call(
        "POST",
        base + "/settings",
        { defaultPrivacy: "PRIVATE" },
        a,
        match(0),
      )
    ).statusCode,
    200,
  );
  assert.equal(
    (
      await call(
        "POST",
        base + "/layout",
        { projectId: p.id, view: "BOARD", sort: "TITLE", grouping: "STATUS" },
        a,
        match(0),
      )
    ).statusCode,
    200,
  );
});
test("four dependency types, negative lag, unknown dates, and cycles", () => {
  const a = {
      id: "a",
      version: 1,
      starts_at: "2026-10-18T10:00:00Z",
      ends_at: "2026-10-18T12:00:00Z",
    },
    b = {
      id: "b",
      version: 1,
      starts_at: "2026-10-18T00:00:00Z",
      ends_at: "2026-10-18T01:00:00Z",
    };
  for (const [type, time] of [
    ["FS", "12:30"],
    ["FF", "11:30"],
    ["SS", "10:30"],
    ["SF", "09:30"],
  ]) {
    const p = previewSchedule(
      [a, b],
      [{ predecessor_id: "a", successor_id: "b", type, lag_minutes: 30 }],
    );
    assert.ok(p.changes[1].startsAt?.includes(time));
  }
  assert.equal(
    previewSchedule(
      [a, { ...b, ends_at: null }],
      [
        {
          predecessor_id: "a",
          successor_id: "b",
          type: "FS",
          lag_minutes: -30,
        },
      ],
    ).unknown.length,
    1,
  );
  assert.throws(() =>
    ordered(
      ["a", "b"],
      [
        { predecessor_id: "a", successor_id: "b", type: "FS", lag_minutes: 0 },
        { predecessor_id: "b", successor_id: "a", type: "SS", lag_minutes: 0 },
      ],
    ),
  );
});

test("organization templates persist, apply atomically across creation entry points, preserve existing projects and never cross tenants", async () => {
  const a = await user(),
    b = await user(),
    A = data(await call("POST", "/organizations", { name: "Modelos A" }, a)),
    B = data(await call("POST", "/organizations", { name: "Modelos B" }, b)),
    root = "/organizations/" + A.organization.id,
    base = root + "/work";
  data(await call("POST", root + "/members", { accountId: b.id }, a));
  const p = data(
    await call("POST", base + "/projects", { title: "Antes do modelo" }, a),
  ).project;
  const initial = data(await call("GET", base + "/templates", undefined, a));
  assert.equal(initial.templates.length, 1);
  assert.equal(initial.templates[0].name, "Default");
  assert.equal(initial.templates[0].isDefault, true);
  const created = await call(
    "POST",
    base + "/templates",
    { galleryKey: "WORKFLOW" },
    a,
  );
  assert.equal(created.statusCode, 201);
  const model = data(created).template;
  const switched = data(
    await call(
      "PATCH",
      base + "/templates/" + model.id,
      { isDefault: true },
      a,
      match(1),
    ),
  ).template;
  const explicit = data(
    await call(
      "POST",
      base + "/projects",
      { title: "Modelo explícito", templateId: model.id },
      a,
    ),
  ).project;
  const derived = data(
    await call("GET", base + "/projects/" + explicit.id, undefined, a),
  );
  assert.deepEqual(
    derived.sections.map((x: any) => x.name),
    ["A fazer", "Em andamento", "Concluído"],
  );
  assert.equal(derived.project.defaultDoneSectionId, derived.sections[2].id);
  assert.deepEqual(derived.project.views, [
    "BOARD",
    "LIST",
    "TIMELINE",
    "CALENDAR",
  ]);
  assert.equal(
    data(await call("GET", base + "/projects/" + p.id, undefined, a)).sections
      .length,
    0,
    "changing the default never rewrites existing projects",
  );
  const implicit = data(
    await call("POST", base + "/projects", { title: "Modelo implícito" }, a),
  ).project;
  assert.equal(
    data(await call("GET", base + "/projects/" + implicit.id, undefined, a))
      .sections.length,
    3,
  );
  assert.equal(
    (await call("POST", base + "/templates", { galleryKey: "DEFAULT" }, b))
      .statusCode,
    403,
  );
  assert.equal(
    (
      await call(
        "POST",
        "/organizations/" + B.organization.id + "/work/projects",
        { title: "Modelo alheio", templateId: model.id },
        b,
      )
    ).statusCode,
    404,
  );
  assert.equal(
    (
      await call(
        "PATCH",
        base + "/templates/" + model.id,
        { definition: { views: [], sections: [], defaultDoneSection: null } },
        a,
        match(switched.version),
      )
    ).statusCode,
    400,
  );
  assert.equal(
    (
      await call(
        "DELETE",
        base + "/templates/" + model.id,
        undefined,
        a,
        match(switched.version),
      )
    ).statusCode,
    422,
  );
  const def = {
    views: ["LIST"],
    sections: [
      { name: "Revisão", semantic: "NONE" },
      { name: "Final", semantic: "DONE" },
    ],
    defaultDoneSection: 1,
  };
  data(
    await call(
      "PATCH",
      base + "/templates/" + model.id,
      { name: "Revisado", definition: def },
      a,
      match(switched.version),
    ),
  );
  const next = data(
    await call("POST", base + "/projects", { title: "Após edição" }, a),
  ).project;
  const nextDetail = data(
    await call("GET", base + "/projects/" + next.id, undefined, a),
  );
  assert.deepEqual(
    nextDetail.sections.map((x: any) => x.name),
    ["Revisão", "Final"],
  );
  assert.equal(
    data(await call("GET", base + "/projects/" + explicit.id, undefined, a))
      .sections.length,
    3,
  );
  await asContext(a, A.organization.id, async (ctx) => {
    const adapters = createWorkResourceAdapters();
    const pa = adapters.project;
    const result = await pa.applyImport!(
      ctx,
      [
        {
          schemaVersion: 1,
          sourceId: "definition",
          title: "Importado",
          description: "",
          visibility: "PUBLIC",
          views: ["CALENDAR"],
        },
      ],
      "project-definitions-v1",
    );
    assert.ok(result.idMap.definition);
    const stored = (
      await ctx.c.query(
        "SELECT assignment_mode,views FROM work_projects WHERE organization_id=$1 AND id=$2",
        [ctx.org.id, result.idMap.definition],
      )
    ).rows[0];
    assert.deepEqual(stored.views, ["CALENDAR"]);
  });
});

test("project JSON preview/import prefixes names, reports invalid items, persists hierarchy and dependencies, and reauthorizes replay", async () => {
  const a = await user(),
    A = data(
      await call("POST", "/organizations", { name: "Importação JSON" }, a),
    ),
    base = "/organizations/" + A.organization.id + "/work",
    endpoint = base + "/project-import";
  const document = {
    schemaVersion: 1,
    projects: [
      {
        sourceId: "p1",
        title: "Projeto",
        visibility: "PRIVATE",
        definition: {
          views: ["BOARD", "LIST"],
          sections: [
            { name: "Pendente", semantic: "NONE" },
            { name: "Feito", semantic: "DONE" },
          ],
          defaultDoneSection: 1,
        },
        tasks: [
          {
            sourceId: "child",
            title: "Filha",
            parentSourceId: "parent",
            status: "TODO",
            sectionIndex: 0,
            checklist: ["Verificar"],
          },
          { sourceId: "parent", title: "Pai", status: "TODO", sectionIndex: 0 },
          {
            sourceId: "done",
            title: "Entregue",
            status: "DONE",
            sectionIndex: 1,
          },
        ],
        dependencies: [
          {
            predecessorSourceId: "parent",
            successorSourceId: "done",
            type: "FF",
            lagMinutes: -15,
          },
        ],
      },
      {
        sourceId: "invalid",
        title: "Inválido",
        tasks: [
          { sourceId: "orphan", title: "Órfã", parentSourceId: "missing" },
        ],
      },
    ],
  };
  const before = data(await call("GET", base + "/projects", undefined, a))
    .projects.length;
  const preview = data(
    await call("POST", endpoint + "/preview", { document, prefix: "2027" }, a),
  );
  assert.deepEqual(
    preview.items.map((i: any) => i.status),
    ["READY", "INVALID"],
  );
  assert.equal(preview.items[0].title, "2027 Projeto");
  assert.equal(preview.items[1].code, "IMPORT_PARENT_MISSING");
  assert.equal(
    data(await call("GET", base + "/projects", undefined, a)).projects.length,
    before,
  );
  assert.equal(
    (
      await call(
        "POST",
        endpoint + "/apply",
        { document, prefix: "Outro", planHash: preview.planHash },
        a,
      )
    ).statusCode,
    409,
  );
  const command = randomUUID(),
    payload = { document, prefix: "2027", planHash: preview.planHash },
    result = data(
      await call("POST", endpoint + "/apply", payload, a, {
        "idempotency-key": command,
      }),
    );
  assert.deepEqual(
    result.report.map((i: any) => i.status),
    ["IMPORTED", "INVALID"],
  );
  const pid = result.report[0].projectId;
  const detail = data(
    await call("GET", base + "/projects/" + pid, undefined, a),
  );
  assert.equal(detail.project.title, "2027 Projeto");
  assert.equal(detail.sections.length, 2);
  await asContext(a, A.organization.id, async (ctx) => {
    const tasks = (
      await ctx.c.query(
        "SELECT * FROM work_tasks WHERE organization_id=$1 AND project_id=$2",
        [ctx.org.id, pid],
      )
    ).rows;
    assert.equal(tasks.length, 3);
    assert.equal(
      tasks.find((t: any) => t.title === "Filha").parent_id,
      tasks.find((t: any) => t.title === "Pai").id,
    );
    assert.ok(
      tasks.every((t: any) => t.starts_at === null && t.ends_at === null),
    );
    assert.equal(
      (
        await ctx.c.query(
          "SELECT * FROM work_dependencies WHERE organization_id=$1",
          [ctx.org.id],
        )
      ).rows[0].type,
      "FF",
    );
    assert.equal(
      (
        await ctx.c.query(
          "SELECT * FROM work_checklist WHERE organization_id=$1",
          [ctx.org.id],
        )
      ).rowCount,
      1,
    );
  });
  assert.deepEqual(
    data(
      await call("POST", endpoint + "/apply", payload, a, {
        "idempotency-key": command,
      }),
    ),
    result,
  );
  assert.equal(
    data(await call("GET", base + "/projects", undefined, a)).projects.length,
    before + 1,
  );
  await asContext(a, A.organization.id, async (ctx) => {
    await ctx.c.query(
      "DELETE FROM work_access WHERE organization_id=$1 AND project_id=$2 AND member_id=$3",
      [ctx.org.id, pid, ctx.member.id],
    );
  });
  assert.equal(
    (
      await call("POST", endpoint + "/apply", payload, a, {
        "idempotency-key": command,
      })
    ).statusCode,
    404,
    "cached imported private project report cannot bypass a revoked grant",
  );
  const stale = data(
    await call("POST", endpoint + "/preview", { document, prefix: "" }, a),
  );
  data(
    await call(
      "POST",
      base + "/settings",
      { defaultPrivacy: "PRIVATE" },
      a,
      match(0),
    ),
  );
  assert.equal(
    (
      await call(
        "POST",
        endpoint + "/apply",
        { document, prefix: "", planHash: stale.planHash },
        a,
      )
    ).statusCode,
    409,
  );
});

test("monthly statistics reconstruct observed states, exclude personal/private tasks and distinguish unknown history from zero", async () => {
  const a = await user(),
    b = await user(),
    A = data(
      await call("POST", "/organizations", { name: "Estatísticas mensais" }, a),
    ),
    root = "/organizations/" + A.organization.id,
    base = root + "/work";
  data(await call("POST", root + "/members", { accountId: b.id }, a));
  const p = data(
      await call("POST", base + "/projects", { title: "Público observado" }, a),
    ).project,
    q = data(
      await call(
        "POST",
        base + "/projects",
        { title: "Privado alheio", visibility: "PRIVATE" },
        b,
      ),
    ).project;
  const t = data(
      await call(
        "POST",
        base + "/tasks",
        { title: "Mudança observada", projectId: p.id },
        a,
      ),
    ).task,
    legacy = data(
      await call(
        "POST",
        base + "/tasks",
        { title: "Legado sintético", projectId: p.id, parentId: t.id },
        a,
      ),
    ).task;
  data(
    await call("POST", base + "/tasks", { title: "Pessoal não exportável" }, a),
  );
  data(
    await call(
      "POST",
      base + "/tasks",
      { title: "Privada invisível", projectId: q.id },
      b,
    ),
  );
  data(
    await call(
      "PATCH",
      base + "/tasks/" + legacy.id,
      { status: "IN_PROGRESS" },
      a,
      match(1),
    ),
  );
  data(
    await call(
      "PATCH",
      base + "/tasks/" + t.id,
      { status: "DONE" },
      a,
      match(1),
    ),
  );
  const now = new Date(),
    month = now.toISOString().slice(0, 7),
    start = new Date(month + "-01T00:00:00Z"),
    previous = new Date(start);
  previous.setUTCMonth(previous.getUTCMonth() - 1);
  const previousMonth = previous.toISOString().slice(0, 7),
    oldTime = new Date(+previous + 86400000).toISOString(),
    newTime = new Date(+start + 1000).toISOString();
  // Synthetic historical fixture, restricted to this disposable database and Work tables.
  const fixturePool = new pg.Pool({ connectionString: migrationUrl.href }),
    fixture = await fixturePool.connect();
  try {
    await fixture.query("BEGIN");
    await fixture.query("SELECT set_config('orgmap.organization_id',$1,true)", [
      A.organization.id,
    ]);
    await fixture.query(
      "UPDATE work_tasks SET created_at=$3 WHERE organization_id=$1 AND id=$2",
      [A.organization.id, t.id, oldTime],
    );
    await fixture.query(
      "UPDATE work_tasks SET created_at=NULL WHERE organization_id=$1 AND id=$2",
      [A.organization.id, legacy.id],
    );
    await fixture.query(
      "UPDATE work_task_observations SET observed_at=CASE WHEN kind='CREATED' THEN $3::timestamptz ELSE $4::timestamptz END WHERE organization_id=$1 AND task_id=$2",
      [A.organization.id, t.id, oldTime, newTime],
    );
    await fixture.query(
      "UPDATE work_task_observations SET kind='BASELINE',status='IN_PROGRESS',observed_at=$3,actor_member_id=NULL WHERE organization_id=$1 AND task_id=$2",
      [A.organization.id, legacy.id, oldTime],
    );
    await fixture.query("COMMIT");
  } catch (e) {
    await fixture.query("ROLLBACK");
    throw e;
  } finally {
    fixture.release();
    await fixturePool.end();
  }
  const past = data(
    await call(
      "GET",
      base + "/statistics?month=" + previousMonth,
      undefined,
      a,
    ),
  );
  assert.equal(past.totalProjects, 1);
  assert.equal(past.total, 2);
  assert.equal(past.byStatus.TODO, 1);
  assert.equal(past.byStatus.IN_PROGRESS, 1);
  assert.equal(past.completed, 0);
  assert.equal(past.created, 1);
  assert.equal(past.coverage.unknownCreationDates, 1);
  assert.equal(past.coverage.personalTasksExcluded, true);
  assert.equal(past.coverage.state, "PARTIAL");
  const current = data(
    await call("GET", base + "/statistics?month=" + month, undefined, a),
  );
  assert.equal(current.total, 2);
  assert.equal(current.completedPercent, 50);
  assert.equal(current.created, 0);
  assert.equal(
    current.changes,
    1,
    "multiple SQL writes in one command do not count the same task twice",
  );
  assert.equal(current.coverage.state, "OBSERVED");
  assert.equal(current.activeParticipants, 1);
  const earlier = new Date(previous);
  earlier.setUTCMonth(earlier.getUTCMonth() - 1);
  const unknown = data(
    await call(
      "GET",
      base + "/statistics?month=" + earlier.toISOString().slice(0, 7),
      undefined,
      a,
    ),
  );
  assert.equal(unknown.total, null);
  assert.equal(unknown.completedPercent, null);
  assert.equal(unknown.coverage.state, "UNAVAILABLE");
  assert.equal(
    (await call("GET", base + "/statistics?month=2026-13", undefined, a))
      .statusCode,
    400,
  );
  assert.equal(
    (await call("GET", base + "/statistics?month=2100-01", undefined, a))
      .statusCode,
    400,
  );
});

test("rich project/task descriptions roundtrip PostgreSQL, preserve literal legacy text, reject unsafe schemas and respect ACL/version/copy/import", async () => {
  const { validateRichDocument, toPlainText } =
    await import("../../packages/content/index.js");
  const doc = validateRichDocument({
    format: "orgmap-richtext",
    version: 1,
    doc: {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            {
              type: "text",
              text: "  Olá 👩🏽‍💻 & <b>literal</b>  ",
              marks: [
                { type: "bold" },
                { type: "italic" },
                { type: "underline" },
                { type: "strike" },
              ],
            },
            { type: "hardBreak" },
            {
              type: "text",
              text: "Referência",
              marks: [
                {
                  type: "link",
                  attrs: { href: "https://example.test/reference?q=a%26b" },
                },
              ],
            },
          ],
        },
        {
          type: "bulletList",
          content: [
            {
              type: "listItem",
              content: [
                {
                  type: "paragraph",
                  content: [{ type: "text", text: "Próximo passo" }],
                },
              ],
            },
          ],
        },
        {
          type: "orderedList",
          attrs: { start: 3 },
          content: [
            {
              type: "listItem",
              content: [
                {
                  type: "paragraph",
                  content: [{ type: "text", text: "Três  " }],
                },
              ],
            },
          ],
        },
      ],
    },
  });
  const a = await user(),
    b = await user(),
    A = data(
      await call(
        "POST",
        "/organizations",
        { name: "Conteúdo rico Trabalho" },
        a,
      ),
    ),
    root = "/organizations/" + A.organization.id,
    base = root + "/work";
  const bm = data(
    await call("POST", root + "/members", { accountId: b.id }, a),
  ).membership;
  const p = data(
    await call(
      "POST",
      base + "/projects",
      { title: "Projeto rico", visibility: "PRIVATE", descriptionRich: doc },
      a,
    ),
  ).project;
  assert.deepEqual(p.descriptionRich, doc);
  assert.equal(p.description, toPlainText(doc));
  assert.equal(
    (await call("GET", base + "/projects/" + p.id, undefined, b)).statusCode,
    404,
  );
  const t = data(
    await call(
      "POST",
      base + "/tasks",
      { title: "Tarefa rica", projectId: p.id, descriptionRich: doc },
      a,
    ),
  ).task;
  assert.deepEqual(t.descriptionRich, doc);
  assert.deepEqual(
    data(await call("GET", base + "/tasks/" + t.id, undefined, a)).task
      .descriptionRich,
    doc,
  );
  const duplicate = data(
    await call(
      "POST",
      base + "/tasks/" + t.id + "/duplicate",
      { title: "Cópia rica" },
      a,
      match(1),
    ),
  ).task;
  assert.deepEqual(duplicate.descriptionRich, doc);
  const unsafe = structuredClone(doc);
  unsafe.doc.content = [
    {
      type: "paragraph",
      content: [
        {
          type: "text",
          text: "Link inválido",
          marks: [{ type: "link", attrs: { href: "javascript:alert(1)" } }],
        },
      ],
    },
  ];
  assert.equal(
    (
      await call(
        "PATCH",
        base + "/tasks/" + t.id,
        { descriptionRich: unsafe },
        a,
        match(1),
      )
    ).statusCode,
    400,
  );
  assert.deepEqual(
    data(await call("GET", base + "/tasks/" + t.id, undefined, a)).task
      .descriptionRich,
    doc,
  );
  assert.equal(
    (
      await call(
        "PATCH",
        base + "/projects/" + p.id,
        { descriptionRich: { ...doc, version: 2 } },
        a,
        match(1),
      )
    ).statusCode,
    400,
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
  const configured = data(
    await call(
      "PATCH",
      base + "/projects/" + p.id,
      { descriptionRich: doc },
      a,
      match(2),
    ),
  ).project;
  assert.deepEqual(configured.descriptionRich, doc);
  assert.equal(configured.description, toPlainText(doc));
  assert.equal(configured.version, 3);
  assert.equal(
    (
      await call(
        "PATCH",
        base + "/tasks/" + t.id,
        { descriptionRich: doc },
        b,
        match(1),
      )
    ).statusCode,
    403,
  );
  const literal =
    '{"format":"orgmap-richtext","version":1} <script>literal & seguro</script>';
  const plain = data(
    await call(
      "PATCH",
      base + "/tasks/" + t.id,
      { description: literal },
      a,
      match(1),
    ),
  ).task;
  assert.equal(plain.description, literal);
  assert.equal(plain.descriptionRich, null);
  assert.equal(
    (
      await call(
        "PATCH",
        base + "/tasks/" + t.id,
        { descriptionRich: doc },
        a,
        match(1),
      )
    ).statusCode,
    409,
  );
  assert.equal(
    data(await call("GET", base + "/tasks/" + t.id, undefined, a)).task
      .description,
    literal,
  );
  const restored = data(
    await call(
      "PATCH",
      base + "/tasks/" + t.id,
      { descriptionRich: doc },
      a,
      match(2),
    ),
  ).task;
  assert.deepEqual(restored.descriptionRich, doc);
  assert.equal(restored.description, toPlainText(doc));
  await asContext(a, A.organization.id, async (ctx) => {
    const stored = (
      await ctx.c.query(
        "SELECT description_rich,description FROM work_tasks WHERE organization_id=$1 AND id=$2",
        [ctx.org.id, t.id],
      )
    ).rows[0];
    assert.deepEqual(stored.description_rich, doc);
    assert.equal(stored.description, toPlainText(doc));
    const adapters = createWorkResourceAdapters();
    const exported = await adapters.task.export(ctx, [t.id], "TASKS");
    assert.deepEqual((exported.records[0] as any).descriptionRich, doc);
    const imported = await adapters.task.applyImport!(
      ctx,
      exported.records,
      "TASKS",
    );
    const importedRow = (
      await ctx.c.query(
        "SELECT description_rich FROM work_tasks WHERE organization_id=$1 AND id=$2",
        [ctx.org.id, imported.idMap[t.id]],
      )
    ).rows[0];
    assert.deepEqual(importedRow.description_rich, doc);
  });
  const document = {
      schemaVersion: 1,
      projects: [
        {
          sourceId: "rich-json",
          title: "JSON rico",
          descriptionRich: doc,
          tasks: [
            {
              sourceId: "rich-task",
              title: "Tarefa importada rica",
              descriptionRich: doc,
            },
          ],
        },
      ],
    },
    preview = data(
      await call("POST", base + "/project-import/preview", { document }, a),
    );
  assert.equal(preview.items[0].status, "READY");
  const report = data(
    await call(
      "POST",
      base + "/project-import/apply",
      { document, planHash: preview.planHash },
      a,
    ),
  ).report;
  const importedProject = data(
    await call("GET", base + "/projects/" + report[0].projectId, undefined, a),
  ).project;
  assert.deepEqual(importedProject.descriptionRich, doc);
  await asContext(a, A.organization.id, async (ctx) => {
    const children = (
      await ctx.c.query(
        "SELECT description_rich FROM work_tasks WHERE organization_id=$1 AND project_id=$2",
        [ctx.org.id, importedProject.id],
      )
    ).rows;
    assert.deepEqual(children[0].description_rich, doc);
  });
});

test("project context is tenant-scoped and does not grant access; archive and restore require original permissions and versions", async () => {
  const owner = await user(), outsider = await user();
  const org = data(await call("POST", "/organizations", {name: "Contexto Maré"}, owner));
  const otherOrg = data(await call("POST", "/organizations", {name: "Outro contexto"}, outsider));
  const root = `/organizations/${org.organization.id}`;
  const otherRoot = `/organizations/${otherOrg.organization.id}`;
  const member = data(await call("POST", root + "/members", {accountId: outsider.id}, owner)).membership;
  const base = root + "/work";
  const p = data(await call("POST", base + "/projects", {title: "Resultado pessoal", visibility: "PRIVATE", startsAt: "2026-11-01T12:00:00Z", endsAt: "2026-11-04T12:00:00Z", tags: ["pesquisa"], customFields: {"Critério":"Aprender"}}, owner)).project;
  assert.equal(p.circleId, null);
  assert.deepEqual(p.tags, ["pesquisa"]);
  assert.deepEqual(p.customFields, {"Critério":"Aprender"});
  assert.equal((await call("POST", base + `/projects/${p.id}/context`, {links: [{kind: "CIRCLE", targetId: otherOrg.rootCircle.id}]}, owner, match(p.version))).statusCode, 404);
  const linked = data(await call("POST", base + `/projects/${p.id}/context`, {links: [{kind:"PARTICIPANT", targetId:member.id}, {kind:"CIRCLE", targetId:org.rootCircle.id}]}, owner, match(p.version)));
  assert.equal(linked.links.length, 2);
  assert.equal((await call("GET", base + `/projects/${p.id}`, undefined, outsider)).statusCode, 404, "participation is not an access grant");
  assert.equal(data(await call("GET", base + `/projects/${p.id}/context`, undefined, owner)).links.length, 2);
  const stateId = randomUUID();
  const configured = data(await call("POST", base + `/projects/${p.id}/states`, {states: [{id:stateId,name:"Em revisão",semantic:"IN_PROGRESS"}]}, owner, match(linked.project.version))).project;
  const task = data(await call("POST", base + "/tasks", {title:"Ação", projectId:p.id}, owner)).task;
  const inReview = data(await call("PATCH", base + `/tasks/${task.id}`, {customStatusId:stateId,customFields:{"Evidência":"Entrevistas"}}, owner, match(task.version))).task;
  assert.equal(inReview.status, "IN_PROGRESS");
  assert.equal(inReview.customStatusId, stateId);
  assert.deepEqual(inReview.customFields,{"Evidência":"Entrevistas"});
  assert.equal((await call("POST", base + `/projects/${p.id}/states`, {states:[]}, owner, match(configured.version))).statusCode, 409);
  const archivedTask = data(await call("PATCH", base + `/tasks/${task.id}`, {archived:true}, owner, match(inReview.version))).task;
  assert.equal(data(await call("GET", base + "/tasks/archived", undefined, owner)).tasks[0].id, task.id);
  assert.equal((await call("POST", base + `/tasks/${task.id}/restore`, {}, outsider, match(archivedTask.version))).statusCode, 404);
  assert.equal((await call("POST", base + `/tasks/${task.id}/restore`, {}, owner, match(archivedTask.version - 1))).statusCode, 409);
  data(await call("POST", base + `/tasks/${task.id}/restore`, {}, owner, match(archivedTask.version)));
  assert.equal(data(await call("GET", base + `/tasks/${task.id}`, undefined, owner)).task.id, task.id);
  const archived = data(await call("PATCH", base + `/projects/${p.id}`, {archived:true}, owner, match(configured.version))).project;
  assert.equal(data(await call("GET", base + "/projects/archived", undefined, owner)).projects[0].id, p.id);
  assert.deepEqual(data(await call("GET", base + "/projects/archived", undefined, outsider)).projects, []);
  assert.equal((await call("POST", base + `/projects/${p.id}/restore`, {}, outsider, match(archived.version))).statusCode, 404);
  assert.equal((await call("POST", otherRoot + `/work/projects/${p.id}/restore`, {}, outsider, match(archived.version))).statusCode, 404);
  data(await call("POST", base + `/projects/${p.id}/restore`, {}, owner, match(archived.version)));
  assert.equal(data(await call("GET", base + `/projects/${p.id}`, undefined, owner)).project.id, p.id);
});

test("duplicate subtree remaps child identities, groups and internal dependencies", async () => {
  const a = await user();
  const A = data(await call("POST", "/organizations", {name:"Árvore Maré"}, a));
  const base = `/organizations/${A.organization.id}/work`;
  const p = data(await call("POST",base+"/projects",{title:"Resultado",visibility:"PRIVATE"},a)).project;
  const parent = data(await call("POST",base+"/tasks",{title:"Pai",projectId:p.id},a)).task;
  const group = data(await call("POST",base+`/tasks/${parent.id}/groups`,{name:"Bloco",position:0},a,match(parent.version))).group;
  const one = data(await call("POST",base+"/tasks",{title:"Primeira",projectId:p.id,parentId:parent.id,groupId:group.id},a)).task;
  const two = data(await call("POST",base+"/tasks",{title:"Segunda",projectId:p.id,parentId:parent.id,groupId:group.id},a)).task;
  data(await call("POST",base+`/tasks/${two.id}/dependencies`,{predecessorId:one.id,type:"FS",lagMinutes:0},a,match(two.version)));
  const parentNow = data(await call("GET",base+`/tasks/${parent.id}`,undefined,a)).task;
  const copy = data(await call("POST",base+`/tasks/${parent.id}/duplicate`,{title:"Cópia",includeSubtasks:true},a,match(parentNow.version))).task;
  const details = data(await call("GET",base+`/tasks/${copy.id}`,undefined,a));
  assert.equal(details.subtasks.length,2);
  assert.equal(details.groups.length,1);
  assert.notEqual(details.groups[0].id,group.id);
  assert.ok(details.subtasks.every((task:any)=>task.parentId===copy.id && task.subtaskGroupId===details.groups[0].id));
  const copyOne=details.subtasks.find((task:any)=>task.title==="Primeira"), copyTwo=details.subtasks.find((task:any)=>task.title==="Segunda");
  assert.notEqual(copyOne.id,one.id); assert.notEqual(copyTwo.id,two.id);
  const copyTwoDetails=data(await call("GET",base+`/tasks/${copyTwo.id}`,undefined,a));
  assert.ok(copyTwoDetails.dependencies.some((edge:any)=>edge.predecessorId===copyOne.id && edge.successorId===copyTwo.id));
  const archived = data(await call("PATCH",base+`/tasks/${parent.id}`,{archived:true},a,match(parentNow.version))).task;
  assert.equal((await call("GET",base+`/tasks/${one.id}`,undefined,a)).statusCode,404);
  const archivedItems=data(await call("GET",base+"/tasks/archived?projectId="+p.id,undefined,a)).tasks;
  assert.ok(archivedItems.some((item:any)=>item.id===one.id && item.archivedByAncestor));
  data(await call("POST",base+`/tasks/${parent.id}/restore`,{},a,match(archived.version)));
  assert.equal(data(await call("GET",base+`/tasks/${one.id}`,undefined,a)).task.id,one.id);
});

test("organization-configured project states are versioned, tenant scoped and cannot be removed while assigned", async () => {
  const a=await user(), b=await user();
  const A=data(await call("POST","/organizations",{name:"Estados Maré"},a));
  const base=`/organizations/${A.organization.id}/work`;
  await call("POST",`/organizations/${A.organization.id}/members`,{accountId:b.id},a);
  const p=data(await call("POST",base+"/projects",{title:"Resultado",visibility:"PRIVATE"},a)).project;
  const stateId=randomUUID();
  const initial=data(await call("GET",base+"/project-states",undefined,a));
  assert.equal((await call("POST",base+"/project-states",{states:[{id:stateId,name:"Em descoberta",semantic:"IN_PROGRESS"}]},b,match(initial.version))).statusCode,403);
  const configured=data(await call("POST",base+"/project-states",{states:[{id:stateId,name:"Em descoberta",semantic:"IN_PROGRESS"}]},a,match(initial.version)));
  const updated=data(await call("PATCH",base+`/projects/${p.id}`,{projectStateId:stateId},a,match(p.version))).project;
  assert.equal(updated.projectStateId,stateId);
  assert.equal((await call("POST",base+"/project-states",{states:[]},a,match(configured.version))).statusCode,409);
  assert.equal((await call("PATCH",base+`/projects/${p.id}`,{projectStateId:randomUUID()},a,match(updated.version))).statusCode,422);
  const viewId=randomUUID();
  const saved=data(await call("POST",base+"/project-views",{views:[{id:viewId,name:"Em foco",view:"BOARD",relevance:"MINE",query:"resultado",sort:"TITLE"}]},a,match(0)));
  assert.equal(saved.version,1);
  assert.equal(data(await call("GET",base+"/project-views",undefined,a)).views[0].id,viewId);
  assert.deepEqual(data(await call("GET",base+"/project-views",undefined,b)).views,[]);
  assert.equal((await call("POST",base+"/project-views",{views:[]},a,match(0))).statusCode,409);
  const layout=data(await call("GET",base+"/layout",undefined,a)).layout;
  assert.equal(layout.view,"LIST", "saving a project view preserves the task layout");
});

test("bulk task updates reject stale versions atomically and update each selected task once", async () => {
  const a=await user(); const A=data(await call("POST","/organizations",{name:"Lote Maré"},a)); const base=`/organizations/${A.organization.id}/work`;
  const one=data(await call("POST",base+"/tasks",{title:"Um"},a)).task;
  const two=data(await call("POST",base+"/tasks",{title:"Dois"},a)).task;
  const stale=await call("POST",base+"/tasks/bulk",{items:[{id:one.id,version:one.version},{id:two.id,version:two.version+1}],status:"DONE"},a);
  assert.equal(stale.statusCode,409);
  assert.equal(data(await call("GET",base+`/tasks/${one.id}`,undefined,a)).task.status,"TODO");
  const updated=data(await call("POST",base+"/tasks/bulk",{items:[{id:one.id,version:one.version},{id:two.id,version:two.version}],status:"DONE"},a));
  assert.equal(updated.tasks.length,2);
  assert.ok(updated.tasks.every((task:any)=>task.status==="DONE" && task.version===2));
});

test("project catalog views round trip role filters and grouping without granting access or accepting foreign tenant identities", async () => {
  const owner=await user(), other=await user();
  const A=data(await call("POST","/organizations",{name:"Vistas de projetos A"},owner));
  const B=data(await call("POST","/organizations",{name:"Vistas de projetos B"},other));
  const root=`/organizations/${A.organization.id}`, base=root+"/work", otherRoot=`/organizations/${B.organization.id}`;
  const member=data(await call("POST",root+"/members",{accountId:other.id},owner)).membership;
  const ownerMembership=data(await call("GET",root+"/bootstrap",undefined,owner)).membership;
  const localRole=data(await call("POST",root+"/roles",{name:"Pesquisa",circleId:A.rootCircle.id,mode:"DIRECT"},owner)).role;
  const foreignRole=data(await call("POST",otherRoot+"/roles",{name:"Pesquisa",circleId:B.rootCircle.id,mode:"DIRECT"},other)).role;
  const foreignMember=data(await call("GET",otherRoot+"/bootstrap",undefined,other)).membership;
  const hidden=data(await call("POST",base+"/projects",{title:"Resultado restrito",visibility:"PRIVATE"},owner)).project;
  data(await call("POST",base+`/projects/${hidden.id}/context`,{links:[{kind:"ROLE",targetId:localRole.id},{kind:"PARTICIPANT",targetId:member.id}]},owner,match(hidden.version)));
  let version=0;
  for(const grouping of ["NONE","STATE","CIRCLE","PERSON","ROLE","TAG"]) {
    const view={id:randomUUID(),name:`Recorte ${grouping}`,view:"GALLERY",relevance:"ALL",query:"resultado",sort:grouping === "ROLE" ? "PROGRESS" : "DUE",roleFilter:localRole.id,personFilter:ownerMembership.id,circleFilter:A.rootCircle.id,grouping};
    const saved=data(await call("POST",base+"/project-views",{views:[view]},owner,match(version)));
    version=saved.version;
    const reloaded=data(await call("GET",base+"/project-views",undefined,owner));
    assert.equal(reloaded.version,version);
    assert.deepEqual(reloaded.views,[{...view,stateFilter:"",tagFilter:"",orderIds:[],visibleProperties:["state","participants","due","progress"],archived:false}]);
  }
  const original=data(await call("GET",base+"/project-views",undefined,owner));
  const view=original.views[0];
  for(const invalid of [{roleFilter:foreignRole.id},{roleFilter:A.rootCircle.id},{roleFilter:randomUUID()},{circleFilter:B.rootCircle.id},{personFilter:foreignMember.id}]) {
    assert.equal((await call("POST",base+"/project-views",{views:[{...view,...invalid}]},owner,match(version))).statusCode,404);
    assert.deepEqual(data(await call("GET",base+"/project-views",undefined,owner)),original,"a rejected reference leaves the saved view/version intact");
  }
  assert.equal((await call("POST",base+"/project-views",{views:[{...view,roleFilter:"not-an-id"}]},owner,match(version))).statusCode,400);
  assert.deepEqual(data(await call("GET",base+"/project-views",undefined,other)).views,[],"views remain personal");
  data(await call("POST",base+"/project-views",{views:[{...view,id:randomUUID(),personFilter:member.id}]},other,match(0)));
  assert.equal((await call("GET",base+`/projects/${hidden.id}`,undefined,other)).statusCode,404,"descriptive role/participant links and a saved role view confer no project access");
  assert.equal((await call("POST",base+"/project-views",{views:[view]},owner,match(version-1))).statusCode,409);
  const taskLayout=data(await call("GET",base+"/layout",undefined,owner)).layout;
  assert.equal(taskLayout.sort,"POSITION");
  assert.equal(taskLayout.grouping,"SECTION");
});

test("bulk project updates enforce manager access and roll back stale batches", async () => {
  const owner=await user(), member=await user();
  const A=data(await call("POST","/organizations",{name:"Lote de projetos"},owner));
  const root=`/organizations/${A.organization.id}`,base=root+"/work";
  await call("POST",root+"/members",{accountId:member.id},owner);
  const first=data(await call("POST",base+"/projects",{title:"Primeiro",visibility:"PRIVATE"},owner)).project;
  const second=data(await call("POST",base+"/projects",{title:"Segundo",visibility:"PRIVATE"},owner)).project;
  assert.equal((await call("POST",base+"/projects/bulk",{items:[{id:first.id,version:first.version}],archive:true},member)).statusCode,404);
  assert.equal((await call("POST",base+"/projects/bulk",{items:[{id:first.id,version:first.version},{id:second.id,version:second.version+1}],archive:true},owner)).statusCode,409);
  assert.equal(data(await call("GET",base+`/projects/${first.id}`,undefined,owner)).project.id,first.id);
  const result=data(await call("POST",base+"/projects/bulk",{items:[{id:first.id,version:first.version},{id:second.id,version:second.version}],archive:true},owner));
  assert.equal(result.projects.length,2); assert.ok(result.projects.every((p:any)=>p.archived));
});

test("manual personal project order persists with ACL-scoped identities and atomic version rejection", async () => {
  const owner=await user(), other=await user();
  const A=data(await call("POST","/organizations",{name:"Ordem pessoal A"},owner));
  const B=data(await call("POST","/organizations",{name:"Ordem pessoal B"},other));
  const root=`/organizations/${A.organization.id}`,base=root+"/work";
  const member=data(await call("POST",root+"/members",{accountId:other.id},owner)).membership;
  const first=data(await call("POST",base+"/projects",{title:"Primeiro",visibility:"PRIVATE"},owner)).project;
  const second=data(await call("POST",base+"/projects",{title:"Segundo",visibility:"PRIVATE"},owner)).project;
  const hidden=data(await call("POST",base+"/projects",{title:"Restrito a outro membro",visibility:"PRIVATE"},other)).project;
  const foreign=data(await call("POST",`/organizations/${B.organization.id}/work/projects`,{title:"Outro tenant",visibility:"PRIVATE"},other)).project;
  const archived=data(await call("PATCH",base+`/projects/${second.id}`,{archived:true},owner,match(second.version))).project;
  const view={id:randomUUID(),name:"Minha ordem",view:"LIST",relevance:"ALL",query:"",sort:"MANUAL",grouping:"NONE",orderIds:[first.id]};
  const saved=data(await call("POST",base+"/project-views",{views:[view]},owner,match(0)));
  assert.deepEqual(saved.views[0].orderIds,[first.id]);
  assert.equal(saved.views[0].sort,"MANUAL");
  const original=data(await call("GET",base+"/project-views",undefined,owner));
  for(const badId of [hidden.id,foreign.id,archived.id,randomUUID()]) {
    assert.equal((await call("POST",base+"/project-views",{views:[{...view,orderIds:[first.id,badId]}]},owner,match(saved.version))).statusCode,404);
    assert.deepEqual(data(await call("GET",base+"/project-views",undefined,owner)),original);
  }
  assert.equal((await call("POST",base+"/project-views",{views:[{...view,orderIds:[first.id,first.id]}]},owner,match(saved.version))).statusCode,400);
  const restored=data(await call("POST",base+`/projects/${second.id}/restore`,{},owner,match(archived.version))).project;
  const reordered=data(await call("POST",base+"/project-views",{views:[{...view,orderIds:[second.id,first.id]}]},owner,match(saved.version)));
  assert.deepEqual(data(await call("GET",base+"/project-views",undefined,owner)).views[0].orderIds,[second.id,first.id]);
  assert.equal((await call("POST",base+"/project-views",{views:[{...view,orderIds:[first.id,second.id]}]},owner,match(saved.version))).statusCode,409);
  assert.deepEqual(data(await call("GET",base+"/project-views",undefined,owner)).views[0].orderIds,[second.id,first.id],"stale order leaves persisted order and version untouched");
  assert.deepEqual(data(await call("GET",base+"/project-views",undefined,other)).views,[]);
  const grant=data(await call("POST",base+`/projects/${first.id}/access`,{memberId:member.id,role:"READER"},owner,match(first.version)));
  data(await call("POST",base+"/project-views",{views:[view]},other,match(0)));
  data(await call("POST",base+`/projects/${first.id}/access`,{memberId:member.id,role:null},owner,match(grant.version)));
  const afterRevocation=data(await call("GET",base+"/project-views",undefined,other));
  assert.deepEqual(afterRevocation.views[0].orderIds,[],"GET does not return revoked project references");
  assert.equal((await call("POST",base+"/project-views",{views:[view]},other,match(afterRevocation.version))).statusCode,404);
  assert.equal(data(await call("GET",base+`/projects/${restored.id}`,undefined,owner)).project.version,restored.version,"ordering does not mutate shared project versions");
  assert.equal(reordered.version,saved.version+1);
});

test("project view visible properties round trip across layouts with legacy defaults and atomic whitelist validation", async()=>{
  const owner=await user(), other=await user();
  const A=data(await call("POST","/organizations",{name:"Metadados da vista"},owner));
  const root=`/organizations/${A.organization.id}`,base=root+"/work";
  data(await call("POST",root+"/members",{accountId:other.id},owner));
  const legacy={id:randomUUID(),name:"Legada",view:"LIST",relevance:"ALL",query:"",sort:"TITLE"};
  let result=data(await call("POST",base+"/project-views",{views:[legacy]},owner,match(0)));
  assert.deepEqual(result.views[0].visibleProperties,["state","participants","due","progress"],"omitting the new field preserves default metadata");
  for(const view of ["LIST","GALLERY","BOARD"]) for(const visibleProperties of [[],["state"],["participants","due"],["state","participants","due","progress"]]) {
    result=data(await call("POST",base+"/project-views",{views:[{...legacy,view,visibleProperties}]},owner,match(result.version)));
    const reloaded=data(await call("GET",base+"/project-views",undefined,owner));
    assert.equal(reloaded.views[0].view,view);
    assert.deepEqual(reloaded.views[0].visibleProperties,visibleProperties);
    assert.equal(reloaded.version,result.version);
  }
  const original=data(await call("GET",base+"/project-views",undefined,owner));
  for(const visibleProperties of [["title"],["state","state"],"state",null]) {
    assert.equal((await call("POST",base+"/project-views",{views:[{...legacy,visibleProperties}]},owner,match(result.version))).statusCode,400);
    assert.deepEqual(data(await call("GET",base+"/project-views",undefined,owner)),original);
  }
  assert.equal((await call("POST",base+"/project-views",{views:[{...legacy,visibleProperties:[]}]},owner,match(result.version-1))).statusCode,409);
  assert.deepEqual(data(await call("GET",base+"/project-views",undefined,owner)),original);
  assert.deepEqual(data(await call("GET",base+"/project-views",undefined,other)).views,[]);
});

test("saved project views persist the archived scope without exposing another member's archive",async()=>{
  const owner=await user(), other=await user();
  const A=data(await call("POST","/organizations",{name:"Arquivo pessoal de vistas"},owner)),root=`/organizations/${A.organization.id}`,base=root+"/work";
  data(await call("POST",root+"/members",{accountId:other.id},owner));
  const project=data(await call("POST",base+"/projects",{title:"Arquivo pesquisável",visibility:"PRIVATE",tags:["história"]},owner)).project;
  data(await call("PATCH",base+`/projects/${project.id}`,{archived:true},owner,match(project.version)));
  const view={id:randomUUID(),name:"História",view:"LIST",relevance:"ALL",query:"arquivo",sort:"TITLE",archived:true,tagFilter:"história"};
  const saved=data(await call("POST",base+"/project-views",{views:[view]},owner,match(0)));
  const reloaded=data(await call("GET",base+"/project-views",undefined,owner));
  assert.equal(reloaded.views[0].archived,true);assert.equal(reloaded.views[0].query,"arquivo");assert.equal(reloaded.views[0].tagFilter,"história");
  assert.equal(data(await call("GET",base+"/projects/archived",undefined,owner)).projects[0].title,"Arquivo pesquisável");
  assert.deepEqual(data(await call("GET",base+"/projects/archived",undefined,other)).projects,[]);
  assert.deepEqual(data(await call("GET",base+"/project-views",undefined,other)).views,[]);
  for(const archived of ["all",null])assert.equal((await call("POST",base+"/project-views",{views:[{...view,archived}]},owner,match(saved.version))).statusCode,400);
  assert.deepEqual(data(await call("GET",base+"/project-views",undefined,owner)),reloaded);
  const {archived,...legacy}=view;
  assert.equal(data(await call("POST",base+"/project-views",{views:[legacy]},owner,match(saved.version))).views[0].archived,false);
});

test("organization JSON export imports new project and task properties without granting access", async () => {
  const owner=await user(), other=await user();
  const A=data(await call("POST","/organizations",{name:"Transporte Maré"},owner));
  const root=`/organizations/${A.organization.id}`,base=root+"/work";
  const member=data(await call("POST",root+"/members",{accountId:other.id},owner)).membership;
  const project=data(await call("POST",base+"/projects",{title:"Resultado",visibility:"PRIVATE",startsAt:"2026-11-01T12:00:00Z",tags:["aprendizado"],customFields:{Critério:"Evidência"}},owner)).project;
  const stateId=randomUUID();
  const configured=data(await call("POST",base+`/projects/${project.id}/states`,{states:[{id:stateId,name:"Em revisão",semantic:"IN_PROGRESS"}]},owner,match(project.version))).project;
  const linked=data(await call("POST",base+`/projects/${project.id}/context`,{links:[{kind:"PARTICIPANT",targetId:member.id}]},owner,match(configured.version))).project;
  const task=data(await call("POST",base+"/tasks",{projectId:project.id,title:"Investigar"},owner)).task;
  const changed=data(await call("PATCH",base+`/tasks/${task.id}`,{customStatusId:stateId,customFields:{Fonte:"Campo"}},owner,match(task.version))).task;
  data(await call("POST",base+`/tasks/${task.id}/checklist`,{title:"Ouvir",done:true},owner,match(changed.version)));
  const {createOrganizationExportAdapter}=await import("../../server/modules/work/organization-export.js");
  const records=await asContext(owner,A.organization.id,async(ctx)=>{
    const selection=randomUUID();
    await ctx.c.query("INSERT INTO work_export_selections(organization_id,id,owner_id,account_id,command_key,kind,include_private,project_ids,months) VALUES($1,$2,$3,$4,$5,'TASKS',false,$6,'{}')",[ctx.org.id,selection,ctx.member.id,owner.id,randomUUID(),[project.id]]);
    const adapter=createOrganizationExportAdapter({}, {project:async()=>({}),mayCreate:()=>true});
    return (await adapter.export!(ctx,[selection],"TASKS",{includePrivate:false})).records;
  });
  const document={schemaVersion:"orgmap-transfer-v1",resourceType:"work-export",kind:"TASKS",records,manifest:{}};
  const endpoint=base+"/project-import";
  const preview=data(await call("POST",endpoint+"/preview",{document,prefix:"Cópia"},owner));
  assert.equal(preview.items[0].status,"READY",JSON.stringify(preview));
  const result=data(await call("POST",endpoint+"/apply",{document,prefix:"Cópia",planHash:preview.planHash},owner));
  assert.equal(result.report[0].status,"IMPORTED",JSON.stringify(result));
  const copyId=result.report[0].projectId;
  const copy=data(await call("GET",base+`/projects/${copyId}`,undefined,owner)).project;
  assert.deepEqual(copy.tags,["aprendizado"]);assert.deepEqual(copy.customFields,{Critério:"Evidência"});assert.equal(copy.taskStates[0].id,stateId);
  assert.equal(data(await call("GET",base+`/projects/${copyId}/context`,undefined,owner)).links[0].targetId,member.id);
  assert.equal((await call("GET",base+`/projects/${copyId}`,undefined,other)).statusCode,404);
  const copied=data(await call("GET",base+`/tasks?projectId=${copyId}`,undefined,owner)).tasks[0];
  assert.deepEqual(copied.customFields,{Fonte:"Campo"});assert.equal(copied.customStatusId,stateId);
  const definitionCopy=await asContext(owner,A.organization.id,async(ctx)=>{
    const adapter=createWorkResourceAdapters({}).project;
    const exported=await adapter.export!(ctx,[project.id],"project-definitions-v1",{includePrivate:false});
    const imported=await adapter.applyImport!(ctx,exported.records,"project-definitions-v1");
    return imported.idMap[project.id];
  });
  const definition=data(await call("GET",base+`/projects/${definitionCopy}`,undefined,owner)).project;
  assert.deepEqual(definition.customFields,{Critério:"Evidência"});assert.deepEqual(definition.tags,["aprendizado"]);
  assert.equal(data(await call("GET",base+`/projects/${definitionCopy}/context`,undefined,owner)).links[0].targetId,member.id);
  assert.equal((await call("GET",base+`/projects/${definitionCopy}`,undefined,other)).statusCode,404);
  const otherOrg=data(await call("POST","/organizations",{name:"Destino diferente"},other));
  const otherEndpoint=`/organizations/${otherOrg.organization.id}/work/project-import`;
  const crossPreview=data(await call("POST",otherEndpoint+"/preview",{document,prefix:""},other));
  assert.equal(crossPreview.items[0].status,"INVALID");
  assert.equal(crossPreview.items[0].code,"IMPORT_CONTEXT_ORGANIZATION_MISMATCH");
});
