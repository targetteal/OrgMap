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
const db = "orgmap_work_comments_" + randomUUID().replaceAll("-", "");
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

test("legacy comment source preserves all rows, microseconds and literal content with cross-source cursor ranks and current Work ACL", async () => {
  const { createWorkLegacyCommentSource } =
      await import("../../server/modules/work/comments-legacy.js"),
    source = createWorkLegacyCommentSource(),
    a = await user(),
    b = await user(),
    A = data(
      await call("POST", "/organizations", { name: "Comentários A" }, a),
    ),
    B = data(
      await call("POST", "/organizations", { name: "Comentários B" }, b),
    ),
    base = "/organizations/" + A.organization.id + "/work",
    p = data(
      await call(
        "POST",
        base + "/projects",
        { title: "Privado legado", visibility: "PRIVATE" },
        a,
      ),
    ).project,
    t = data(
      await call(
        "POST",
        base + "/tasks",
        { title: "Tarefa de histórico", projectId: p.id },
        a,
      ),
    ).task,
    foreign = data(
      await call(
        "POST",
        "/organizations/" + B.organization.id + "/work/tasks",
        { title: "Tarefa estrangeira" },
        b,
      ),
    ).task;
  const bm = data(
    await call(
      "POST",
      "/organizations/" + A.organization.id + "/members",
      { accountId: b.id },
      a,
    ),
  ).membership;
  data(
    await call(
      "PATCH",
      "/organizations/" + A.organization.id + "/members/" + bm.id,
      { status: "SUSPENDED" },
      a,
      match(1),
    ),
  );
  const ids = Array.from({ length: 127 }, () => randomUUID()),
    literal = '  {"x":"<b>& literal</b>"}\n\n',
    fixturePool = new pg.Pool({ connectionString: migrationUrl.href }),
    fixture = await fixturePool.connect();
  try {
    await fixture.query("BEGIN");
    await fixture.query("SELECT set_config('orgmap.organization_id',$1,true)", [
      A.organization.id,
    ]);
    for (let i = 0; i < ids.length; i++)
      await fixture.query(
        "INSERT INTO work_comments(organization_id,id,task_id,author_id,content,created_at) VALUES($1,$2,$3,$4,$5,$6::timestamptz)",
        [
          A.organization.id,
          ids[i],
          t.id,
          i === 0 ? bm.id : A.membership.id,
          literal + i,
          i === 0
            ? "2026-10-19T00:00:00.123455Z"
            : i === 126
              ? "2026-10-19T00:00:00.123457Z"
              : "2026-10-19T00:00:00.123456Z",
        ],
      );
    await fixture.query("COMMIT");
  } catch (e) {
    await fixture.query("ROLLBACK");
    throw e;
  } finally {
    fixture.release();
    await fixturePool.end();
  }
  await asContext(a, A.organization.id, async (ctx) => {
    const before = (
      await ctx.c.query(
        "SELECT id,author_id,content,created_at FROM work_comments WHERE organization_id=$1 ORDER BY id",
        [ctx.org.id],
      )
    ).rows;
    const first = await source.list(ctx, { taskId: t.id, take: 101 });
    assert.equal(first.length, 101);
    assert.equal(first[0].id, ids[0]);
    assert.equal(first[0].createdAt, "2026-10-19T00:00:00.123455Z");
    assert.equal(first[0].authorId, bm.id);
    assert.equal(first[0].content, literal + "0");
    const boundary = first.at(-1)!;
    const second = await source.list(ctx, {
      taskId: t.id,
      take: 101,
      after: {
        createdAt: boundary.createdAt,
        id: boundary.id,
        source: "WORK_LEGACY",
      },
    });
    const all = [...first, ...second];
    assert.equal(all.length, 127);
    assert.equal(new Set(all.map((r) => r.id)).size, 127);
    assert.equal(all.at(-1)!.createdAt, "2026-10-19T00:00:00.123457Z");
    const cross = await source.list(ctx, {
      taskId: t.id,
      take: 101,
      after: {
        createdAt: boundary.createdAt,
        id: boundary.id,
        source: "PLATFORM",
      },
    });
    assert.deepEqual(
      cross,
      second,
      "legacy rank0 never repeats an item after equal timestamp/id from rank1",
    );
    const after = (
      await ctx.c.query(
        "SELECT id,author_id,content,created_at FROM work_comments WHERE organization_id=$1 ORDER BY id",
        [ctx.org.id],
      )
    ).rows;
    assert.deepEqual(after, before, "reading never rewrites legacy rows");
    await assert.rejects(() =>
      source.list(ctx, { taskId: foreign.id, take: 1 }),
    );
    await assert.rejects(() => source.list(ctx, { taskId: t.id, take: 102 }));
  });
  assert.equal((await pool.query("SELECT * FROM work_comments")).rowCount, 0);
});

test("compatibility comment append rolls back with the Work task update and retries atomically", async () => {
  const a = await user(),
    A = data(
      await call("POST", "/organizations", { name: "Rollback comentários" }, a),
    ),
    org = A.organization.id,
    base = "/organizations/" + org + "/work",
    t = data(
      await call("POST", base + "/tasks", { title: "Comentário atômico" }, a),
    ).task,
    key = randomUUID(),
    headers = { ...match(1), "idempotency-key": key },
    url = base + "/tasks/" + t.id + "/comments";
  const fixture = new pg.Pool({ connectionString: migrationUrl.href });
  try {
    await fixture.query(
      `CREATE FUNCTION work_test_comment_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic Work comment rollback'; END $$`,
    );
    await fixture.query(
      `CREATE TRIGGER work_test_comment_failure BEFORE UPDATE ON work_tasks FOR EACH ROW EXECUTE FUNCTION work_test_comment_failure()`,
    );
    const failed = await call(
      "POST",
      url,
      { content: "Permanece somente após ACK" },
      a,
      headers,
    );
    assert.equal(failed.statusCode, 500);
    const detail = data(
      await call("GET", base + "/tasks/" + t.id, undefined, a),
    );
    assert.equal(detail.task.version, 1);
    assert.deepEqual(detail.comments, []);
    await fixture.query("DROP TRIGGER work_test_comment_failure ON work_tasks");
    const saved = await call(
      "POST",
      url,
      { content: "Permanece somente após ACK" },
      a,
      headers,
    );
    assert.equal(saved.statusCode, 201);
    assert.equal(data(saved).task.version, 2);
    const replay = await call(
      "POST",
      url,
      { content: "Permanece somente após ACK" },
      a,
      headers,
    );
    assert.equal(replay.statusCode, 201);
    assert.deepEqual(data(replay), data(saved));
    const final = data(
      await call("GET", base + "/tasks/" + t.id, undefined, a),
    );
    assert.equal(final.task.version, 2);
    assert.equal(final.comments.length, 1);
    assert.equal(final.comments[0].source, "PLATFORM");
    await asContext(a, org, async (ctx) =>
      assert.equal(
        (
          await ctx.c.query(
            "SELECT count(*)::int AS n FROM work_comments WHERE organization_id=$1 AND task_id=$2",
            [org, t.id],
          )
        ).rows[0].n,
        0,
      ),
    );
  } finally {
    await fixture.query(
      "DROP TRIGGER IF EXISTS work_test_comment_failure ON work_tasks",
    );
    await fixture.query("DROP FUNCTION IF EXISTS work_test_comment_failure()");
    await fixture.end();
  }
});
