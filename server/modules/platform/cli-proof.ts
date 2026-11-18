/** Test-only subprocess proof; refuses any nonexclusive database. */
import assert from "node:assert/strict";
import { mock } from "node:test";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { writeFile, readFile } from "node:fs/promises";
import { join } from "node:path";
import { createServer } from "node:http";
import pg from "pg";
import { buildApp } from "../../src/app.js";
import { createRuntime } from "../../src/runtime.js";
import { pool } from "../../src/db.js";
import {
  createOrgMapIntegration,
  createIntegratedDispatcher,
} from "../../integration/index.js";
import { createPlatformScheduling } from "./scheduling.js";
import { PostgresScopeDispatch } from "./dispatcher.js";
if (
  !/^\/orgmap_platform_cli_[a-f0-9]+$/.test(
    new URL(process.env.DATABASE_URL!).pathname,
  )
)
  throw Error("Exclusive CLI proof database required");
const blobsDirectory = process.env.PLATFORM_BLOBS_DIRECTORY!;
const origin = "http://platform-cli.localhost:5177";
process.env.ALLOWED_ORIGINS = origin;
const mark = (phase: string) => process.stderr.write(JSON.stringify({phase,pid:process.pid,at:new Date().toISOString()})+"\n");
mark("startup");
const core = createRuntime();
let app = await buildApp([createOrgMapIntegration({ blobsDirectory })], {
  migrationMaxPrefix: 999,
});
let cookie = "",
  csrf = "";
const call = async (
  method: string,
  url: string,
  payload?: object,
  version?: number,
) =>
  app.inject({
    method: method as any,
    url,
    payload,
    headers: {
      origin,
      cookie,
      "x-csrf-token": csrf,
      "idempotency-key": randomUUID(),
      ...(version === undefined ? {} : { "if-match": '"' + version + '"' }),
    },
  });
const ok = (r: any, status = 200) => {
  assert.equal(r.statusCode, status, r.body);
  return r.json().data;
};
async function runCli(extraEnv: Record<string, string> = {}) {
  mark("worker-cli-start");
  await new Promise<void>((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [
        "--import",
        "tsx",
        "server/modules/platform/worker-cli.ts",
        "server/modules/platform/composition.ts",
        "--once",
      ],
      {
        env: { ...process.env, ...extraEnv },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    let output = "";
    child.stdout.on("data", (v) => {
      output += v.toString();
    });
    child.stderr.on("data", (v) => {
      output += v.toString();
    });
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(Error("CLI did not terminate after --once"));
    }, 20000);
    child.once("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.once("exit", (code) => {
      clearTimeout(timer);
      code === 0 ? resolve() : reject(Error("CLI failed: " + output));
    });
  });
}
async function schedulingProof(org: string, member: string) {
  mark("scheduling-start");
  const scheduling = createPlatformScheduling("interoperability");
  const dispatchPool = new pg.Pool({
      connectionString: process.env.PLATFORM_DISPATCH_DATABASE_URL,
    }),
    scopes = new PostgresScopeDispatch(dispatchPool);
  const wakes = () =>
    core.withWorkerContext(
      org,
      member,
      async (ctx) =>
        (
          await ctx.c.query(
            "SELECT id,available_at,claim_token FROM platform_scope_wakes WHERE organization_id=$1 AND member_id=$2",
            [org, member],
          )
        ).rows,
    );
  let deliveries = 0,
    failReceiver = false,
    signatureSeen = false;
  const receiver = createServer(async (req, res) => {
    for await (const _ of req) {
    }
    signatureSeen ||= typeof req.headers["x-orgmap-signature"] === "string";
    if (failReceiver) res.writeHead(503).end();
    else {
      deliveries++;
      res.writeHead(204).end();
    }
  });
  await new Promise<void>((resolve) =>
    receiver.listen(0, "127.0.0.1", resolve),
  );
  try {
    await assert.rejects(
      core.withWorkerContext(org, member, async (ctx) => {
        await scheduling.schedule(ctx);
        throw Error("producer rollback");
      }),
    );
    assert.equal((await wakes()).length, 0);
    // The producer's JavaScript clock can be ahead of PostgreSQL. Immediate
    // scheduling must still be claimable without waiting for that clock.
    mock.timers.enable({ apis: ["Date"], now: Date.now() + 60_000 });
    try {
      await core.withWorkerContext(org, member, (ctx) => scheduling.schedule(ctx));
    } finally {
      mock.timers.reset();
    }
    const skewedClockClaim = await scopes.claim(["interoperability"]);
    assert.ok(skewedClockClaim, "Immediate wake must be due even when the producer clock is ahead");
    assert.equal(await scopes.release(skewedClockClaim, false), true);
    assert.equal((await wakes()).length, 0);
    await core.withWorkerContext(org, member, (ctx) =>
      scheduling.schedule(ctx),
    );
    assert.equal(await scopes.claim(), null);
    assert.equal((await wakes()).length, 1); // No registered participant must not acknowledge its wake.
    const current = await scopes.claim(["interoperability"]);
    assert.ok(current);
    await core.withWorkerContext(org, member, (ctx) =>
      scheduling.schedule(ctx, { availableAt: new Date(Date.now() + 3600000) }),
    );
    assert.equal(await scopes.release(current, false), true);
    assert.equal((await wakes()).length, 1);
    assert.equal(await scopes.claim(["interoperability"]), null);
    await core.withWorkerContext(org, member, async (ctx) => {
      await ctx.c.query(
        "UPDATE platform_scope_wakes SET available_at=now() WHERE organization_id=$1 AND member_id=$2",
        [org, member],
      );
    });
    const expired = await scopes.claim(["interoperability"]);
    assert.ok(expired);
    await core.withWorkerContext(org, member, async (ctx) => {
      await ctx.c.query(
        "UPDATE platform_worker_scopes SET lease_until=now()-interval '1 second' WHERE organization_id=$1 AND member_id=$2",
        [org, member],
      );
    });
    const recovered = await scopes.claim(["interoperability"]);
    assert.ok(recovered);
    assert.equal(await scopes.release(expired, false), false);
    assert.equal(await scopes.release(recovered, false), true);
    assert.equal((await wakes()).length, 0);
    // Exercise only the other module's supported API/worker port. No SQL into interop tables.
    const configuration: Record<
      string,
      { endpoint: string; secret: string; allowLocalHttp: boolean }
    > = {};
    await app.close();
    app = await buildApp(
      [createOrgMapIntegration({ blobsDirectory, deliveries: configuration })],
      { migrationMaxPrefix: 999 },
    );
    const base = "/api/v1/organizations/" + org + "/interoperability";
    const connection = ok(
      await call("POST", base + "/connections", {
        provider: "LOCAL",
        label: "Platform scheduler local proof",
      }),
    ).connection;
    configuration[org + ":" + connection.id] = {
      endpoint:
        "http://127.0.0.1:" + (receiver.address() as any).port + "/receiver",
      secret: "synthetic-scheduling-signature-key",
      allowLocalHttp: true,
    };
    const queuePath = base + "/connections/" + connection.id + "/deliveries";
    async function enqueue() {
      const event = ok(
        await call("POST", base + "/calendar-events", {
          uid: randomUUID() + "@example.test",
          sequence: 0,
          summary: "Synthetic automatic delivery",
          startsAt: "2026-10-20T10:00:00Z",
          endsAt: "2026-10-20T11:00:00Z",
          source: "LOCAL",
          cancelled: false,
        }),
      ).event;
      return ok(await call("POST", queuePath, { calendarEventId: event.id }))
        .delivery;
    }
    const queued = await enqueue();
    assert.equal((await wakes()).length, 1);
    const originalClaim = scopes.claim.bind(scopes);
    const originalRelease = scopes.release.bind(scopes);
    const observed: { lastClaim: Awaited<ReturnType<typeof scopes.claim>>; failed?: boolean } = { lastClaim: null };
    scopes.claim = async (...args) => (observed.lastClaim = await originalClaim(...args));
    scopes.release = async (scope, failed, repeat) => { observed.failed = failed; return originalRelease(scope, failed, repeat); };
    const dispatcher = createIntegratedDispatcher(scopes, {
      blobsDirectory,
      deliveries: configuration,
    });
    const configPath = join(blobsDirectory, "operator-proof.json");
    await writeFile(
      configPath,
      JSON.stringify({ blobsDirectory, deliveries: configuration }),
      { mode: 0o600 },
    );
    await app.close();
    await runCli({ ORGMAP_INTEGRATION_CONFIG: configPath });
    assert.equal(deliveries, 1);
    assert.equal(signatureSeen, true);
    await runCli({ ORGMAP_INTEGRATION_CONFIG: configPath });
    assert.equal((await wakes()).length, 0);
    app = await buildApp(
      [createOrgMapIntegration({ blobsDirectory, deliveries: configuration })],
      { migrationMaxPrefix: 999 },
    );
    assert.equal(
      ok(await call("GET", queuePath)).items.find(
        (x: any) => x.id === queued.id,
      ).state,
      "DELIVERED",
    );
    // HTTP 503 cannot prove the receiver performed no side effect.
    mark("scheduling-http-unknown");
    failReceiver = true;
    const unknown = await enqueue();
    await dispatcher.runOnce();
    failReceiver = false;
    assert.equal(ok(await call("GET", queuePath)).items.find((x: any) => x.id === unknown.id).state, "OUTCOME_UNKNOWN");
    await dispatcher.runOnce(); // Drain the dispatcher's immediate continuation wake.
    assert.equal(await dispatcher.runOnce(), false);
    assert.equal(ok(await call("GET", queuePath)).items.find((x: any) => x.id === unknown.id).attempts, 1);
    // A refused connection proves the network operation never reached a receiver.
    const unavailable = createServer();
    await new Promise<void>((resolve) => unavailable.listen(0, "127.0.0.1", resolve));
    const unavailablePort = (unavailable.address() as any).port;
    await new Promise<void>((resolve, reject) => unavailable.close(error => error ? reject(error) : resolve()));
    const configKey = org + ":" + connection.id;
    const normalEndpoint = configuration[configKey].endpoint;
    configuration[configKey].endpoint = `http://127.0.0.1:${unavailablePort}/receiver`;
    const retry = await enqueue();
    mark("scheduling-preconnect-retry");
    try { await dispatcher.runOnce(); } finally { configuration[configKey].endpoint = normalEndpoint; }
    assert.ok(observed.lastClaim, "The dispatcher must claim a due scope for the failed delivery");
    assert.equal(observed.lastClaim.organizationId, org, "The claimed scope must belong to the fixture organization");
    assert.equal(observed.lastClaim.memberId, member, "The claimed scope must belong to the fixture member");
    assert.ok(observed.lastClaim.participants?.includes("interoperability"), "The claimed scope must include the delivery participant");
    assert.equal(observed.failed, false, "The dispatcher must complete its participants before releasing the scope");
    const failedDelivery = ok(await call("GET", queuePath)).items.find(
      (item: any) => item.id === retry.id,
    );
    assert.equal(failedDelivery.state, "FAILED");
    const scheduled = (await wakes()).sort(
      (a, b) =>
        new Date(a.available_at).getTime() - new Date(b.available_at).getTime(),
    );
    assert.equal(
      scheduled.length,
      2,
      "Immediate repeat and domain retry must both remain durable",
    );
    assert.ok(
      new Date(scheduled[1].available_at).getTime() >
        new Date(scheduled[0].available_at).getTime(),
    );
    const retryWake = scheduled[1];
    // Hold only our scheduling wake while checking ACK preservation. A busy host
    // may spend the domain's real 2–3s retry delay between these assertions.
    await core.withWorkerContext(org, member, (ctx) =>
      ctx.c.query(
        "UPDATE platform_scope_wakes SET available_at=now()+interval '1 hour' WHERE organization_id=$1 AND id=$2",
        [org, retryWake.id],
      ),
    );
    await dispatcher.runOnce(); // Drain immediate repeat, leaving the future retry wake intact.
    const future = await wakes();
    assert.equal(future.length, 1);
    assert.equal(future[0].id, retryWake.id);
    assert.equal(await dispatcher.runOnce(), false);
    await core.withWorkerContext(org, member, (ctx) =>
      ctx.c.query(
        "UPDATE platform_scope_wakes SET available_at=$3 WHERE organization_id=$1 AND id=$2",
        [org, retryWake.id, retryWake.available_at],
      ),
    );
    const delay = await core.withWorkerContext(
      org,
      member,
      async (ctx) =>
        (
          await ctx.c.query(
            "SELECT greatest(0,extract(epoch FROM ($1::timestamptz-clock_timestamp()))*1000)::int AS delay",
            [retryWake.available_at],
          )
        ).rows[0].delay as number,
    );
    assert.ok(delay < 6000, "Unexpected domain retry delay");
    await new Promise((resolve) => setTimeout(resolve, delay + 75));
    await dispatcher.runOnce();
    await dispatcher.runOnce();
    const retried = ok(await call("GET", queuePath)).items.find(
      (x: any) => x.id === retry.id,
    );
    assert.equal(retried.state, "DELIVERED");
    assert.equal(retried.attempts, 2);
    assert.equal(deliveries, 2);
    assert.equal((await wakes()).length, 0);
    mark("scheduling-retry-complete");
    const revoked = await enqueue();
    ok(
      await call(
        "POST",
        base + "/connections/" + connection.id + "/revoke",
        {},
        connection.version,
      ),
    );
    await dispatcher.runOnce();
    assert.equal(deliveries, 2);
    assert.equal(
      ok(await call("GET", queuePath)).items.find(
        (x: any) => x.id === revoked.id,
      ).state,
      "REVOKED",
    );
  } finally {
    await dispatchPool.end();
    await new Promise<void>((resolve) => receiver.close(() => resolve()));
  }
}
async function importDestinationProof(org: string) {
  mark("import-start");
  const base = "/api/v1/organizations/" + org;
  const title = "Projeto de contexto · " + randomUUID();
  const project = ok(
    await call("POST", base + "/work/projects", {
      title,
      visibility: "PUBLIC",
    }),
    201,
  ).project;
  const document = JSON.parse(
    await readFile(
      "tests/fixtures/platform-import-project.json",
      "utf8",
    ),
  );
  const targets = ok(
    await call("POST", base + "/platform/imports/targets", {
      document,
      query: title,
    }),
  );
  assert.equal(targets.supported, true);
  assert.deepEqual(targets.items, [
    { id: project.id, type: "project", title, canImport: true },
  ]);
  const preview = ok(
    await call("POST", base + "/platform/imports/preview", {
      document,
      resourceId: targets.items[0].id,
    }),
  );
  assert.equal(preview.recordCount, 1);
  const job = ok(
    await call("POST", base + "/platform/imports", {
      document,
      resourceId: targets.items[0].id,
      planHash: preview.planHash,
    }),
    202,
  );
  await runCli();
  const completed = ok(await call("GET", base + "/platform/jobs/" + job.id));
  assert.equal(
    completed.state,
    "COMPLETED",
    JSON.stringify({
      state: completed.state,
      errorCode: completed.errorCode,
      attempts: ok(
        await call("GET", base + "/platform/jobs/" + job.id + "/attempts"),
      ).items,
    }),
  );
  const projects = ok(await call("GET", base + "/work/projects")).projects;
  assert.equal(
    projects.filter((p: any) => p.title === document.records[0].title).length,
    1,
  );
}
async function regularMemberNotificationProof(org: string, resourceId: string) {
  mark("member-notification-start");
  const register = await app.inject({
      method: "POST",
      url: "/api/v1/auth/register",
      headers: { origin },
      payload: {
        email: randomUUID() + "@example.test",
        password: "regular-member-notification-proof",
        displayName: "Follower",
      },
    }),
    account = ok(register, 201);
  const followerCookie =
    register.cookies[0].name + "=" + register.cookies[0].value;
  const asFollower = (
    method: string,
    url: string,
    payload?: object,
    version?: number,
  ) =>
    app.inject({
      method: method as any,
      url,
      payload,
      headers: {
        origin,
        cookie: followerCookie,
        "x-csrf-token": account.csrfToken,
        "idempotency-key": randomUUID(),
        ...(version === undefined ? {} : { "if-match": '"' + version + '"' }),
      },
    });
  const member = ok(
    await call("POST", "/api/v1/organizations/" + org + "/members", {
      accountId: account.account.id,
    }),
    201,
  ).membership.id;
  const base = "/api/v1/organizations/" + org + "/platform",
    resource = base + "/resources/circle/" + resourceId;
  ok(await asFollower("POST", resource + "/follow", { enabled: true }));
  ok(
    await asFollower(
      "POST",
      base + "/preferences",
      { event: "CommentAdded", channel: "EMAIL", enabled: false },
      1,
    ),
  );
  ok(
    await call("POST", resource + "/comments", {
      content: "First followed comment",
    }),
    201,
  );
  const dispatchPool = new pg.Pool({
    connectionString: process.env.PLATFORM_DISPATCH_DATABASE_URL,
  });
  try {
    const dispatcher = createIntegratedDispatcher(
      new PostgresScopeDispatch(dispatchPool),
      { blobsDirectory },
    );
    assert.equal(await dispatcher.runOnce(), true);
    assert.equal(
      ok(await asFollower("GET", base + "/notifications")).items.length,
      1,
    );
    await core.withWorkerContext(org, member, async (ctx) => {
      const state = (
        await ctx.c.query(
          "SELECT available_at>now() AS delayed FROM platform_worker_scopes WHERE organization_id=$1 AND member_id=$2",
          [org, member],
        )
      ).rows[0];
      assert.equal(
        state.delayed,
        false,
        "An unrelated owner-only interop consumer must not back off regular-member platform notifications",
      );
    });
    ok(
      await call("POST", resource + "/comments", {
        content: "Second followed comment",
      }),
      201,
    );
    assert.equal(await dispatcher.runOnce(), true);
    assert.equal(
      ok(await asFollower("GET", base + "/notifications")).items.length,
      2,
    );
  } finally {
    await dispatchPool.end();
  }
}
try {
  mark("register-start");
  const registered = await call("POST", "/api/v1/auth/register", {
    email: randomUUID() + "@example.test",
    password: "exclusive-cli-proof-password-123",
    displayName: "CLI proof",
  });
  const auth = ok(registered, 201);
  cookie = registered.cookies[0].name + "=" + registered.cookies[0].value;
  csrf = auth.csrfToken;
  const created = ok(
      await call("POST", "/api/v1/organizations", {
        name: "Aurora CLI " + randomUUID(),
      }),
      201,
    ),
    org = created.organization.id,
    member = created.membership.id,
    resourceId = created.rootCircle.id;
  const base = "/api/v1/organizations/" + org + "/platform";
  const input = {
    resourceType: "circle",
    resourceIds: [resourceId],
    kind: "STRUCTURE",
    format: "JSON",
  };
  const first = ok(await call("POST", base + "/exports", input), 202);
  await app.close(); // No listening API, web request, cookie or browser participates in dispatch.
  await runCli();
  app = await buildApp([createOrgMapIntegration({ blobsDirectory })], {
    migrationMaxPrefix: 999,
  });
  const completed = ok(await call("GET", base + "/jobs/" + first.id));
  assert.equal(completed.state, "COMPLETED");
  const artifact = ok(
    await call(
      "GET",
      base + "/artifacts/" + completed.result.artifactId + "/download",
    ),
  );
  const doc = JSON.parse(Buffer.from(artifact.base64, "base64").toString());
  assert.equal(doc.kind, "STRUCTURE");
  assert.equal(doc.records[0].id, resourceId);
  const second = ok(await call("POST", base + "/exports", input), 202);
  await core.withWorkerContext(org, member, async (ctx) => {
    await ctx.c.query(
      "UPDATE platform_jobs SET state='RUNNING',attempts=1,lease_token=$3,lease_until=now()-interval '1 second' WHERE organization_id=$1 AND id=$2",
      [org, second.id, randomUUID()],
    );
    await ctx.c.query(
      "UPDATE platform_worker_scopes SET lease_token=$3,lease_until=now()-interval '1 second' WHERE organization_id=$1 AND member_id=$2",
      [org, member, randomUUID()],
    );
  });
  await app.close();
  await runCli(); // Entirely new Node process, resuming the persisted expired scope/job leases.
  app = await buildApp([createOrgMapIntegration({ blobsDirectory })], {
    migrationMaxPrefix: 999,
  });
  const resumed = ok(await call("GET", base + "/jobs/" + second.id));
  assert.equal(resumed.state, "COMPLETED");
  assert.equal(resumed.attempts, 2);
  await core.withWorkerContext(org, member, async (ctx) => {
    assert.equal(
      (
        await ctx.c.query(
          "SELECT count(*) FROM platform_artifacts WHERE organization_id=$1 AND job_id=$2",
          [org, second.id],
        )
      ).rows[0].count,
      "1",
    );
  });
  await schedulingProof(org, member);
  await regularMemberNotificationProof(org, resourceId);
  await importDestinationProof(org);
  console.log(
    JSON.stringify({
      scenario: "platform_cli_process_restart",
      jobsCompleted: 2,
      realAdapter: "circle",
      browserRequired: false,
      duplicateArtifacts: 0,
      schedulingAtomic: true,
      interopLocalHttpDelivered: 2,
      futureRetryPreserved: true,
      importDestinationDiscovery: true,
    }),
  );
} finally {
  await app.close();
  await pool.end();
}
