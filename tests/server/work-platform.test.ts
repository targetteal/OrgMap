import { test, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import pg from "pg";
import { spawn } from "node:child_process";

const adminUrl =
  process.env.MIGRATION_DATABASE_URL ??
  "postgres://orgmap_migrator:orgmap_local_only@127.0.0.1:55432/orgmap";
const admin = new pg.Pool({ connectionString: adminUrl }),
  db = "orgmap_work_transfer_" + randomUUID().replaceAll("-", "");
await admin.query(`CREATE DATABASE "${db}"`);
const url = new URL(adminUrl);
url.pathname = "/" + db;
try {
  // Programmatic dispatch uses the production readiness check. Its fixture
  // must install the complete composed schema and actual migration checksums.
  const env:NodeJS.ProcessEnv={...process.env,MIGRATION_DATABASE_URL:url.href};
  delete env.MIGRATION_SCOPE;delete env.MIGRATION_MAX_PREFIX;
  await new Promise<void>((ok,no)=>{
    const p=spawn(process.execPath,['--import','tsx','server/src/migrate.ts'],{env,stdio:['ignore','ignore','pipe']});
    p.stderr.resume();p.on('error',no);p.on('exit',code=>code===0?ok():no(Error('WORK_PLATFORM_MIGRATION_FAILED')));
  });
} catch (e) {
  await admin.query(`DROP DATABASE "${db}" WITH (FORCE)`);
  await admin.end();
  throw e;
}
const runtime = new URL(
  process.env.DATABASE_URL ??
    "postgres://orgmap_app:orgmap_app_local_only@127.0.0.1:55432/orgmap",
);
runtime.pathname = "/" + db;
process.env.DATABASE_URL = runtime.href;
const { pool } = await import("../../server/src/db.js");
assert.equal(
  (await pool.query("SELECT current_database() AS name")).rows[0].name,
  db,
);
const { buildApp } = await import("../../server/src/app.js"),
  { createRuntime } = await import("../../server/src/runtime.js");
const { workModule, createWorkResourceAdapters } =
  await import("../../server/modules/work/index.js");
const { ResourceRegistry } =
    await import("../../server/modules/platform/ports.js"),
  { FilesystemBlobStore } =
    await import("../../server/modules/platform/blob.js"),
  { PlatformWorker } = await import("../../server/modules/platform/worker.js"),
  { createPlatform } = await import("../../server/modules/platform/plugin.js");
const root = await mkdtemp(join(tmpdir(), "orgmap-work-transfer-")),
  blobs = new FilesystemBlobStore(root),
  registry = new ResourceRegistry();
for (const [type, adapter] of Object.entries(createWorkResourceAdapters()))
  registry.registerResourceAdapter(type, adapter);
const core = createRuntime(),
  worker = new PlatformWorker({
    withContext: (org, member, fn) => core.withWorkerContext(org, member, fn),
    registry,
    blobs,
  });
const { mountWorkTestHarness } =
  await import("../../server/modules/work/test-harness.js");
const app = await buildApp([
  async (app, core) => {
    await mountWorkTestHarness(app, core, { registry, blobs });
  },
]);
if (process.env.WORK_TEST_DEBUG)
  app.addHook("onError", async (_request, _reply, error) => {
    console.error(error.message);
  });
after(async () => {
  await app.close();
  await pool.end();
  await admin.query(`DROP DATABASE "${db}" WITH (FORCE)`);
  await admin.end();
  await rm(root, { recursive: true, force: true });
});
type User = { cookie: string; csrf: string };
async function call(method: string, path: string, payload?: any, u?: User) {
  return app.inject({
    method: method as any,
    url: "/api/v1" + path,
    payload,
    headers: {
      origin: "http://localhost:5173",
      "idempotency-key": randomUUID(),
      ...(u ? { cookie: u.cookie, "x-csrf-token": u.csrf } : {}),
    },
  });
}
function data(r: any) {
  assert.ok(r.statusCode >= 200 && r.statusCode < 300, r.body);
  return r.json().data;
}
test("canonical TASKS and STATISTICS complete through the real platform worker and authorized artifact download", async () => {
  const reg = await call("POST", "/auth/register", {
      email: randomUUID() + "@example.test",
      password: "work-worker-test-password",
      displayName: "Work worker tester",
    }),
    session = data(reg),
    u = {
      cookie: reg.cookies[0].name + "=" + reg.cookies[0].value,
      csrf: session.csrfToken,
    };
  const organization = data(
      await call(
        "POST",
        "/organizations",
        { name: "Transferência Trabalho sintética" },
        u,
      ),
    ),
    org = organization.organization.id,
    member = organization.membership.id,
    base = "/organizations/" + org;
  const p = data(
    await call(
      "POST",
      base + "/work/projects",
      { title: "Projeto privado para transferência", visibility: "PRIVATE" },
      u,
    ),
  ).project;
  const task = data(
    await call(
      "POST",
      base + "/work/tasks",
      { title: "Tarefa de exportação real", projectId: p.id },
      u,
    ),
  ).task;
  for (const kind of ["TASKS", "STATISTICS"]) {
    const queued = await call(
      "POST",
      base + "/platform/exports",
      { resourceType: "task", resourceIds: [task.id], kind, format: "JSON" },
      u,
    );
    assert.equal(queued.statusCode, 202, queued.body);
    const job = data(queued);
    assert.equal(await worker.runJob(org, member), true);
    const completed = data(
      await call("GET", base + "/platform/jobs/" + job.id, undefined, u),
    );
    assert.equal(completed.state, "COMPLETED", JSON.stringify(completed));
    assert.equal(completed.errorCode, null);
    const artifact = data(
      await call(
        "GET",
        base +
          "/platform/artifacts/" +
          completed.result.artifactId +
          "/download",
        undefined,
        u,
      ),
    );
    const document = JSON.parse(
      Buffer.from(artifact.base64, "base64").toString("utf8"),
    );
    assert.equal(document.kind, kind);
    assert.equal(document.resourceType, "task");
    assert.equal(document.schemaVersion, "orgmap-transfer-v1");
    assert.equal(document.manifest.estimated, false);
    if (kind === "TASKS") {
      assert.equal(document.records[0].sourceId, task.id);
      assert.equal(document.records[0].title, task.title);
    } else {
      assert.equal(document.records[0].total, 1);
      assert.equal(document.records[0].byStatus.TODO, 1);
      assert.equal(document.records[0].title, undefined);
      assert.equal(document.records[0].sourceId, undefined);
    }
  }
  const adapter = registry.get("task")!;
  await core.withWorkerContext(org, member, (ctx) =>
    assert.rejects(() => adapter.validateImport!(ctx, [], "STATISTICS")),
  );
  assert.equal(
    (
      await call(
        "POST",
        base + "/platform/exports",
        {
          resourceType: "task",
          resourceIds: [task.id],
          kind: "task-definitions-v1",
          format: "JSON",
        },
        u,
      )
    ).statusCode,
    422,
    "API canonical kinds are preserved",
  );
});
test("explicit private operational export is opt-in, Owner-only, revocable at worker/download/replay, and never grants read/search or personal-task export", async () => {
  let oversight = false;
  const privateRegistry = new ResourceRegistry();
  const adapters = createWorkResourceAdapters({
    privateOperationalExport: () => oversight,
  });
  for (const [type, adapter] of Object.entries(adapters))
    privateRegistry.registerResourceAdapter(type, adapter);
  const privateApp = await buildApp([
    async (app, core) => {
      await mountWorkTestHarness(app, core, {
        registry: privateRegistry,
        blobs,
      });
    },
  ]);
  const privateCore = createRuntime(),
    privateWorker = new PlatformWorker({
      withContext: (org, member, fn) =>
        privateCore.withWorkerContext(org, member, fn),
      registry: privateRegistry,
      blobs,
    });
  async function request(
    method: string,
    path: string,
    payload?: any,
    user?: User,
    extra: any = {},
  ) {
    return privateApp.inject({
      method: method as any,
      url: "/api/v1" + path,
      payload,
      headers: {
        origin: "http://localhost:5173",
        "idempotency-key": randomUUID(),
        ...(user ? { cookie: user.cookie, "x-csrf-token": user.csrf } : {}),
        ...extra,
      },
    });
  }
  async function register() {
    const r = await request("POST", "/auth/register", {
        email: randomUUID() + "@example.test",
        password: "private-worker-test-password",
        displayName: "Private export tester",
      }),
      d = data(r);
    return {
      id: d.account.id,
      cookie: r.cookies[0].name + "=" + r.cookies[0].value,
      csrf: d.csrfToken,
    };
  }
  try {
    const a = await register(),
      b = await register(),
      A = data(
        await request(
          "POST",
          "/organizations",
          { name: "Oversight sintético Aurora" },
          a,
        ),
      ),
      org = A.organization.id,
      member = A.membership.id,
      base = "/organizations/" + org;
    data(await request("POST", base + "/members", { accountId: b.id }, a));
    const p = data(
        await request(
          "POST",
          base + "/work/projects",
          { title: "Confidencial sem grant Owner", visibility: "PRIVATE" },
          b,
        ),
      ).project,
      t = data(
        await request(
          "POST",
          base + "/work/tasks",
          { title: "Confidencial tarefa", projectId: p.id },
          b,
        ),
      ).task,
      personal = data(
        await request(
          "POST",
          base + "/work/tasks",
          { title: "Pessoal jamais no export org" },
          b,
        ),
      ).task;
    const payload = {
      resourceType: "task",
      resourceIds: [t.id],
      kind: "TASKS",
      format: "JSON",
      includePrivate: true,
    };
    assert.equal(
      (await request("GET", base + "/work/tasks/" + t.id, undefined, a))
        .statusCode,
      404,
    );
    assert.equal(
      (
        await request(
          "POST",
          base + "/platform/exports",
          { ...payload, includePrivate: false },
          a,
        )
      ).statusCode,
      403,
    );
    assert.equal(
      (await request("POST", base + "/platform/exports", payload, a))
        .statusCode,
      403,
    );
    oversight = true;
    assert.equal(
      (await request("GET", base + "/work/tasks/" + t.id, undefined, a))
        .statusCode,
      404,
    );
    assert.deepEqual(
      data(
        await request(
          "GET",
          base + "/platform/search?q=Confidencial",
          undefined,
          a,
        ),
      ).items,
      [],
    );
    assert.equal(
      (
        await request(
          "POST",
          base + "/platform/exports",
          { ...payload, includePrivate: false },
          a,
        )
      ).statusCode,
      403,
    );
    assert.equal(
      (await request("POST", base + "/platform/exports", payload, b))
        .statusCode,
      403,
      "Member cannot opt into operational oversight",
    );
    assert.equal(
      (
        await request(
          "POST",
          base + "/platform/exports",
          { ...payload, resourceIds: [t.id, personal.id] },
          a,
        )
      ).statusCode,
      403,
    );
    await privateCore.withWorkerContext(org, member, (ctx) =>
      assert.rejects(() =>
        createWorkResourceAdapters().task.export(ctx, [t.id], "TASKS", {
          includePrivate: true,
        }),
      ),
    );
    const k = randomUUID(),
      queued = await request("POST", base + "/platform/exports", payload, a, {
        "idempotency-key": k,
      });
    assert.equal(queued.statusCode, 202, queued.body);
    const job = data(queued);
    assert.equal(await privateWorker.runJob(org, member), true);
    const completed = data(
      await request("GET", base + "/platform/jobs/" + job.id, undefined, a),
    );
    assert.equal(completed.state, "COMPLETED", JSON.stringify(completed));
    assert.equal(completed.includePrivate, true);
    const file = data(
        await request(
          "GET",
          base +
            "/platform/artifacts/" +
            completed.result.artifactId +
            "/download",
          undefined,
          a,
        ),
      ),
      doc = JSON.parse(Buffer.from(file.base64, "base64").toString());
    assert.equal(doc.records.length, 1);
    assert.equal(doc.records[0].sourceId, t.id);
    oversight = false;
    assert.equal(
      (
        await request(
          "GET",
          base +
            "/platform/artifacts/" +
            completed.result.artifactId +
            "/download",
          undefined,
          a,
        )
      ).statusCode,
      404,
    );
    assert.equal(
      (
        await request("POST", base + "/platform/exports", payload, a, {
          "idempotency-key": k,
        })
      ).statusCode,
      403,
    );
    oversight = true;
    const waiting = data(
      await request("POST", base + "/platform/exports", payload, a),
    );
    oversight = false;
    assert.equal(await privateWorker.runJob(org, member), true);
    assert.equal(
      (
        await request(
          "GET",
          base + "/platform/jobs/" + waiting.id,
          undefined,
          a,
        )
      ).statusCode,
      404,
    );
    oversight = true;
    const failed = data(
      await request("GET", base + "/platform/jobs/" + waiting.id, undefined, a),
    );
    assert.equal(failed.errorCode, "RESOURCE_NOT_FOUND");
    assert.equal(failed.state, "FAILED");
    assert.equal(failed.result, null);
  } finally {
    await privateApp.close();
  }
});

test("organization export queues through the real port, preserves hierarchy/months, and revalidates private intent at replay/worker/download", async () => {
  const { createWorkModule } =
      await import("../../server/modules/work/index.js"),
    { createExportJobPort } =
      await import("../../server/modules/platform/export-jobs.js");
  let oversight = false,
    failAfterEnqueue = false;
  const privateOperationalExport = () => oversight,
    adapters = createWorkResourceAdapters({ privateOperationalExport }),
    globalRegistry = new ResourceRegistry();
  for (const [type, adapter] of Object.entries(adapters))
    globalRegistry.registerResourceAdapter(type, adapter);
  const jobs = createExportJobPort(globalRegistry),
    options = {
      privateOperationalExport,
      tabularExports: false,
      exportJobs: {
        enqueue: async (ctx: any, input: any) => {
          const result = await jobs.enqueue(ctx, input);
          if (failAfterEnqueue)
            throw Error("synthetic producer rollback after real enqueue");
          return result;
        },
      },
    };
  const api = await buildApp([
      async (app, core) => {
        await mountWorkTestHarness(app, core, {
          registry: globalRegistry,
          blobs,
          workOptions: options,
        });
      },
    ]),
    globalCore = createRuntime(),
    globalWorker = new PlatformWorker({
      withContext: (org, member, fn) =>
        globalCore.withWorkerContext(org, member, fn),
      registry: globalRegistry,
      blobs,
    });
  const request = async (
    method: string,
    path: string,
    payload?: any,
    u?: any,
    extra: any = {},
  ) =>
    api.inject({
      method: method as any,
      url: "/api/v1" + path,
      payload,
      headers: {
        origin: "http://localhost:5173",
        "idempotency-key": randomUUID(),
        ...(u ? { cookie: u.cookie, "x-csrf-token": u.csrf } : {}),
        ...extra,
      },
    });
  const register = async () => {
    const r = await request("POST", "/auth/register", {
        email: randomUUID() + "@example.test",
        password: "work-export-test-only-123",
        displayName: "Exportação sintética",
      }),
      d = data(r);
    return {
      id: d.account.id,
      cookie: r.cookies[0].name + "=" + r.cookies[0].value,
      csrf: d.csrfToken,
    };
  };
  try {
    const a = await register(),
      b = await register(),
      A = data(
        await request(
          "POST",
          "/organizations",
          { name: "Exportação global sintética" },
          a,
        ),
      ),
      org = A.organization.id,
      mid = A.membership.id,
      base = "/organizations/" + org;
    data(await request("POST", base + "/members", { accountId: b.id }, a));
    const p = data(
        await request(
          "POST",
          base + "/work/projects",
          { title: "Projeto público" },
          a,
        ),
      ).project,
      empty = data(
        await request(
          "POST",
          base + "/work/projects",
          { title: "=SUM(1,2)" },
          a,
        ),
      ).project,
      q = data(
        await request(
          "POST",
          base + "/work/projects",
          { title: "Projeto privado alheio", visibility: "PRIVATE" },
          b,
        ),
      ).project;
    const parent = data(
        await request(
          "POST",
          base + "/work/tasks",
          {
            title: "Z pai",
            projectId: p.id,
            priority: "HIGH",
            estimateMinutes: 90,
            tags: ["comma, label", "=SUM(1,2)"],
          },
          a,
        ),
      ).task,
      child = data(
        await request(
          "POST",
          base + "/work/tasks",
          { title: "A filha", projectId: p.id, parentId: parent.id },
          a,
        ),
      ).task;
    data(
      await request(
        "POST",
        base + "/work/tasks",
        { title: "Tarefa pessoal omitida" },
        a,
      ),
    );
    data(
      await request(
        "POST",
        base + "/work/tasks",
        { title: "Conteúdo confidencial", projectId: q.id },
        b,
      ),
    );
    assert.equal(
      (await request("GET", base + "/work/projects/" + q.id, undefined, a))
        .statusCode,
      404,
    );
    assert.equal(
      (
        await request(
          "POST",
          base + "/work/exports",
          { kind: "TASKS", format: "XLSX" },
          a,
        )
      ).statusCode,
      503,
    );
    const run = async (
      kind: string,
      includePrivate = false,
      format: "JSON" | "CSV" | "XLSX" = "JSON",
    ) => {
      const command = randomUUID(),
        payload = { kind, format, includePrivate },
        response = await request("POST", base + "/work/exports", payload, a, {
          "idempotency-key": command,
        });
      assert.equal(response.statusCode, 202, response.body);
      const result = data(response);
      assert.equal(await globalWorker.runJob(org, mid), true);
      const job = data(
        await request(
          "GET",
          base + "/platform/jobs/" + result.job.id,
          undefined,
          a,
        ),
      );
      assert.equal(job.state, "COMPLETED", JSON.stringify(job));
      const artifact = data(
        await request(
          "GET",
          base + "/platform/artifacts/" + job.result.artifactId + "/download",
          undefined,
          a,
        ),
      );
      const projection = await globalCore.withWorkerContext(
        org,
        mid,
        async (ctx) => {
          const row = (
            await ctx.c.query(
              "SELECT resource_ids FROM platform_jobs WHERE organization_id=$1 AND id=$2",
              [org, result.job.id],
            )
          ).rows[0];
          return (await adapters["work-export"].export!(
            ctx,
            row.resource_ids,
            kind,
            { includePrivate, format },
          )) as any;
        },
      );
      return {
        result,
        command,
        payload,
        job,
        workbook: projection.workbook,
        bytes: Buffer.from(artifact.base64, "base64"),
        document:
          format === "JSON"
            ? JSON.parse(
                Buffer.from(artifact.base64, "base64").toString("utf8"),
              )
            : null,
      };
    };
    const normal = await run("TASKS");
    assert.equal(normal.result.selection.projects, 2);
    assert.equal(normal.document.records.length, 2);
    assert.ok(
      normal.document.records.some(
        (r: any) => r.sourceId === empty.id && r.tasks.length === 0,
      ),
    );
    const project = normal.document.records.find(
      (r: any) => r.sourceId === p.id,
    );
    assert.deepEqual(
      project.tasks.map((t: any) => t.sourceId),
      [parent.id, child.id],
    );
    assert.equal(project.tasks[1].parentSourceId, parent.id);
    assert.deepEqual(
      normal.workbook.sheets.map((sheet: any) => sheet.name),
      ["Tarefas", "Projetos"],
    );
    assert.deepEqual(
      normal.workbook.sheets[0].rows.map((r: any) => [r[2], r[3], r[4]]),
      [
        [parent.id, null, 0],
        [child.id, parent.id, 1],
      ],
    );
    assert.equal(
      normal.workbook.sheets[1].rows.length,
      2,
      "empty projects remain in the Projects sheet",
    );
    assert.ok(
      !JSON.stringify(normal.document).includes("Tarefa pessoal omitida"),
    );
    assert.ok(
      !JSON.stringify(normal.document).includes("Conteúdo confidencial"),
    );
    const monthly = await run("STATISTICS");
    assert.equal(monthly.document.records.length, 25);
    assert.equal(monthly.workbook.sheets[0].rows.length, 25);
    assert.equal(
      monthly.workbook.sheets[0].rows[0][2],
      null,
      "unavailable task counts remain null in the table projection",
    );
    assert.equal(monthly.document.records[0].coverage.state, "UNAVAILABLE");
    assert.equal(monthly.document.records[0].total, null);
    assert.equal(monthly.document.records.at(-1).total, 2);
    assert.equal(
      (
        await request(
          "POST",
          base + "/work/exports",
          { kind: "TASKS", format: "JSON", includePrivate: true },
          a,
        )
      ).statusCode,
      403,
    );
    oversight = true;
    const privateExport = await run("TASKS", true);
    assert.equal(privateExport.result.selection.projects, 3);
    assert.ok(
      JSON.stringify(privateExport.document).includes("Conteúdo confidencial"),
    );
    assert.equal(
      (await request("GET", base + "/work/projects/" + q.id, undefined, a))
        .statusCode,
      404,
      "export never grants ordinary read",
    );
    oversight = false;
    assert.equal(
      (
        await request(
          "GET",
          base +
            "/platform/artifacts/" +
            privateExport.job.result.artifactId +
            "/download",
          undefined,
          a,
        )
      ).statusCode,
      404,
    );
    assert.equal(
      (
        await request(
          "POST",
          base + "/work/exports",
          privateExport.payload,
          a,
          { "idempotency-key": privateExport.command },
        )
      ).statusCode,
      403,
    );
    oversight = true;
    const pending = data(
      await request(
        "POST",
        base + "/work/exports",
        { kind: "TASKS", format: "JSON", includePrivate: true },
        a,
      ),
    );
    oversight = false;
    assert.equal(await globalWorker.runJob(org, mid), true);
    await globalCore.withWorkerContext(org, mid, async (ctx) => {
      assert.equal(
        (
          await ctx.c.query(
            "SELECT state FROM platform_jobs WHERE organization_id=$1 AND id=$2",
            [org, pending.job.id],
          )
        ).rows[0].state,
        "FAILED",
      );
    });
    options.tabularExports = true;
    const xlsx = await run("TASKS", false, "XLSX"),
      csv = await run("TASKS", false, "CSV"),
      monthlyCsv = await run("STATISTICS", false, "CSV");
    assert.equal(xlsx.bytes.subarray(0, 2).toString(), "PK");
    assert.ok(
      csv.bytes.toString("utf8").includes("PROJECT_ONLY"),
      "CSV retains empty projects as explicit records",
    );
    assert.ok(
      csv.bytes.toString("utf8").includes("'=SUM(1,2)"),
      "formula-looking strings are neutralized in presentation CSV",
    );
    if (process.env.WORK_TEST_PYTHON) {
      const { execFileSync } = await import("node:child_process");
      const proof = JSON.parse(
        execFileSync(
          process.env.WORK_TEST_PYTHON,
          [
            "-c",
            `import sys,io,json,base64,csv,openpyxl
v=json.load(sys.stdin)
w=openpyxl.load_workbook(io.BytesIO(base64.b64decode(v['xlsx'])),data_only=False)
assert w.sheetnames==['Tarefas','Projetos']
rows=list(w['Tarefas'].values)
assert [r[2] for r in rows[1:]]==v['tasks']
assert [r[4] for r in rows[1:]]==[0,1]
assert w['Tarefas']['E2'].data_type=='n'
assert rows[1][14]=='HIGH' and rows[1][15]==90 and json.loads(rows[1][16])==['comma, label','=SUM(1,2)']
assert rows[2][14]=='NONE' and rows[2][15] is None and json.loads(rows[2][16])==[]
assert w['Projetos']['B2'].value=='=SUM(1,2)' or w['Projetos']['B3'].value=='=SUM(1,2)'
assert all(c.data_type!='f' for s in w for row in s for c in row)
c=list(csv.DictReader(io.StringIO(base64.b64decode(v['csv']).decode('utf8'))))
assert len(c)==3 and sum(r['Tipo de registro']=='PROJECT_ONLY' for r in c)==1
assert [r['Tarefa ID'] for r in c if r['Tipo de registro']=='TASK']==v['tasks']
p=next(r for r in c if r['Tarefa ID']==v['tasks'][0])
assert p['Prioridade']=='HIGH' and p['Estimativa (minutos)']=='90' and json.loads(p['Etiquetas (JSON)'])==['comma, label','=SUM(1,2)']
m=list(csv.DictReader(io.StringIO(base64.b64decode(v['monthly']).decode('utf8'))))
assert len(m)==25 and m[0]['Tarefas observadas']=='' and m[0]['Cobertura']=='UNAVAILABLE'
print(json.dumps({'xlsxSheets':w.sheetnames,'taskLevels':[r[4] for r in rows[1:]],'csvRows':len(c),'monthlyRows':len(m),'noFormulaCells':True}))`,
          ],
          {
            input: JSON.stringify({
              xlsx: xlsx.bytes.toString("base64"),
              csv: csv.bytes.toString("base64"),
              monthly: monthlyCsv.bytes.toString("base64"),
              tasks: [parent.id, child.id],
            }),
            encoding: "utf8",
          },
        ),
      );
      assert.equal(proof.monthlyRows, 25);
      console.log("# independent Work tabular proof " + JSON.stringify(proof));
    }
    const counts = await globalCore.withWorkerContext(
      org,
      mid,
      async (ctx) => ({
        selections: (
          await ctx.c.query(
            "SELECT count(*) FROM work_export_selections WHERE organization_id=$1",
            [org],
          )
        ).rows[0].count,
        jobs: (
          await ctx.c.query(
            "SELECT count(*) FROM platform_jobs WHERE organization_id=$1",
            [org],
          )
        ).rows[0].count,
      }),
    );
    failAfterEnqueue = true;
    assert.equal(
      (
        await request(
          "POST",
          base + "/work/exports",
          { kind: "TASKS", format: "JSON" },
          a,
        )
      ).statusCode,
      500,
    );
    const after = await globalCore.withWorkerContext(org, mid, async (ctx) => ({
      selections: (
        await ctx.c.query(
          "SELECT count(*) FROM work_export_selections WHERE organization_id=$1",
          [org],
        )
      ).rows[0].count,
      jobs: (
        await ctx.c.query(
          "SELECT count(*) FROM platform_jobs WHERE organization_id=$1",
          [org],
        )
      ).rows[0].count,
    }));
    assert.deepEqual(
      after,
      counts,
      "producer rollback removes both selection and real Platform job",
    );
  } finally {
    await api.close();
  }
});
